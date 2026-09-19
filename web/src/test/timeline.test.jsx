import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import Timeline from "../components/Timeline.jsx";
import { barOf, timelineHtml } from "../lib/timelineDoc.js";

/* Полоса задачи на оси времени. Задача без начала и без сдач полосы не
   имеет: рисовать её «от сегодня до сегодня» значило бы выдумать данные. */

const func = { dur: 2, durUnit: "ч" };
const DAY = 86400000;

describe("полоса задачи", () => {
  it("без начала и без сдач полосы нет", () => {
    expect(barOf({ submissions: [] }, func)).toBeNull();
    expect(barOf({ start: null, submissions: [] }, func)).toBeNull();
    expect(barOf({ start: "", submissions: [] }, func)).toBeNull();
  });

  it("пустое начало — это не полночь 1970 года", () => {
    // `new Date(null)` даёт ровно её, и задача без начала уезжала на ось в
    // шестидесятые, утаскивая за собой всю шкалу.
    const at = "2026-09-03T10:00:00.000Z";
    const bar = barOf({ start: null, submissions: [{ id: "s", at }] }, func);
    expect(bar.from).toBe(new Date(at).getTime());
  });

  it("от начала — на время одного выполнения, пока сдач нет", () => {
    const start = "2026-09-01T09:00:00.000Z";
    const bar = barOf({ start, submissions: [] }, { dur: 3, durUnit: "дн" });
    expect(bar.from).toBe(new Date(start).getTime());
    expect(bar.to - bar.from).toBe(3 * DAY);
  });

  it("до последней сдачи, а не до первой попавшейся", () => {
    // Обычная sort() сравнивает как строки: «9…» шло бы после «17…», и
    // последняя сдача оказывалась не последней.
    const t = (iso) => new Date(iso).getTime();
    const bar = barOf({ start: "2026-09-01T00:00:00.000Z", submissions: [
      { id: "a", at: "2026-09-09T00:00:00.000Z" },
      { id: "b", at: "2026-09-17T00:00:00.000Z" },
    ] }, func);
    expect(bar.to).toBe(t("2026-09-17T00:00:00.000Z"));
  });
});

/* ─────── ТАЙМЛАЙН ФАЙЛОМ ───────

   Экран показывает то, что есть в модели СЕЙЧАС, а спрашивают другое: «как
   оно шло». По живой модели на это не ответить — она меняется, и вчерашняя
   картина исчезает бесследно. */
