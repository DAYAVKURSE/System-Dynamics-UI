import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { putEnvValue, readEnvValue, setSetting } from "../lib/envStore.js";

/* Настройки, которые владелец задаёт с телефона («/callapp call»,
   «/callmain on»), ложатся в тот же .env, где живут токен бота и секрет
   TURN. Проверяем главное: запись одной строки не задевает соседей, не
   копит дубли и не открывает файл посторонним. */

let tmp;
let n = 0;
const envPath = () => path.join(tmp, `env-${n += 1}`);

beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sd-env-")); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe("файл .env", () => {
  it("строка добавляется, соседние секреты остаются на месте", () => {
    const f = envPath();
    fs.writeFileSync(f, "TELEGRAM_BOT_TOKEN=def\nTURN_SECRET=abc\n");
    putEnvValue("TELEGRAM_CALL_APP", "call", f);
    const body = fs.readFileSync(f, "utf8");
    expect(body).toMatch(/^TELEGRAM_BOT_TOKEN=def$/m);
    expect(body).toMatch(/^TURN_SECRET=abc$/m);
    expect(body).toMatch(/^TELEGRAM_CALL_APP=call$/m);
  });

  it("повторная запись заменяет прежнее значение, а не копит строки", () => {
    const f = envPath();
    fs.writeFileSync(f, "TELEGRAM_CALL_APP=old\nTURN_SECRET=abc\n");
    putEnvValue("TELEGRAM_CALL_APP", "call", f);
    const body = fs.readFileSync(f, "utf8");
    expect(body.match(/TELEGRAM_CALL_APP=/g)).toHaveLength(1);
    expect(body).not.toMatch(/=old/);
    expect(body).toMatch(/^TURN_SECRET=abc$/m);
  });

  it("файла ещё нет — заводится; без переноса строки в конце сосед не склеивается", () => {
    const f = envPath();
    putEnvValue("TELEGRAM_CALL_APP", "call", f);
    expect(fs.readFileSync(f, "utf8")).toBe("TELEGRAM_CALL_APP=call\n");
    fs.writeFileSync(f, "TURN_SECRET=abc");   // без «\n» в конце
    putEnvValue("TELEGRAM_CALL_APP", "call", f);
    expect(fs.readFileSync(f, "utf8")).toBe("TURN_SECRET=abc\nTELEGRAM_CALL_APP=call\n");
  });

  it("файл с секретами не читается посторонним на сервере", () => {
    const f = envPath();
    putEnvValue("TELEGRAM_CALL_APP", "call", f);
    expect(fs.statSync(f).mode & 0o077).toBe(0);
  });

  it("значение читается обратно, а пустое или отсутствующее — как пустое", () => {
    const f = envPath();
    expect(readEnvValue("TELEGRAM_CALL_APP", f)).toBe("");
    fs.writeFileSync(f, "TELEGRAM_CALL_APP= call \nTELEGRAM_CALL_MAIN=\n");
    expect(readEnvValue("TELEGRAM_CALL_APP", f)).toBe("call");
    expect(readEnvValue("TELEGRAM_CALL_MAIN", f)).toBe("");
  });

  it("настройка действует сразу: и в файле, и в живом процессе", () => {
    const f = envPath();
    const prev = process.env.TELEGRAM_CALL_MAIN;
    try {
      setSetting("TELEGRAM_CALL_MAIN", "1", f);
      expect(process.env.TELEGRAM_CALL_MAIN).toBe("1");
      expect(readEnvValue("TELEGRAM_CALL_MAIN", f)).toBe("1");
    } finally {
      if (prev === undefined) delete process.env.TELEGRAM_CALL_MAIN;
      else process.env.TELEGRAM_CALL_MAIN = prev;
    }
  });
});
