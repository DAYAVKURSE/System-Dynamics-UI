import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

/* ═══════════════════════════════════════════════════════════════
   ЯЗЫК ПРИЛОЖЕНИЯ (владелец, 2026-09-21)

   Ключ — русская строка; словари в locales/. Сборка оборачивает текст в
   JSX вызовом t/tx (web/i18n-babel.js), поэтому на русском всё как было,
   а на другом языке строка меняется, если перевод есть, и остаётся
   русской, если нет. Строки с подстановками — по шаблону «{0}».
   ═══════════════════════════════════════════════════════════════ */

vi.mock("../../../locales/en.json", () => ({ default: {
  "Сохранить": "Save",
  "Осталось {0} дн.": "{0} days left",
  "Отправил {0} в чат": "Sent {0} to the chat",
  "Первая строка": "First line",
  "Взял в работу: ": "Taken into work: ",
  "Готово: ": "Done: ",
  " · ещё": " · more",
} }));
vi.mock("../../../locales/zh.json", () => ({ default: { "Сохранить": "保存" } }));

let i18n;
beforeEach(async () => { localStorage.clear(); i18n = await import("../i18n/t.js"); i18n.setLang("ru"); });
afterEach(() => { i18n.setLang("ru"); });

describe("t и tx", () => {
  it("на русском — ключ как есть; на английском — перевод, без перевода — русский", () => {
    expect(i18n.t("Сохранить")).toBe("Сохранить");
    i18n.setLang("en");
    expect(i18n.currentLang()).toBe("en");
    expect(localStorage.getItem("sd_lang")).toBe("en");
    expect(i18n.t("Сохранить")).toBe("Save");
    expect(i18n.t("Такого нет")).toBe("Такого нет");
    i18n.setLang("zh");
    expect(i18n.t("Сохранить")).toBe("保存");
  });
  it("подстановки: шаблон в JSX и строка, собранная заранее", () => {
    i18n.setLang("en");
    expect(i18n.t("Осталось {0} дн.", [5])).toBe("5 days left");
    expect(i18n.tx("Осталось 12 дн.")).toBe("12 days left");
    expect(i18n.tx("Отправил запись в чат")).toBe("Sent запись to the chat");
    // Многострочное — построчно; не строка — как есть.
    expect(i18n.tx("Первая строка\nТакого нет")).toBe("First line\nТакого нет");
    expect(i18n.tx(42)).toBe(42);
    // Собранное из кусков — переводится по кускам: «Готово: » + число + « · ещё».
    expect(i18n.tx("Готово: 3 · ещё")).toBe("Done: 3 · more");
    expect(i18n.tx("Взял в работу: Сайт")).toBe("Taken into work: Сайт");
  });
  it("незнакомый язык — русский; язык с сервера сильнее запомненного", () => {
    i18n.setLang("xx");
    expect(i18n.currentLang()).toBe("ru");
    expect(i18n.syncLang("en")).toBe(true);
    expect(i18n.currentLang()).toBe("en");
    expect(i18n.syncLang("en")).toBe(false);
    expect(i18n.syncLang("")).toBe(false);
  });
});

describe("сборка оборачивает JSX", () => {
  function Card({ n, label }) {
    return (
      <div>
        <button aria-label="сохранить анкету" title="Сохранить">Сохранить</button>
        <span>{`Осталось ${n} дн.`}</span>
        <span>{label}</span>
        <input placeholder="Имя" />
      </div>);
  }
  it("текст, атрибуты, шаблоны и выражения — по словарю выбранного языка", () => {
    i18n.setLang("en");
    render(<Card n={3} label="Сохранить" />);
    const b = screen.getByRole("button", { name: "сохранить анкету" });
    expect(b).toHaveTextContent("Save");
    expect(b.title).toBe("Save");
    expect(screen.getByText("3 days left")).toBeInTheDocument();
    expect(screen.getAllByText("Save")).toHaveLength(2);
    expect(screen.getByPlaceholderText("Имя")).toBeInTheDocument();   // перевода нет — русский
  });
});
