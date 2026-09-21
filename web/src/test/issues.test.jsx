import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import IssuesPanel, { IssueModal } from "../components/IssuesPanel.jsx";
import { resetIdentity } from "../identity.js";

/* ════════════════════════════════════════════════════════════════
   СООБЩЕНИЯ ОБ ОШИБКАХ (владелец, 2026-09-21)

   «Кнопка со значком восклицательного знака… модальное окно с просьбой
   „Напишите сообщение об ошибке" и полем ввода… вкладка „issues", где
   будут в списке показаны отправленные пользователями сообщения, и
   кнопка „Удалить" рядом с каждым».
   ════════════════════════════════════════════════════════════════ */

const ME = { id: "1", name: "Владелец", known: true, solo: false, isOwner: true,
  tabs: ["tools"] };
const ISSUES = [
  { id: "is_1", by: "2", name: "Иван", avatar: "", text: "не жмётся кнопка",
    at: "2026-09-21T09:00:00Z" },
  { id: "is_2", by: "3", name: "Пётр", avatar: "", text: "пропала схема",
    at: "2026-09-20T09:00:00Z" },
];

const server = () => {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || "GET",
      body: opts.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => ({ issues: ISSUES }) };
  }));
  return calls;
};

beforeEach(() => { resetIdentity(); });
afterEach(() => vi.restoreAllMocks());

describe("вкладка «Issues»", () => {
  it("показывает присланные сообщения: кто, когда и что", async () => {
    server();
    render(<IssuesPanel me={ME} />);
    await screen.findByText("не жмётся кнопка");
    expect(screen.getByText("Иван")).toBeInTheDocument();
    expect(screen.getByText("пропала схема")).toBeInTheDocument();
    expect(screen.getByText("Пётр")).toBeInTheDocument();
  });

  it("«Удалить» стоит у каждого и спрашивает перед удалением", async () => {
    const calls = server();
    render(<IssuesPanel me={ME} />);
    await screen.findByText("не жмётся кнопка");
    expect(screen.getAllByRole("button", { name: /удалить сообщение/ })).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("удалить сообщение от Иван"));
    expect(screen.getByText("Вы уверены? Это действие необратимо")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Да" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE"
      && c.url.endsWith("/api/issues/is_1"))).toBe(true));
  });

  it("отказ «Нет» ничего не удаляет", async () => {
    const calls = server();
    render(<IssuesPanel me={ME} />);
    await screen.findByText("не жмётся кнопка");
    fireEvent.click(screen.getByLabelText("удалить сообщение от Иван"));
    fireEvent.click(screen.getByRole("button", { name: "Нет" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});

describe("окно сообщения об ошибке", () => {
  it("просит написать сообщение и отправляет написанное", async () => {
    const sent = [];
    const closed = [];
    render(<IssueModal onClose={() => closed.push(1)}
      onSend={async (t) => { sent.push(t); }} />);
    expect(screen.getByText("Напишите сообщение об ошибке")).toBeInTheDocument();
    // Пустое не отправляется: жаловаться молча не на что.
    expect(screen.getByRole("button", { name: "Отправить" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("сообщение об ошибке"),
      { target: { value: "  не жмётся кнопка  " } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(sent).toEqual(["не жмётся кнопка"]));
    expect(closed).toHaveLength(1);
  });

  /* ГАЛОЧКА «ОТПРАВИТЬ СКРИНШОТ» (владелец, 2026-09-21): снимок и лента
     сняты при нажатии на значок; лента уходит всегда, снимок — по галочке. */
  it("лента уходит всегда, снимок — только по галочке «отправить скриншот»", async () => {
    const sent = [];
    render(<IssueModal onClose={() => {}} seen={{ log: "12:00:01 кнопка «Схема»", shot: "data:image/png;base64,AAAA" }}
      onSend={async (t, extra) => { sent.push([t, extra]); }} />);
    const box = screen.getByRole("checkbox", { name: "отправить скриншот" });
    expect(box).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("сообщение об ошибке"), { target: { value: "экран пустой" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual(["экран пустой", { log: "12:00:01 кнопка «Схема»", shot: null }]);
    cleanup();
    render(<IssueModal onClose={() => {}} seen={{ log: "л", shot: "data:image/png;base64,AAAA" }}
      onSend={async (t, extra) => { sent.push([t, extra]); }} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "отправить скриншот" }));
    fireEvent.change(screen.getByLabelText("сообщение об ошибке"), { target: { value: "снова" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual(["снова", { log: "л", shot: "data:image/png;base64,AAAA" }]);
    // Снимка нет (не снялся) — галочка выключена.
    cleanup();
    render(<IssueModal onClose={() => {}} seen={{ log: "л", shot: null }} onSend={async () => {}} />);
    expect(screen.getByRole("checkbox", { name: "отправить скриншот" })).toBeDisabled();
  });

  it("сервер отказал — окно остаётся и говорит словами", async () => {
    const closed = [];
    render(<IssueModal onClose={() => closed.push(1)}
      onSend={async () => { throw new Error("диск недоступен"); }} />);
    fireEvent.change(screen.getByLabelText("сообщение об ошибке"),
      { target: { value: "сломалось" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await screen.findByText("диск недоступен");
    expect(closed).toHaveLength(0);
  });
});

/* ─────── ЗНАЧОК В ШАПКЕ ───────

   «Добавь кнопку слева от „Отменить" со значком восклицательного знака»
   (владелец, 2026-09-21). Место здесь и есть требование: ошибку замечают
   посреди работы, и значок должен стоять там, где рука уже находится. */
describe("значок в шапке", () => {
  it("стоит слева от «Отменить» и открывает окно", async () => {
    const { default: SystemModel } = await import("../components/SystemModel.jsx");
    render(<SystemModel />);
    const bang = screen.getByRole("button", { name: "сообщить об ошибке" });
    const undo = screen.getByRole("button", { name: /отменить/ });
    // Слева — значит раньше в порядке документа.
    expect(bang.compareDocumentPosition(undo) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    // И оба в одном ряду значков.
    expect(bang.parentElement).toBe(undo.parentElement);
    fireEvent.click(bang);
    // Окно — после снимка экрана и ленты: они снимаются в момент нажатия.
    expect(await screen.findByText("Напишите сообщение об ошибке")).toBeInTheDocument();
  });
});
