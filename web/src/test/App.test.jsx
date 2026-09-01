import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "../App.jsx";

describe("App", () => {
  it("рендерит схему жизнеспособности без ошибок", () => {
    render(<App />);
    expect(screen.getByText(/Активы и движение ресурсов/i)).toBeInTheDocument();
    expect(screen.getByText("Цели")).toBeInTheDocument();
    expect(screen.getByText("Схема")).toBeInTheDocument();
    expect(screen.getByText("Прогноз")).toBeInTheDocument();
    expect(screen.getByText("Выгрузить")).toBeInTheDocument();
  });

  it("вкладка «Цели» показывает существующую цель модели", () => {
    render(<App />);
    // TRAITS0 содержит одну готовую цель: t.id="u9" want=10, "активные пользователи".
    // Текст встречается и в карточке цели, и в выпадающих списках — проверяем,
    // что он вообще есть на странице, не привязываясь к конкретному месту.
    expect(screen.getAllByText(/активные пользователи/i).length).toBeGreaterThan(0);
  });
});
