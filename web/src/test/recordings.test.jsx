import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CallsBoard from "../components/CallsBoard.jsx";

/* Записи созвонов на вкладке звонков: список, а по нажатию — «Скачать» и
   «Удалить». «Скачать» — это отправка себе в чат с ботом: сохранить файл
   прямо из мини-приложения Telegram не даёт, а из чата он открывается и
   пересылается штатно. */

const rec = (id, name, extra = {}) => ({
  id, name, size: 3 * 1024 * 1024, savedAt: "2026-09-03T10:00:00.000Z",
  type: "video/webm", kind: "call", scope: "a".repeat(32),
  url: `/api/reports/${"a".repeat(32)}/${id}`, ...extra,
});

let recordings, sent, deleted;
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  recordings = [rec("r1", "звонок-1.webm"), rec("r2", "звонок-2.webm")];
  sent = []; deleted = [];
  window.Telegram = { WebApp: { initData: "x", initDataUnsafe: { user: { id: 100 } } } };
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/api/reports?kind=call")) return ok(recordings);
    if (/\/api\/reports\/[^/]+\/send$/.test(u)) {
      sent.push(u.split("/").at(-2));
      return ok({ sent: "file" });
    }
    if (u.includes("/api/reports/") && opts.method === "DELETE") {
      const id = u.split("/").at(-1);
      deleted.push(id);
      recordings = recordings.filter((r) => r.id !== id);
      return ok(null, 204);
    }
    if (u.endsWith("/api/calls")) return ok([]);
    return ok({}, 404);
  });
});
afterEach(() => { vi.restoreAllMocks(); delete window.Telegram; });

const board = () => render(<CallsBoard meId="100" openCall={null} onOpenCall={() => {}} />);

describe("записи на вкладке звонков", () => {
  it("записи видны списком, с размером и датой", async () => {
    board();
    expect(await screen.findByText("звонок-1.webm")).toBeInTheDocument();
    expect(screen.getByText("звонок-2.webm")).toBeInTheDocument();
    expect(screen.getAllByText(/3,0 МБ/)).toHaveLength(2);
  });

  it("кнопки появляются по нажатию на запись, а не висят у каждой", async () => {
    board();
    await screen.findByText("звонок-1.webm");
    expect(screen.queryByText("Скачать")).toBeNull();

    fireEvent.click(screen.getByLabelText("запись звонок-1.webm"));
    expect(screen.getByText("Скачать")).toBeInTheDocument();
    expect(screen.getByText("Удалить")).toBeInTheDocument();
  });

  it("«Скачать» отправляет запись в чат с ботом и говорит об этом", async () => {
    board();
    await screen.findByText("звонок-1.webm");
    fireEvent.click(screen.getByLabelText("запись звонок-1.webm"));
    fireEvent.click(screen.getByText("Скачать"));
    await waitFor(() => expect(sent).toEqual(["r1"]));
    expect(await screen.findByText(/Отправил запись в чат/)).toBeInTheDocument();
  });

  it("запись, которая не влезла в файл, уходит ссылкой — и это сказано словами", async () => {
    global.fetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/api/reports?kind=call")) return ok(recordings);
      if (/\/send$/.test(u)) return ok({ sent: "link", link: "https://x.test/f" });
      if (u.endsWith("/api/calls")) return ok([]);
      return ok({}, 404);
    });
    board();
    await screen.findByText("звонок-1.webm");
    fireEvent.click(screen.getByLabelText("запись звонок-1.webm"));
    fireEvent.click(screen.getByText("Скачать"));
    expect(await screen.findByText(/ссылку на неё/)).toBeInTheDocument();
  });

  it("«Удалить» убирает запись с сервера и из списка", async () => {
    board();
    await screen.findByText("звонок-1.webm");
    fireEvent.click(screen.getByLabelText("запись звонок-1.webm"));
    fireEvent.click(screen.getByText("Удалить"));
    await waitFor(() => expect(deleted).toEqual(["r1"]));
    await waitFor(() => expect(screen.queryByText("звонок-1.webm")).toBeNull());
    expect(screen.getByText("звонок-2.webm")).toBeInTheDocument();
  });

  it("без записей — не пустота, а что сделать", async () => {
    recordings = [];
    board();
    expect(await screen.findByText(/Записей пока нет/)).toBeInTheDocument();
  });
});
