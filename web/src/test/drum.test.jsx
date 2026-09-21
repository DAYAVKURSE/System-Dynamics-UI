import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import {
  BIG, GAP, NOMINAL_W, SMALL, TURN, centers, hold, lensAt, lensStyle, nearest,
} from "../lib/drum.js";
import { openTab } from "./openTab.js";
import { VAR, applyCapShift, capShift } from "../lib/capShift.js";

/* ════════════════════════════════════════════════════════════════
   БАРАБАН ВКЛАДОК И НАДПИСЬ ПОСЕРЕДИНЕ (владелец, 2026-09-21)

   «Должен быть эффект увеличения: объекты уменьшаются к краю и
   увеличиваются посередине ПЛАВНО. Сейчас выглядит так, как будто барабан
   многоугольный»; «активной вкладкой должна становиться та, которая в
   середине, а не та, на которую нажали. Барабан не должен реагировать на
   нажатие»; «надписи должны быть чётко посередине».
   ════════════════════════════════════════════════════════════════ */

describe("линза", () => {
  it("крупнее всего посередине, мельче всего у края", () => {
    expect(lensAt(0).scale).toBeCloseTo(BIG, 5);
    expect(lensAt(1).scale).toBeCloseTo(SMALL, 5);
    expect(lensAt(-1).scale).toBeCloseTo(SMALL, 5);
  });

  it("убывает ПЛАВНО и без единой ступеньки: ни ровных участков, ни изломов", () => {
    const step = 0.01;
    const at = [];
    for (let u = 0; u <= 1.0001; u += step) at.push(lensAt(u).scale);
    const d = at.slice(1).map((v, i) => v - at[i]);
    // Всюду убывает — плоских участков, как у прежней кусочной формулы, нет.
    expect(d.every((v) => v < 0)).toBe(true);
    // И убывает гладко: соседние приращения отличаются мало, то есть
    // ломаного угла («грани многоугольника») нигде нет.
    const jerk = d.slice(1).map((v, i) => Math.abs(v - d[i]));
    expect(Math.max(...jerk)).toBeLessThan(0.002);
  });

  it("поворот — прямо по месту: это цилиндр, а не многоугольник", () => {
    expect(lensAt(0).turn).toBe(0);
    expect(lensAt(1).turn).toBeCloseTo(TURN, 5);
    expect(lensAt(-1).turn).toBeCloseTo(-TURN, 5);
    // Ровно посередине между серединой и краем — ровно половина угла.
    expect(lensAt(0.5).turn).toBeCloseTo(TURN / 2, 5);
    // И вглубь вкладка уходит тем дальше, чем сильнее повёрнута.
    expect(lensAt(1).depth).toBeLessThan(lensAt(0.5).depth);
    expect(lensAt(0).depth).toBeCloseTo(0, 5);
  });

  it("края гаснут, середина — в полную силу, и всё это симметрично", () => {
    expect(lensAt(0).dim).toBeCloseTo(1, 5);
    expect(lensAt(1).dim).toBeLessThan(0.5);
    expect(lensAt(-0.7).dim).toBeCloseTo(lensAt(0.7).dim, 5);
    expect(lensAt(-0.7).scale).toBeCloseTo(lensAt(0.7).scale, 5);
    // За краем окна сильнее, чем на краю, уже не бывает.
    expect(lensAt(4).scale).toBeCloseTo(lensAt(1).scale, 5);
  });

  it("стиль — перспектива, поворот, глубина и размер одной строкой", () => {
    const v = lensStyle(1);
    expect(v.transform).toMatch(/^perspective\(\d+px\) rotateY\(-?[\d.]+deg\) translateZ\(-?[\d.]+px\) scale\([\d.]+\)$/);
    expect(Number(v.opacity)).toBeLessThan(1);
    expect(lensStyle(0).transform).toContain("rotateY(0.00deg)");
    expect(Number(lensStyle(0).opacity)).toBe(1);
  });
});

describe("ряд барабана", () => {
  it("центры вкладок идут по их ширинам с промежутком", () => {
    expect(centers([100, 60, 80], 10)).toEqual([50, 140, 220]);
    expect(centers([])).toEqual([]);
  });

  it("ближайшая к середине — та, чей центр ближе", () => {
    const cs = centers([100, 60, 80], 10);
    expect(nearest(cs, 50)).toBe(0);
    expect(nearest(cs, 100)).toBe(1);
    expect(nearest(cs, 500)).toBe(2);
    expect(nearest([], 0)).toBe(-1);
  });

  it("дальше первой и последней барабан не крутится", () => {
    const cs = centers([100, 60, 80], 10);
    expect(hold(cs, -900)).toBe(cs[0]);
    expect(hold(cs, 900)).toBe(cs[cs.length - 1]);
    expect(hold(cs, 140)).toBe(140);
    expect(hold([], 5)).toBe(0);
  });
});

