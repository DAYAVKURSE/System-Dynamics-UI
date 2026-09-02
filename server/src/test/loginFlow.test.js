import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  authStatus, authSupported, cancelLogin, findAuthUrl, findError, findToken, hasLogin,
  loggedIn, loginState, normalizeCode, plainText, putEnvValue, safeTail, saveToken, squash,
  startLogin, storeLogin, submitCode,
} from "../lib/loginFlow.js";

/* Вход в Claude Code из чата. Проверяется на поддельном `claude`, который
   повторяет поведение настоящего — обоих его способов входа.

   Способ 1, основной: `claude auth login` — обычная программа. Ссылка в
   stdout, код из stdin строкой, ответ словами. Проверено на живой команде
   версии 2.1.258: работает на простых каналах, без всякого терминала.

   Способ 2, запасной (старые версии без `auth`): `claude setup-token`. Он
   печатает токен на год, но только в настоящем терминале и только в свой
   экран на Ink. И принимает клавиши по своим правилам, на которых вход и
   ломался в проде:

   · «\n» Enter-ом не считается — Ink зовёт его «enter», а поле принимает
     только «return», то есть «\r»;
   · «\r» одним куском вместе с кодом тоже не срабатывает: длинный ввод
     Claude Code принимает за вставку и кладёт в поле целиком.

   Прежняя заглушка читала код обычным `read -r` из bash, который берёт и
   «\n», и «\r», — поэтому тесты были зелёными, а вход в проде молчал до
   таймаута («claude не выдал токен за 120 с»). Теперь заглушка на Node, с
   сырым stdin и теми же двумя правилами.

   Настоящий вход тут запускать нельзя: он выдал бы живой токен. */

const URL_OK = "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a"
  + "&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback"
  + "&scope=user%3Ainference&code_challenge=8nOIU6QB47RZ6mwjbTQPpWx6Inr3KEePLlCwmXnAOaM"
  + "&code_challenge_method=S256&state=mu4lGkX2b5eNUL3CoQvuKTZzNicEtr5FjWJOvxYGI_s";
const TOKEN = "sk-ant-oat01-ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ-testonly";
// Настоящий код — «код#состояние» и около сотни знаков: длина здесь не
// украшение, на ней и ломался Enter, присланный одним куском с кодом.
const CODE = `ac_${"A".repeat(70)}#${"s".repeat(43)}`;

let tmp, bins, stateFile;

const fake = (name, body, shebang = "#!/usr/bin/env bash") => {
  const file = path.join(bins, name);
  fs.writeFileSync(file, `${shebang}\n${body}\n`, { mode: 0o755 });
  return file;
};

/**
 * Поддельный claude. `withAuth` включает команды `auth` — так отличаются
 * свежая версия и старая, где остаётся только `setup-token`.
 */
