import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { Workers } from "../components/AssetPanel.jsx";

/* Должность и роль — разное. РОЛЬ отвечает на «что человеку показывать»
   (вкладки) и живёт в «Людях и ролях». ДОЛЖНОСТЬ отвечает на «кем он
   числится» и заводится здесь, рядом с людьми: за каждым новым человеком
   ходить в другую вкладку незачем. Встроенных должностей нет — какие они
   бывают, знает владелец. */

const PEOPLE = [
  { id: "2", name: "Иван", roleId: "executor", position: "p1" },
  { id: "3", name: "Пётр", roleId: "reviewer" },
];
const POSITIONS = [{ id: "p1", name: "дизайнер" }, { id: "p2", name: "аналитик" }];
const positionOf = (id) => POSITIONS
  .find((p) => p.id === PEOPLE.find((x) => x.id === id)?.position)?.name || "";

const mount = (over = {}) => render(<Workers workers={{ crew: ["2", "3"] }} people={PEOPLE}
  nameOf={(id) => PEOPLE.find((p) => p.id === id)?.name || id} tasks={[]} funcs={[]}
  positionOf={positionOf} onOrder={() => {}} onOpenPerson={() => {}}
  positions={POSITIONS} {...over} />);

describe("должности в блоке воркеров", () => {
  it("владелец добавляет должность и назначает её воркеру", async () => {
    const onAddPosition = vi.fn(async () => {});
    const onSetPosition = vi.fn(async () => {});
    mount({ onAddPosition, onSetPosition, onDropPosition: async () => {} });
    expect(screen.getByText("должности")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("новая должность"), { target: { value: "тестировщик" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(onAddPosition).toHaveBeenCalledWith("тестировщик"));
    // Поле очищено: следующая должность — с чистого листа.
    await waitFor(() => expect(screen.getByLabelText("новая должность").value).toBe(""));
    fireEvent.change(screen.getByLabelText("должность: Пётр"), { target: { value: "p2" } });
    expect(onSetPosition).toHaveBeenCalledWith("3", "p2");
    // У Ивана должность уже стоит — и она выбрана, и видна в его строке.
    expect(screen.getByLabelText("должность: Иван").value).toBe("p1");
  });

  it("должность снимается пустым выбором, а не удалением человека", () => {
    const onSetPosition = vi.fn(async () => {});
    mount({ onAddPosition: async () => {}, onDropPosition: async () => {}, onSetPosition });
    fireEvent.change(screen.getByLabelText("должность: Иван"), { target: { value: "" } });
    expect(onSetPosition).toHaveBeenCalledWith("2", "");
    // У кого должности нет — так и сказано словом.
    expect(screen.getAllByText("без должности").length).toBeGreaterThan(0);
  });

  it("должность убирается из списка", () => {
    const onDropPosition = vi.fn(async () => {});
    mount({ onAddPosition: async () => {}, onDropPosition, onSetPosition: async () => {} });
    fireEvent.click(screen.getByLabelText("убрать должность: дизайнер"));
    expect(onDropPosition).toHaveBeenCalledWith("p1");
  });

  it("без права править — ни блока должностей, ни выбора", () => {
    mount();
    expect(screen.queryByText("должности")).toBeNull();
    expect(screen.queryByLabelText("должность: Иван")).toBeNull();
    // Но саму должность в строке человека видно всем.
    expect(screen.getByText("дизайнер")).toBeInTheDocument();
  });

  it("отказ сервера — словами под блоком", async () => {
    mount({ onAddPosition: async () => { throw new Error("такая должность уже есть"); },
      onDropPosition: async () => {}, onSetPosition: async () => {} });
    fireEvent.change(screen.getByLabelText("новая должность"), { target: { value: "дизайнер" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    expect(await screen.findByText("такая должность уже есть")).toBeInTheDocument();
  });
});
