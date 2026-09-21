import { fireEvent, screen } from "@testing-library/react";
import { GAP, NOMINAL_W } from "../lib/drum.js";

/* ════════════════════════════════════════════════════════════════
   ОТКРЫТЬ ВКЛАДКУ В ТЕСТЕ

   Нажатие вкладку больше не открывает (владелец, 2026-09-21: «активной
   должна становиться та, которая в середине, а не та, на которую нажали.
   Барабан не должен реагировать на нажатие»). Открывают её, ДОКРУТИВ
   барабан до середины, — и тест делает ровно это: тянет барабан пальцем
   на столько, на сколько нужная вкладка отстоит от нынешней.

   Без разметки (jsdom) ширины сговорённые — те же, по которым считает сам
   барабан (lib/drum.js), поэтому расстояние здесь и там совпадает.
   ════════════════════════════════════════════════════════════════ */

export function openTab(name) {
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const to = tabs.findIndex((b) => b.textContent === name);
  /* Внутренние ряды («Выгрузка», «Роли», «Агенты») барабаном не стали и
     на нажатие отзываются по-прежнему. */
  if (to < 0) { fireEvent.click(screen.getByRole("button", { name })); return; }
  /* Где барабан стоит сейчас: посередине — открытая вкладка. Если
     открытой в ряду нет вовсе (такой вкладки этому человеку не дали),
     барабан стоит на первой. */
  const from = Math.max(0, tabs.findIndex((b) => b.getAttribute("aria-current") === "page"));
  if (tabs[to].getAttribute("aria-current") === "page") return;
  const drum = tabs[to].closest("[data-drum]");
  if (!drum) throw new Error("барабана нет");
  // Тянем ряд влево, чтобы правая вкладка пришла в середину.
  const dx = (from - to) * (NOMINAL_W + GAP);
  fireEvent.pointerDown(drum, { clientX: 0, pointerId: 1, button: 0 });
  fireEvent.pointerMove(drum, { clientX: dx, pointerId: 1 });
  fireEvent.pointerUp(drum, { clientX: dx, pointerId: 1 });
  const now = [...document.querySelectorAll("[data-tab]")]
    .find((b) => b.getAttribute("aria-current") === "page");
  if (!now || now.textContent !== name) {
    throw new Error(`барабан не довернулся до «${name}»: посередине «${now ? now.textContent : "—"}»`);
  }
}
