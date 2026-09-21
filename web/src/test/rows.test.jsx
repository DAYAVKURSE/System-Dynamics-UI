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
  it("правило есть только для рядов, где нет ничего, кроме кнопок", () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");
    expect(css).toMatch(/\.flex\.gap-2:not\(:has\(:not\(button\)\)\)[^{]*\{\s*justify-content:\s*space-between/);
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
    expect(token("--card-p")).toBe(17);                 // 20 − 15 %
  });
  it("кнопка и поле берут размеры из токенов, а шрифт — прежний", async () => {
    const { S, btn } = await import("../components/ui.jsx");
    expect(btn(false).paddingLeft).toBe("var(--btn-px)");
    expect(btn(false).paddingTop).toContain("var(--btn-py)");
    expect(btn(false).fontSize).toBe(13);
    expect(S.inp.padding).toBe("var(--inp-py) var(--inp-px)");
    expect(S.inp.fontSize).toBe(14);
    expect(S.card.padding).toBe("var(--card-p)");
  });
});