const fakeClaude = (withAuth) => `
const fs = require("node:fs");
const URL = ${JSON.stringify(URL_OK)};
const CODE = ${JSON.stringify(CODE)};
const TOKEN = ${JSON.stringify(TOKEN)};
const STATE = process.env.FAKE_STATE || ${JSON.stringify("")};
const withAuth = ${withAuth ? "true" : "false"};
const w = (s) => process.stdout.write(s);
const argv = process.argv.slice(2);
const saved = () => { try { return fs.readFileSync(STATE, "utf8").trim() === "in"; } catch { return false; } };

if (argv[0] === "auth") {
  if (!withAuth) { process.stderr.write("error: unknown command 'auth'\\n"); process.exit(1); }
  if (argv[1] === "login" && argv.includes("--help")) { w("Usage: claude auth login\\n"); process.exit(0); }
  if (argv[1] === "status") {
    w(JSON.stringify({ loggedIn: saved(), authMethod: saved() ? "claude.ai" : "none" }, null, 2) + "\\n");
    process.exit(saved() ? 0 : 1);
  }
  if (argv[1] === "login") {
    w("Opening browser to sign in\\u2026\\n");
    w("If the browser didn't open, visit: " + URL + "\\n");
    w("Paste code here if prompted > ");
    let buf = "";
    process.stdin.on("data", (d) => {
      buf += String(d);
      let i;
      while ((i = buf.indexOf("\\n")) >= 0) {
        const code = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!code) continue;
        const parts = code.split("#");
        // Настоящий claude 2.1.258 пишет это БЕЗ всякого префикса и
        // продолжает читать. Заглушка, которая вместо этого выходила с
        // «Login failed», прятала как раз ту ветку, куда владелец и попадёт.
        if (!parts[0] || !parts[1]) {
          process.stderr.write("Invalid code. Please make sure the full code was copied.\\n");
          continue;
        }
        if (code === CODE) {
          try { fs.writeFileSync(STATE, "in"); } catch {}
          w("Login successful.\\n"); process.exit(0);
        }
        process.stderr.write("Login failed: Request failed with status code 400\\n");
        process.exit(1);
      }
    });
    setTimeout(() => process.exit(3), 60000).unref?.();
    return;
  }
  process.stderr.write("error: unknown command\\n"); process.exit(1);
}

if (argv[0] !== "setup-token") { process.stderr.write("error: unknown command\\n"); process.exit(1); }

w("Welcome to Claude Code v2.1.258\\n");
w("This will guide you through long-lived (1-year) auth token setup.\\n");
w("Browser didn't open? Use the url below to sign in (c to copy)\\n");
w("\\u001b]8;id=x;" + URL + "\\u0007\\u001b[37m" + URL + "\\u001b[39m\\u001b]8;;\\u0007\\n");
w("Paste code here if prompted > ");

let buf = "";
const submit = () => {
  const code = buf; buf = "";
  if (!code.trim()) return;
  if (!code.includes("#")) {
    w("\\nOAuth error: Invalid code. Please make sure the full code was copied");
    w("Press Enter to retry.\\n");
    return;                                  // процесс НЕ выходит — как настоящий
  }
  if (code !== CODE) {
    w("\\nOAuth error: Request failed with status code 400Press Enter to retry.\\n");
    return;
  }
  w("\\nProcessing authentication\\u2026\\n");
  setTimeout(() => {
    w("\\u2713 Long-lived authentication token created successfully!\\n");
    w("Your OAuth token (valid for 1 year):\\n" + TOKEN + "\\n");
    w("Store this token securely. You won't be able to see it again.\\n");
    process.exit(0);
  }, 100);
};

try { process.stdin.setRawMode(true); } catch {}
process.stdin.resume();
process.stdin.on("data", (d) => {
  const s = String(d);
  // Длинный кусок Claude Code считает вставкой и кладёт в поле целиком —
  // вместе с возвратом каретки, который поэтому Enter-ом не срабатывает.
  if (s.length > 16) { buf += s.replace(/[\\r\\n]/g, ""); return; }
  for (const ch of s) {
    if (ch === "\\r") submit();               // Ink: только «return» отправляет
    else if (ch === "\\n") continue;          // Ink зовёт это «enter» — не Enter
    else buf += ch;
  }
});
setTimeout(() => process.exit(3), 60000).unref?.();
`;

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "sd-login-"));
  bins = path.join(tmp, "bin");
  stateFile = path.join(tmp, "auth-state");
  process.env.FAKE_STATE = stateFile;
  await fsp.mkdir(bins, { recursive: true });

  fake("claude-new", fakeClaude(true), "#!/usr/bin/env node");    // с `auth login`
  fake("claude-old", fakeClaude(false), "#!/usr/bin/env node");   // только setup-token

  // Ссылку дал и умер, не дождавшись кода: у claude свой срок на
  // подтверждение, и владелец мог не успеть сходить в браузер.
  fake("claude-dies", `
const w = (s) => process.stdout.write(s);
w("If the browser didn't open, visit: ${URL_OK}\\n");
w("Paste code here if prompted > ");
setTimeout(() => { process.stderr.write("Login failed: authorization request expired\\n"); process.exit(1); }, 700);
`, "#!/usr/bin/env node");

  // Ссылку не печатает вовсе — так вело себя всё без псевдотерминала.
  fake("claude-silent", "sleep 30");

  // Печатает ссылку, переносом посреди параметров: собрать её нельзя.
  fake("claude-wrapped", `
printf '%s\\n' 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&code_chal'
printf '%s\\n' 'lenge=8nOIU6&state=mu4lGk'
sleep 30`);
});

afterAll(async () => { await fsp.rm(tmp, { recursive: true, force: true }); });
afterEach(() => {
  cancelLogin();
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  try { fs.rmSync(stateFile, { force: true }); } catch { /* не было */ }
});

const bin = (n) => path.join(bins, n);
const envPath = () => path.join(tmp, `env-${Math.random().toString(36).slice(2)}`);

