import { describe, expect, it } from "vitest";
import { taskViewFor } from "../lib/workspaceStore.js";

/* Скрытость одна на отметку и слова. Задача глазами человека: скрытую
   отметку видит только автор, скрытые слова — автор и адресат, публичные
   слова — все участники. Отметку в задаче, кроме автора, не видит никто —
   она называла бы автора не хуже имени. Здесь проверяется срез
   `taskViewFor`, которым сервер отвечает не-владельцу. */

// Постановщик 100, исполнитель 200, проверяющий 300.
const TASK = {
  id: "t1", setter: "100", assignee: "200", reviewer: "300", status: "done",
  reviews: [
    { id: "rv1", by: "300", accept: true, mark: 2, comment: "лично", hidden: true },
    { id: "rv2", by: "300", accept: true, mark: 5, comment: "всем", hidden: false },
  ],
  submissions: [{ id: "sb1", at: "2026-01-01T00:00:00Z", hours: 1,
    setterRating: { mark: 3, comment: "срок тесный", hidden: true } }],
  chat: [
    { id: "m1", text: "когда начнёшь?", by: "300", at: "2026-01-01T00:00:00Z" },
    { id: "m2", text: "завтра", by: "200", at: "2026-01-01T01:00:00Z" },
  ],
};

describe("taskViewFor: скрытая отметка и скрытые слова", () => {
  it("автор решения видит его целиком — и скрытую отметку, и слова", () => {
    const v = taskViewFor(TASK, "300");
    expect(v.reviews[0]).toMatchObject({ mark: 2, comment: "лично", hidden: true });
    expect(v.reviews[1]).toMatchObject({ mark: 5, comment: "всем" });
  });

  it("исполнителю (адресату) — скрытые слова, но ни одной отметки", () => {
    const v = taskViewFor(TASK, "200");
    expect(v.reviews.map((r) => r.mark)).toEqual([null, null]);
    expect(v.reviews.map((r) => r.comment)).toEqual(["лично", "всем"]);
  });

  it("постановщику — публичные слова; скрытая отметка и скрытые слова режутся", () => {
    const v = taskViewFor(TASK, "100");
    expect(v.reviews.map((r) => r.mark)).toEqual([null, null]);
    expect(v.reviews.map((r) => r.comment)).toEqual(["", "всем"]);
    expect(JSON.stringify(v)).not.toContain("лично");
  });

  it("оценку постановки из сдачи видит только её автор — исполнитель", () => {
    expect(taskViewFor(TASK, "200").submissions[0].setterRating)
      .toEqual({ mark: 3, comment: "срок тесный", hidden: true });
    // Постановщик — адресат слов, но получает их через рейтинги, а не из
    // сдачи: из сдачи была бы видна и отметка.
    expect(taskViewFor(TASK, "100").submissions[0].setterRating).toBeNull();
    expect(taskViewFor(TASK, "300").submissions[0].setterRating).toBeNull();
  });

  /* Обсуждение — общее: кому видна задача, тому видны все сообщения
     (владелец, 2026-09-20). Скрытых слов в нём нет вовсе. */
  it("обсуждение видно целиком всем, кому видна задача", () => {
    ["100", "200", "300"].forEach((who) => {
      expect(taskViewFor(TASK, who).chat.map((m) => m.text))
        .toEqual(["когда начнёшь?", "завтра"]);
    });
  });

  it("пустая задача не ломает срез: списки остаются списками", () => {
    const v = taskViewFor({ id: "t0" }, "200");
    expect(v).toMatchObject({ id: "t0", reviews: [], submissions: [] });
  });
});
