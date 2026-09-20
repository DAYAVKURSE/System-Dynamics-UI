import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RemindersCard } from "../components/ProfilePanel.jsx";

/* Список напоминаний в карточке «напоминания» (владелец, 2026-09-15):
   что и когда пришлёт бот, что висит. */
afterEach(() => vi.restoreAllMocks());

const ME = { id: "5", known: true, solo: false, profile: { warnMin: 30 } };

describe("список напоминаний", () => {
  /* Владелец (2026-09-20): по форме на каждое напоминание, и в форме всё
     строго «ключ: значение» — в том числе статус выполнения задачи и
     статус самого напоминания. */
  const REMS = [
    { id: "setup:b", kind: "setup", taskId: "b", title: "Поставить макет", at: null,
      end: "", doing: "ожидает постановки", sentAt: "2026-09-15T10:00:00.000Z",
      hanging: { since: "2026-09-15T10:00:00.000Z", deferredUntil: null } },
    { id: "task:a", kind: "task", taskId: "a", title: "Сверстать",
      at: "2026-09-15T11:30:00.000Z", end: "2026-09-16T18:00", doing: "в работе",
      sentAt: null, hanging: null },
    { id: "task:d", kind: "task", taskId: "d", title: "Сдана давно",
      at: "2026-09-14T09:00:00.000Z", end: "", doing: "сдана",
      sentAt: "2026-09-14T09:00:00.000Z", hanging: null },
  ];
  const server = (reminders = REMS) => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method || "GET" });
      if (opts.method === "DELETE") return { ok: true, status: 204, json: async () => ({}) };
      return { ok: true, status: 200,
        json: async () => (String(url).includes("/api/schedule/reminders")
          ? { reminders } : {}) };
    }));
    return calls;
  };

  it("на форме — задача, когда, статус выполнения и статус напоминания", async () => {
    server();
    render(<RemindersCard me={ME} />);
    const list = await screen.findByLabelText("список напоминаний");
    const rows = await within(list).findAllByLabelText(/^напоминание /);
    expect(rows).toHaveLength(3);

    expect(rows[0].textContent).toContain("задача: Поставить макет");
    expect(rows[0].textContent).toContain("статус выполнения: ожидает постановки");
    expect(rows[0].textContent).toContain("статус напоминания: отправлено");
    expect(rows[0].textContent).toContain("раз в минуту, пока не нажмут кнопку");

    // Взятая в работу из списка НЕ пропадает — в этом и была поломка.
    expect(rows[1].textContent).toContain("задача: Сверстать");
    expect(rows[1].textContent).toContain("статус выполнения: в работе");
    expect(rows[1].textContent).toContain("статус напоминания: не отправлено");
    expect(rows[1].textContent).toContain("срок: 2026-09-16 18:00");

    // И сданная тоже: убрать её может только человек.
    expect(rows[2].textContent).toContain("статус выполнения: сдана");
    expect(within(list).getByRole("button", { name: "Обновить" })).toBeInTheDocument();
  });

  it("«Удалить» убирает напоминание с формы и уезжает на сервер", async () => {
    const calls = server();
    render(<RemindersCard me={ME} />);
    const list = await screen.findByLabelText("список напоминаний");
    expect(await within(list).findAllByLabelText(/^напоминание /)).toHaveLength(3);
    fireEvent.click(within(list).getByRole("button", { name: "удалить напоминание Сверстать" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(calls.find((c) => c.method === "DELETE").url)
      .toBe("/api/schedule/reminders/task%3Aa");
    await waitFor(async () =>
      expect(await within(list).findAllByLabelText(/^напоминание /)).toHaveLength(2));
  });

  it("без сервера списка нет; пустой список объяснён", async () => {
    const { unmount } = render(<RemindersCard me={{ ...ME, solo: true, known: true }} />);
    expect(screen.queryByLabelText("список напоминаний")).toBeNull();
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ reminders: [] }) })));
    render(<RemindersCard me={ME} />);
    expect(await screen.findByText(/Напоминаний нет/)).toBeInTheDocument();
  });
});
