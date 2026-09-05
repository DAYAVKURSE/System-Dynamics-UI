import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_REPORT_BYTES } from "../storage.js";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/* Файл отчёта уезжает на диск сервера, а в сценарий попадает ссылка.
   Без сервера — обратно в data:-URL внутри сценария. */

const file = (name = "снимок.png", type = "image/png", size = 12) => {
  const f = new File([new Uint8Array(size)], name, { type });
  return f;
};

// fetch — единственная точка, где клиент узнаёт про сервер: подменяем её и
// смотрим, что именно уходит на бэкенд.
const mockFetch = ({ reports }) => {
  const calls = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (String(url).includes("/api/health")) {
      return { ok: true, headers: { get: () => "application/json" },
        json: async () => ({ ok: true, scenarios: false, reminders: false, reports }) };
    }
    if (String(url).includes("/api/reports")) {
      return { ok: true, status: 201,
        json: async () => ({ id: "r1", name: "снимок.png", type: "image/png",
          size: 12, scope: "a".repeat(32), url: "/api/reports/" + "a".repeat(32) + "/r1" }) };
    }
    return { ok: false, status: 404, headers: { get: () => "text/html" },
      json: async () => ({}) };
  });
  return calls;
};

let container;
// «Есть ли куда грузить» storage.js выясняет один раз и запоминает — иначе
// каждый файл бил бы по /api/health. Поэтому каждому тесту нужен свежий
// модульный граф, а не один импорт на файл.
const fresh = async () => {
  vi.resetModules();
  const { default: SystemModel } = await import("../components/SystemModel.jsx");
  return render(<SystemModel />);
};

beforeEach(() => { localStorage.clear(); seed(); });
afterEach(() => { vi.restoreAllMocks(); delete global.fetch; });

/* Задачи заводятся из целей, а не руками, поэтому для сдачи нужна уже
   поставленная задача. Кладём её черновиком — как если бы человек вернулся
   к своей работе, — и открываем на доске. */
const DOC = {
  entities: [{ id: "usr", name: "Пользователи", color: "#fff", x: 0, y: 0,
    setters: ["1"], owners: ["1"], reviewers: ["1"], crew: [] }],
  traits: [{ id: "t1", e: "usr", k: "growth", l: "спрос", unit: "шт.", have: 100 },
    { id: "t2", e: "usr", k: "growth", l: "заявки", unit: "шт.", have: 0 }],
  kinds: [{ id: "growth", sign: "↑", name: "рост", color: "#3DDC97", dir: "up" }],
  funcs: [{ id: "f1", e: "usr", name: "Сбор заявок", kind: "task", factors: [],
    dur: 2, durHi: 2, durUnit: "ч", every: 0, everyHi: 0, everyUnit: "ч",
    takes: [{ id: "p1", trait: "t1", lo: 2, hi: 4, group: "p1" }],
    gives: [{ id: "p2", trait: "t2", lo: 1, hi: 1, group: "p2" }],
    setters: ["1"], owners: ["1"], reviewers: ["1"], x: 0, y: 0 }],
  tasks: [{ id: "tk1", funcId: "f1", title: "Сбор заявок", body: "собрать",
    status: "progress", setter: "1", assignee: "1", reviewer: "1",
    start: null, end: "2030-01-01T10:00", endBy: "hand", warn: 10,
    submissions: [], reviews: [], comments: [] }],
  goals: [],
  factors: [],
};
const seed = () => localStorage.setItem("sd_draft", JSON.stringify({
  v: 5, savedAt: new Date().toISOString(), name: "", doc: DOC }));

const openSubmit = () => {
  fireEvent.click(screen.getByRole("button", { name: /Восстановить/ }));
  fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
  fireEvent.click(screen.getByText("Сбор заявок"));
  fireEvent.click(screen.getByRole("button", { name: "СДАТЬ" }));
};
const dump = () => {
  fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
  fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
  fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
  return JSON.parse(container.querySelector("textarea").value);
};
const attach = async (f) => {
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  fireEvent.change(input);
};

describe("файл отчёта — на диске, ссылка в сценарии", () => {
  it("с сервером файл уходит на бэкенд, а в задаче остаётся ссылка", async () => {
    const calls = mockFetch({ reports: true });
    ({ container } = await fresh());
    openSubmit();
    await attach(file());

    await waitFor(() => expect(screen.getByText(/📎/)).toBeTruthy());
    const upload = calls.find((c) => c.url.includes("/api/reports"));
    expect(upload).toBeTruthy();
    expect(upload.opts.method).toBe("POST");
    // Имя едет base64, иначе кириллица в заголовке превращается в мусор.
    expect(atob(upload.opts.headers["X-Report-Name"])).toBeTruthy();
    // Тело — сам файл, а не base64-строка: диску незачем лишняя треть.
    expect(upload.opts.body).toBeInstanceOf(File);

    fireEvent.click(screen.getAllByRole("button", { name: "Сдать" })[0]);
    const saved = dump().tasks[0].submissions[0].file;
    expect(saved.url).toMatch(/^\/api\/reports\//);
    expect(saved.data).toBeUndefined();     // никакого data:-URL в сценарии
  });

  it("без сервера файл ложится в сценарий инлайном — отчёт не теряется",
    async () => {
      mockFetch({ reports: false });
      ({ container } = await fresh());
      openSubmit();
      await attach(file());

      await waitFor(() => expect(screen.getByText(/📎/)).toBeTruthy());
      fireEvent.click(screen.getAllByRole("button", { name: "Сдать" })[0]);
      const saved = dump().tasks[0].submissions[0].file;
      expect(saved.data).toMatch(/^data:/);
      expect(saved.url).toBeUndefined();
    });

  it("отказ сервера показывается словами, а не молча теряет файл", async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/api/health")) {
        return { ok: true, headers: { get: () => "application/json" },
          json: async () => ({ ok: true, scenarios: false, reminders: false, reports: true }) };
      }
      return { ok: false, status: 507, json: async () => ({}) };
    });
    ({ container } = await fresh());
    openSubmit();
    await attach(file());

    await waitFor(() => expect(screen.getByText(/не удалось загрузить файл/)).toBeTruthy());
    // Сдача без файла всё равно возможна: отчёт текстом — тоже отчёт.
    fireEvent.click(screen.getAllByRole("button", { name: "Сдать" })[0]);
    expect(dump().tasks[0].submissions[0].file).toBeFalsy();
  });

  it("слишком большой файл отвергается до отправки", async () => {
    const calls = mockFetch({ reports: true });
    ({ container } = await fresh());
    openSubmit();
    const big = file("огромный.bin", "application/octet-stream", 1);
    Object.defineProperty(big, "size", { value: MAX_UPLOAD_REPORT_BYTES + 1 });
    await attach(big);

    await waitFor(() => expect(screen.getByText(/не поместится/)).toBeTruthy());
    expect(calls.some((c) => c.url.includes("/api/reports"))).toBe(false);
  });
});
