import { describe, expect, it } from "vitest";
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

  it("видно, что происходило: отложили, сдали, приняли", () => {
    const out = html();
    expect(out).toContain("отложена");
    expect(out).toContain("сдача");
    expect(out).toMatch(/принято[^<]*оценка 5/);
    expect(out).toContain("хорошо");
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
