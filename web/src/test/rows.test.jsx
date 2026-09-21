import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { Arrow, Grip } from "../components/ui.jsx";

/* ВЛАДЕЛЕЦ, 2026-09-21: «стрелка должна выглядеть не как кнопка, а просто
   как стрелка»; «три полоски на форме проекта слились в одну — исправь»;
   «я сказал распределить кнопки по ширине!». */
describe("стрелка и полоски", () => {
  it("стрелка — без рамки и фона, но нажимается и говорит, открыто ли", () => {
    render(<Arrow open={false} label="развернуть блок" onClick={() => {}} />);
    const a = screen.getByRole("button", { name: "развернуть блок" });
    expect(a.getAttribute("style")).toMatch(/border: 0/);
    expect(a.style.background).toBe("transparent");
    expect(a).toHaveAttribute("aria-expanded", "false");
    expect(a.textContent).toBe("▸");
  });
  it("три полоски стоят с промежутком — не сливаются в одну", () => {
    render(<Grip label="переставить" bind={{}} />);
    const g = screen.getByRole("button", { name: "переставить" });
    expect(g.children).toHaveLength(3);
    expect(parseFloat(g.style.gap)).toBeGreaterThan(0);
  });
});

describe("ряд из одних кнопок — по ширине", () => {
  it("ряд из одних кнопок — сетка равных ячеек с зазором 3 мм, капсулы со значками не трогает", () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");
    expect(css).toMatch(/\.flex\.gap-2:not\(:has\(> :not\(button\)\)\):not\(:has\(svg\)\)[^{]*\{\s*display:\s*grid/);
    expect(css).toMatch(/--gap-x:\s*12px/);          // 3 мм между кнопками
    // Кнопку саму при этом не растягивают.
    expect(css).not.toMatch(/>\s*button\s*\{\s*flex:\s*1\s+1/);
  });
});

/* НА 15 % МЕНЬШЕ, НО НЕ БЛИЖЕ 2 ММ К БУКВАМ (владелец, 2026-09-21).
   Размеры заданы токенами в одном месте — их и проверяем: по ширине
   полные 15 %, по высоте — сколько позволяют 2 мм (7,6 px) до буквы. */
describe("размеры на 15 % меньше", () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");
  const token = (name) => Number((css.match(new RegExp(`${name}:\\s*([\\d.]+)px`)) || [])[1]);
  it("кнопка: по ширине −15 %, по высоте — до буквы не меньше 2 мм", () => {
    expect(token("--btn-px")).toBe(10);                 // 12 − 15 %
    const h = token("--control-h");
    expect(h).toBeLessThan(28);
    // Прописная 10 px: до рамки с каждой стороны остаётся ≥ 7,6 px.
    expect((h - 10) / 2).toBeGreaterThanOrEqual(7.6);
    expect(token("--btn-py") * 2 + 18 + 2).toBe(h);     // отступы собирают ту же высоту
  });
  it("поле и форма — на 15 %", () => {
    expect(token("--inp-py") * 2 + 20 + 2).toBeLessThanOrEqual(38 * 0.85 + 0.5);
    expect(token("--inp-px")).toBe(10);
    expect(token("--inset")).toBe(16);                  // 20 − 15 % → на сетку 4
  });
  it("кнопка и поле берут размеры из токенов, а шрифт — прежний", async () => {
    const { S, btn } = await import("../components/ui.jsx");
    expect(btn(false).paddingLeft).toBe("var(--btn-px)");
    expect(btn(false).paddingTop).toContain("var(--btn-py)");
    expect(btn(false).fontSize).toBe("var(--fs-btn)");
    expect(S.inp.padding).toBe("var(--inp-py) var(--inp-px)");
    expect(S.inp.fontSize).toBe("var(--fs-body)");
    expect(S.card.padding).toBe("var(--inset)");
  });
});

/* ЧЕТЫРЕ РАЗМЕРА И ДВА КЕРНИНГА (владелец, 2026-09-21): заголовок, кнопка,
   текст, подсказка — токенами; числовых размеров в компонентах не осталось,
   кроме знаков (звёзды, часы), которые не текст. */
describe("типографика токенами", () => {
  it("в компонентах нет размеров шрифта числом, кроме знаков", () => {
    const dir = path.resolve(process.cwd(), "src/components");
    const left = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".jsx")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      for (const m of src.matchAll(/fontSize:\s*([0-9.]+)/g)) {
        if (Number(m[1]) < 24) left.push(`${f}: ${m[1]}`);
      }
    }
    expect(left).toEqual([]);
  });
  it("токены: заголовок крупнее текста, текст крупнее подсказки; отступ от краёв один", () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");
    const px = (n) => Number((css.match(new RegExp(`${n}:\\s*([\\d.]+)px`)) || [])[1]);
    expect(px("--fs-title")).toBeGreaterThan(px("--fs-body"));
    expect(px("--fs-body")).toBeGreaterThan(px("--fs-hint"));
    expect(px("--fs-btn")).toBe(px("--fs-body"));
    expect(px("--inset") % 4).toBe(0);
    expect(px("--gap") % 4).toBe(0);
  });
});

/* «ВЕРНУТЬ» — ТАКАЯ ЖЕ ИЗГИБАЮЩАЯСЯ СТРЕЛКА, КАК «ОТМЕНИТЬ», ТОЛЬКО В
   ДРУГУЮ СТОРОНУ, И РОВНО ПОСЕРЕДИНЕ КАПСУЛЫ (владелец, 2026-09-21). */
describe("значки стрелок", () => {
  it("«вернуть» — отражение «отменить»: дуга и наконечник в обе стороны", async () => {
    const { ICON } = await import("../components/ui.jsx");
    expect(ICON.undo).toMatch(/a5 5 0 0 1/);      // дуга по часовой
    expect(ICON.redo).toMatch(/a5 5 0 0 0/);      // и против
    // Наконечник «вернуть» — две черты В ОДНУ сторону от острия.
    expect(ICON.redo).toMatch(/M18 9l-3\.5-3\.5M18 9l-3\.5 3\.5/);
    expect(ICON.undo).toMatch(/M6 9l3\.5-3\.5M6 9l3\.5 3\.5/);
  });
  it("рисунок стоит в середине квадрата 24×24: острия зеркальны относительно 12", async () => {
    const { ICON } = await import("../components/ui.jsx");
    const tip = (d) => Number(d.match(/^M(-?[\d.]+)/)[1]);
    // Остриё «отменить» на 6, «вернуть» на 18: середина — 12, размах у
    // обоих 6…18 (дуга радиусом 5 от 13 и от 11).
    expect((tip(ICON.undo) + tip(ICON.redo)) / 2).toBe(12);
    expect(ICON.undo).toMatch(/^M6 9h7a5 5/);
    expect(ICON.redo).toMatch(/^M18 9h-7a5 5/);
  });
});