describe("разбор вывода терминала", () => {
  it("ссылка достаётся из гиперссылки, а не остаётся с мусором", () => {
    const raw = `\x1b[32m?\x1b[0m \x1b]8;;${URL_OK}\x1b\\${URL_OK}\x1b]8;;\x1b\\\n`;
    expect(findAuthUrl(raw)).toBe(URL_OK);
    expect(plainText(raw)).not.toMatch(/\x1b/);
  });

  it("перенесённая посреди параметров ссылка отвергается, а не шлётся битой", () => {
    // Без code_challenge и state подтверждение входа не состоится: лучше
    // сказать «не разобрал», чем прислать владельцу нерабочую ссылку.
    const broken = "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1\nchallenge=8n";
    expect(findAuthUrl(broken)).toBeNull();
  });

  it("чужие ссылки из вывода за ссылку входа не сходят", () => {
    expect(findAuthUrl("см. https://docs.claude.com/setup и https://example.com/oauth/authorize"))
      .toBeNull();
  });

  it("токен находится по префиксу", () => {
    expect(findToken(`Token: ${TOKEN}\n`)).toBe(TOKEN);
    expect(findToken("ничего похожего")).toBeNull();
  });

  it("слова, расставленные курсором, а не пробелами, всё равно находятся", () => {
    // Ink двигает курсор («\x1b[12G») вместо пробелов — фраза после чистки
    // склеивается, и искать её можно только в слитном виде.
    const raw = "\x1b[2GPaste\x1b[8Gcode\x1b[13Ghere\x1b[18Gif\x1b[21Gprompted\x1b[30G>";
    expect(squash(raw)).toContain("pastecodehereifprompted");
  });

  it("жалоба claude достаётся из вывода словами", () => {
    const raw = "OAuth error: Invalid code. Please make sure the full code was copied"
      + "Press Enter to retry.";
    expect(findError(raw)).toBe("Invalid code. Please make sure the full code was copied");
    expect(findError("всё хорошо")).toBe("");
  });

  it("в сообщение об ошибке токен не просачивается", () => {
    expect(safeTail(`что-то пошло не так ${TOKEN}`)).not.toMatch(/sk-ant/);
    expect(safeTail(`что-то пошло не так ${TOKEN}`)).toMatch(/«токен»/);
  });
});

describe("код подтверждения", () => {
  it("«код#состояние» проходит как есть", () => {
    expect(normalizeCode(` ${CODE} `)).toBe(CODE);
  });

  it("перенос строки от почтового клиента не мешает", () => {
    expect(normalizeCode("ac_AAA\n#sss")).toBe("ac_AAA#sss");
  });

  it("вместо кода прислали ссылку возврата — берём из неё код и состояние", () => {
    expect(normalizeCode("https://platform.claude.com/oauth/code/callback?code=abc&state=xyz"))
      .toBe("abc#xyz");
  });

  it("рассказ вместо кода в чужой процесс не уезжает", () => {
    expect(normalizeCode("код с пробелами")).toBe("");
    expect(normalizeCode("")).toBe("");
    expect(normalizeCode("a".repeat(600))).toBe("");
  });
});

describe("файл .env", () => {
  it("строка добавляется, соседние секреты остаются на месте", () => {
    const f = envPath();
    fs.writeFileSync(f, "BRIDGE_TOKEN=abc\nTELEGRAM_BOT_TOKEN=def\n");
    putEnvValue("CLAUDE_CODE_OAUTH_TOKEN", TOKEN, f);
    const body = fs.readFileSync(f, "utf8");
    expect(body).toMatch(/^BRIDGE_TOKEN=abc$/m);
    expect(body).toMatch(/^TELEGRAM_BOT_TOKEN=def$/m);
    expect(body).toMatch(new RegExp(`^CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}$`, "m"));
  });

  it("повторный вход заменяет прежний токен, а не копит строки", () => {
    const f = envPath();
    fs.writeFileSync(f, `CLAUDE_CODE_OAUTH_TOKEN=old\nBRIDGE_TOKEN=abc\n`);
    putEnvValue("CLAUDE_CODE_OAUTH_TOKEN", TOKEN, f);
    const body = fs.readFileSync(f, "utf8");
    expect(body.match(/CLAUDE_CODE_OAUTH_TOKEN=/g)).toHaveLength(1);
    expect(body).not.toMatch(/=old/);
    expect(body).toMatch(/^BRIDGE_TOKEN=abc$/m);
  });

  it("файл с токеном не читается посторонним на сервере", () => {
    const f = envPath();
    putEnvValue("CLAUDE_CODE_OAUTH_TOKEN", TOKEN, f);
    expect(fs.statSync(f).mode & 0o077).toBe(0);
  });

  it("вход виден и по файлу, и по окружению", () => {
    const f = envPath();
    expect(hasLogin(f)).toBe(false);
    fs.writeFileSync(f, "CLAUDE_CODE_OAUTH_TOKEN=\n");   // пустое — это не вход
    expect(hasLogin(f)).toBe(false);
    putEnvValue("CLAUDE_CODE_OAUTH_TOKEN", TOKEN, f);
    expect(hasLogin(f)).toBe(true);
  });
});

