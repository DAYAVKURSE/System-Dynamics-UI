import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProfilePanel from "../components/ProfilePanel.jsx";
import { WARN } from "../components/ui.jsx";

/* ЧАСЫ ОТДЕЛЬНОГО ДНЯ.

   Общие «с — до» действуют на все выбранные дни. Двойное нажатие по
   рабочему дню открывает правку ЕГО часов: день жёлтый, подсказка говорит,
   для каких дней правятся часы, а поля «с»/«до» пишут в запись дня, а не
   в общие. Одиночное нажатие по другому рабочему дню в это время добавляет
   его в набор. Выключили день — его часы ушли вместе с ним. */

const ME = { id: "2", name: "Иван", isOwner: false, known: true, tabs: ["tasks"],
  profile: { about: "", days: [1, 2, 3, 4, 5, 6], from: "09:00", to: "18:00" } };

afterEach(() => vi.restoreAllMocks());

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

describe("часы отдельного дня", () => {
  it("без двойного нажатия часы общие — на все выбранные дни", async () => {
    const saved = mount();
    fireEvent.change(screen.getByLabelText("работаю с"), { target: { value: "10:00" } });
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(last(saved)).toMatchObject({ from: "10:00", to: "18:00", perDay: {} });
    expect(screen.getByText(/Работает: пн–сб · 10:00–18:00/)).toBeInTheDocument();
    expect(screen.queryByText(/Часы правятся только для/)).toBeNull();
  });

  it("двойное нажатие: день жёлтый, подсказка, часы уходят в запись дня", async () => {
    const saved = mount();
    fireEvent.dblClick(day("сб"));
    expect(day("сб")).toHaveStyle({ color: WARN });
    expect(day("пн")).not.toHaveStyle({ color: WARN });
    expect(screen.getByText("Часы правятся только для: сб")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("работаю с"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("работаю до"), { target: { value: "14:00" } });
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    // Общие часы не тронуты: правилась только суббота.
    expect(last(saved)).toMatchObject({ from: "09:00", to: "18:00",
      perDay: { 6: { from: "10:00", to: "14:00" } } });
    expect(screen.getByText(/Работает: пн–пт · 09:00–18:00; сб · 10:00–14:00/))
      .toBeInTheDocument();
    // «Готово» закрывает правку, и поля снова про общие часы.
    fireEvent.click(screen.getByLabelText("готово: часы дня"));
    expect(screen.queryByText(/Часы правятся только для/)).toBeNull();
    expect(day("сб")).not.toHaveStyle({ color: WARN });
    expect(screen.getByLabelText("работаю с")).toHaveValue("09:00");
  });

  it("одиночное нажатие в правке добавляет день в набор, повторное — убирает", async () => {
    const saved = mount();
    fireEvent.dblClick(day("сб"));
    fireEvent.click(day("пт"));
    expect(day("пт")).toHaveStyle({ color: WARN });
    // Пятница при этом осталась рабочей: нажатие не выключило её.
    expect(screen.getByText("Часы правятся только для: пт, сб")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("работаю до"), { target: { value: "15:00" } });
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(last(saved).perDay).toEqual({ 5: { from: "09:00", to: "15:00" },
      6: { from: "09:00", to: "15:00" } });
    fireEvent.click(day("пт"));
    expect(day("пт")).not.toHaveStyle({ color: WARN });
    expect(screen.getByText("Часы правятся только для: сб")).toBeInTheDocument();
    expect(screen.getByText(/Работает: пн–чт · 09:00–18:00; пт, сб · 09:00–15:00/))
      .toBeInTheDocument();
  });

  it("поля показывают часы первого дня набора, а двойное нажатие по жёлтому закрывает правку",
    () => {
      mount({ ...ME, profile: { ...ME.profile,
        perDay: { 6: { from: "10:00", to: "14:00" } } } });
      fireEvent.dblClick(day("сб"));
      expect(screen.getByLabelText("работаю с")).toHaveValue("10:00");
      expect(screen.getByLabelText("работаю до")).toHaveValue("14:00");
      fireEvent.dblClick(day("сб"));
      expect(screen.queryByText(/Часы правятся только для/)).toBeNull();
      expect(screen.getByLabelText("работаю с")).toHaveValue("09:00");
    });

  it("выходной не правится: двойное нажатие по нему ничего не открывает", () => {
    mount();
    fireEvent.dblClick(day("вс"));
    expect(screen.queryByText(/Часы правятся только для/)).toBeNull();
    expect(day("вс")).not.toHaveStyle({ color: WARN });
  });

  it("день выключили — его часы ушли вместе с ним", async () => {
    const saved = mount({ ...ME, profile: { ...ME.profile,
      perDay: { 6: { from: "10:00", to: "14:00" } } } });
    expect(screen.getByText(/Работает: пн–пт · 09:00–18:00; сб · 10:00–14:00/))
      .toBeInTheDocument();
    fireEvent.click(day("сб"));
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
