import React, { useState } from "react";
import { btn } from "./ui.jsx";
import TasksBoard from "./TasksBoard.jsx";
import SpaceBoard from "./SpaceBoard.jsx";

/* ════════════════════════════════════════════════════════════════
   ЗАДАЧИ · два вида одной вкладки

   Доска и пространство отвечают на разные вопросы про одну и ту же
   работу: «что с ней сейчас» и «как она связана с остальным». Это не две
   вкладки — задачи те же, открываются те же, и держать их в двух местах
   меню значило бы обещать два разных списка. Поэтому переключатель
   стоит на месте прежнего вводного текста: он объяснял, откуда берутся
   задачи, один раз при первом заходе, а место занимал при каждом.

   Выбранный вид помнится в браузере: человек, работающий в пространстве,
   не должен возвращаться к нему из доски каждый раз. Это удобство, а не
   часть модели, поэтому ему место в localStorage, а не в документе.
   ════════════════════════════════════════════════════════════════ */

const KEY = "sd_tasks_view";
export const VIEWS = [["board", "Доска"], ["space", "Пространство"]];

const readView = () => {
  try {
    const v = localStorage.getItem(KEY);
    return VIEWS.some(([k]) => k === v) ? v : "board";
  } catch { return "board"; }
};
const rememberView = (v) => {
  try { localStorage.setItem(KEY, v); } catch { /* хранилище закрыто — не беда */ }
};

/** Пропсы: всё, что нужно TasksBoard, плюс `space/setSpace/files/memory/ask`. */
export default function TasksTab({ space, setSpace, files = [], memory = [], ask, ...board }) {
  const [view, setView] = useState(readView);
  const pick = (v) => { setView(v); rememberView(v); };
  return (
    <div>
      <div className="flex gap-2" style={{ marginBottom: 10 }}>
        {VIEWS.map(([k, name]) => (
          <button key={k} style={btn(view === k)} aria-pressed={view === k} onClick={() => pick(k)}>
            {name}
          </button>))}
      </div>
      {view === "space"
        ? <SpaceBoard space={space} setSpace={setSpace} tasks={board.tasks || []}
          funcs={board.funcs} entities={board.entities} files={files} memory={memory} ask={ask}
          nameOf={board.nameOf}
          /* Открыть задачу — значит показать её карточку, а она живёт на
             доске: сдача и комментарии есть только там. */
          onOpenTask={(id) => { board.setOpenId?.(id); pick("board"); }} />
        : <TasksBoard {...board} />}
    </div>);
}
