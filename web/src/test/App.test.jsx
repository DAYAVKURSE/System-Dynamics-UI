import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import App from "../App.jsx";

const setUrl = (suffix) => {
  delete window.location;
  window.location = new URL(`https://example.test/${suffix}`);
};

beforeEach(() => { setUrl(""); delete window.Telegram; });
afterEach(() => { setUrl(""); });

describe("App", () => {
  it("рендерит схему жизнеспособности без ошибок", () => {
    render(<App />);
    expect(screen.getByText(/Активы: воркеры, функции, ресурсы/i)).toBeInTheDocument();
    expect(screen.getByText("Задачи")).toBeInTheDocument();
    expect(screen.getByText("Схема")).toBeInTheDocument();
    expect(screen.getByText("Инструменты")).toBeInTheDocument();
    // «Прогноз» — подвкладка под схемой, в главном ряду его нет.
    expect(screen.queryByText("Прогноз")).toBeNull();
  });

  it("по ссылке на звонок открывается окно звонка, а не вся модель", () => {
    // Так адрес и выглядит, когда мини-приложение открыли кнопкой
    // «Подключиться»: параметры Telegram — во фрагменте.
    setUrl("#tgWebAppData=user%3D%7B%7D&tgWebAppStartParam=call_abc123");
    render(<App />);
    expect(screen.queryByText(/Активы: воркеры, функции, ресурсы/i)).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    fireEvent.click(screen.getByRole("button", { name: /^Функции/ }));
    expect(screen.getAllByDisplayValue(/Сбор заявок/).length).toBeGreaterThan(0);
  });
});
