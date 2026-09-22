import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { clearLog, fieldNote, labelOf, logText, record, tail, watchApp } from "../lib/appLog.js";
import { screenText } from "../lib/screenText.js";

/* ════════════════════════════════════════════════════════════════
   ВОЛШЕБНАЯ ПАЛОЧКА (владелец, 2026-09-21)

   «После кнопки с восклицательным знаком и перед кнопкой отменить —
   кнопка с волшебной палочкой. При нажатии — модальное окно с полем ввода
   и кнопкой „вопрос ассистенту“. У ассистента в контексте должна быть
   информация о том, что видел пользователь в приложении. Ответ на вопрос
   должен приходить в чат».
   ════════════════════════════════════════════════════════════════ */

beforeEach(() => clearLog());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("журнал действий", () => {
  it("пишет нажатия и правки полей, а пароль — только «изменено»", () => {
    document.body.innerHTML = `
      <button aria-label="сохранить">S</button>
      <button>Удалить</button>
      <input aria-label="имя" value="Иван" />
      <input type="password" aria-label="ключ" value="sk-1" />
      <select aria-label="модель"><option>gpt</option><option selected>claude</option></select>`;
    const off = watchApp(document);
    fireEvent.click(document.querySelector("[aria-label='сохранить']"));
    fireEvent.click(document.querySelectorAll("button")[1]);
    fireEvent.change(document.querySelector("[aria-label='имя']"), { target: { value: "Пётр" } });
    fireEvent.change(document.querySelector("[type='password']"), { target: { value: "sk-2" } });
    fireEvent.change(document.querySelector("select"), { target: { value: "claude" } });
    off();
    const t = logText();
    expect(t).toMatch(/кнопка «сохранить»/);
    expect(t).toMatch(/кнопка «Удалить»/);
    expect(t).toMatch(/поле «имя»: Пётр/);
    expect(t).toMatch(/поле «ключ»: изменено/);
    expect(t).not.toMatch(/sk-2/);
    expect(t).toMatch(/выбрано «модель»: claude/);
    // Снятый слушатель больше не пишет.
    fireEvent.click(document.querySelector("[aria-label='сохранить']"));
    expect(tail().length).toBe(5);
    document.body.innerHTML = "";
  });
  it("хранит последние сорок и не больше", () => {
    for (let i = 0; i < 50; i += 1) record(`шаг ${i}`);
    expect(tail()).toHaveLength(40);
    expect(tail()[0].text).toBe("шаг 10");
  });
  it("подпись элемента — aria-label, иначе текст", () => {
    const b = document.createElement("button"); b.textContent = "  Ок  ";
    expect(labelOf(b)).toBe("Ок");
    b.setAttribute("aria-label", "подтвердить");
    expect(labelOf(b)).toBe("подтвердить");
    const c = document.createElement("input"); c.type = "checkbox"; c.checked = true;
    c.setAttribute("aria-label", "гипотезы");
    expect(fieldNote(c)).toBe("отмечено: «гипотезы»");
  });
});

describe("экран словами", () => {
  it("заголовки, поля со значениями, кнопки и отметки — в порядке чтения", () => {
    document.body.innerHTML = `
      <div><span>ПРОГНОЗ</span><input aria-label="месяцы" value="3" />
        <input type="checkbox" aria-label="включить гипотезы" checked />
        <button aria-pressed="true">Управление</button>
        <input type="password" aria-label="ключ" value="secret" />
        <div style="display:none">спрятано</div>
        <p>Что умеет делать система</p></div>`;
    const t = screenText(document.body);
    expect(t.split("\n")).toEqual([
      "ПРОГНОЗ", "месяцы: 3", "[x] включить гипотезы", "[Управление] (выбрано)",
      "ключ: •••", "Что умеет делать система",
    ]);
    expect(t).not.toMatch(/secret|спрятано/);
    document.body.innerHTML = "";
  });
  it("барабан вкладок читается подписями, открытая — в скобках", () => {
    render(<SystemModel />);
    const t = screenText(document.body);
    expect(t).toMatch(/Вкладки: Маркет · Анкета · \[Задачи\] · Проверка/);
    // Букв по отдельности в тексте нет.
    expect(t).not.toMatch(/^З\nа\nд/m);
  });
  it("длинный экран обрезается до предела", () => {
    document.body.innerHTML = `<div>${"<p>строка</p>".repeat(3000)}</div>`;
    expect(screenText(document.body, { limit: 500 }).length).toBeLessThanOrEqual(500);
    document.body.innerHTML = "";
  });
});

