import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  accessCodeOf, addUser, addVirtualUser, dropAccessCode, dropGrant, grantFor, grantsTo,
  identify, makeAccessCode, mayActAs, removeVirtualUser, useAccessCode,
} from "../lib/orgStore.js";

/* ════════════════════════════════════════════════════════════════
   КОД ДОСТУПА И «УДАЛИТЬ СОТРУДНИКА» (владелец, 2026-09-20)

   «При нажатии „+ сотрудник" сначала должно появляться модальное окно, в
   котором можно ввести определённый код, который позволит сделать
   виртуальным реального сотрудника. При этом у реального сотрудника
   также должна быть возможность пользоваться своей страницей».

   Отсюда и проверки: код открывает чужую страницу ровно на то, что в нём
   написано; хозяин при этом ничего не теряет; просроченный код не
   открывает ничего; а «удалить» у настоящего человека убирает разрешение,
   а не человека.
   ════════════════════════════════════════════════════════════════ */

let tmp;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-access-"));
  process.env.ORG_DIR = path.join(tmp, "org");
});
afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
beforeEach(async () => {
  process.env.OWNER_TELEGRAM_ID = "1";
  await fs.rm(process.env.ORG_DIR, { recursive: true, force: true });
  await identify("1", { name: "Владелец" });
});

/* Два настоящих участника: тот, кто пускает, и тот, кого пускают. */
const pair = async () => {
  await addUser({ id: "10", name: "Пётр", roleId: "worker", addedBy: "1" });
  await addUser({ id: "20", name: "Техподдержка", roleId: "worker", addedBy: "1" });
  return { host: "10", guest: "20" };
};

describe("код доступа", () => {
  it("открывает страницу хозяина ровно на то, что в коде", async () => {
    const { host, guest } = await pair();
    const code = await makeAccessCode(host, { minutes: 30, access: "r", tabs: ["tasks", "review"] });
    expect(code.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(code.access).toBe("r");
    expect(code.tabs).toEqual(["tasks", "review"]);

    // До кода чужая страница закрыта — даже владельцу.
    expect(await mayActAs(guest, host)).toBe(false);
    expect(await mayActAs("1", host)).toBe(false);

    const used = await useAccessCode(code.code, guest);
    expect(used.error).toBeUndefined();
    expect(used.user.id).toBe(host);
    expect(await mayActAs(guest, host)).toBe(true);

    const g = await grantFor(guest, host);
    expect(g.access).toBe("r");
    expect(g.tabs).toEqual(["tasks", "review"]);
    // Разрешение — только тому, кто ввёл: третьему оно не достаётся.
    expect(await mayActAs("1", host)).toBe(false);
  });

  it("хозяин продолжает работать у себя: доступ разделён, а не передан", async () => {
    const { host, guest } = await pair();
    const code = await makeAccessCode(host, { minutes: 30, access: "rw", tabs: ["tasks"] });
    await useAccessCode(code.code, guest);
    const me = await identify(host, {});
    expect(me.known).toBe(true);
    expect(me.tabs).toContain("tasks");
    expect(me.tabs).toContain("review");
  });

  it("код одноразовый, свой не годится, чужой набор букв — тоже", async () => {
    const { host, guest } = await pair();
    const code = await makeAccessCode(host, { minutes: 30, access: "rw", tabs: [] });
    expect((await useAccessCode(code.code, host)).error).toBe("own code");
    expect((await useAccessCode("ЧУШЬ", guest)).error).toBe("bad code");
    expect((await useAccessCode(code.code, guest)).error).toBeUndefined();
    // Второй раз тот же код уже ничего не открывает.
    await addUser({ id: "30", name: "Третий", roleId: "worker", addedBy: "1" });
    expect((await useAccessCode(code.code, "30")).error).toBe("bad code");
  });

  it("минуты — срок: просроченное разрешение не открывает ничего", async () => {
    const { host, guest } = await pair();
    const code = await makeAccessCode(host, { minutes: 1, access: "rw", tabs: ["tasks"] });
    await useAccessCode(code.code, guest);
    expect(await mayActAs(guest, host)).toBe(true);
    // Через час разрешения нет — и в списке его тоже нет.
    const hour = Date.now() + 61 * 60 * 1000;
    const real = Date.now;
    Date.now = () => hour;
    try {
      expect(await mayActAs(guest, host)).toBe(false);
      expect(await grantsTo(guest)).toEqual([]);
      expect(await accessCodeOf(host)).toBeNull();
    } finally { Date.now = real; }
  });

  it("код один: новый гасит прежний, «погасить» убирает и его", async () => {
    const { host } = await pair();
    const first = await makeAccessCode(host, { minutes: 30, access: "rw", tabs: [] });
    const second = await makeAccessCode(host, { minutes: 30, access: "rw", tabs: [] });
    expect(second.code).not.toBe(first.code);
    expect((await accessCodeOf(host)).code).toBe(second.code);
    await dropAccessCode(host);
    expect(await accessCodeOf(host)).toBeNull();
  });

  it("вкладки берутся только настоящие: выдуманной в коде не будет", async () => {
    const { host } = await pair();
    const code = await makeAccessCode(host, { minutes: 5, access: "rw",
      tabs: ["tasks", "такой-вкладки-нет"] });
    expect(code.tabs).toEqual(["tasks"]);
  });
});

describe("удалить сотрудника", () => {
  it("у настоящего человека убирается разрешение, а не человек", async () => {
    const { host, guest } = await pair();
    const code = await makeAccessCode(host, { minutes: 30, access: "rw", tabs: ["tasks"] });
    await useAccessCode(code.code, guest);
    expect(await dropGrant(guest, host)).toBe(true);
    expect(await mayActAs(guest, host)).toBe(false);
    // Человек на месте: страница осталась его.
    expect((await identify(host, {})).known).toBe(true);
    expect(await dropGrant(guest, host)).toBe(false);
  });

  it("виртуальная страница стирается, забранная человеком — нет", async () => {
    const page = await addVirtualUser({ addedBy: "1" });
    expect(await removeVirtualUser(page.id)).toBe(true);
    expect(await removeVirtualUser(page.id)).toBe(false);
    const taken = await addVirtualUser({ addedBy: "1" });
    const { host } = await pair();
    // Страницу забрал настоящий человек — эта кнопка её больше не трогает.
    const org = await import("../lib/orgStore.js");
    const all = await org.listOrg();
    all.users.find((u) => u.id === taken.id).tg = host;
    await fs.writeFile(path.join(process.env.ORG_DIR, "org.json"),
      JSON.stringify(all, null, 2), "utf8");
    expect(await removeVirtualUser(taken.id)).toBe(false);
  });
});
