import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { SWIPE_SHARE, swipeFrom, swipeStep, tabAfter } from "../lib/swipe.js";

/* СВАЙП ПЕРЕКЛЮЧАЕТ ВКЛАДКИ (владелец, 2026-09-19): «движение которого
   занимает не менее 60% от экрана в поперечнике», позже — «сделай
   необходимый для свайпа процент 40». */

const touch = (el, kind, x, y = 100) => fireEvent[kind](el,
  kind === "touchEnd" ? { changedTouches: [{ clientX: x, clientY: y }] }
    : { touches: [{ clientX: x, clientY: y }] });
const swipe = (el, from, to, y2 = 100) => {
  touch(el, "touchStart", from);
  touch(el, "touchEnd", to, y2);
};

describe("мера свайпа", () => {
  const W = 1000;
  it("порог — доля ширины экрана, и она названа один раз", () => {
    expect(SWIPE_SHARE).toBe(0.4);
  });
  it("короткое движение — не свайп: палец ходит по экрану всё время", () => {
    expect(swipeStep({ dx: -200, width: W })).toBe(0);
    expect(swipeStep({ dx: -W * SWIPE_SHARE + 1, width: W })).toBe(0);
  });
  it("размашистое: влево — следующая вкладка, вправо — предыдущая", () => {
    expect(swipeStep({ dx: -420, width: W })).toBe(1);
    expect(swipeStep({ dx: 420, width: W })).toBe(-1);
  });
  it("поперёк — это прокрутка, а не смена вкладки", () => {
    expect(swipeStep({ dx: -700, dy: -900, width: W })).toBe(0);
  });
  it("за краем ряда вкладок нет — там и остаёмся", () => {
    const keys = ["a", "b", "c"];
    expect(tabAfter(keys, "a", -1)).toBe("a");
    expect(tabAfter(keys, "c", 1)).toBe("c");
    expect(tabAfter(keys, "b", 1)).toBe("c");
  });
  it("там, где палец значит своё, свайпа нет", () => {
    document.body.innerHTML = "<div data-pannable=''><span id='in'></span></div><span id='out'></span>";
    expect(swipeFrom(document.getElementById("in"))).toBe(false);
    expect(swipeFrom(document.getElementById("out"))).toBe(true);
    document.body.innerHTML = "";
  });
});

describe("свайп по экрану", () => {
  it("меняет вкладку влево и вправо", () => {
    const { container } = render(<SystemModel />);
    const root = container.firstChild;
    const W = window.innerWidth;
    // Открыты «Задачи»; влево — «Проверка», она в ряду следующая.
    swipe(root, W - 20, 20);
    expect(screen.getByText(/постановка и проверка/)).toBeInTheDocument();
    // Вправо — обратно в «Задачи».
    swipe(root, 20, W - 20);
    expect(screen.queryByText(/постановка и проверка/)).toBeNull();
  });

  it("короткого движения мало: вкладка остаётся", () => {
    const { container } = render(<SystemModel />);
    const root = container.firstChild;
    swipe(root, 400, 200);
    expect(screen.queryByText(/постановка и проверка/)).toBeNull();
  });
});

/* КОЛЕНО СО СКРУГЛЕНИЕМ (владелец, 2026-09-19): «на схеме должны быть
   стрелки строго вертикальные и горизонтальные с закруглениями. В
   МайндКарте тоже». */
describe("ортогональные линии", () => {
  it("каждый прямой отрезок — по вертикали или по горизонтали, углы скруглены", async () => {
    const { orthPath, elbow } = await import("../lib/paths.js");
    const d = orthPath([[0, 0], [0, 50], [80, 50], [80, 90]], 10);
    // Углы — квадратичные кривые, отрезки между ними прямые.
    expect(d).toMatch(/^M0,0 /);
    expect((d.match(/Q/g) || []).length).toBe(2);
    expect(d).not.toMatch(/C/);
    // Колено между блоками: выходит из стороны блока и входит во встречную.
    const e = elbow({ x: 0, y: 0 }, { x: 0, y: 200 }, { w: 100, h: 60, r: 12 });
    expect(e.d.startsWith("M50,60")).toBe(true);
    expect(e.mid).toEqual([50, 130]);
  });

  it("короткое колено не съедает само себя: радиус прижат к половине стороны", () => {
    return import("../lib/paths.js").then(({ orthPath }) => {
      const d = orthPath([[0, 0], [0, 4], [10, 4]], 10);
      // Угол скруглён не больше, чем на половину короткой стороны (2).
      expect(d).toContain("L0,2");
    });
  });
});