describe("какой способ входа выбирается", () => {
  it("свежий claude умеет `auth login` — им и входим", async () => {
    expect(await authSupported(bin("claude-new"))).toBe(true);
    const { url } = await startLogin({ bin: bin("claude-new") });
    expect(url).toBe(URL_OK);
    expect(loginState()).toMatchObject({ stage: "code", kind: "auth" });
  }, 30000);

  it("старый claude команды `auth` не знает — остаётся setup-token", async () => {
    expect(await authSupported(bin("claude-old"))).toBe(false);
    await startLogin({ bin: bin("claude-old") });
    expect(loginState()).toMatchObject({ stage: "code", kind: "token" });
  }, 30000);
});

describe("вход через `claude auth login` (основной способ)", () => {
  const opts = () => ({ bin: bin("claude-new"), file: envPath(), restart: false });

  it("код доходит строкой, вход сохраняется, токен в чат не уходит", async () => {
    const o = { ...opts(), file: envPath() };
    fs.writeFileSync(o.file, "BRIDGE_TOKEN=abc\nCLAUDE_CODE_OAUTH_TOKEN=старый\n");
    await startLogin({ bin: o.bin, mode: "auth" });
    const r = await submitCode(CODE);
    expect(r).toEqual({ token: "", stored: true });

    const done = await storeLogin(o);
    expect(done.mode).toBe("auth");
    // Прежний токен обязан уйти: в очереди claude он стоит ВЫШЕ
    // сохранённого входа, и со старым свежий вход не подействовал бы.
    expect(fs.readFileSync(o.file, "utf8")).toMatch(/^CLAUDE_CODE_OAUTH_TOKEN=$/m);
    expect(fs.readFileSync(o.file, "utf8")).toMatch(/^BRIDGE_TOKEN=abc$/m);
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(await authStatus(o.bin)).toMatchObject({ supported: true, loggedIn: true });
  }, 30000);

  it("неверный код объясняется словами claude, а не молчанием", async () => {
    await startLogin({ bin: bin("claude-new"), mode: "auth" });
    const err = await submitCode(`ac_wrong#${"s".repeat(43)}`).catch((e) => e);
    expect(err.message).toMatch(/не принял код/);
    expect(err.retry).toBe(true);            // бот сразу выдаст новую ссылку
    expect(loginState().stage).toBe("idle");
  }, 30000);

  it("неполный код объясняется сразу, а не через две минуты тишины", async () => {
    // Настоящий claude отвечает на него голым «Invalid code…» без префикса
    // и продолжает читать. Пока эту строку не ловили, владелец ждал
    // таймаут и получал бессмысленную новую ссылку.
    await startLogin({ bin: bin("claude-new"), mode: "auth" });
    const started = Date.now();
    const err = await submitCode("ac_AAAAAAAAAAAAAAAAAAAA").catch((e) => e);
    expect(err.message).toMatch(/целиком/);
    expect(Date.now() - started).toBeLessThan(10000);
  }, 30000);

  it("умерший процесс назван своей причиной, а не таймаутом", async () => {
    await startLogin({ bin: bin("claude-dies"), mode: "auth" });
    await new Promise((r) => setTimeout(r, 1200));    // процесс успевает выйти
    const started = Date.now();
    const err = await submitCode(CODE).catch((e) => e);
    expect(err.message).toMatch(/не принял код|закрыл вход/);
    expect(Date.now() - started).toBeLessThan(10000);
  }, 30000);

  it("вход виден и без токена в .env — по самому claude", async () => {
    const f = envPath();
    expect(await loggedIn({ bin: bin("claude-new"), file: f })).toBe(false);
    await startLogin({ bin: bin("claude-new"), mode: "auth" });
    await submitCode(CODE);
    expect(await loggedIn({ bin: bin("claude-new"), file: f })).toBe(true);
  }, 30000);
});

