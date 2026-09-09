import { describe, expect, it } from "vitest";
import { collectRatings, commentsFor, publishStep, publishedRatings, ratingId, statsFor,
  viewRatingsFor } from "../lib/ratings.js";

/* Оценка публикуется без автора и только тогда, когда автора нельзя
   вычислить: не меньше двух оценок от РАЗНЫХ людей, по одной за попытку.
   Свои оценки человек не видит, чужие — видит; скрытые слова доходят
   только до адресата. Здесь проверяется ровно это — и то, что в
   опубликованном нет ни одного поля, по которому автора можно узнать. */

/* Задача: исполнитель `a`, проверяющий `by`, постановщик `s`. Решение —
   приём с оценкой; сдача — с оценкой постановки. */
const task = (id, { a = "200", by = "300", s = "100", mark = 5, comment = "хорошо",
  hidden = false, setup = null, at = "2026-01-01T10:00:00Z" } = {}) => ({
  id, assignee: a, reviewer: by, setter: s, status: "done",
  submissions: [{ id: `sb${id}`, at, hours: 1, setterRating: setup }],
  reviews: [{ id: `rv${id}`, at, by, accept: true, mark, comment, hidden }],
});
const model = (tasks, published = []) => ({ tasks, published });

describe("сбор оценок", () => {
  it("за выполнение — про исполнителя, от проверяющего; за постановку — про постановщика, от исполнителя", () => {
    const m = model([task("t1", { setup: { mark: 4, comment: "ясно", hidden: false } })]);
    const list = collectRatings(m);
    expect(list).toHaveLength(2);
    expect(list.find((r) => r.kind === "work"))
      .toMatchObject({ subject: "200", by: "300", mark: 5, id: ratingId("t1", "work", "300") });
    expect(list.find((r) => r.kind === "setup"))
      .toMatchObject({ subject: "100", by: "200", mark: 4, id: ratingId("t1", "setup", "200") });
  });

  it("возврат — не оценка, и себе оценку не ставят", () => {
    const returned = { ...task("t1"), reviews: [{ by: "300", accept: false, mark: 2, comment: "нет" }] };
    expect(collectRatings(model([returned]))).toHaveLength(0);
    // Постановщик и исполнитель — один человек: оценивать свою постановку некому.
    const self = task("t2", { s: "200", setup: { mark: 5, comment: "сам себе" } });
    expect(collectRatings(model([self])).filter((r) => r.kind === "setup")).toHaveLength(0);
  });

  it("слова без отметки — тоже оценка; пусто и там и там — нет", () => {
    const words = task("t1", { mark: null, comment: "только слова" });
    expect(collectRatings(model([words]))[0]).toMatchObject({ mark: null, comment: "только слова" });
    const empty = task("t2", { mark: null, comment: "" });
    expect(collectRatings(model([empty]))).toHaveLength(0);
  });
});

describe("публикация", () => {
  it("одна оценка от одного человека не публикуется никогда", () => {
    const m = model([task("t1")]);
    expect(publishStep(m)).toEqual({ published: null, changed: false });
    expect(m.published).toEqual([]);
    // И второй раз от того же проверяющего — автор всё ещё один.
    const m2 = model([task("t1"), task("t2")]);
    expect(publishStep(m2).changed).toBe(false);
  });

  it("порог — два РАЗНЫХ автора, и за попытку публикуется одна", () => {
    const m = model([task("t1", { by: "300", at: "2026-01-01T10:00:00Z" }),
      task("t2", { by: "400", at: "2026-01-02T10:00:00Z" })]);
    const first = publishStep(m);
    expect(first.changed).toBe(true);
    expect(m.published).toEqual([ratingId("t1", "work", "300")]);
    // Вторая — на следующей попытке, а не сразу: две сразу называют обоих.
    expect(publishStep(m).published.id).toBe(ratingId("t2", "work", "400"));
    expect(publishStep(m).changed).toBe(false);
  });

  it("опубликованные считаются в порог вместе с ожидающими", () => {
    // Порог набрался, обе опубликованы; третья от третьего — публикуется
    // сразу: авторов уже трое.
    const m = model([task("t1", { by: "300" }), task("t2", { by: "400" })]);
    publishStep(m); publishStep(m);
    m.tasks.push(task("t3", { by: "500" }));
    expect(publishStep(m).changed).toBe(true);
    expect(m.published).toHaveLength(3);
  });

  it("порог — на человека и вид: оценки постановки не помогают оценкам выполнения", () => {
    // Про 200 одна оценка выполнения (от 300) и одна оценка постановки
    // (от 600, где 200 — постановщик) — это разные виды.
    const m = model([task("t1", { by: "300" }),
      task("t2", { a: "600", s: "200", by: "700", mark: null, comment: "",
        setup: { mark: 3, comment: "" } })]);
    expect(publishStep(m).changed).toBe(false);
  });
});

