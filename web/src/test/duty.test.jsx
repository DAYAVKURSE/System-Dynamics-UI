import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProfilePanel from "../components/ProfilePanel.jsx";
import { dutyOf } from "../lib/funcs.js";

/* ВЫПОЛНЯЕМЫЕ ЗАДАЧИ В АНКЕТЕ.

   Настройки актива человек не видит: их открывает владелец. Но знать, что
   на нём висит, он должен — и по всем активам сразу, а не по одному.
   Поручает ДОЛЖНОСТЬ: выбрать себе работу нельзя, можно только отказаться
   от того, в чём уже выбрали, и вернуть отказ назад. */

const ENTITIES = [
  { id: "e1", name: "Продажи", crew: ["2", "3"] },
  { id: "e2", name: "Склад", crew: ["2"] },
  { id: "e3", name: "Бухгалтерия", crew: ["9"] },
];
const FUNCS = [
  { id: "f1", e: "e1", name: "Звонок лиду", posts: { owners: ["p-sales"] } },
  { id: "f2", e: "e1", name: "Проверка счёта", posts: { reviewers: ["p-buh"] } },
  { id: "f3", e: "e2", name: "Приёмка", posts: { setters: ["p-sales"] }, except: ["2"] },
  { id: "f4", e: "e3", name: "Зарплата", posts: { owners: ["p-sales"] } },
];
const ME = { id: "2", name: "Иван", isOwner: false, known: true, tabs: ["tasks"],
  profile: { about: "" } };
const POS = (id) => (String(id) === "2" ? "p-sales" : "p-buh");

afterEach(() => vi.restoreAllMocks());

describe("что человеку поручено", () => {
  it("собирается по всем активам, где он воркер и его выбрали должностью", () => {
    const duty = dutyOf({ funcs: FUNCS, entities: ENTITIES }, "2", { positionOf: POS });
    expect(duty.map((d) => d.func)).toEqual(["f1", "f3"]);
    expect(duty[0]).toMatchObject({ asset: "e1", assetName: "Продажи",
      roles: ["owners"], off: false });
    // «Зарплата» — его должность, но в том активе он не воркер.
    expect(duty.some((d) => d.func === "f4")).toBe(false);
    // Отказ виден в том же списке, а не прячет запись.
    expect(duty.find((d) => d.func === "f3").off).toBe(true);
  });

  it("чужая роль в списке не появляется", () => {
    const duty = dutyOf({ funcs: FUNCS, entities: ENTITIES }, "3", { positionOf: POS });
    expect(duty.map((d) => d.func)).toEqual(["f2"]);
    expect(duty[0].roles).toEqual(["reviewers"]);
  });
});

describe("раздел в анкете", () => {
  const view = (props = {}) => render(
    <ProfilePanel me={ME} people={[{ id: "2", name: "Иван" }]} tasks={[]}
      funcs={FUNCS} entities={ENTITIES} positionOf={POS} {...props} />);

  it("стоит перед работами и показывает актив, функцию и роль", () => {
    const { container } = view();
    expect(screen.getByText("мои выполняемые задачи")).toBeTruthy();
    expect(screen.getByText("Звонок лиду")).toBeTruthy();
    expect(screen.getByText("Продажи")).toBeTruthy();
    expect(screen.getAllByText(/исполнитель/).length).toBeGreaterThan(0);
    const text = container.textContent;
    expect(text.indexOf("мои выполняемые задачи"))
      .toBeLessThan(text.indexOf("комментарии и работы"));
  });

  it("выбрать себе работу нельзя — в разделе только отказ", () => {
    view();
    const card = screen.getByText("мои выполняемые задачи").parentElement;
    const labels = [...card.querySelectorAll("button")]
      .map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["отказаться: Звонок лиду", "вернуть: Приёмка"]);
  });

  it("отказ уходит на сервер и возвращается тем же нажатием", async () => {
    const sent = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      sent.push([url, opts?.body ? JSON.parse(opts.body) : null]);
      if (String(url).endsWith("/workspace/duty") && !opts?.method) {
        return { ok: true, status: 200, json: async () => ({ duty: [
          { func: "f1", name: "Звонок лиду", asset: "e1", assetName: "Продажи",
            roles: ["owners"], off: false },
        ] }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));
    view();
    fireEvent.click(screen.getByRole("button", { name: "отказаться: Звонок лиду" }));
    await waitFor(() => expect(sent.some(([u]) => String(u).includes("/funcs/f1/duty")))
      .toBe(true));
    expect(sent.find(([u]) => String(u).includes("/funcs/f1/duty"))[1]).toEqual({ off: true });
    const back = await screen.findByRole("button", { name: "вернуть: Звонок лиду" });
    fireEvent.click(back);
    await waitFor(() => expect(sent.filter(([u]) => String(u).includes("/funcs/f1/duty")).length)
      .toBe(2));
    expect(sent.filter(([u]) => String(u).includes("/funcs/f1/duty"))[1][1])
      .toEqual({ off: false });
  });

  it("в чужой анкете отказаться нельзя — только прочитать", () => {
    render(<ProfilePanel me={ME} personId="3" people={[{ id: "3", name: "Пётр" }]}
      tasks={[]} funcs={FUNCS} entities={ENTITIES} positionOf={POS} />);
    expect(screen.getByText("выполняемые задачи")).toBeTruthy();
    expect(screen.getByText("Проверка счёта")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /отказаться/ })).toBeNull();
  });

  it("владелец пишет модель сам, без запроса на сервер", () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls.push(1);
      return { ok: true, status: 200, json: async () => ({}) };
    }));
    const seen = [];
    render(<ProfilePanel me={{ ...ME, isOwner: true }} people={[{ id: "2", name: "Иван" }]}
      tasks={[]} funcs={FUNCS} entities={ENTITIES} positionOf={POS}
      onRefuseFunc={(id, off) => seen.push([id, off])} />);
    fireEvent.click(screen.getByRole("button", { name: "отказаться: Звонок лиду" }));
    expect(seen).toEqual([["f1", true]]);
    expect(calls.length).toBe(0);
  });
});
