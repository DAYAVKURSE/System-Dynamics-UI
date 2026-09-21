import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import {
  BITE, DIM, GAP, GROW, NOMINAL_W, bend, centers, dimAt, hold, lens, nearest, radiusOf,
  settled, shown, step,
} from "../lib/drum.js";
import { openTab } from "./openTab.js";
import { VAR, applyCapShift, capShift } from "../lib/capShift.js";

/* ════════════════════════════════════════════════════════════════
   БАРАБАН ВКЛАДОК И НАДПИСЬ ПОСЕРЕДИНЕ (владелец, 2026-09-21)

   «Не выглядит как круглый барабан: слова уменьшаются целиком, а не
   плавно, не видно изгиб. Движение — плавно, с небольшой задержкой и
   самую малость прерывисто, как будто внутри много шестерёнок. Линза
   немного увеличивает 60% площади посередине и плавно расплывается к
   краям»; «активной становится та, которая в середине, а не та, на
   которую нажали»; «надписи должны быть чётко посередине».
   ════════════════════════════════════════════════════════════════ */

describe("цилиндр", () => {
  const R = radiusOf(100);
  it("точка на дуге: посередине — на месте, у обода — ближе к середине и глубже", () => {
    expect(bend(0, R)).toMatchObject({ dx: 0, dz: 0, th: 0, hidden: false });
    const b = bend(80, R);
    expect(b.dx).toBeLessThan(0);          // проекция короче дуги
    expect(b.dz).toBeLessThan(0);          // ушла вглубь
    expect(b.th).toBeCloseTo(80 / R, 6);   // угол — дуга на радиус
    expect(bend(-80, R).th).toBeCloseTo(-b.th, 6);
    expect(bend(-80, R).dx).toBeCloseTo(-b.dx, 6);
  });
  it("дальше четверти оборота буквы не видно", () => {
    expect(bend(R * 2, R).hidden).toBe(true);
    expect(bend(R * 1.2, R).hidden).toBe(false);
  });
  it("изгиб — внутри слова: две буквы одной вкладки стоят под разными углами", () => {
    // Буквы на −20 и +20 px от середины своей вкладки — разные углы,
    // и это и есть видимый изгиб слова, которого не давал поворот целиком.
    expect(bend(-20, R).th).not.toBeCloseTo(bend(20, R).th, 3);
    expect(Math.abs(bend(20, R).th)).toBeGreaterThan(0.05);
  });
  it("буква у обода гаснет плавно, посередине видна вся", () => {
    expect(dimAt(0)).toBeCloseTo(1, 6);
    expect(dimAt(Math.PI / 2)).toBeCloseTo(DIM, 6);
    const a = dimAt(0.3), b = dimAt(0.6), c = dimAt(0.9);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });
});

describe("линза", () => {
  it("немного увеличивает середину и ничего — край", () => {
    expect(lens(0)).toBeCloseTo(1 + GROW, 6);
    expect(lens(1)).toBeLessThan(1.01);
    expect(GROW).toBeLessThanOrEqual(0.15);
  });
  it("держит больше половины увеличения на ~60% ширины, дальше гаснет", () => {
    const half = 1 + GROW / 2;
    expect(lens(0.29)).toBeGreaterThan(half);   // внутри 60 %
    expect(lens(0.5)).toBeGreaterThan(half);
    expect(lens(0.7)).toBeLessThan(half);       // снаружи
  });
  it("расплывается плавно: ни ступеней, ни изломов", () => {
    const at = [];
    for (let u = 0; u <= 1.0001; u += 0.01) at.push(lens(u));
    const d = at.slice(1).map((v, i) => v - at[i]);
    expect(d.every((v) => v <= 1e-12)).toBe(true);
    const jerk = d.slice(1).map((v, i) => Math.abs(v - d[i]));
    expect(Math.max(...jerk)).toBeLessThan(0.0015);
  });
});

describe("тяжёлый ход", () => {
  it("догоняет цель не сразу — с задержкой — и в конце стоит ровно на ней", () => {
    let m = { at: 0, v: 0 };
    m = step(m, 100);
    expect(m.at).toBeGreaterThan(0);
    expect(m.at).toBeLessThan(20);                 // первый кадр — малая доля пути
    for (let i = 0; i < 400; i += 1) m = step(m, 100);
    expect(settled(m, 100)).toBe(true);
    expect(m.at).toBeCloseTo(100, 1);
  });
  it("не перелетает заметно: тяжёлый, а не пружина", () => {
    let m = { at: 0, v: 0 };
    let top = 0;
    for (let i = 0; i < 400; i += 1) { m = step(m, 100); top = Math.max(top, m.at); }
    expect(top).toBeLessThan(103);
  });
  it("зубья: на ходу положение чуть дрожит, в покое — нет", () => {
    expect(shown(50, 0)).toBe(50);
    const moving = [40, 41, 42, 43, 44, 45].map((x) => shown(x, 3) - x);
    expect(Math.max(...moving.map(Math.abs))).toBeGreaterThan(0.3);
    expect(Math.max(...moving.map(Math.abs))).toBeLessThanOrEqual(BITE + 1e-9);
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
    expect(screen.getByRole("button", { name: "Задачи" })).toHaveAttribute("aria-current", "page");
    expect(other).not.toHaveAttribute("aria-current");
  });

  it("докрутили до середины — она и стала открытой", () => {
    render(<SystemModel />);
    openTab("Схема");
    expect(screen.getByRole("button", { name: "Схема" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Задачи" })).not.toHaveAttribute("aria-current");
    openTab("Анкета");
    expect(screen.getByRole("button", { name: "Анкета" })).toHaveAttribute("aria-current", "page");
  });

  it("недокрутили: посередине осталась прежняя — она и остаётся открытой", () => {
    render(<SystemModel />);
    const drum = document.querySelector("[data-drum]");
    const short = -(NOMINAL_W + GAP) / 3;
    drum.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 0, button: 0 }));
    drum.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: short }));
    drum.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: short }));
    expect(screen.getByRole("button", { name: "Задачи" })).toHaveAttribute("aria-current", "page");
  });

  it("вид стоит с самого начала: вкладка на дуге, буквы — каждая на своей точке", () => {
    render(<SystemModel />);
    const mid = screen.getByRole("button", { name: "Задачи" });
    const side = screen.getByRole("button", { name: "Рынок услуг" });
    expect(mid.style.transform).toContain("rotateY(0.00deg)");
    const size = (el) => Number(el.style.transform.match(/scale\(([\d.]+)\)/)[1]);
    expect(size(mid)).toBeGreaterThan(size(side));
    // Буквы — свои элементы, и у каждой свой поворот.
    const letters = [...side.querySelectorAll("[data-letter]")];
    expect(letters.map((l) => l.textContent).join("")).toBe("Рынок услуг");
    expect(letters.every((l) => /rotateY\(/.test(l.style.transform))).toBe(true);
    // Буква дальней вкладки тусклее буквы открытой.
    const op = (el) => Number(el.querySelector("[data-letter]").style.opacity);
    expect(op(side)).toBeLessThan(op(mid));
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
