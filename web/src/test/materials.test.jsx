import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* «МАТЕРИАЛЫ» НА ВКЛАДКЕ ОТЧЁТОВ.

   Все единицы ресурсов в одном месте: по ресурсу, с номерами, со
   скачиванием. Загрузка — окном: количество, вид (файл / текст /
   уникальное поле) и ровно одно поле под вид. Отсюда же считается,
   сколько ресурса есть: у ресурса это число больше не вводят. */

let container;
beforeEach(() => { localStorage.clear(); ({ container } = render(<SystemModel />)); });

const tab = (name) => fireEvent.click(screen.getByRole("button", { name }));
const reports = () => tab("Отчёты");
const pickTrait = (id) => fireEvent.change(screen.getByLabelText("ресурс материалов"),
  { target: { value: id } });
const openUpload = () => fireEvent.click(screen.getByRole("button", { name: "Загрузить единицу ресурса" }));
const dialog = () => screen.getByRole("dialog");
const materialsCard = () => screen.getByText("материалы — единицы ресурсов").closest("div").parentElement;
const dump = () => {
  tab("Инструменты");
  if (!container.querySelector("textarea")) tab("Выгрузка");
  fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
  return JSON.parse(container.querySelector("textarea").value);
};
const loadJson = (m) => {
  tab("Инструменты");
  if (!container.querySelector("textarea")) tab("Выгрузка");
  const area = container.querySelector("textarea");
  fireEvent.change(area, { target: { value: JSON.stringify(m) } });
  fireEvent.blur(area);
  const row = screen.getByRole("button", { name: "Выгрузить" }).parentElement;
  fireEvent.click(within(row).getByRole("button", { name: "Загрузить" }));
};

describe("форма «Материалы»", () => {
  it("стоит перед проектами и показывает единицы выбранного ресурса с номерами", () => {
    reports();
    const card = materialsCard();
    const projects = screen.getByText("отчёты — карта проектов");
    // Материалы — выше карты проектов: проект начинается с единицы.
    expect(card.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const sel = screen.getByLabelText("ресурс материалов");
    expect([...sel.options].map((o) => o.textContent)).toContain("Рынок услуг · спрос");
    pickTrait("dem");
    // Образец: 3000 обращений одной записью «×3000» — и «есть» из неё.
    expect(within(card).getByText("№1")).toBeInTheDocument();
    expect(within(card).getByText(/^×3.?000$/)).toBeInTheDocument();
    expect(within(card).getByText(/обращения с рынка/)).toBeInTheDocument();
    expect(within(card).getByText(/^3.?000$/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "скачать обращ. №1" })).toBeInTheDocument();
  });

  it("текст: окно с количеством и видом, загрузка → строка, «есть» выросло, запись в модели", () => {
    reports();
    pickTrait("req");
    expect(screen.getByText(/Единиц пока нет/)).toBeInTheDocument();
    openUpload();
    const d = dialog();
    expect(d).toHaveAccessibleName("Добавить: заявки");
    expect(within(d).getByLabelText("количество")).toBeInTheDocument();
    expect(within(d).getAllByRole("radio").map((r) => r.getAttribute("aria-label")))
      .toEqual(["файл", "текст", "уникальное поле"]);
    // Единица — что-то одно: под выбранным видом ровно одно поле.
    expect(within(d).getByLabelText("файл единицы")).toBeInTheDocument();
    fireEvent.click(within(d).getByLabelText("текст"));
    expect(within(d).queryByLabelText("файл единицы")).toBeNull();
    expect(within(d).queryByLabelText(/уникальный код/)).toBeNull();
    // Без текста грузить нечего.
    expect(within(d).getByRole("button", { name: "Загрузить" })).toBeDisabled();
    fireEvent.change(within(d).getByLabelText("текст единицы"), { target: { value: "заявка от Иванова" } });
    fireEvent.change(within(d).getByLabelText("количество"), { target: { value: "2" } });
    fireEvent.click(within(d).getByRole("button", { name: "Загрузить" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    const card = materialsCard();
    expect(within(card).getByText("№1")).toBeInTheDocument();
    expect(within(card).getByText("×2")).toBeInTheDocument();
    expect(within(card).getByText("заявка от Иванова")).toBeInTheDocument();
    expect(within(card).getByText(/загружено/)).toBeInTheDocument();
    expect(within(card).getByText("2")).toBeInTheDocument();
    const m = dump().materials.find((x) => x.trait === "req");
    expect(m).toMatchObject({ kind: "text", qty: 2, text: "заявка от Иванова", file: null, code: "" });

    // У ресурса «есть сейчас» — это число, и руками оно не вводится.
    tab("Схема");
    fireEvent.click(screen.getByRole("button", { name: /^Ресурсы/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть ресурса" })[1]);
    expect(screen.getByLabelText("есть сейчас").textContent).toMatch(/^2 шт\./);
  });

  it("уникальное поле: код виден до загрузки, у каждой единицы свой, и он же сохраняется", () => {
    reports();
    pickTrait("req");
    openUpload();
    const d = dialog();
    fireEvent.click(within(d).getByLabelText("уникальное поле"));
    fireEvent.change(within(d).getByLabelText("количество"), { target: { value: "2" } });
    const codes = [within(d).getByLabelText("уникальный код 1").value,
      within(d).getByLabelText("уникальный код 2").value];
    expect(codes[0]).toMatch(/^[A-Z2-9]{8}$/);
    expect(codes[0]).not.toBe(codes[1]);
    fireEvent.click(within(d).getByRole("button", { name: "Загрузить" }));

    const card = materialsCard();
    expect(within(card).getByText(codes[0])).toBeInTheDocument();
    expect(within(card).getByText(codes[1])).toBeInTheDocument();
    expect(within(card).getByText("№2")).toBeInTheDocument();
    expect(dump().materials.filter((x) => x.trait === "req").map((x) => x.code)).toEqual(codes);
  });

  it("файл: без сервера ложится внутрь сценария, и скачать его можно из списка", async () => {
    reports();
    pickTrait("req");
    openUpload();
    const d = dialog();
    const input = within(d).getByLabelText("файл единицы");
    const f = new File(["x"], "договор.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [f], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(within(d).getByText(/договор\.pdf/)).toBeInTheDocument());
    fireEvent.click(within(d).getByRole("button", { name: "Загрузить" }));

    const link = within(materialsCard()).getByRole("link", { name: "скачать шт. №1" });
    expect(link.getAttribute("href")).toMatch(/^data:/);
    expect(link.getAttribute("download")).toBe("договор.pdf");
    expect(dump().materials.find((x) => x.trait === "req").file.name).toBe("договор.pdf");
  });

  it("материалы переживают выгрузку и загрузку", () => {
    const m = dump();
    loadJson({ ...m, materials: [{ id: "mx", trait: "req", kind: "code", qty: 1, code: "LOADED22" }] });
    reports();
    pickTrait("req");
    expect(within(materialsCard()).getByText("LOADED22")).toBeInTheDocument();
    // Записанное у ресурса число не читается: «есть» — по материалам.
    pickTrait("dem");
    expect(screen.getByText(/Единиц пока нет/)).toBeInTheDocument();
  });
});
