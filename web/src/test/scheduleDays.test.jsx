import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProfilePanel from "../components/ProfilePanel.jsx";
import { WARN } from "../components/ui.jsx";
import { inWorkTime, lastBoundary, liveStatus } from "../lib/workers.js";

/* ЧАСЫ ОТДЕЛЬНОГО ДНЯ И СТАТУС ПО ГРАФИКУ.

   Владелец (2026-09-13): «при двойном нажатии на день или несколько дней
   они должны становиться жёлтыми, и время редактируется только под них,
   не трогая остальные; под временем — кнопка «Принять», которая завершает
   режим редактирования; при одинарном нажатии просто показывается время
   работы для этого дня, но не редактируется»; «статус должен меняться,
   если сейчас по графику рабочее время или нерабочее». */

const ME = { id: "2", name: "Иван", isOwner: false, known: true, tabs: ["tasks"],
  profile: { about: "", days: [1, 2, 3, 4, 5, 6], from: "09:00", to: "18:00" } };

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// Всё, что уехало на сервер, — чтобы сверить последнюю запись графика.
function mount(me = ME) {
  const saved = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
    saved.push(JSON.parse(opts.body));
    return { ok: true, status: 200,
      json: async () => ({ profile: { about: "", ...JSON.parse(opts.body) } }) };
  }));
  render(<ProfilePanel me={me} people={[]} tasks={[]} funcs={[]} />);
  return saved;
}
const day = (s) => screen.getByLabelText(`рабочий день ${s}`);
const last = (saved) => saved[saved.length - 1];
const accept = () => fireEvent.click(screen.getByLabelText("принять: часы дня"));

