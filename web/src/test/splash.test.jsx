import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Splash from "../components/Splash.jsx";
import SystemModel from "../components/SystemModel.jsx";
import { resetIdentity } from "../identity.js";

/* Окно загрузки (владелец, 2026-09-22): логотип в движении, пока сервер
   не ответил, кто мы. Сама анимация — public/loader.svg из
   scripts/logo-loader.mjs. */

describe("окно загрузки", () => {
  it("тёмный экран и живой логотип", () => {
    render(<Splash />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "загрузка");
    expect(screen.getByTestId("logo-loader")).toHaveAttribute("src", "/loader.svg");
  });
  it("loader.svg — один файл SMIL: куб, дерево, четыре падающих яблока", () => {
    const svg = readFileSync(resolve(process.cwd(), "public/loader.svg"), "utf8");
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelectorAll("script")).toHaveLength(0);
    // 12 рёбер куба в двух слоях
    expect(doc.querySelectorAll("line[x1] > animate[attributeName='x1']")).toHaveLength(24);
    // четыре яблока на ветках и четыре падающих — тоже по два слоя
    expect(doc.querySelectorAll("animateTransform")).toHaveLength(16);
    expect(doc.querySelectorAll("animate[repeatCount='indefinite']").length).toBeGreaterThan(0);
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
