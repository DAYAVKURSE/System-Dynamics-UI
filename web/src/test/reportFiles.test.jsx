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

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); delete global.fetch; });

const openSubmit = () => {
  fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
  // Задача — выполнение функции: заводится под функцией модели.
  fireEvent.click(screen.getAllByRole("button", { name: "+ выполнение" })[0]);
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

    fireEvent.click(screen.getByRole("button", { name: "Сдать" }));
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
      fireEvent.click(screen.getByRole("button", { name: "Сдать" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Сдать" }));
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
