import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { EDGE, GROW, REACH, lensAt, lensStyle, placeIn } from "../lib/lens.js";
import { VAR, applyCapShift, capShift } from "../lib/capShift.js";

/* ════════════════════════════════════════════════════════════════
   ЛУПА НА ВКЛАДКАХ И НАДПИСЬ ПОСЕРЕДИНЕ (владелец, 2026-09-21)

   «Эффект вытянутой горизонтально лупы: объект в середине увеличен, а по
   краям уменьшаются, но только прямо близко к краю… текст как будто
   написан на крутящемся внутри цилиндре»; «надписи должны быть чётко
   посередине, они как будто смещены вверх».
   ════════════════════════════════════════════════════════════════ */

describe("лупа", () => {
  it("в середине — увеличение, и только там", () => {
    expect(lensAt(0).scale).toBeCloseTo(1 + GROW, 5);
    expect(lensAt(0).turn).toBe(0);
    // Чуть в сторону — увеличение ещё есть, но меньше.
    expect(lensAt(REACH / 2).scale).toBeGreaterThan(1);
    expect(lensAt(REACH / 2).scale).toBeLessThan(1 + GROW);
    // За пределом досягаемости лупы его нет вовсе.
    expect(lensAt(REACH).scale).toBeCloseTo(1, 5);
    expect(lensAt((REACH + EDGE) / 2).scale).toBeCloseTo(1, 5);
  });

  it("уменьшение и заворот — только прямо у края", () => {
    // До обода вкладка стоит прямо и в полную силу.
    expect(lensAt(EDGE).turn).toBe(0);
    expect(lensAt(EDGE).dim).toBe(1);
    expect(lensAt(EDGE).scale).toBeCloseTo(1, 5);
    // За ободом — заворот, и у самого края он резче, чем на полпути.
    const mid = lensAt((EDGE + 1) / 2);
    const край = lensAt(1);
    expect(Math.abs(mid.turn)).toBeGreaterThan(0);
    expect(Math.abs(край.turn)).toBeGreaterThan(Math.abs(mid.turn) * 3);
    expect(край.scale).toBeLessThan(1);
    expect(край.dim).toBeLessThan(1);
    expect(край.depth).toBeLessThan(0);
  });

  it("цилиндр: края заворачиваются в разные стороны, симметрично", () => {
    expect(lensAt(-1).turn).toBe(-lensAt(1).turn);
    expect(lensAt(-1).scale).toBeCloseTo(lensAt(1).scale, 5);
    // За краем ряда сильнее, чем на краю, уже не бывает.
    expect(lensAt(3).turn).toBe(lensAt(1).turn);
  });

  it("стиль — перспектива, поворот, глубина и размер одной строкой", () => {
    const v = lensStyle(1);
    expect(v.transform).toMatch(/^perspective\(\d+px\) rotateY\(-?[\d.]+deg\) translateZ\(-[\d.]+px\) scale\([\d.]+\)$/);
    expect(Number(v.opacity)).toBeLessThan(1);
    expect(lensStyle(0).transform).toContain("rotateY(0.00deg)");
    expect(Number(lensStyle(0).opacity)).toBe(1);
  });

  it("место вкладки считается по разметке, а не по повёрнутому виду", () => {
    const box = { clientWidth: 200, scrollLeft: 0 };
    expect(placeIn(box, { offsetLeft: 90, offsetWidth: 20 })).toBeCloseTo(0, 5);
    expect(placeIn(box, { offsetLeft: 0, offsetWidth: 20 })).toBeCloseTo(-0.9, 5);
    expect(placeIn(box, { offsetLeft: 180, offsetWidth: 20 })).toBeCloseTo(0.9, 5);
    // Прокрутка ряда двигает место вместе с рядом.
    expect(placeIn({ clientWidth: 200, scrollLeft: 90 }, { offsetLeft: 90, offsetWidth: 20 }))
      .toBeCloseTo(-0.9, 5);
    // Ряда ещё нет на экране — ничего не считаем.
    expect(placeIn({ clientWidth: 0 }, { offsetLeft: 10, offsetWidth: 10 })).toBe(0);
  });

  it("на ряду вкладок лупа стоит с самого начала", () => {
    render(<SystemModel />);
    const tab = screen.getByRole("button", { name: "Схема" });
    expect(tab.style.transform).toContain("perspective(");
    expect(tab.style.transform).toContain("rotateY(");
    expect(tab.style.opacity).not.toBe("");
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