describe("таймлайн сохраняется файлом", () => {
  const FUNCS = [{ id: "f1", e: "e1", name: "Сбор заявок", dur: 2, durUnit: "ч" }];
  const TASKS = [
    { id: "t1", funcId: "f1", title: "Первая", status: "deferred", assignee: "2",
      start: "2026-09-01T10:00", end: "2026-09-03T10:00",
      deferredAt: "2026-09-01T10:05:00.000Z",
      submissions: [], reviews: [] },
    { id: "t2", funcId: "f1", title: "Вторая", status: "done", assignee: "3",
      start: "2026-09-02T10:00",
      submissions: [{ id: "s1", at: "2026-09-04T12:00:00.000Z", hours: 3 }],
      reviews: [{ at: "2026-09-04T13:00:00.000Z", accept: true, mark: 5,
        comment: "хорошо" }] },
    { id: "t3", funcId: "f1", title: "Без срока", status: "backlog",
      submissions: [], reviews: [] },
  ];
  const html = () => timelineHtml(TASKS, FUNCS, {
    statusName: (id) => ({ deferred: "Отложено", done: "Готово",
      backlog: "Ожидает" }[id] || id),
    funcName: () => "Сбор заявок",
    personName: (id) => (id == null ? "не назначен" : `человек ${id}`),
    now: Date.parse("2026-09-05T00:00:00Z"),
  });

  it("в файл идут ВСЕ задачи, а не отфильтрованные на экране", () => {
    const out = html();
    ["Первая", "Вторая", "Без срока"].forEach((t) => expect(out).toContain(t));
  });

  it("задача без срока не выпадает, но и на ось не ставится", () => {
    /* Придумать ей дату нельзя, а потерять — незачем: она в отдельном
       списке, и там сказано, почему её нет на оси. */
    const out = html();
    expect(out).toContain("Без срока — на оси их нет");
  });

  it("видно, что происходило: отложили, сдали, приняли — но без отметки", () => {
    const out = html();
    expect(out).toContain("отложена");
    expect(out).toContain("сдача");
    expect(out).toContain("принято");
    expect(out).toContain("хорошо");
    /* Отметки в файле нет даже публичной: у задачи один проверяющий, и
       отметка без имени называет его не хуже подписи; а исполнитель своих
       оценок не видит — файл же может открыть кто угодно. */
    expect(out).not.toMatch(/оценка/);
  });

  /* Файл собирается чьими-то глазами, и правило у него то же, что у среза
     сервера (`taskViewFor`): скрытые слова — автору и исполнителю, которому
     они адресованы, остальным их нет вовсе. У владельца модель целиком, и
     без этого его файл уносил бы наружу скрытые слова всех проверяющих. */
  describe("скрытое решение проверяющего", () => {
    const SECRET = "СКРЫТЫЕ СЛОВА ПРОВЕРЯЮЩЕГО";
    const task = { id: "h1", funcId: "f1", title: "Скрытая", status: "done",
      assignee: "200", reviewer: "300", start: "2026-09-02T10:00",
      submissions: [{ id: "s1", at: "2026-09-04T12:00:00.000Z", hours: 1 }],
      reviews: [{ id: "rv1", by: "300", at: "2026-09-04T13:00:00.000Z",
        accept: true, mark: 2, hidden: true, comment: SECRET }] };
    const file = (viewer) => timelineHtml([task], FUNCS,
      { now: Date.parse("2026-09-05T00:00:00Z"), viewer });

    it("постороннему (и владельцу без зрителя) — ни отметки, ни слов", () => {
      [file("100"), file(null)].forEach((out) => {
        expect(out).toContain("принято");
        expect(out).not.toContain(SECRET);
        expect(out).not.toMatch(/оценка/);
      });
    });

    it("автору слов и исполнителю, которому они адресованы, — слова, но не отметка", () => {
      [file("300"), file("200")].forEach((out) => {
        expect(out).toContain(SECRET);
        expect(out).not.toMatch(/оценка/);
      });
    });

    it("публичные слова — всем, кто видит задачу", () => {
      const open = { ...task, reviews: [{ ...task.reviews[0], hidden: false }] };
      const out = timelineHtml([open], FUNCS,
        { now: Date.parse("2026-09-05T00:00:00Z"), viewer: "100" });
      expect(out).toContain(SECRET);
    });
  });

  it("файл самодостаточен: ни скриптов, ни ссылок наружу", () => {
    // Иначе через год он мог бы и не открыться.
    const out = html();
    expect(out).not.toMatch(/<script/);
    expect(out).not.toMatch(/https?:\/\//);
  });

  it("название задачи не ломает разметку", () => {
    const out = timelineHtml(
      [{ id: "x", title: "<b>жирный</b> & <script>", status: "backlog",
        start: "2026-09-01T10:00", submissions: [] }], FUNCS,
      { now: Date.parse("2026-09-05T00:00:00Z") });
    expect(out).toContain("&lt;b&gt;жирный&lt;/b&gt; &amp; &lt;script&gt;");
    expect(out).not.toMatch(/<script/);
  });
});

/* ФИЛЬТРЫ ТАЙМЛАЙНА (владелец, 2026-09-19): «сделай выбор статуса задачи из
   выпадающего списка, а не из кучи кнопок; актуализируй статусы; подпись
   внизу, что такое полоса и чёрточки, убери полностью; сделай
   дополнительный выбор фильтрации по технологическим процессам». */
describe("фильтры таймлайна", () => {
  const FUNCS = [
    { id: "f1", e: "e1", name: "Из процесса", dur: 1, durUnit: "ч", proc: "p1",
      takes: [], gives: [] },
    { id: "f2", e: "e1", name: "Своими руками", dur: 1, durUnit: "ч", takes: [], gives: [] },
  ];
  const TASKS = [
    { id: "a", funcId: "f1", title: "Из процесса", status: "backlog",
      start: "2030-01-01T10:00", submissions: [], reviews: [], comments: [] },
    { id: "b", funcId: "f2", title: "Без процесса", status: "progress",
      start: "2030-01-02T10:00", submissions: [], reviews: [], comments: [] },
    { id: "c", funcId: "f1", title: "Отменённая", status: "backlog", canceled: true,
      start: "2030-01-03T10:00", submissions: [], reviews: [], comments: [] },
  ];
  const show = () => render(<Timeline tasks={TASKS} funcs={FUNCS} traits={[]}
    entities={[{ id: "e1", name: "Актив" }]} procs={[{ id: "p1", name: "Приём лидов" }]}
    nameOf={(id) => id} meId="1" />);

  it("статус выбирается списком, и в нём есть «Отменена»", () => {
    show();
    const sel = screen.getByLabelText("статус задач");
    expect(sel.tagName.toLowerCase()).toBe("select");
    const names = [...sel.querySelectorAll("option")].map((o) => o.textContent);
    expect(names[0]).toBe("все статусы");
    expect(names).toContain("Отменена");
    expect(names).toContain("В работе");
    // Кучи кнопок со статусами больше нет.
    expect(screen.queryByRole("button", { name: "В работе" })).toBeNull();
  });

  it("процесс — второй список, и в нём только те, по которым есть работа", () => {
    show();
    const sel = screen.getByLabelText("технологический процесс");
    const names = [...sel.querySelectorAll("option")].map((o) => o.textContent);
    expect(names).toEqual(["все процессы", "Приём лидов", "вне процессов"]);
    fireEvent.change(sel, { target: { value: "p1" } });
    expect(screen.queryByText("Без процесса")).toBeNull();
    fireEvent.change(sel, { target: { value: "none" } });
    expect(screen.getByText("Без процесса")).toBeInTheDocument();
  });

  it("подписи про полосу и чёрточки внизу нет", () => {
    const { container } = show();
    expect(container.textContent).not.toMatch(/Полоса — время задачи/);
    expect(container.textContent).not.toMatch(/чёрточки/);
  });
});