describe("выбирает середина, а не нажатие", () => {
  it("нажатие на вкладку не открывает её", () => {
    render(<SystemModel />);
    const was = screen.getByRole("button", { name: "Задачи" });
    expect(was).toHaveAttribute("aria-current", "page");
    const other = screen.getByRole("button", { name: "Схема" });
    other.click();
    // Ничего не произошло: барабан на нажатие не отзывается.
    expect(screen.getByRole("button", { name: "Задачи" })).toHaveAttribute("aria-current", "page");
    expect(other).not.toHaveAttribute("aria-current");
  });

  it("докрутили до середины — она и стала открытой", () => {
    render(<SystemModel />);
    openTab("Схема");
    expect(screen.getByRole("button", { name: "Схема" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Задачи" })).not.toHaveAttribute("aria-current");
    // И назад — тем же путём.
    openTab("Анкета");
    expect(screen.getByRole("button", { name: "Анкета" })).toHaveAttribute("aria-current", "page");
  });

  it("недокрутили: посередине осталась прежняя — она и остаётся открытой", () => {
    render(<SystemModel />);
    const drum = document.querySelector("[data-drum]");
    // Меньше половины вкладки — до соседней не дотянули.
    const short = -(NOMINAL_W + GAP) / 3;
    drum.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 0, button: 0 }));
    drum.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: short }));
    drum.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: short }));
    expect(screen.getByRole("button", { name: "Задачи" })).toHaveAttribute("aria-current", "page");
  });

  it("вид вкладок стоит на них с самого начала", () => {
    render(<SystemModel />);
    const mid = screen.getByRole("button", { name: "Задачи" });
    const side = screen.getByRole("button", { name: "Рынок услуг" });
    expect(mid.style.transform).toContain("rotateY(0.00deg)");
    // Открытая крупнее дальней — это и есть увеличение посередине.
    const size = (el) => Number(el.style.transform.match(/scale\(([\d.]+)\)/)[1]);
    expect(size(mid)).toBeGreaterThan(size(side));
    expect(Number(side.style.opacity)).toBeLessThan(Number(mid.style.opacity));
  });
});

describe("надпись посередине", () => {
  const metrics = (font) => ({ actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 0,
    fontBoundingBoxAscent: 11, fontBoundingBoxDescent: 4, font });

  it("поправка — это половина прописной минус перекос выносов", () => {
    const ctx = { font: "", measureText: () => metrics() };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    // 10/2 - (11-4)/2 = 5 - 3.5 = 1.5
    expect(capShift("600 13px X")).toBe(1.5);
    vi.restoreAllMocks();
  });

  it("померить не удалось — поправки нет, и ничего не съезжает", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(capShift("600 13px X")).toBe(0);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => { throw new Error("нет"); });
    expect(capShift("600 13px X")).toBe(0);
    vi.restoreAllMocks();
  });

  it("нелепая величина не применяется: это ошибка измерения, а не шрифт", () => {
    const ctx = { font: "", measureText: () => ({ actualBoundingBoxAscent: 40,
      actualBoundingBoxDescent: 0, fontBoundingBoxAscent: 11, fontBoundingBoxDescent: 4 }) };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    expect(capShift("600 13px X")).toBe(0);
    vi.restoreAllMocks();
  });

  it("поправка кладётся в корень документа переменной", () => {
    const ctx = { font: "", measureText: () => metrics() };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    expect(applyCapShift()).toBe(1.5);
    expect(document.documentElement.style.getPropertyValue(VAR)).toBe("1.5px");
    document.documentElement.style.removeProperty(VAR);
    vi.restoreAllMocks();
  });
});

/* ДЛИНА КНОПКИ — ПО НАДПИСИ (владелец, 2026-09-21: «кнопки не должны быть
   несоразмерно длинными, сделай нормальную длину»; «если кнопка должна
   стоять рядом с объектом слева — она не должна перемещаться вправо или
   изменять свои размеры»). Правила, которое растягивало кнопку на весь
   ряд, больше нет — проверяем это по самой таблице стилей. */
describe("кнопки не растягиваются", () => {
  it("в index.css нет правила «кнопка занимает всю ширину ряда»", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const css = fs.readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");
    expect(css).not.toMatch(/>\s*button\s*\{\s*flex:\s*1\s+1/);
    // Отступ под оптическую поправку — на месте.
    expect(css).toContain("--text-nudge");
  });

  it("кнопка у имени профиля своего размера и стоит рядом с именем", async () => {
    const { btn } = await import("../components/ui.jsx");
    // Высота кнопки держится минимумом, а не растяжкой ряда.
    expect(btn(false).minHeight).toBe("var(--control-h)");
    expect(btn(false).flex).toBeUndefined();
    expect(btn(false).width).toBeUndefined();
  });
});
