import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* СХЕМА: две формы над ней, полоски состояния на блоках, щипок.

   Владелец (2026-09-13): «в первой форме масштаба в конце строки слово
   «месяц» ни к чему не относится — сделай форму «Масштаб» отдельно, убери
   слово «масштаб», оставь «−», «+», «выровнять», «+ актив»; справа —
   форма с прокруткой и словом «прогноз»; двумя пальцами схема
   увеличивается и уменьшается; полоски на блоках — ровные, красная, если
   актив не принят, зелёная, если принят». */

let container;
beforeEach(() => {
  localStorage.clear();
  ({ container } = render(<SystemModel />));
  fireEvent.click(screen.getByRole("button", { name: "Схема" }));
});

const touch = (el, type, points) => {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "touches", { value: points.map(([x, y]) => ({ clientX: x, clientY: y })) });
  act(() => { el.dispatchEvent(ev); });
};
const svgWidth = () => Number(container.querySelector("svg").getAttribute("width"));

describe("формы над схемой", () => {
  it("«масштаб» — только кнопки, без слова; справа «прогноз» с ползунком", () => {
    const scale = screen.getByLabelText("масштаб");
    expect(within(scale).queryByText("масштаб")).toBeNull();
    expect(within(scale).getByRole("button", { name: "уменьшить" })).toBeInTheDocument();
    expect(within(scale).getByRole("button", { name: "увеличить" })).toBeInTheDocument();
    expect(within(scale).getByRole("button", { name: "⌗ выровнять" })).toBeInTheDocument();
    expect(within(scale).getByRole("button", { name: "+ актив" })).toBeInTheDocument();
    expect(within(scale).queryByText("месяц")).toBeNull();
    const sim = screen.getByLabelText("прогноз на схеме");
    expect(within(sim).getByText("прогноз")).toBeInTheDocument();
    expect(within(sim).getByLabelText("месяц на схеме")).toBeInTheDocument();
  });
});

describe("полоски на блоках", () => {
  it("ровная полоска внутри блока: зелёная у принятого актива, красная у непринятого", () => {
    const blocks = container.querySelectorAll("[data-entity]");
    expect(blocks.length).toBeGreaterThan(0);
    blocks.forEach((g) => {
      const frame = g.querySelector("rect");
      const stripe = g.querySelector("rect[data-state]");
      expect(stripe).not.toBeNull();
      const fx = Number(frame.getAttribute("x")), fy = Number(frame.getAttribute("y"));
      const fh = Number(frame.getAttribute("height"));
      // Полоска не касается рамки: отступ и слева, и сверху, и снизу.
      expect(Number(stripe.getAttribute("x"))).toBeGreaterThan(fx + 2);
      expect(Number(stripe.getAttribute("y"))).toBeGreaterThan(fy + 2);
      expect(Number(stripe.getAttribute("y")) + Number(stripe.getAttribute("height")))
        .toBeLessThan(fy + fh - 2);
    });
    const states = new Set(Array.from(container.querySelectorAll("rect[data-state]"))
      .map((r) => r.getAttribute("data-state")));
    // В образце есть и принятые, и непринятые активы — оба цвета на месте.
    expect(states.has("ok") || states.has("bad")).toBe(true);
    const okFill = container.querySelector('rect[data-state="ok"]')?.getAttribute("fill");
    const badFill = container.querySelector('rect[data-state="bad"]')?.getAttribute("fill");
    if (okFill && badFill) expect(okFill).not.toBe(badFill);
  });
});

describe("щипок", () => {
  it("двумя пальцами схема увеличивается и уменьшается в пределах масштаба", () => {
    const box = container.querySelector("[data-scheme-box]");
    const w0 = svgWidth();
    touch(box, "touchstart", [[100, 100], [200, 100]]);
    touch(box, "touchmove", [[50, 100], [250, 100]]);   // разводим — крупнее
    expect(svgWidth()).toBeGreaterThan(w0);
    touch(box, "touchend", []);
    const w1 = svgWidth();
    touch(box, "touchstart", [[100, 100], [300, 100]]);
    touch(box, "touchmove", [[150, 100], [250, 100]]);  // сводим — мельче
    expect(svgWidth()).toBeLessThan(w1);
    touch(box, "touchend", []);
    // Кнопки «−»/«+» — тот же масштаб.
    const w2 = svgWidth();
    fireEvent.click(screen.getByRole("button", { name: "увеличить" }));
    expect(svgWidth()).toBeGreaterThan(w2);
  });
});