describe("часы отдельного дня", () => {
  it("без правки дня часы общие — на все выбранные дни", async () => {
    const saved = mount();
    fireEvent.change(screen.getByLabelText("работаю с"), { target: { value: "10:00" } });
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(last(saved)).toMatchObject({ from: "10:00", to: "18:00", perDay: {} });
    expect(screen.getByText(/Работает: пн–сб · 10:00–18:00/)).toBeInTheDocument();
    expect(screen.queryByText(/Правятся только/)).toBeNull();
  });

  it("двойное нажатие: день жёлтый, часы уходят в запись дня, «Принять» закрывает правку", async () => {
    const saved = mount();
    fireEvent.dblClick(day("сб"));
    expect(day("сб")).toHaveStyle({ color: WARN });
    expect(day("пн")).not.toHaveStyle({ color: WARN });
    expect(screen.getByText("Правятся только: сб")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("работаю с"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("работаю до"), { target: { value: "14:00" } });
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    // Общие часы не тронуты: правилась только суббота.
    expect(last(saved)).toMatchObject({ from: "09:00", to: "18:00",
      perDay: { 6: { from: "10:00", to: "14:00" } } });
    expect(screen.getByText(/Работает: пн–пт · 09:00–18:00; сб · 10:00–14:00/))
      .toBeInTheDocument();
    accept();
    expect(screen.queryByText(/Правятся только/)).toBeNull();
    expect(day("сб")).not.toHaveStyle({ color: WARN });
    expect(screen.getByLabelText("работаю с")).toHaveValue("09:00");
  });

  it("в правке следующий день берётся одним нажатием, повторное — убирает; часы — всем в наборе", async () => {
    const saved = mount();
    fireEvent.dblClick(day("сб"));
    fireEvent.click(day("пт"));
    expect(day("пт")).toHaveStyle({ color: WARN });
    expect(screen.getByText("Правятся только: пт, сб")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("работаю до"), { target: { value: "15:00" } });
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(last(saved).perDay).toEqual({ 5: { from: "09:00", to: "15:00" },
      6: { from: "09:00", to: "15:00" } });
    fireEvent.click(day("пт"));
    expect(day("пт")).not.toHaveStyle({ color: WARN });
    expect(screen.getByText("Правятся только: сб")).toBeInTheDocument();
    expect(screen.getByText(/Работает: пн–чт · 09:00–18:00; пт, сб · 09:00–15:00/))
      .toBeInTheDocument();
  });

  it("одиночное нажатие — только показ: часы дня в полях, поля отключены, повторное снимает", () => {
    const saved = mount({ ...ME, profile: { ...ME.profile,
      perDay: { 6: { from: "10:00", to: "14:00" } } } });
    fireEvent.click(day("сб"));
    expect(screen.getByText(/Часы для: сб — только просмотр/)).toBeInTheDocument();
    expect(screen.getByLabelText("работаю с")).toHaveValue("10:00");
    expect(screen.getByLabelText("работаю с")).toBeDisabled();
    expect(day("сб")).not.toHaveStyle({ color: WARN });
    // Выходной — так и сказано.
    fireEvent.click(day("вс"));
    expect(screen.getByText("вс — выходной")).toBeInTheDocument();
    fireEvent.click(day("вс"));
    expect(screen.queryByText(/выходной/)).toBeNull();
    expect(screen.getByLabelText("работаю с")).toHaveValue("09:00");
    expect(screen.getByLabelText("работаю с")).not.toBeDisabled();
    // Нажатия ничего не записали: смотреть — не править.
    expect(saved).toHaveLength(0);
  });

  it("выходной берут в правку двойным: галочка «рабочие дни» делает его рабочим, часы — его", async () => {
    const saved = mount();
    fireEvent.dblClick(day("вс"));
    expect(day("вс")).toHaveStyle({ color: WARN });
    expect(screen.getByLabelText("рабочие дни")).not.toBeChecked();
    expect(screen.getByLabelText("работаю с")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("рабочие дни"));
    fireEvent.change(screen.getByLabelText("работаю до"), { target: { value: "13:00" } });
    accept();
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(last(saved)).toMatchObject({ days: [1, 2, 3, 4, 5, 6, 0],
      perDay: { 0: { from: "09:00", to: "13:00" } } });
    expect(screen.getByText(/вс · 09:00–13:00/)).toBeInTheDocument();
  });

  it("в правке снять галочку — дни выходные, и их часы ушли вместе с ними", async () => {
    const saved = mount({ ...ME, profile: { ...ME.profile,
      perDay: { 6: { from: "10:00", to: "14:00" } } } });
    fireEvent.dblClick(day("сб"));
    expect(screen.getByLabelText("рабочие дни")).toBeChecked();
    fireEvent.click(screen.getByLabelText("рабочие дни"));
    accept();
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(last(saved)).toMatchObject({ days: [1, 2, 3, 4, 5], perDay: {} });
    expect(screen.getByText(/Работает: пн–пт · 09:00–18:00\./)).toBeInTheDocument();
  });

  it("чужой график с часами дня читается словами", () => {
    render(<ProfilePanel me={ME} personId="3" tasks={[]} funcs={[]}
      people={[{ id: "3", name: "Пётр", days: [1, 2, 3, 4, 5, 6], from: "09:00",
        to: "18:00", perDay: { 6: { from: "10:00", to: "14:00" } } }]} />);
    expect(screen.getByText(/Работает: пн–пт · 09:00–18:00; сб · 10:00–14:00/))
      .toBeInTheDocument();
    expect(screen.queryByLabelText("рабочий день сб")).toBeNull();
  });
});

describe("статус по графику", () => {
  const sc = { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00", perDay: {}, status: "ready" };
  const mon10 = new Date(2026, 8, 14, 10, 0);   // понедельник
  const mon20 = new Date(2026, 8, 14, 20, 0);
  const sun12 = new Date(2026, 8, 13, 12, 0);

  it("рабочее ли время: по дню и часам, свои часы дня — тоже; без дней — неизвестно", () => {
    expect(inWorkTime(sc, mon10)).toBe(true);
    expect(inWorkTime(sc, mon20)).toBe(false);
    expect(inWorkTime(sc, sun12)).toBe(false);
    expect(inWorkTime({ ...sc, perDay: { 1: { from: "12:00", to: "" } } }, mon10)).toBe(false);
    expect(inWorkTime({ ...sc, from: "", to: "" }, mon10)).toBe(true);
    // Смена через полночь.
    expect(inWorkTime({ ...sc, from: "22:00", to: "06:00" }, new Date(2026, 8, 14, 23, 0))).toBe(true);
    expect(inWorkTime({ ...sc, from: "22:00", to: "06:00" }, mon10)).toBe(false);
    expect(inWorkTime({ ...sc, days: [] }, mon10)).toBeNull();
  });

  it("график решает, пока человек не выбрал сам; выбор после последней смены по графику — приоритетнее", () => {
    // Без метки выбора — по графику: вечером «не работаю», днём «на месте».
    expect(liveStatus(sc, mon20)).toBe("off");
    expect(liveStatus({ ...sc, status: "busy" }, mon20)).toBe("off");
    expect(liveStatus(sc, mon10)).toBe("ready");
    expect(liveStatus({ ...sc, status: "busy" }, mon10)).toBe("ready");
    expect(liveStatus({ ...sc, days: [], status: "off" }, mon10)).toBe("off");
    // Выбор после начала рабочего дня (09:00) действует днём…
    const at = (h, m = 0) => new Date(2026, 8, 14, h, m).toISOString();
    expect(liveStatus({ ...sc, status: "busy", statusAt: at(9, 30) }, mon10)).toBe("busy");
    expect(liveStatus({ ...sc, status: "off", statusAt: at(9, 30) }, mon10)).toBe("off");
    // …но не после конца рабочего дня (18:00): график сменил статус сам.
    expect(liveStatus({ ...sc, status: "busy", statusAt: at(9, 30) }, mon20)).toBe("off");
    // Выбор вечером, после конца дня, — приоритетнее «не работаю».
    expect(liveStatus({ ...sc, status: "ready", statusAt: at(19) }, mon20)).toBe("ready");
    // Выбор до начала дня — устарел с началом дня.
    expect(liveStatus({ ...sc, status: "off", statusAt: at(8) }, mon10)).toBe("ready");
    // Границы: последняя до 10:00 понедельника — 09:00 того же дня, до 20:00 — 18:00.
    expect(lastBoundary(sc, mon10).getTime()).toBe(new Date(2026, 8, 14, 9).getTime());
    expect(lastBoundary(sc, mon20).getTime()).toBe(new Date(2026, 8, 14, 18).getTime());
    // В воскресенье — пятница 18:00; смена через полночь кончается назавтра.
    expect(lastBoundary(sc, sun12).getTime()).toBe(new Date(2026, 8, 11, 18).getTime());
    expect(lastBoundary({ ...sc, from: "22:00", to: "06:00" }, new Date(2026, 8, 15, 7)).getTime())
      .toBe(new Date(2026, 8, 15, 6).getTime());
    expect(lastBoundary({ ...sc, days: [] }, mon10)).toBeNull();
  });

  it("на экране: вечером — «сегодня не работаю» по графику; нажатый сейчас статус — приоритетнее, с меткой момента", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(mon20);
    const saved = mount({ ...ME, profile: { ...ME.profile, status: "ready" } });
    expect(screen.getByLabelText("статус сейчас")).toHaveTextContent("сегодня не работаю");
    expect(screen.getByText(/по графику сейчас нерабочее время/)).toBeInTheDocument();
    expect(screen.getByLabelText("статус: на рабочем месте")).toHaveAttribute("aria-pressed", "true");
    // Нажали «на рабочем месте» вечером — действует, пока график не сменит сам.
    fireEvent.click(screen.getByLabelText("статус: на рабочем месте"));
    expect(screen.getByLabelText("статус сейчас")).toHaveTextContent("на рабочем месте");
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(last(saved)).toMatchObject({ status: "ready", statusAt: mon20.toISOString() });
    // Статус и дни — двумя формами внутри карточки.
    expect(screen.getByLabelText("статус")).toBeInTheDocument();
    expect(screen.getByLabelText("рабочие дни и часы")).toBeInTheDocument();
  });
});
