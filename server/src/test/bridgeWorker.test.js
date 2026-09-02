import { afterEach, describe, expect, it } from "vitest";
import { refreshToken } from "../../../tools/claude-bridge.mjs";

/* Воркер перечитывает .env на каждом круге. Это то, из-за чего вход из чата
   действует сразу: pm2 может и не перезапуститься, а токен всё равно должен
   подхватиться. */

afterEach(() => { delete process.env.CLAUDE_CODE_OAUTH_TOKEN; });

describe("подхват входа без перезапуска", () => {
  it("новый токен в .env становится токеном воркера", () => {
    expect(refreshToken(() => ({ CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-new" }))).toBe(true);
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-new");
  });

  it("тот же токен не считается новым — иначе вход проверялся бы каждую секунду", () => {
    refreshToken(() => ({ CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-same" }));
    expect(refreshToken(() => ({ CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-same" }))).toBe(false);
  });

  it("пустой .env не стирает уже работающий вход", () => {
    refreshToken(() => ({ CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-live" }));
    expect(refreshToken(() => ({}))).toBe(false);
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-live");
  });
});
