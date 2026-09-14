import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
    if (u.endsWith("/html")) {
      return { ok: true, status: 200,
        json: async () => ({ html: "<p>Текст договора <b>п. 1</b></p>", version: DOC.versions[1] }) };
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

describe("права сотрудников и договоры участников", () => {
  it("форма ролей называется «права сотрудников»; у роли — договор из списка и «Пригласить участника»", async () => {
    const calls = ownerServer();
    render(<PeoplePanel me={ME} />);
    const rights = await screen.findByLabelText("права сотрудников");
    expect(within(rights).getByText("права сотрудников")).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText("описание версии"), { target: { value: "первая" } });
    fireEvent.click(screen.getByRole("button", { name: "загрузить договор" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe("/api/org/docs");
    expect(calls[0].body).toMatchObject({ name: "Оферта", note: "первая", file: { name: "Оферта.docx" } });
    expect(String(calls[0].body.file.data)).toMatch(/^data:/);
  });

  it("нажатие на договор выделяет его: «Скачать», «Сохранить изменения», описание; повторное — снимает; версии деревом", async () => {
    const calls = ownerServer();
    render(<PeoplePanel me={ME} />);
    const row = await screen.findByRole("button", { name: "документ Договор подряда" });
    expect(screen.queryByLabelText("скачать Договор подряда")).toBeNull();
    fireEvent.click(row);
    expect(screen.getByLabelText("скачать Договор подряда")).toHaveAttribute("href", "/api/reports/s/f2");
    const save = screen.getByRole("button", { name: "сохранить изменения Договор подряда" });
    expect(save).toBeDisabled();   // правок ещё нет
    expect(screen.getByLabelText("описание изменений Договор подряда")).toBeInTheDocument();
    // Документ открылся на весь экран, с крестиком.
    const viewer = await screen.findByRole("dialog", { name: "документ Договор подряда" });
    expect(within(viewer).getByRole("button", { name: "закрыть документ" })).toBeInTheDocument();
    expect(within(viewer).getByLabelText("текст документа").innerHTML).toContain("п. 1");
    // Правка → «Сохранить изменения» активна → новая версия с описанием.
    const text = within(viewer).getByLabelText("текст документа");
    text.innerHTML = "<p>Текст договора <b>п. 1</b> и п. 2</p>";
    fireEvent.input(text);
    fireEvent.change(screen.getByLabelText("описание изменений Договор подряда"),
      { target: { value: "добавлен п. 2" } });
    fireEvent.click(screen.getByRole("button", { name: "сохранить изменения Договор подряда" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/org/docs/doc1/versions")).toBe(true));
    expect(calls.find((c) => c.url === "/api/org/docs/doc1/versions").body)
      .toMatchObject({ note: "добавлен п. 2", html: expect.stringContaining("п. 2") });
    // Версии — деревом, старую можно удалить, последнюю — нет.
    fireEvent.click(screen.getByRole("button", { name: "версии Договор подряда" }));
    expect(screen.getByText("поправлен п. 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "удалить версию v1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "удалить версию v2" })).toBeNull();
    // Повторное нажатие — закрыть и снять выделение.
    fireEvent.click(screen.getByRole("button", { name: "документ Договор подряда" }));
    expect(screen.queryByRole("dialog", { name: "документ Договор подряда" })).toBeNull();
    expect(screen.queryByLabelText("скачать Договор подряда")).toBeNull();
  });

  it("плейсхолдеры документа — поля в рамке с описанием; значения уезжают PUT", async () => {
    const calls = ownerServer();
    render(<PeoplePanel me={ME} />);
    const city = await screen.findByLabelText("поле Договор подряда: city");
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
