import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Splash, { APPLES, FALL, FALL_AT, HOLD, STAGGER, TURN, cubePaths, frameAt, project }
  from "../components/LogoLoader.jsx";
import SystemModel from "../components/SystemModel.jsx";
import { resetIdentity } from "../identity.js";

/* Окно загрузки (владелец, 2026-09-21): куб делает полный оборот, потом
   четыре яблока падают; в начале они на ветках. */

const REST = Math.PI / 4;
const near = (p, x, y) => Math.abs(p.x - x) < 0.6 && Math.abs(p.y - y) < 0.6;

describe("куб логотипа", () => {
  it("в покое — шестигранник логотипа", () => {
    expect(near(project([-1, 1, -1], REST), 50, 6)).toBe(true);
    expect(near(project([1, 1, -1], REST), 87, 28)).toBe(true);
    expect(near(project([1, -1, 1], REST), 50, 94)).toBe(true);
    expect(near(project([1, 1, 1], REST), 50, 50)).toBe(true);
    const p = cubePaths(REST, 0);
    // черенок логотипа: от правой вершины к середине, не целиком
    expect(p.front).toMatch(/M87 28L69\.?\d* 38\.?\d*/);
    // вертикаль от верхней вершины к середине в покое не рисуется
    expect(p.back + p.front).not.toMatch(/M50 6L50 50/);
  });
  it("во время оборота рёбра целые, к концу — снова черенки", () => {
    const mid = frameAt(HOLD + TURN / 2);
    expect(mid.grow).toBe(1);
    expect(mid.theta).toBeCloseTo(REST + Math.PI, 3);
    const full = cubePaths(mid.theta, 1);
    expect((full.back + full.front).match(/M/g)).toHaveLength(12);
    const end = frameAt(HOLD + TURN - 1);
    expect(end.grow).toBeLessThan(0.05);
    expect(end.theta).toBeCloseTo(REST + 2 * Math.PI, 2);
    expect(frameAt(0).grow).toBe(0);
    expect(frameAt(0).theta).toBe(REST);
  });
});

describe("яблоки", () => {
  it("на ветках до оборота, падают после", () => {
    const before = frameAt(HOLD + TURN);
    expect(before.apples.every((a) => a.dy === 0)).toBe(true);
    const during = frameAt(FALL_AT + STAGGER / 2);
    expect(during.apples[0].dy).toBeGreaterThan(0);           // первое уже летит
    expect(during.apples[3].dy).toBe(0);                      // последнее ещё висит
    const after = frameAt(FALL_AT + STAGGER * 3 + FALL);
    expect(after.apples.every((a) => a.dy > 40 && a.opacity === 0)).toBe(true);
  });
  it("четыре, и черенки касаются веток", () => {
    expect(APPLES).toHaveLength(4);
    render(<Splash />);
    const svg = screen.getByTestId("logo-loader");
    const stems = [...svg.querySelectorAll("[data-apple] path")].map((p) => p.getAttribute("d"));
    expect(stems).toEqual(["M43 32.9v4", "M57 32.9v4", "M36 52.7v4", "M64 52.7v4"]);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "загрузка");
  });
});

describe("окно загрузки в приложении", () => {
  afterEach(() => { resetIdentity(); vi.restoreAllMocks(); });
  it("видно, пока сервер не ответил, кто мы", async () => {
    let answer;
    const health = new Promise((r) => { answer = r; });
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("/api/health")) { await health; return { ok: false }; }
      return { ok: true, json: async () => ({}) };
    });
    resetIdentity();
    render(<SystemModel splash />);
    expect(screen.getByLabelText("загрузка")).toBeInTheDocument();
    expect(screen.queryByLabelText("blockTree")).toBeNull();
    answer();
    await waitFor(() => expect(screen.queryByLabelText("загрузка")).toBeNull());
    expect(screen.getByLabelText("blockTree")).toBeInTheDocument();
  });
});
