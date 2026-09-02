import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  cancelLogin, findAuthUrl, findToken, hasLogin, loginState, plainText, putEnvValue,
  safeTail, saveToken, startLogin, submitCode,
} from "../lib/loginFlow.js";

/* Вход в Claude Code из чата. Проверяется на поддельном `claude`, который
   повторяет вывод настоящего: приветствие, ссылку внутри гиперссылки
   терминала (OSC 8), приглашение и токен в ответ на код. Настоящий вход
   тут запускать нельзя — он выдал бы живой токен; а весь разбор вывода и
   работа с .env от настоящей команды не зависят. */

const URL_OK = "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a"
  + "&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback"
  + "&scope=user%3Ainference&code_challenge=8nOIU6QB47RZ6mwjbTQPpWx6Inr3KEePLlCwmXnAOaM"
  + "&code_challenge_method=S256&state=mu4lGkX2b5eNUL3CoQvuKTZzNicEtr5FjWJOvxYGI_s";
const TOKEN = "sk-ant-oat01-ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ-testonly";
const CODE = "goodcode";

let tmp, bins;

/** Поддельный claude: $1 — как себя вести. */
const fake = (name, body) => {
  const file = path.join(bins, name);
  fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  return file;
};

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "sd-login-"));
  bins = path.join(tmp, "bin");
  await fsp.mkdir(bins, { recursive: true });

  // Ведёт себя как настоящий: печатает ссылку гиперссылкой и ждёт код.
  // Ссылку печатаем через %s: в ней есть %3A и %2F, и как формат printf их
  // съедает — первая же версия заглушки на этом и попалась.
  fake("claude-ok", `
url=${JSON.stringify(URL_OK)}
printf 'Welcome to Claude Code v2.1.258\\n'
printf 'Browser did not open? Use the url below to sign in\\n'
printf '\\033]8;;%s\\033\\\\%s\\033]8;;\\033\\\\\\n' "$url" "$url"
printf 'Paste code here if prompted > '
read -r code
if [ "$code" = "${CODE}" ]; then printf '\\nToken: %s\\n' ${JSON.stringify(TOKEN)}; exit 0; fi
printf '\\nInvalid authorization code\\n'; exit 1`);

  // Ссылку не печатает вовсе — так вело себя всё без псевдотерминала.
  fake("claude-silent", "sleep 30");

  // Печатает ссылку, переносом посреди параметров: собрать её нельзя.
  fake("claude-wrapped", `
printf '%s\\n' 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&code_chal'
printf '%s\\n' 'lenge=8nOIU6&state=mu4lGk'
sleep 30`);
});

afterAll(async () => { await fsp.rm(tmp, { recursive: true, force: true }); });
afterEach(() => { cancelLogin(); delete process.env.CLAUDE_CODE_OAUTH_TOKEN; });

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

  it("в сообщение об ошибке токен не просачивается", () => {
    expect(safeTail(`что-то пошло не так ${TOKEN}`)).not.toMatch(/sk-ant/);
    expect(safeTail(`что-то пошло не так ${TOKEN}`)).toMatch(/«токен»/);
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

describe("разговор с claude", () => {
  it("ссылка приходит целой и годной для подтверждения", async () => {
    const { url } = await startLogin({ bin: bin("claude-ok") });
    expect(url).toBe(URL_OK);
    expect(new URL(url).searchParams.get("code_challenge")).toBeTruthy();
    expect(loginState().stage).toBe("code");
  }, 20000);

  it("верный код превращается в токен и попадает в .env", async () => {
    const f = envPath();
    fs.writeFileSync(f, "BRIDGE_TOKEN=abc\n");
    await startLogin({ bin: bin("claude-ok") });
    const { token } = await submitCode(CODE);
    expect(token).toBe(TOKEN);
    saveToken(token, { file: f, restart: false });
    expect(fs.readFileSync(f, "utf8")).toMatch(new RegExp(`CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}`));
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
    expect(loginState().stage).toBe("idle");   // разговор закончен, процесс убран
  }, 20000);

  it("неверный код объясняется словами, а не молчанием", async () => {
    await startLogin({ bin: bin("claude-ok") });
    await expect(submitCode("wrongcode")).rejects.toThrow(/код не подошёл/i);
    expect(loginState().stage).toBe("idle");
  }, 20000);

  it("код без начатого входа не принимается", async () => {
    await expect(submitCode(CODE)).rejects.toThrow(/не начат/);
  });

  it("подставленный вместо кода мусор не уезжает в процесс", async () => {
    await startLogin({ bin: bin("claude-ok") });
    await expect(submitCode("код с пробелами")).rejects.toThrow(/не похоже на код/);
    // Разговор не сломан: настоящий код после этого всё ещё принимается.
    expect(loginState().stage).toBe("code");
    await expect(submitCode(CODE)).resolves.toMatchObject({ token: TOKEN });
  }, 20000);

  it("молчащий claude не подвешивает бота навсегда", async () => {
    await expect(startLogin({ bin: bin("claude-silent"), timeoutMs: 1500 }))
      .rejects.toThrow(/не показал ссылку/);
    expect(loginState().stage).toBe("idle");
  }, 20000);

  it("перенесённая ссылка — честный отказ, а не битая ссылка в чат", async () => {
    await expect(startLogin({ bin: bin("claude-wrapped"), timeoutMs: 1500 }))
      .rejects.toThrow(/не показал ссылку/);
  }, 20000);

  it("отсутствие команды на сервере названо своим именем", async () => {
    await expect(startLogin({ bin: path.join(bins, "нет-такой-команды") }))
      .rejects.toThrow(/claude завершился|нет команды/);
  }, 20000);

  it("отмена убирает разговор и процесс", async () => {
    await startLogin({ bin: bin("claude-ok") });
    expect(cancelLogin()).toBe(true);
    expect(loginState().stage).toBe("idle");
    expect(cancelLogin()).toBe(false);
  }, 20000);
});