describe("вход через `claude setup-token` (запасной способ)", () => {
  it("ссылка приходит целой и годной для подтверждения", async () => {
    const { url } = await startLogin({ bin: bin("claude-old"), mode: "token" });
    expect(url).toBe(URL_OK);
    expect(new URL(url).searchParams.get("code_challenge")).toBeTruthy();
    expect(loginState().stage).toBe("code");
  }, 30000);

  it("длинный код доходит целиком и превращается в токен", async () => {
    // Регрессия на главную поломку: код отправляется, только если Enter
    // уходит отдельным нажатием после самого кода.
    const f = envPath();
    fs.writeFileSync(f, "BRIDGE_TOKEN=abc\n");
    await startLogin({ bin: bin("claude-old"), mode: "token" });
    const { token } = await submitCode(CODE);
    expect(token).toBe(TOKEN);
    await saveToken(token, { file: f, restart: false });
    expect(fs.readFileSync(f, "utf8")).toMatch(new RegExp(`CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}`));
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
    expect(loginState().stage).toBe("idle");   // разговор закончен, процесс убран
  }, 30000);

  it("неполный код объясняется словами, а не молчанием до таймаута", async () => {
    await startLogin({ bin: bin("claude-old"), mode: "token" });
    // Без части после «#» настоящий claude отвечает «Invalid code» и
    // остаётся жив: раньше это выглядело как «не выдал токен за 120 с».
    await expect(submitCode("ac_AAAAAAAAAAAAAAAAAAAA")).rejects.toThrow(/целиком/);
    expect(loginState().stage).toBe("idle");
  }, 30000);

  it("просроченный код назван просроченным, и обещана новая ссылка", async () => {
    await startLogin({ bin: bin("claude-old"), mode: "token" });
    const err = await submitCode(`ac_wrong#${"s".repeat(43)}`).catch((e) => e);
    expect(err.message).toMatch(/не принял код/);
    expect(err.retry).toBe(true);
  }, 30000);

  it("подставленный вместо кода мусор не уезжает в процесс", async () => {
    await startLogin({ bin: bin("claude-old"), mode: "token" });
    await expect(submitCode("код с пробелами")).rejects.toThrow(/не похоже на код/);
    // Разговор не сломан: настоящий код после этого всё ещё принимается.
    expect(loginState().stage).toBe("code");
    await expect(submitCode(CODE)).resolves.toMatchObject({ token: TOKEN });
  }, 30000);
});

describe("когда что-то не так", () => {
  it("код без начатого входа не принимается", async () => {
    await expect(submitCode(CODE)).rejects.toThrow(/не начат/);
  });

  it("отсутствие pm2 не роняет сервер в момент удачного входа", async () => {
    // spawn сообщает об отсутствии команды СОБЫТИЕМ, а не исключением:
    // без слушателя Node валил весь процесс — сервер и бота — ровно тогда,
    // когда вход наконец удался.
    const f = envPath();
    const r = await saveToken(TOKEN, { file: f, restart: true });
    expect(r.saved).toBe(true);
    expect(typeof r.restarted).toBe("boolean");
  }, 20000);

  it("молчащий claude не подвешивает бота навсегда", async () => {
    await expect(startLogin({ bin: bin("claude-silent"), mode: "token", timeoutMs: 1500 }))
      .rejects.toThrow(/не показал ссылку/);
    expect(loginState().stage).toBe("idle");
  }, 20000);

  it("перенесённая ссылка — честный отказ, а не битая ссылка в чат", async () => {
    await expect(startLogin({ bin: bin("claude-wrapped"), mode: "token", timeoutMs: 1500 }))
      .rejects.toThrow(/не показал ссылку/);
  }, 20000);

  it("отсутствие команды названо ИМЕННО той командой, которой нет", async () => {
    // Запасной путь запускает не claude, а `script`, и раньше сообщение
    // винило claude — искали бы не то.
    await expect(startLogin({ bin: path.join(bins, "нет-такой-команды"), mode: "auth" }))
      .rejects.toThrow(/нет команды .*нет-такой-команды/);
  }, 20000);

  it("отмена убирает разговор и процесс", async () => {
    await startLogin({ bin: bin("claude-new"), mode: "auth" });
    expect(cancelLogin()).toBe(true);
    expect(loginState().stage).toBe("idle");
    expect(cancelLogin()).toBe(false);
  }, 20000);
});
