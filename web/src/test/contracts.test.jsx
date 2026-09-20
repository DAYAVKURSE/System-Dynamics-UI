import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { DiffForms } from "../components/ContractsPanel.jsx";
import { changeForms } from "../lib/docdiff.js";

/* ДОГОВОРЫ: документы с версиями, «права сотрудников», приглашение с
   подписью, договор к подписи у позванного (владелец, 2026-09-14). */

/* Подпись рисуют на экране — в тестах вместо холста заглушка, отдающая
   готовую запись по «Готово»: правила самой подписи проверяет
   signature.test.jsx. */
vi.mock("../components/SignaturePad.jsx", () => ({
  default: ({ onDone, onCancel, title }) => (
    <div role="dialog" aria-label="подпись">
      <span>{title}</span>
      <button type="button" onClick={() => onDone({ by: "1", at: "2026-09-14T10:00:00Z",
        strokes: [[{ x: 1, y: 1, t: 0, p: 0.5 }]], png: "data:image/png;base64,AAAA",
        hash: "abcdef0123456789", w: 300, h: 200 })}>Готово</button>
      <button type="button" onClick={onCancel}>Отмена</button>
    </div>),
}));

const { default: PeoplePanel } = await import("../components/PeoplePanel.jsx");
const { default: RegisterPanel } = await import("../components/RegisterPanel.jsx");

const PH = [{ key: "sum", desc: "сумма" }, { key: "start", desc: "начало" }, { key: "end", desc: "окончание" },
  { key: "city", desc: "город" }, { key: "fio", desc: "ФИО исполнителя" }];
const DOC = { id: "doc1", name: "Договор подряда", at: "2026-09-14T09:00:00Z", by: "1",
  values: { city: "Москва" },
  versions: [
    { id: "v1", at: "2026-09-13T09:00:00Z", by: "1", note: "первая версия", hash: "h1",
      file: { id: "f1", name: "podryad.docx", url: "/api/reports/s/f1" }, placeholders: PH },
    { id: "v2", at: "2026-09-14T09:00:00Z", by: "1", note: "поправлен п. 3", hash: "h2",
      file: { id: "f2", name: "podryad.docx", url: "/api/reports/s/f2" }, placeholders: PH },
  ] };
const ORG = {
  ownerId: "1",
  roles: [{ id: "executor", name: "исполнитель", tabs: ["tasks"], doc: "doc1" },
    { id: "reviewer", name: "проверяющий", tabs: ["review"], doc: null }],
  users: [{ id: "1", name: "Владелец", roles: [] },
    { id: "5", name: "Пётр", roles: ["executor"], active: [],
      agreements: [{ id: "agr1", roleId: "executor", sum: "50000", start: "2026-01-01", end: "2026-06-30",
        docName: "Договор подряда", file: { url: "/api/reports/s/f9", name: "подписан.docx" } }] }],
  forms: [], docs: [DOC],
};
const ME = { id: "1", isOwner: true, known: true };

const ownerServer = (over = {}) => {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/html")) {
      // Версии различаются текстом: v1 без п. 3, v2 — с ним.
      const v1 = u.endsWith("?v=v1");
      return { ok: true, status: 200,
        json: async () => ({ html: v1 ? "<p>Текст договора <b>п. 1</b></p><p>старый пункт</p>"
          : "<p>Текст договора <b>п. 1</b></p><p>п. 3 поправлен</p>", version: DOC.versions[v1 ? 0 : 1] }) };
    }
    if (opts.method && opts.method !== "GET") {
      calls.push({ url: u, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
      if (u.endsWith("/api/org/agreements")) {
        return { ok: true, status: 201,
          json: async () => ({ id: "agr9", link: "https://t.me/bot?start=agr_tok", token: "tok" }) };
      }
      return { ok: true, status: opts.method === "DELETE" ? 204 : 200, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => (over.org || ORG) };
  }));
  return calls;
};
afterEach(() => vi.restoreAllMocks());

