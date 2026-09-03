import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
    expect(screen.getByText(/Активы и движение ресурсов/i)).toBeInTheDocument();
    expect(screen.getByText("Задачи")).toBeInTheDocument();
    expect(screen.getByText("Схема")).toBeInTheDocument();
    expect(screen.getByText("Прогноз")).toBeInTheDocument();
    expect(screen.getByText("Инструменты")).toBeInTheDocument();
  });

  it("по ссылке на звонок открывается окно звонка, а не вся модель", () => {
    // Так адрес и выглядит, когда мини-приложение открыли кнопкой
    // «Подключиться»: параметры Telegram — во фрагменте.
    setUrl("#tgWebAppData=user%3D%7B%7D&tgWebAppStartParam=call_abc123");
    render(<App />);
    expect(screen.queryByText(/Активы и движение ресурсов/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Инструменты")).not.toBeInTheDocument();
    expect(screen.queryByText("Прогноз")).not.toBeInTheDocument();
    // Именно кнопка входа, а не любое слово «звонок» на странице: их там
    // теперь несколько (одно — на кнопке «вниз экрана»), и широкая
    // проверка стала бы падать от любой новой надписи.
    expect(screen.getByRole("button", { name: "Войти в звонок" })).toBeInTheDocument();
  });

  it("модель со стартовой целью рендерится", () => {
    render(<App />);
    // TRAITS0 содержит одну готовую цель: t.id="u9" want=10, "активные пользователи".
    // Текст встречается и в карточке цели, и в выпадающих списках — проверяем,
    // что он вообще есть на странице, не привязываясь к конкретному месту.
    expect(screen.getAllByText(/активные пользователи/i).length).toBeGreaterThan(0);
  });
});
