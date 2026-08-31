import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// storage.js кеширует результат определения хранилища в модульной переменной,
// поэтому под каждый сценарий импортируем модуль заново.
async function freshStorage() {
  vi.resetModules();
  return import("../storage.js");
}

/* Имитация Telegram.WebApp.CloudStorage: колбэчный API + жёсткий лимит
   4096 символов на значение, как у настоящего. */
function makeCloudStorage() {
  const store = new Map();
  const ok = (cb, value) => setTimeout(() => cb(null, value), 0);
  return {
    _store: store,
    setItem(key, value, cb) {
      if (String(value).length > 4096) return setTimeout(() => cb("VALUE_TOO_LONG"), 0);
      store.set(key, String(value));
      ok(cb, true);
    },
    getItem(key, cb) {
      ok(cb, store.get(key) ?? "");
    },
    getItems(keys, cb) {
      const out = {};
      keys.forEach((k) => (out[k] = store.get(k) ?? ""));
      ok(cb, out);
    },
    getKeys(cb) {
      ok(cb, [...store.keys()]);
    },
    removeItems(keys, cb) {
      keys.forEach((k) => store.delete(k));
      ok(cb, true);
    },
  };
}

const bigModel = () => ({
  entities: Array.from({ length: 40 }, (_, i) => ({ id: "e" + i, name: "Актив " + i })),
  traits: Array.from({ length: 200 }, (_, i) => ({ id: "t" + i, l: "Ресурс номер " + i, unit: "ед./мес" })),
  edges: Array.from({ length: 120 }, (_, i) => ({ id: "a" + i, carrier: "носитель " + i })),
});

beforeEach(() => {
  localStorage.clear();
  delete window.Telegram;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: false, status: 404, headers: { get: () => "text/html" } })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("выбор хранилища", () => {
  it("без бэкенда и без Telegram выбирает localStorage", async () => {
    const s = await freshStorage();
    expect(await s.detectStorage()).toBe("local");
  });

  it("в Telegram с CloudStorage выбирает облако", async () => {
    window.Telegram = { WebApp: { CloudStorage: makeCloudStorage() } };
    const s = await freshStorage();
    expect(await s.detectStorage()).toBe("cloud");
  });

  it("при живом /api/health выбирает сервер", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => "application/json" },
          json: () => Promise.resolve({ ok: true }),
        }),
      ),
    );
    const s = await freshStorage();
    expect(await s.detectStorage()).toBe("server");
  });

  it("старый клиент Telegram без CloudStorage откатывается на localStorage", async () => {
    window.Telegram = { WebApp: {} };
    const s = await freshStorage();
    expect(await s.detectStorage()).toBe("local");
  });
});

describe("облако Telegram: сохранение, чтение, обновление, удаление", () => {
  let cs;
  beforeEach(() => {
    cs = makeCloudStorage();
    window.Telegram = { WebApp: { CloudStorage: cs } };
  });

  it("сохраняет и читает сценарий целиком", async () => {
    const s = await freshStorage();
    const data = { entities: [{ id: "usr" }], traits: [], edges: [] };
    const saved = await s.saveScenario({ name: "Мой сценарий", data });

    expect(saved.id).toBeTruthy();
    expect(await s.listScenarios()).toHaveLength(1);

    const loaded = await s.getScenario(saved.id);
    expect(loaded.name).toBe("Мой сценарий");
    expect(loaded.data).toEqual(data);
  });

  it("большая модель режется на куски и собирается обратно без потерь", async () => {
    const s = await freshStorage();
    const data = bigModel();
    const raw = JSON.stringify(data);
    expect(raw.length).toBeGreaterThan(4096); // иначе тест ничего не проверяет

    const saved = await s.saveScenario({ name: "Большая", data });
    const chunkKeys = [...cs._store.keys()].filter((k) => k.startsWith(`sd_${saved.id}_`));
    expect(chunkKeys.length).toBeGreaterThan(1);
    chunkKeys.forEach((k) => expect(cs._store.get(k).length).toBeLessThanOrEqual(4096));

    const loaded = await s.getScenario(saved.id);
    expect(loaded.data).toEqual(data);
  });

  it("обновление на более короткую версию не оставляет хвостов от старой", async () => {
    const s = await freshStorage();
    const saved = await s.saveScenario({ name: "Большая", data: bigModel() });
    const before = [...cs._store.keys()].filter((k) => k.startsWith(`sd_${saved.id}_`)).length;

    const small = { entities: [], traits: [], edges: [] };
    await s.saveScenario({ id: saved.id, name: "Стала маленькой", data: small });

    const after = [...cs._store.keys()].filter((k) => k.startsWith(`sd_${saved.id}_`)).length;
    expect(after).toBeLessThan(before);

    const loaded = await s.getScenario(saved.id);
    expect(loaded.data).toEqual(small);
    expect(loaded.name).toBe("Стала маленькой");
    expect(await s.listScenarios()).toHaveLength(1); // обновление, а не новая запись
  });

  it("удаление убирает и запись из списка, и куски данных", async () => {
    const s = await freshStorage();
    const saved = await s.saveScenario({ name: "На удаление", data: bigModel() });
    await s.deleteScenario(saved.id);

    expect(await s.listScenarios()).toHaveLength(0);
    expect([...cs._store.keys()].filter((k) => k.startsWith(`sd_${saved.id}_`))).toHaveLength(0);
    expect(await s.getScenario(saved.id)).toBeNull();
  });

  it("список отсортирован от новых к старым", async () => {
    const s = await freshStorage();
    await s.saveScenario({ name: "Первый", data: { entities: [] } });
    await new Promise((r) => setTimeout(r, 5));
    await s.saveScenario({ name: "Второй", data: { entities: [] } });

    const list = await s.listScenarios();
    expect(list.map((x) => x.name)).toEqual(["Второй", "Первый"]);
  });
});

describe("localStorage-хранилище", () => {
  it("переживает «перезагрузку страницы» (новый импорт модуля)", async () => {
    const s1 = await freshStorage();
    const data = { entities: [{ id: "usr" }], traits: [], edges: [] };
    const saved = await s1.saveScenario({ name: "До перезагрузки", data });

    const s2 = await freshStorage(); // модуль загружен заново, localStorage тот же
    const loaded = await s2.getScenario(saved.id);
    expect(loaded.data).toEqual(data);
    expect(await s2.listScenarios()).toHaveLength(1);
  });

  it("не падает на повреждённом содержимом localStorage", async () => {
    localStorage.setItem("sd_scenarios", "{это не json");
    const s = await freshStorage();
    expect(await s.listScenarios()).toEqual([]);
  });
});

describe("общие правила", () => {
  it("пустое имя отклоняется с понятным сообщением", async () => {
    const s = await freshStorage();
    await expect(s.saveScenario({ name: "   ", data: {} })).rejects.toThrow(/имя/i);
  });
});
