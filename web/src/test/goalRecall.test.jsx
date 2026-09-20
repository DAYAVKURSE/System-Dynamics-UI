import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import GoalsPanel from "../components/GoalsPanel.jsx";
import { newGoal } from "../lib/goals.js";

/* ОТЗЫВ ЦЕЛИ (владелец, 2026-09-20).

   Отозвать — не удалить: цель остаётся заполненной формой, а решение
   уходит. Окно спрашивает об одном: стирать ли сделанное. «Нет» убирает
   дальнейший прогноз и невыполненную работу, результаты остаются; «Да» —
   всё, что цель завела. */

const TRAITS = [{ id: "t1", e: "e1", l: "заявки", unit: "шт", have: 0 }];
const MODEL = { funcs: [], entities: [], traits: TRAITS, tasks: [] };

function Panel({ applied = true, onRecall }) {
  const [goals, setGoals] = React.useState(
    [{ ...newGoal("t1"), id: "g1", name: "Цель", qty: 5,
      appliedAt: applied ? "2026-09-01T10:00:00Z" : null }]);
  return (<>
    <GoalsPanel goals={goals} setGoals={setGoals} traits={TRAITS} model={MODEL}
      runsOf={() => []} onTasks={() => {}} onDropGoal={() => {}}
      onRecallGoal={onRecall} />
    <div data-applied={String(goals[0].appliedAt)} />
  </>);
}
const applied = () => document.querySelector("[data-applied]").dataset.applied;
const recallBtn = () => screen.getByLabelText("отозвать цель");

describe("отзыв цели", () => {
  it("кнопка стоит рядом с «удалить», у непринятой цели не нажимается", () => {
    render(<Panel applied={false} />);
    expect(recallBtn()).toBeDisabled();
    expect(screen.getByLabelText("удалить цель")).toBeInTheDocument();
  });

  it("у применённой нажимается и спрашивает, стирать ли сделанное", () => {
    render(<Panel onRecall={() => {}} />);
    expect(recallBtn()).not.toBeDisabled();
    fireEvent.click(recallBtn());
    expect(screen.getByRole("dialog", { name: "Удалить созданную деятельность" }))
      .toBeInTheDocument();
  });

  it("«Нет» — цель больше не применена, а сделанное остаётся", () => {
    const got = [];
    render(<Panel onRecall={(id, all) => got.push([id, all])} />);
    fireEvent.click(recallBtn());
    fireEvent.click(screen.getByLabelText("оставить созданную деятельность"));
    expect(got).toEqual([["g1", false]]);
    expect(applied()).toBe("null");
    // Цель осталась заполненной формой — её снова можно применить.
    expect(screen.getByLabelText("удалить цель")).toBeInTheDocument();
    expect(recallBtn()).toBeDisabled();
  });

  it("«Да» — уходит всё, что цель завела", () => {
    const got = [];
    render(<Panel onRecall={(id, all) => got.push([id, all])} />);
    fireEvent.click(recallBtn());
    fireEvent.click(screen.getByLabelText("удалить созданную деятельность"));
    expect(got).toEqual([["g1", true]]);
    expect(applied()).toBe("null");
  });
});
