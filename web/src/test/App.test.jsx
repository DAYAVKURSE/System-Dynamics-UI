import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import App from "../App.jsx";
import { openTab } from "./openTab.js";

const setUrl = (suffix) => {
  delete window.location;
  window.location = new URL(`https://example.test/${suffix}`);
};

beforeEach(() => { setUrl(""); delete window.Telegram; });
afterEach(() => { setUrl(""); });

describe("App", () => {
  it("рендерит схему жизнеспособности без ошибок", () => {
    render(<App />);
    // Шапка — имя приложения (владелец, 2026-09-19).
    expect(screen.getByLabelText("blockTree")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Задачи" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Схема" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Инструменты" })).toBeInTheDocument();
    // «Прогноз» — подвкладка под схемой, в главном ряду его нет.
    expect(screen.queryByText("Цели")).toBeNull();
  });

  it("по ссылке на звонок открывается окно звонка, а не вся модель", () => {
    // Так адрес и выглядит, когда мини-приложение открыли кнопкой
    // «Подключиться»: параметры Telegram — во фрагменте.
    setUrl("#tgWebAppData=user%3D%7B%7D&tgWebAppStartParam=call_abc123");
    render(<App />);
    expect(screen.queryByLabelText("blockTree")).not.toBeInTheDocument();
    expect(screen.queryByText("Инструменты")).not.toBeInTheDocument();
    expect(screen.queryByText("Схема")).not.toBeInTheDocument();
    // Именно кнопка входа, а не любое слово «звонок» на странице: их там
    // теперь несколько (одно — на кнопке «вниз экрана»), и широкая
    // проверка стала бы падать от любой новой надписи.
    expect(screen.getByRole("button", { name: "Войти в звонок" })).toBeInTheDocument();
  });

  it("стартовая модель рендерится: у неё есть функции", () => {
    render(<App />);
    // Функции живут в карточке актива: на доске задач их списка нет —
    // задачи берутся из целей, а не заводятся под функцией руками.
    openTab("Схема");
    fireEvent.click(screen.getByRole("button", { name: /^Функции/ }));
    // Название функции — надпись, а не поле: правят его двойным нажатием.
    expect(screen.getAllByText(/Сбор заявок/).length).toBeGreaterThan(0);
  });
});
