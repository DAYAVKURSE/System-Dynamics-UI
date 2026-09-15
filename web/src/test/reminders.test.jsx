import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RemindersCard } from "../components/ProfilePanel.jsx";

/* Список напоминаний в карточке «напоминания» (владелец, 2026-09-15):
   что и когда пришлёт бот, что висит. */
afterEach(() => vi.restoreAllMocks());

const ME = { id: "5", known: true, solo: false, profile: { warnMin: 30 } };

describe("список напоминаний", () => {
  it("показывает вид, задачу и время; висящее — словами; пустой список — объяснением", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => ({ ok: true, status: 200, json: async () => (
      String(url).includes("/api/schedule/reminders")
        ? { reminders: [
          { id: "setup:b", kind: "setup", title: "Поставить макет", at: null, hanging: { deferredUntil: null } },
          { id: "warn:a", kind: "warn", title: "Сверстать", at: "2026-09-15T11:30:00.000Z", repeat: "once", hanging: null },
          { id: "start:d", kind: "start", title: "Ежедневная", at: "2026-09-16T09:00:00.000Z", repeat: "daily", hanging: null },
        ] } : {}) })));
    render(<RemindersCard me={ME} />);
    const list = await screen.findByLabelText("список напоминаний");
    const rows = await within(list).findAllByLabelText(/^напоминание /);
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("нужно поставить");
    expect(rows[0].textContent).toContain("висит, повторяется каждую минуту");
    expect(rows[1].textContent).toContain("предупреждение · Сверстать");
    expect(rows[2].textContent).toContain("повтор");
    expect(within(list).getByRole("button", { name: "Обновить" })).toBeInTheDocument();
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
