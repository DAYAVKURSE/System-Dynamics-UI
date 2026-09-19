import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { SWIPE_SHARE, swipeFrom, swipeStep, tabAfter } from "../lib/swipe.js";

/* СВАЙП ПЕРЕКЛЮЧАЕТ ВКЛАДКИ (владелец, 2026-09-19): «движение которого
   занимает не менее 60% от экрана в поперечнике». */

const touch = (el, kind, x, y = 100) => fireEvent[kind](el,
  kind === "touchEnd" ? { changedTouches: [{ clientX: x, clientY: y }] }
    : { touches: [{ clientX: x, clientY: y }] });
const swipe = (el, from, to, y2 = 100) => {
  touch(el, "touchStart", from);
  touch(el, "touchEnd", to, y2);
};

describe("мера свайпа", () => {
  const W = 1000;
  it("короткое движение — не свайп: палец ходит по экрану всё время", () => {
    expect(swipeStep({ dx: -400, width: W })).toBe(0);
    expect(swipeStep({ dx: -W * SWIPE_SHARE + 1, width: W })).toBe(0);
  });
  it("через весь экран: влево — следующая вкладка, вправо — предыдущая", () => {
    expect(swipeStep({ dx: -700, width: W })).toBe(1);
    expect(swipeStep({ dx: 700, width: W })).toBe(-1);
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
