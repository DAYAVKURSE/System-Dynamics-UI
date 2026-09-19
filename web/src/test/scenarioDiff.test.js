import { describe, expect, it } from "vitest";
import { diffDocs, docLines } from "../lib/scenarioDiff.js";

/* Версии схемы сравниваются строками-описаниями: перестановка полей — не
   правка, переименование — правка (владелец, 2026-09-19). */
const base = {
  entities: [{ id: "e1", name: "Пользователи" }],
  traits: [{ id: "t1", l: "заявки", e: "e1" }],
  funcs: [{ id: "f1", name: "Приём", e: "e1", takes: [], gives: [{ id: "p1", trait: "t1", lo: 1, hi: 1 }] }],
  procs: [{ id: "pr1", name: "Передача", status: "on", text: "Задача: Принять\nКто: Пользователи" }],
};

describe("разница версий схемы", () => {
  it("те же данные — ничего не добавилось и не убралось", () => {
    expect(diffDocs(base, { ...base, entities: [{ name: "Пользователи", id: "e1" }] }))
      .toEqual({ added: [], removed: [] });
  });

  it("переименование актива — пара строк: старая убрана, новая добавлена", () => {
    const next = { ...base, entities: [{ id: "e1", name: "Клиенты" }] };
    const d = diffDocs(base, next);
    expect(d.added.some((l) => l.includes("актив: Клиенты"))).toBe(true);
    expect(d.removed.some((l) => l.includes("актив: Пользователи"))).toBe(true);
  });

  it("новая задача в процессе видна строкой", () => {
    const next = { ...base, procs: [{ ...base.procs[0], text: "Задача: Принять\nКто: Пользователи\nБерёт: заявки 1" }] };
    const d = diffDocs(base, next);
    expect(d.added).toEqual(["процесс «Передача»: Берёт: заявки 1"]);
    expect(d.removed).toEqual([]);
  });

  it("схема словами: активы, ресурсы, функции, процессы", () => {
    const lines = docLines(base);
    expect(lines[0]).toBe("актив: Пользователи");
    expect(lines[1]).toBe("ресурс: заявки — Пользователи");
    expect(lines[2]).toBe("функция: Приём — Пользователи: берёт ничего, выдаёт заявки 1");
    expect(lines[3]).toBe("процесс: Передача — on");
  });
});