describe("кнопка в шапке и окно", () => {
  it("палочка стоит между «!» и «отменить»; нажатие открывает окно с полем и кнопкой", async () => {
    render(<SystemModel />);
    const bang = screen.getByRole("button", { name: "сообщить об ошибке" });
    const wand = screen.getByRole("button", { name: "вопрос ассистенту" });
    const undo = screen.getByRole("button", { name: /отменить/ });
    expect(bang.compareDocumentPosition(wand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(wand.compareDocumentPosition(undo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(wand.parentElement).toBe(undo.parentElement);
    fireEvent.click(wand);
    expect(await screen.findByLabelText("вопрос ассистенту", { selector: "textarea" })).toBeInTheDocument();
    // В окне — своя кнопка с той же надписью; значок в шапке — со значком.
    const sendBtn = screen.getAllByRole("button", { name: "вопрос ассистенту" })
      .find((b) => b.textContent === "вопрос ассистенту");
    expect(sendBtn).toBeTruthy();
  });

  it("вопрос уходит вместе с экраном и действиями; ответ обещан в чат", async () => {
    const posts = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
      if (String(url).endsWith("/api/assistant/ask-from-app")) {
        posts.push(JSON.parse(opts.body));
        return { ok: true, status: 202, json: async () => ({ id: "q1" }) };
      }
      return { ok: false, status: 404, json: async () => ({ error: "not found" }) };
    }));
    render(<SystemModel />);
    fireEvent.click(screen.getByRole("button", { name: "сохранить" }));
    record("открыта вкладка «Схема»");
    fireEvent.click(screen.getByRole("button", { name: "вопрос ассистенту" }));
    const box = await screen.findByLabelText("вопрос ассистенту", { selector: "textarea" });
    fireEvent.change(box, { target: { value: "Почему тут пусто?" } });
    fireEvent.click(screen.getAllByRole("button", { name: "вопрос ассистенту" })
      .find((b) => b.textContent === "вопрос ассистенту"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].question).toBe("Почему тут пусто?");
    // Экран снят до открытия окна: самого окна в нём нет, а вкладки — есть.
    expect(posts[0].screen).toMatch(/Вкладки: /);
    expect(posts[0].screen).not.toMatch(/Вопрос ассистенту/);
    expect(posts[0].log).toMatch(/открыта вкладка «Схема»/);
    // Галочка «отправить скриншот» не стояла — снимка в вопросе нет.
    expect(posts[0].shot).toBeNull();
    expect(await screen.findByRole("status")).toHaveTextContent("Ответ придёт в чат бота.");
  });

  /* ГАЛОЧКА «ОТПРАВИТЬ СКРИНШОТ» (владелец, 2026-09-22): как в сообщении об
     ошибке — снимок уходит в чат вместе с вопросом только по галочке. */
  it("снимок уходит только по галочке; не снялся заранее — снимается при отправке", async () => {
    const { WandModal } = await import("../components/WandModal.jsx");
    const sent = [];
    render(<WandModal seen={{ screen: "Вкладки: [Задачи]", log: "л", shot: "data:image/png;base64,AAAA" }}
      onClose={() => {}} onSend={async (q) => { sent.push(q); }} />);
    const box = screen.getByRole("checkbox", { name: "отправить скриншот" });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    fireEvent.change(screen.getByLabelText("вопрос ассистенту", { selector: "textarea" }),
      { target: { value: "Что это?" } });
    fireEvent.click(screen.getByRole("button", { name: "вопрос ассистенту" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ question: "Что это?", screen: "Вкладки: [Задачи]", log: "л",
      shot: "data:image/png;base64,AAAA" });
    cleanup();
    render(<WandModal seen={{ screen: "э", log: "л", shot: null }} onClose={() => {}}
      capture={async () => ({ shot: "data:image/png;base64,BBBB" })}
      onSend={async (q) => { sent.push(q); }} />);
    const late = screen.getByRole("checkbox", { name: "отправить скриншот" });
    expect(late).not.toBeDisabled();
    fireEvent.click(late);
    fireEvent.change(screen.getByLabelText("вопрос ассистенту", { selector: "textarea" }),
      { target: { value: "А это?" } });
    fireEvent.click(screen.getByRole("button", { name: "вопрос ассистенту" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].shot).toBe("data:image/png;base64,BBBB");
  });
});