const pickFile = (label, name = "novyi.docx") => {
  const input = screen.getByLabelText(label);
  const f = new File(["PK"], name,
    { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  fireEvent.change(input);
};

describe("роли и договоры участников", () => {
  it("форма ролей называется «роли»; у роли — договор из списка и «Пригласить участника»", async () => {
    const calls = ownerServer();
    render(<PeoplePanel me={ME} />);
    const rights = await screen.findByLabelText("роли");
    expect(within(rights).getByText("роли")).toBeInTheDocument();
    expect(screen.getByLabelText("договор роли «исполнитель»")).toHaveValue("doc1");
    expect(screen.getByRole("button", { name: "пригласить участника: исполнитель" })).toBeInTheDocument();
    // У роли без договора приглашения нет: выдавать нечего.
    expect(screen.queryByRole("button", { name: "пригласить участника: проверяющий" })).toBeNull();
    fireEvent.change(screen.getByLabelText("договор роли «проверяющий»"), { target: { value: "doc1" } });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: "/api/org/roles/reviewer/doc", method: "PUT", body: { docId: "doc1" } });
  });

  it("под ролями участника — его договоры: начало, окончание, сумма; недействующий помечен", async () => {
    ownerServer();
    render(<PeoplePanel me={ME} />);
    const list = await screen.findByLabelText("договоры: Пётр");
    expect(list.textContent).toContain("с 01.01.2026");
    expect(list.textContent).toContain("по 30.06.2026");
    expect(list.textContent).toContain("сумма 50000");
    expect(list.textContent).toContain("не действует");
  });
});

