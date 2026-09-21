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
