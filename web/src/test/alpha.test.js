import { describe, expect, it } from "vitest";
import { ACC, C, alpha } from "../components/ui.jsx";

/* Цвет с прозрачностью (владелец, 2026-09-22): токены — переменные CSS,
   hex-хвост к ним не приклеить — линейка таймлайна и рамки пропадали. */
describe("alpha", () => {
  it("к hex приклеивает хвост, к переменной — color-mix с процентом", () => {
    expect(alpha("#4de1ff", "66")).toBe("#4de1ff66");
    expect(alpha(ACC, "66")).toBe("color-mix(in srgb, var(--accent-cyan) 40%, transparent)");
    expect(alpha(C.line, "ff")).toBe("color-mix(in srgb, var(--border-glass) 100%, transparent)");
    expect(alpha(C.ink, "00")).toBe("color-mix(in srgb, var(--bg-base) 0%, transparent)");
  });
});
