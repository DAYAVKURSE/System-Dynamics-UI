import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { DRAFT_V, clearDraft, draftKey, readDraft, saveDraft } from "../lib/draft.js";

/* Черновик: страховка от того, что Telegram убьёт WebView вместе с правками.
   Всё, что не уехало на диск, должно пережить закрытие вкладки. */

const DOC = {
  entities: [{ id: "a", name: "Актив А", color: "#fff", x: 0, y: 0 }],
  traits: [{ id: "x", e: "a", k: "growth", l: "ресурс А", unit: "шт.", have: 3 }],
  edges: [],
  kinds: [{ id: "growth", sign: "↑", name: "рост", color: "#3DDC97", dir: "up" }],
  okrs: [],
  tasks: [],
};

beforeEach(() => { localStorage.clear(); delete window.Telegram; });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("хранение черновика", () => {
  it("записанный черновик читается обратно", () => {
    expect(saveDraft(DOC, { name: "Мой сценарий" })).toBe(true);
    const d = readDraft();
    expect(d.doc).toEqual(DOC);
    expect(d.name).toBe("Мой сценарий");
    expect(Number.isNaN(new Date(d.savedAt).getTime())).toBe(false);
  });

  it("пустое хранилище — не черновик, а просто пусто", () => {
    expect(readDraft()).toBeNull();
  });

  it("мусор в хранилище не роняет приложение", () => {
    localStorage.setItem(draftKey(), "{не json");
    expect(readDraft()).toBeNull();
  });

  it("черновик чужой версии игнорируется", () => {
    localStorage.setItem(draftKey(), JSON.stringify({ v: DRAFT_V + 1, doc: DOC }));
    expect(readDraft()).toBeNull();
  });

  it("половина документа хуже, чем ничего", () => {
    // Модель, собранная из огрызка, — это состояние, которого у пользователя
    // никогда не было; лучше честно ничего не предлагать.
    const { tasks, ...noTasks } = DOC;
    localStorage.setItem(draftKey(), JSON.stringify({ v: DRAFT_V, doc: noTasks }));
    expect(readDraft()).toBeNull();

    localStorage.setItem(draftKey(),
      JSON.stringify({ v: DRAFT_V, doc: { ...DOC, kinds: [] } }));
    expect(readDraft()).toBeNull();
  });

  it("запрет на запись — это false, а не исключение", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(saveDraft(DOC)).toBe(false);
  });

  it("черновики разных аккаунтов Telegram не смешиваются", () => {
    const anon = draftKey();
    window.Telegram = { WebApp: { initDataUnsafe: { user: { id: 42 } } } };
    const user = draftKey();
    expect(user).not.toBe(anon);

    saveDraft(DOC);
    window.Telegram = { WebApp: { initDataUnsafe: { user: { id: 43 } } } };
    expect(readDraft()).toBeNull();
  });

  it("отброшенный черновик исчезает из хранилища", () => {
    saveDraft(DOC);
    clearDraft();
    expect(localStorage.getItem(draftKey())).toBeNull();
  });
});

/* ─────── черновик в приложении ─────── */

const addEntity = () => fireEvent.click(screen.getByRole("button", { name: "+ актив" }));
const scheme = () => fireEvent.click(screen.getByRole("button", { name: "Схема" }));
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });

describe("автосохранение", () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });

  it("правка попадает в черновик после паузы", () => {
    render(<SystemModel />);
    scheme();
    addEntity();
    expect(readDraft()).toBeNull(); // пауза ещё идёт — промежуточные состояния не пишем

    tick(900);
    expect(readDraft().doc.entities.some((e) => e.name === "Новый актив")).toBe(true);
  });

  it("нетронутая модель черновика не создаёт", () => {
    render(<SystemModel />);
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "Симуляция" }));
    tick(900);
    // Переключение вкладок — не работа, терять там нечего.
    expect(readDraft()).toBeNull();
  });

  it("уход вкладки пишет черновик, не дожидаясь паузы", () => {
    render(<SystemModel />);
    scheme();
    addEntity();

    // Именно этот случай и страхуем: Telegram сворачивает приложение и
    // убивает WebView раньше, чем истечёт пауза.
    act(() => {
      Object.defineProperty(document, "visibilityState",
        { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(readDraft().doc.entities.some((e) => e.name === "Новый актив")).toBe(true);
    Object.defineProperty(document, "visibilityState",
      { value: "visible", configurable: true });
  });

  it("отмена правки убирает черновик — терять снова нечего", () => {
    render(<SystemModel />);
    scheme();
    addEntity();
    tick(900);
    expect(readDraft()).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /отменить/ }));
    tick(900);
    expect(readDraft()).toBeNull();
  });
});

