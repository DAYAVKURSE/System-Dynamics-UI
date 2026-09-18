import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    // Под прогнозом никаких подписей (владелец, 2026-09-13).
    expect(within(sim).queryByText(/На блоке/)).toBeNull();
    // Обе формы — в одной строке, без переноса.
    expect(scale.parentElement).toBe(sim.parentElement);
    expect(scale.parentElement.style.flexWrap).toBe("nowrap");
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

/* Камера: viewBox svg. Окно в тестах не измеряется (0×0) — берётся
   запасной размер 1000×600, и масштаб = 1000 / ширина viewBox. */
const vb = () => {
  const [x, y, w, h] = container.querySelector("svg").getAttribute("viewBox").split(" ").map(Number);
  return { x, y, w, h };
};
const zoomOf = () => 1000 / vb().w;
const sheet = () => {
  const rects = Array.from(container.querySelectorAll("[data-entity] > rect:first-child"));
  const cw = Math.max(1000, ...rects.map((r) => Number(r.getAttribute("x")) + Number(r.getAttribute("width")) + 24));
  const ch = Math.max(740, ...rects.map((r) => Number(r.getAttribute("y")) + Number(r.getAttribute("height")) + 24));
  return { cw, ch };
};
const fits = () => {
  const v = vb(), { cw, ch } = sheet();
  return v.x <= 0.01 && v.y <= 0.01 && v.x + v.w >= cw - 0.01 && v.y + v.h >= ch - 0.01;
};

describe("схема просыпается одним нажатием (владелец, 2026-09-18)", () => {
  const box = () => container.querySelector("[data-scheme-box]");
  it("пока не нажали — жесты пальца уходят странице; одно касание будит, нажатие вне усыпляет", () => {
    expect(box().dataset.live).toBe("0");
    expect(box().style.touchAction).toBe("pan-y");
    expect(screen.getByText("нажмите, чтобы двигать схему")).toBeInTheDocument();
    // Свайп пальцем схему не будит и жестов себе не забирает.
    fireEvent.pointerDown(box(), { pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerUp(box(), { pointerType: "touch", clientX: 100, clientY: 180 });
    expect(box().dataset.live).toBe("0");
    // Касание без движения — будит.
    fireEvent.pointerDown(box(), { pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerUp(box(), { pointerType: "touch", clientX: 102, clientY: 101 });
    expect(box().dataset.live).toBe("1");
    expect(box().style.touchAction).toBe("none");
    expect(screen.queryByText("нажмите, чтобы двигать схему")).toBeNull();
    // Нажатие вне схемы — снова спит.
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    expect(box().dataset.live).toBe("0");
  });
});

describe("окно и лист", () => {
  it("схема — в окне фиксированной высоты, лист вписан в него при открытии", () => {
    const box = container.querySelector("[data-scheme-box]");
    expect(box.style.height).toContain("520px");
    expect(box.style.overflow).toBe("hidden");
    expect(container.querySelector("svg").getAttribute("width")).toBe("100%");
    expect(fits()).toBe(true);
  });

  it("«+» плавно увеличивает, «−» уменьшает, а дальше «вписать лист» не уходит", async () => {
    const z0 = zoomOf();
    fireEvent.click(screen.getByRole("button", { name: "увеличить" }));
    await waitFor(() => expect(zoomOf()).toBeGreaterThan(z0 * 1.2));
    for (let i = 0; i < 8; i += 1) fireEvent.click(screen.getByRole("button", { name: "уменьшить" }));
    await waitFor(() => expect(fits()).toBe(true));
    expect(zoomOf()).toBeCloseTo(z0, 5);
  });

  it("один палец по пустому месту прокручивает лист, а не страницу", async () => {
    fireEvent.click(screen.getByRole("button", { name: "увеличить" }));
    // Пока лист уже окна, он стоит по центру и прокручивать нечего: ждём,
    // когда масштаб перевалит за 1 и лист станет шире окна.
    await waitFor(() => expect(zoomOf()).toBeGreaterThan(1));
    const svg = container.querySelector("svg");
    const x0 = vb().x;
    fireEvent.pointerDown(svg, { clientX: 300, clientY: 200, button: 0 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 200 });
    expect(vb().x).toBeGreaterThan(x0);
    fireEvent.pointerUp(window, { clientX: 200, clientY: 200 });
  });
});

describe("щипок", () => {
  it("точка листа под серединой пальцев остаётся под ней на каждом движении", () => {
    const box = container.querySelector("[data-scheme-box]");
    const under = (sx, sy) => { const v = vb(), z = 1000 / v.w; return [v.x + sx / z, v.y + sy / z]; };
    touch(box, "touchstart", [[100, 100], [200, 100]]);
    const [wx, wy] = under(150, 100);
    const z0 = zoomOf();
    touch(box, "touchmove", [[50, 100], [250, 100]]);        // разводим — крупнее вдвое
    expect(zoomOf()).toBeCloseTo(z0 * 2, 3);
    expect(under(150, 100)[0]).toBeCloseTo(wx, 3);
    expect(under(150, 100)[1]).toBeCloseTo(wy, 3);
    // Середина пальцев сдвинулась — та же точка листа едет за ней.
    touch(box, "touchmove", [[80, 140], [280, 140]]);
    expect(under(180, 140)[0]).toBeCloseTo(wx, 3);
    expect(under(180, 140)[1]).toBeCloseTo(wy, 3);
    touch(box, "touchend", []);
  });

  it("сводим пальцы до упора — лист целиком в окне; за лист камера не уезжает", () => {
    const box = container.querySelector("[data-scheme-box]");
    touch(box, "touchstart", [[100, 100], [400, 100]]);
    touch(box, "touchmove", [[240, 100], [260, 100]]);
    touch(box, "touchend", []);
    expect(fits()).toBe(true);
    // Крупно и в угол: viewBox не выходит за лист.
    touch(box, "touchstart", [[100, 100], [200, 100]]);
    touch(box, "touchmove", [[0, 100], [300, 100]]);
    touch(box, "touchend", []);
    // Хотя бы половина окна — над листом по каждой оси.
    const v = vb(), { cw, ch } = sheet();
    expect(v.x).toBeGreaterThanOrEqual(-v.w / 2 - 0.01);
    expect(v.y).toBeGreaterThanOrEqual(-v.h / 2 - 0.01);
    expect(v.x).toBeLessThanOrEqual(cw - v.w / 2 + 0.01);
    expect(v.y).toBeLessThanOrEqual(ch - v.h / 2 + 0.01);
  });
});
