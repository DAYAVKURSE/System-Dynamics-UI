import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import CallsBoard from "../components/CallsBoard.jsx";

/* ═══════════════════════════════════════════════════════════════
   ФОРМА ЗАПИСИ ЗВОНКА (владелец, 2026-09-21)

   Раскрытая запись — форма: текст расшифровки и пять кнопок — скачать и
   удалить видеозапись, транскрибировать, скачать и удалить транскрипцию.
   Расшифровку запускает кнопка (не сохранение), идёт она в фоне, и форма
   переспрашивает состояние, пока «идёт».
   ═══════════════════════════════════════════════════════════════ */

const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
let transcript;
let calls;
beforeEach(() => {
  transcript = { status: "none" };
  calls = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    calls.push({ u, m: opts.method || "GET" });
    if (u === "/api/calls") return ok([]);
    if (u === "/api/reports?kind=call") return ok([{ id: "r1", scope: "s", name: "звонок-1.webm", size: 1000, savedAt: "2026-09-21T10:00:00Z" }]);
    if (u === "/api/reports/r1/transcript" && opts.method === "DELETE") { transcript = { status: "none" }; return { ok: true, status: 204 }; }
    if (u === "/api/reports/r1/transcript") return ok(transcript);
    if (u === "/api/reports/r1/transcribe") { transcript = { status: "pending", model: "Groq / whisper" }; return ok({ status: "pending", tracks: 2 }, 202); }
    if (u === "/api/reports/r1/send") return ok({ sent: "file" });
    if (u === "/api/reports/s/r1" && opts.method === "DELETE") return { ok: true, status: 204 };
    return ok({}, 404);
  });
});
afterEach(() => { vi.restoreAllMocks(); delete global.fetch; });

const open = async () => {
  render(<CallsBoard meId="100" openCall={null} onOpenCall={() => {}} nameOf={(x) => x} />);
  fireEvent.click(await screen.findByLabelText("запись звонок-1.webm"));
  return screen.findByLabelText("форма записи звонок-1.webm");
};

describe("форма записи", () => {
  it("без расшифровки — три кнопки: скачать и удалить видеозапись, транскрибировать", async () => {
    const form = await open();
    await waitFor(() => expect(calls.some((c) => c.u === "/api/reports/r1/transcript")).toBe(true));
    expect(within(form).getByRole("button", { name: "скачать видеозапись" })).toHaveTextContent("Скачать видеозапись");
    expect(within(form).getByRole("button", { name: "удалить видеозапись" })).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "транскрибировать" })).toHaveTextContent("Транскрибировать");
    expect(within(form).queryByRole("link", { name: "скачать транскрипцию" })).toBeNull();
    expect(within(form).queryByRole("button", { name: "удалить транскрипцию" })).toBeNull();
  });

  it("«транскрибировать» запускает расшифровку; пока идёт — так и написано; готовый текст — на форме, с кнопками скачать и удалить", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const form = await open();
    fireEvent.click(within(form).getByRole("button", { name: "транскрибировать" }));
    await waitFor(() => expect(calls.some((c) => c.u === "/api/reports/r1/transcribe" && c.m === "POST")).toBe(true));
    expect(await within(form).findByText(/Расшифровка идёт/)).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "транскрибировать" })).toBeDisabled();
    // Готово — форма узнаёт сама, переспросив.
    transcript = { status: "done", text: "[00:00] Кто-то @boss: Привет.\n[00:02] Иван @ivan: Здравствуй." };
    vi.advanceTimersByTime(5100);
    const text = await within(form).findByLabelText("транскрипция");
    expect(text).toHaveTextContent("Кто-то @boss: Привет.");
    expect(text).toHaveTextContent("Иван @ivan: Здравствуй.");
    const dl = within(form).getByRole("link", { name: "скачать транскрипцию" });
    expect(dl).toHaveTextContent("Скачать транскрипцию");
    expect(dl.getAttribute("download")).toBe("звонок-1 — транскрипция.txt");
    // Удалить транскрипцию — в два касания; видеозапись остаётся.
    fireEvent.click(within(form).getByRole("button", { name: "удалить транскрипцию" }));
    fireEvent.click(within(form).getByRole("button", { name: "удалить транскрипцию" }));
    await waitFor(() => expect(calls.some((c) => c.u === "/api/reports/r1/transcript" && c.m === "DELETE")).toBe(true));
    await waitFor(() => expect(within(form).queryByLabelText("транскрипция")).toBeNull());
    expect(screen.getByLabelText("запись звонок-1.webm")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("не удалось — причина словами; «скачать видеозапись» шлёт в чат; «удалить видеозапись» — в два касания", async () => {
    transcript = { status: "error", error: "провайдер ответил 400: bad" };
    const form = await open();
    expect(await within(form).findByText(/Расшифровка не удалась: провайдер ответил 400: bad/)).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "скачать видеозапись" }));
    expect(await screen.findByText(/Отправил видеозапись в чат с ботом/)).toBeInTheDocument();
    const del = within(form).getByRole("button", { name: "удалить видеозапись" });
    fireEvent.click(del);
    expect(del).toHaveTextContent("насовсем?");
    fireEvent.click(del);
    await waitFor(() => expect(calls.some((c) => c.u === "/api/reports/s/r1" && c.m === "DELETE")).toBe(true));
  });
});