describe("восстановление", () => {
  const entityNames = (container) =>
    [...container.querySelectorAll("svg g text")].map((t) => t.textContent);

  it("при запуске предлагает вернуть несохранённые правки", () => {
    saveDraft({ ...DOC, entities: [{ ...DOC.entities[0], name: "Забытый актив" }] },
      { name: "Черновой сценарий" });
    render(<SystemModel />);

    expect(screen.getByText(/Остались правки от/)).toBeTruthy();
    expect(screen.getByText(/Черновой сценарий/)).toBeTruthy();
  });

  it("«Восстановить» возвращает модель из черновика", () => {
    saveDraft({ ...DOC, entities: [{ ...DOC.entities[0], name: "Забытый актив" }] });
    const { container } = render(<SystemModel />);
    fireEvent.click(screen.getByRole("button", { name: "Восстановить" }));

    scheme();
    expect(entityNames(container)).toContain("Забытый актив");
    expect(screen.queryByText(/Остались правки от/)).toBeNull();
  });

  it("восстановление — обычный шаг истории, его можно отменить", () => {
    saveDraft({ ...DOC, entities: [{ ...DOC.entities[0], name: "Забытый актив" }] });
    const { container } = render(<SystemModel />);
    fireEvent.click(screen.getByRole("button", { name: "Восстановить" }));
    fireEvent.click(screen.getByRole("button", { name: /отменить/ }));

    scheme();
    expect(entityNames(container)).not.toContain("Забытый актив");
    expect(entityNames(container)).toContain("Пользователи");
  });

  it("«Отбросить» убирает плашку и чистит хранилище", () => {
    saveDraft(DOC);
    render(<SystemModel />);
    fireEvent.click(screen.getByRole("button", { name: "Отбросить" }));

    expect(screen.queryByText(/Остались правки от/)).toBeNull();
    expect(readDraft()).toBeNull();
  });

  it("без черновика плашки нет", () => {
    render(<SystemModel />);
    expect(screen.queryByText(/Остались правки от/)).toBeNull();
  });

  it("если черновик писать некуда — говорим об этом вслух", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    render(<SystemModel />);
    scheme();
    addEntity();

    // Молчание тут опаснее всего: пользователь считал бы, что защищён.
    await waitFor(() => expect(screen.getByText(/не даёт сохранить черновик/))
      .toBeTruthy());
  });
});

// Досрочная запись черновика — тем же путём, каким её делает уходящая вкладка.
function flushOnHide() {
  act(() => {
    Object.defineProperty(document, "visibilityState",
      { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  Object.defineProperty(document, "visibilityState",
    { value: "visible", configurable: true });
}

describe("черновик и диск", () => {
  it("сохранение на диск закрывает вопрос — черновик больше не нужен", async () => {
    render(<SystemModel />);
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    addEntity();
    flushOnHide();
    expect(readDraft()).not.toBeNull(); // черновик есть — иначе проверка ниже пустая

    fireEvent.click(screen.getByRole("button", { name: "JSON" }));

    const name = screen.getByPlaceholderText("имя сценария");
    fireEvent.change(name, { target: { value: "Рабочий" } });
    fireEvent.blur(name);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(screen.getByText(/Сохранено/)).toBeTruthy());
    expect(readDraft()).toBeNull();
  });

  it("после загрузки сценария черновик не появляется заново", async () => {
    // Загруженное лежит на диске целиком, спасать нечего. Без этого
    // приложение при следующем запуске предлагало бы «восстановить» ровно
    // то, что и так сохранено.
    localStorage.setItem("sd_scenarios", JSON.stringify({
      index: [{ id: "s1", name: "С диска", savedAt: new Date().toISOString() }],
      data: { s1: JSON.stringify(DOC) },
    }));
    render(<SystemModel />);
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    addEntity();
    flushOnHide();
    expect(readDraft()).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    const list = await screen.findByRole("combobox");
    fireEvent.change(list, { target: { value: "s1" } });
    // Кнопок «Загрузить» на вкладке две: первая — для текста JSON,
    // вторая — для сценария с диска.
    fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[1]);
    await waitFor(() => expect(screen.getByText(/Загружено/)).toBeTruthy());

    expect(readDraft()).toBeNull();
    flushOnHide();
    expect(readDraft()).toBeNull();
  });

  it("старый сценарий без классификаций не оставляет модель без типов", async () => {
    const { kinds, okrs, tasks, ...old } = DOC;
    localStorage.setItem("sd_scenarios", JSON.stringify({
      index: [{ id: "s2", name: "Старый", savedAt: new Date().toISOString() }],
      data: { s2: JSON.stringify(old) },
    }));
    render(<SystemModel />);
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    const list = await screen.findByRole("combobox");
    fireEvent.change(list, { target: { value: "s2" } });
    // Кнопок «Загрузить» на вкладке две: первая — для текста JSON,
    // вторая — для сценария с диска.
    fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[1]);
    await waitFor(() => expect(screen.getByText(/Загружено/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Типы" }));
    expect(screen.getAllByDisplayValue("рост").length).toBeGreaterThan(0);
  });
});