describe("форма договоров", () => {
  it("новый договор: название как у файла, файл Word, описание версии — POST с base64", async () => {
    const calls = ownerServer();
    render(<PeoplePanel me={ME} />);
    await screen.findByLabelText("договоры");
    fireEvent.click(screen.getByRole("button", { name: "+ договор" }));
    expect(screen.getByLabelText("такое же, как у файла")).toBeChecked();
    expect(screen.getByLabelText("название договора")).toBeDisabled();
    pickFile("файл договора", "Оферта.docx");
    expect(screen.getByLabelText("название договора")).toHaveValue("Оферта");
    // Описания изменений словами нет: разница считается сама, как в git.
    expect(screen.queryByLabelText("описание версии")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "загрузить договор" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe("/api/org/docs");
    expect(calls[0].body).toMatchObject({ name: "Оферта", file: { name: "Оферта.docx" } });
    expect(String(calls[0].body.file.data)).toMatch(/^data:/);
  });

  it("название — рамка всей карточки; Редактировать/Скачать/Удалить; кнопки правки — на документе; свёрнутый — полоска внизу", async () => {
    const calls = ownerServer();
    render(<PeoplePanel me={ME} />);
    const card = await screen.findByLabelText("договор Договор подряда");
    // Название — подпись рамки всей карточки (legend fieldset'а), не отдельная рамка посреди.
    expect(card.tagName).toBe("FIELDSET");
    expect(card.querySelector("legend").textContent).toBe("Договор подряда");
    expect(within(card).queryByLabelText("название Договор подряда")).toBeNull();
    // Порядок: Редактировать, Скачать (ссылка на последнюю версию), Удалить.
    expect(within(card).getAllByRole("button")[0]).toHaveAccessibleName("редактировать Договор подряда");
    const download = within(card).getByLabelText("скачать Договор подряда");
    expect(download).toHaveAttribute("href", "/api/reports/s/f2");
    expect(download.compareDocumentPosition(within(card).getByRole("button", { name: "редактировать Договор подряда" })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    const drop = within(card).getByRole("button", { name: "удалить договор Договор подряда" });
    expect(download.compareDocumentPosition(drop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // «Сохранить изменения» на карточке нет.
    expect(within(card).queryByText(/Сохранить изменения/)).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "редактировать Договор подряда" }));
    const viewer = await screen.findByRole("dialog", { name: "документ Договор подряда" });
    // Значки на документе: закрыть, свернуть, отменить, вернуть, сохранить (пока правок нет — неактивна).
    ["закрыть документ", "свернуть документ", "отменить правку", "вернуть правку", "сохранить документ"]
      .forEach((n) => expect(within(viewer).getByRole("button", { name: n })).toBeInTheDocument());
    const saveBtn = within(viewer).getByRole("button", { name: "сохранить документ" });
    expect(saveBtn).toBeDisabled();
    expect(saveBtn.querySelector("svg[data-icon='save']")).not.toBeNull();   // значок дискеты, без слов
    expect(saveBtn.textContent.trim()).toBe("");
    expect(saveBtn.style.borderRadius).toBe("50%");
    expect(within(viewer).getByRole("button", { name: "закрыть документ" }).style.borderRadius).toBe("50%");
    expect(within(viewer).getByRole("button", { name: "свернуть документ" }).querySelector("svg")).not.toBeNull();
    // Правка: добавили слово в предложение.
    const text = within(viewer).getByLabelText("текст документа");
    text.innerHTML = "<p>Текст договора <b>п. 1</b></p><p>п. 3 срочно поправлен</p>";
    fireEvent.input(text);
    expect(within(viewer).getByRole("button", { name: "сохранить документ" })).not.toBeDisabled();
    // Свернули — документ спрятан, правки остались: на карточке одна зелёная форма с предложением и словом.
    fireEvent.click(within(viewer).getByRole("button", { name: "свернуть документ" }));
    expect(screen.queryByRole("dialog", { name: "документ Договор подряда" })).toBeNull();
    // Свёрнутый документ — полоска внизу с названием.
    const bar = screen.getByRole("region", { name: "свёрнутый документ Договор подряда" });
    expect(bar.style.position).toBe("fixed");
    expect(bar.textContent).toContain("Договор подряда");
    expect(bar.textContent).toContain("свёрнут");
    expect(within(card).getByText("несохранённые изменения")).toBeInTheDocument();
    const plus = within(card).getByLabelText("добавлено");
    expect(plus.textContent).toBe("+п. 3 срочно поправлен");
    expect(plus.querySelector("[data-hl='+']").textContent.trim()).toBe("срочно");
    expect(within(card).queryByLabelText("убрано")).toBeNull();
    // Нажатие на полоску разворачивает тот же документ с правками; полоска исчезает.
    fireEvent.click(within(bar).getByRole("button", { name: "развернуть документ Договор подряда" }));
    const again = await screen.findByRole("dialog", { name: "документ Договор подряда" });
    expect(screen.queryByRole("region", { name: "свёрнутый документ Договор подряда" })).toBeNull();
    fireEvent.click(within(again).getByRole("button", { name: "сохранить документ" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/org/docs/doc1/versions")).toBe(true));
    expect(calls.find((c) => c.url === "/api/org/docs/doc1/versions").body.html).toContain("срочно");
  });

  it("«прошлые версии»: версия раскрывается кнопками открыть/скачать/удалить и изменениями; «Загрузить новый» — перед списком", async () => {
    ownerServer();
    render(<PeoplePanel me={ME} />);
    const card = await screen.findByLabelText("договор Договор подряда");
    const upload = within(card).getByText("Загрузить новый");
    const versions = within(card).getByRole("button", { name: "прошлые версии Договор подряда" });
    // eslint-disable-next-line no-bitwise
    expect(upload.compareDocumentPosition(versions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(versions);
    expect(within(card).queryByRole("button", { name: "открыть версию v2" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "версия v2" }));
    expect(within(card).getByRole("button", { name: "открыть версию v2" })).toBeInTheDocument();
    expect(within(card).getByLabelText("скачать версию v2")).toHaveAttribute("href", "/api/reports/s/f2");
    expect(within(card).queryByRole("button", { name: "удалить версию v2" })).toBeNull();   // последнюю нельзя
    // Изменения v2 против v1 — формами: замена абзаца → «+» и «−» с выделением.
    await waitFor(() => expect(within(card).getByLabelText("добавлено")).toBeInTheDocument());
    expect(within(card).getByLabelText("добавлено").textContent).toContain("п. 3 поправлен");
    expect(within(card).getByLabelText("убрано").textContent).toContain("старый пункт");
    // Повторное нажатие — скрыть.
    fireEvent.click(within(card).getByRole("button", { name: "версия v2" }));
    expect(within(card).queryByRole("button", { name: "открыть версию v2" })).toBeNull();
    // Старую можно удалить; «открыть» показывает её только для чтения.
    fireEvent.click(within(card).getByRole("button", { name: "версия v1" }));
    expect(within(card).getByRole("button", { name: "удалить версию v1" })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "открыть версию v1" }));
    const ro = await screen.findByRole("dialog", { name: /документ Договор подряда · версия/ });
    expect(within(ro).getByLabelText("текст документа")).toHaveAttribute("contenteditable", "false");
  });

  it("плейсхолдеры документа — поля в рамке с описанием; значения уезжают PUT", async () => {
    const calls = ownerServer();
    render(<PeoplePanel me={ME} />);
    // Плейсхолдеры — под спойлером.
    const card = await screen.findByLabelText("договор Договор подряда");
    expect(within(card).queryByLabelText("поле Договор подряда: city")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "плейсхолдеры Договор подряда" }));
    const city = screen.getByLabelText("поле Договор подряда: city");
    expect(city).toHaveValue("Москва");
    expect(screen.getByText("город", { selector: "legend" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("поле Договор подряда: fio"), { target: { value: "Иванов" } });
    fireEvent.blur(screen.getByLabelText("поле Договор подряда: fio"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/org/docs/doc1")).toBe(true));
    expect(calls.find((c) => c.url === "/api/org/docs/doc1").body.values)
      .toMatchObject({ city: "Москва", fio: "Иванов" });
  });
});

describe("пригласить участника", () => {
  it("сумма, даты и подпись обязательны; «Отправить» даёт ссылку и «Выбрать чат»", async () => {
    const calls = ownerServer();
    render(<PeoplePanel me={ME} />);
    fireEvent.click(await screen.findByRole("button", { name: "пригласить участника: исполнитель" }));
    const modal = screen.getByRole("dialog", { name: "Пригласить участника · исполнитель" });
    const send = within(modal).getByRole("button", { name: "Отправить" });
    expect(send).toBeDisabled();
    fireEvent.change(within(modal).getByLabelText("приглашение: sum"), { target: { value: "70000" } });
    fireEvent.change(within(modal).getByLabelText("приглашение: start"), { target: { value: "2026-10-01" } });
    fireEvent.change(within(modal).getByLabelText("приглашение: end"), { target: { value: "2026-12-31" } });
    expect(send).toBeDisabled();   // без подписи
    fireEvent.click(within(modal).getByRole("button", { name: "Поставить подпись" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "подпись" })).getByRole("button", { name: "Готово" }));
    expect(within(modal).getByText(/Подпись поставлена/)).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole("button", { name: "Отправить" }));
    await within(modal).findByText("Выбрать чат");
    const post = calls.find((c) => c.url === "/api/org/agreements");
    expect(post.body).toMatchObject({ docId: "doc1", roleId: "executor", sum: "70000",
      start: "2026-10-01", end: "2026-12-31", values: { city: "Москва" },
      sign1: { hash: "abcdef0123456789" } });
    expect(within(modal).getByLabelText("ссылка приглашения").textContent).toBe("https://t.me/bot?start=agr_tok");
  });
});

describe("договор к подписи у позванного", () => {
  const me = { id: "5", known: true, isOwner: false, tabs: [], pending: "executor",
    agreement: { id: "agr1", docName: "Договор подряда", roleName: "исполнитель", sum: "50000",
      start: "2026-10-01", end: "2026-12-31", docHash: "h2",
      placeholders: [{ key: "sum", desc: "сумма", value: "50000" }, { key: "city", desc: "город", value: "Москва" },
        { key: "fio", desc: "ФИО исполнителя", value: "" }], userValues: {} } };
  it("пустые плейсхолдеры — полями; подпись — по «Поставить подпись»; отправка — POST sign", async () => {
    const calls = ownerServer();
    const onDone = vi.fn();
    render(<RegisterPanel me={me} onDone={onDone} />);
    expect(screen.getByLabelText("договор к подписи").textContent).toContain("Договор подряда");
    expect(screen.queryByLabelText("договор: city")).toBeNull();   // заполнено владельцем
    expect(screen.getByRole("button", { name: "Подписать и отправить" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("договор: fio"), { target: { value: "Пётр Петров" } });
    fireEvent.click(screen.getByRole("button", { name: "Поставить подпись" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "подпись" })).getByRole("button", { name: "Готово" }));
    expect(screen.getByRole("button", { name: "Подписать и отправить" })).not.toBeDisabled();
    // Документ открывается на весь экран только для чтения.
    fireEvent.click(await screen.findByRole("button", { name: "Открыть договор" }));
    const viewer = screen.getByRole("dialog", { name: "документ Договор подряда" });
    expect(within(viewer).getByLabelText("текст документа")).toHaveAttribute("contenteditable", "false");
    fireEvent.click(within(viewer).getByRole("button", { name: "закрыть документ" }));
    fireEvent.click(screen.getByRole("button", { name: "Подписать и отправить" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/org/agreements/agr1/sign")).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/sign")).body)
      .toMatchObject({ values: { fio: "Пётр Петров" }, sign2: { hash: "abcdef0123456789" } });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});

describe("ошибка загрузки — на форме", () => {
  it("отказ сервера стоит под кнопкой «Загрузить», а не внизу страницы", async () => {
    ownerServer();
    const orig = global.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
      if (opts.method === "POST" && String(url).endsWith("/api/org/docs")) {
        return { ok: false, status: 400, json: async () => ({ error: "В договоре нет обязательных плейсхолдеров: [(sum): …]" }) };
      }
      return orig(url, opts);
    }));
    render(<PeoplePanel me={ME} />);
    await screen.findByLabelText("договоры");
    fireEvent.click(screen.getByRole("button", { name: "+ договор" }));
    pickFile("файл договора", "без-суммы.docx");
    fireEvent.click(screen.getByRole("button", { name: "загрузить договор" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/обязательных плейсхолдеров/);
    expect(screen.getByLabelText("новый договор")).toContainElement(alert);
  });
});

/* ЖЁЛТАЯ ФОРМА ЗАМЕНЫ (владелец, 2026-09-20): «добавь жёлтую плашку между
   зелёной и красной: добавлен текст — зелёная, убран — красная, заменён —
   жёлтая». В форме замены видно и старое, и новое: старое зачёркнуто. */
describe("формы изменений документа", () => {
  const forms = (from, to) => changeForms([from], [to]);

  it("замена слов — жёлтая форма «±», старое зачёркнуто, новое выделено", () => {
    render(<DiffForms forms={forms("Срок выполнения — три дня.", "Срок выполнения — пять дней.")} />);
    const box = screen.getByLabelText("заменено");
    expect(box.querySelector("legend").textContent).toBe("±");
    expect(screen.queryByLabelText("добавлено")).toBeNull();
    expect(screen.queryByLabelText("убрано")).toBeNull();
    const del = [...box.querySelectorAll("[data-hl='del']")];
    const add = [...box.querySelectorAll("[data-hl='add']")];
    expect(del.map((n) => n.textContent.trim())).toEqual(["три", "дня."]);
    expect(add.map((n) => n.textContent.trim())).toEqual(["пять", "дней."]);
    expect(del[0].style.textDecoration).toBe("line-through");
    expect(add[0].style.textDecoration).toBe("");
  });

  it("добавление — зелёная, удаление — красная, как было", () => {
    render(<DiffForms forms={forms("бета гамма дельта", "новое бета гамма дельта")} />);
    expect(screen.getByLabelText("добавлено").querySelector("legend").textContent).toBe("+");
    expect(screen.queryByLabelText("заменено")).toBeNull();
  });
});