describe("что отдаётся наружу", () => {
  const ready = () => {
    const m = model([task("t1", { by: "300", comment: "чётко" }),
      task("t2", { by: "400", comment: "тайком", hidden: true })]);
    publishStep(m); publishStep(m);
    return m;
  };

  it("в опубликованном нет автора, задачи и времени", () => {
    const rows = publishedRatings(ready());
    expect(rows).toHaveLength(2);
    rows.forEach((r) => {
      expect(r).not.toHaveProperty("by");
      expect(r).not.toHaveProperty("id");
      expect(r).not.toHaveProperty("taskId");
      expect(r).not.toHaveProperty("at");
    });
  });

  it("рейтинг — только из опубликованного, и null там, где оценок нет", () => {
    const m = model([task("t1", { mark: 5 }), task("t2", { by: "400", mark: 3 })]);
    expect(statsFor(m, "200")).toMatchObject({ mark: null, count: 0 });
    publishStep(m);
    expect(statsFor(m, "200")).toMatchObject({ mark: 5, count: 1 });
    publishStep(m);
    expect(statsFor(m, "200")).toMatchObject({ mark: 4, count: 2 });
    expect(statsFor(m, "никто").mark).toBeNull();
  });

  it("свои оценки не отдаются, чужие — отдаются", () => {
    const m = ready();
    const asSubject = viewRatingsFor(m, "200");
    expect(asSubject.others).not.toHaveProperty("200");
    expect(asSubject.mine).not.toHaveProperty("mark");
    // Постановщику и любому другому — средняя без имени.
    const asOther = viewRatingsFor(m, "100");
    expect(asOther.others["200"]).toMatchObject({ mark: 5, count: 2 });
    expect(JSON.stringify(asOther)).not.toContain('"by"');
  });

  it("скрытые слова видит только адресат; публичные — все, но без имени", () => {
    const m = ready();
    const mine = commentsFor(m, { viewer: "200" }).mine.map((c) => c.text);
    expect(mine).toContain("тайком");
    expect(mine).toContain("чётко");
    const other = commentsFor(m, { viewer: "100" }).others["200"].map((c) => c.text);
    expect(other).toEqual(["чётко"]);
    // Автор своих слов в «адресованных мне» не видит: это не его почта.
    expect(commentsFor(m, { viewer: "400" }).mine).toEqual([]);
  });

  it("скрытая отметка входит в средние наравне с публичной", () => {
    /* Скрытость прячет отметку от глаз, а не из рейтинга: средняя и так
       без имени. Две задачи Ивана: публичная «5» и скрытая «3». */
    const m = model([task("t1", { by: "300", mark: 5 }),
      task("t2", { by: "400", mark: 3, comment: "лично", hidden: true })]);
    publishStep(m); publishStep(m);
    expect(statsFor(m, "200")).toMatchObject({ mark: 4, count: 2 });
    // И постановщик видит среднюю с обеими, но не скрытые слова.
    const seen = viewRatingsFor(m, "100");
    expect(seen.others["200"]).toMatchObject({ mark: 4, count: 2 });
    expect(seen.others["200"].comments.map((c) => c.text)).toEqual(["хорошо"]);
    expect(JSON.stringify(seen)).not.toContain("лично");
  });

  it("скрытая оценка постановки — тоже в среднюю постановщика, слова — только ему", () => {
    const m = model([
      task("t1", { a: "200", s: "100", setup: { mark: 2, comment: "неясно", hidden: true } }),
      task("t2", { a: "600", s: "100", by: "700", setup: { mark: 4, comment: "ясно", hidden: false } }),
    ]);
    publishStep(m); publishStep(m);
    expect(statsFor(m, "100").setup).toMatchObject({ mark: 3, count: 2 });
    // Постановщику — оба слова: скрытые для него и писали.
    expect(commentsFor(m, { viewer: "100" }).mine.map((c) => c.text).sort())
      .toEqual(["неясно", "ясно"]);
    // Постороннему про постановщика — только публичное.
    expect(commentsFor(m, { viewer: "999" }).others["100"].map((c) => c.text)).toEqual(["ясно"]);
  });

  it("скрытые слова доходят до адресата сразу, публичные — когда опубликованы", () => {
    const m = model([task("t1", { by: "300", comment: "публично" }),
      task("t2", { by: "400", comment: "лично", hidden: true })]);
    // Ничего не опубликовано: публичных слов ещё нет, скрытые уже есть.
    expect(commentsFor(m, { viewer: "200" }).mine.map((c) => c.text)).toEqual(["лично"]);
  });
});
