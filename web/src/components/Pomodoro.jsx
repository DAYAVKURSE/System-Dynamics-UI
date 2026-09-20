import React, { useCallback, useEffect, useRef, useState } from "react";
import { C, OK, ACC, S, btn } from "./ui.jsx";

/* ════════════════════════════════════════════════════════════════
   ТОМАТ · часы работы и перерыва в форме задачи

   Слева — сколько минут длится работа и сколько перерыв. Посередине —
   часы, отсчитывающие минуты и секунды до нуля. Справа — плей и пауза.

   Дошло до нуля — часы ОСТАНАВЛИВАЮТСЯ, бьют один раз и ждут (владелец,
   2026-09-20): время на них становится зелёным, а следующее нажатие
   плея начинает противоположный отрезок — перерыв после работы, работу
   после перерыва. Сами по себе отрезки не сменяются: решает человек.

   Отсчёт идёт по ЧАСАМ, а не по тикам на экране: считается момент
   окончания, а не сколько раз сработал таймер. Поэтому закрытая форма,
   уснувшая вкладка и перезапуск приложения ничего не сбивают — вернулись
   и увидели то, что должно быть (владелец, 2026-09-20: «Да,
   продолжается»). Запись живёт в браузере у задачи и у человека: томат —
   личные часы на столе, а не свойство задачи, и чужому его видеть незачем.
   ════════════════════════════════════════════════════════════════ */

export const WORK_MIN = 25, REST_MIN = 5;
const MIN_MIN = 1, MAX_MIN = 180;
const clampMin = (v, fallback) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_MIN, Math.max(MIN_MIN, n));
};

export const keyOf = (meId, taskId) => `sd_tomato_${meId ?? "me"}_${taskId}`;

/** Часы: минуты и секунды с ведущим нулём. */
export const clockText = (sec) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/* Что записано у задачи. `endsAt` — момент, когда часы дойдут до нуля
   (идут); `left` — сколько осталось, когда их остановили. Одно из двух,
   никогда оба: иначе после паузы пришлось бы гадать, какое верно. */
const emptyState = () => ({ work: WORK_MIN, rest: REST_MIN, mode: "work",
  endsAt: null, left: WORK_MIN * 60 });

export const readState = (key) => {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(key);
    if (!raw) return emptyState();
    const v = JSON.parse(raw);
    const work = clampMin(v.work, WORK_MIN), rest = clampMin(v.rest, REST_MIN);
    const mode = v.mode === "rest" ? "rest" : "work";
    const full = (mode === "rest" ? rest : work) * 60;
    return {
      work, rest, mode,
      endsAt: Number.isFinite(v.endsAt) ? v.endsAt : null,
      left: Number.isFinite(v.left) ? Math.max(0, v.left) : full,
    };
  } catch { return emptyState(); }
};
const writeState = (key, st) => {
  try { localStorage.setItem(key, JSON.stringify(st)); } catch { /* приватный режим */ }
};

/** Сколько осталось прямо сейчас — по часам, а не по числу тиков. */
export const leftNow = (st, now = Date.now()) => (st.endsAt == null
  ? Math.max(0, st.left)
  : Math.max(0, (st.endsAt - now) / 1000));

/* Один гулкий удар колокольчика. Своим звуком, а не файлом: файл — это
   лишний запрос и лишний вес ради одного удара. Две волны (основной тон и
   обертон) с затухающей громкостью — так звучит удар, а не писк. */
export function ring() {
  try {
    const Ctx = typeof window === "undefined" ? null : (window.AudioContext || window.webkitAudioContext);
    if (!Ctx) return false;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.5, now + 0.01);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
    out.connect(ctx.destination);
    [[196, 1], [392, 0.35], [587, 0.12]].forEach(([hz, vol]) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(hz, now);
      g.gain.setValueAtTime(vol, now);
      osc.connect(g); g.connect(out);
      osc.start(now); osc.stop(now + 2.7);
    });
    setTimeout(() => { try { ctx.close(); } catch { /* уже закрыт */ } }, 3200);
    return true;
  } catch { return false; }
}

const PLAY = "M8 5.5v13l11-6.5z";
const PAUSE = "M9 5.5h3.2v13H9zM16.8 5.5H20v13h-3.2z";
const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
    style={{ display: "block" }}>
    <path d={d} fill="currentColor" />
  </svg>);

export default function Pomodoro({ taskId, meId }) {
  const key = keyOf(meId, taskId);
  const [st, setSt] = useState(() => readState(key));
  const [left, setLeft] = useState(() => leftNow(readState(key)));
  // Бьём один раз на один дошедший до нуля отсчёт — и только если ноль
  // случился при нас: вернуться к давно отзвеневшим часам и услышать
  // удар было бы новостью о том, что случилось час назад.
  const rang = useRef(false);

  // Открыли другую задачу — это другие часы: читаем их запись заново.
  useEffect(() => {
    const next = readState(key);
    setSt(next);
    setLeft(leftNow(next));
    rang.current = false;
  }, [key]);

  const put = useCallback((patch) => {
    setSt((prev) => {
      const next = { ...prev, ...patch };
      writeState(key, next);
      return next;
    });
  }, [key]);

  /* Часы идут — пересчитываем остаток по времени. Дошло до нуля:
     останавливаем, бьём один раз и ждём. */
  useEffect(() => {
    if (st.endsAt == null) { setLeft(Math.max(0, st.left)); return undefined; }
    const tick = () => {
      const v = leftNow(st);
      setLeft(v);
      if (v <= 0) {
        if (!rang.current) { rang.current = true; ring(); }
        put({ endsAt: null, left: 0 });
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [st, put]);

  const running = st.endsAt != null;
  const done = !running && left <= 0;
  const full = (st.mode === "rest" ? st.rest : st.work) * 60;

  const play = () => {
    rang.current = false;
    if (done) {
      /* Отзвенело — следующий отрезок противоположный: перерыв после
         работы, работа после перерыва. Сам он не начинается: нажать
         должен человек. */
      const mode = st.mode === "work" ? "rest" : "work";
      const sec = (mode === "rest" ? st.rest : st.work) * 60;
      put({ mode, endsAt: Date.now() + sec * 1000, left: sec });
      return;
    }
    const sec = left > 0 ? left : full;
    put({ endsAt: Date.now() + sec * 1000, left: sec });
  };
  const pause = () => { if (running) put({ endsAt: null, left: leftNow(st) }); };

  /* Поменяли минуты — часы этого отрезка встают на новое время, если они
     не идут: иначе правка «сколько длится работа» молча отняла бы время у
     той работы, что идёт прямо сейчас. */
  const setMin = (field, raw) => {
    const v = clampMin(raw, field === "rest" ? REST_MIN : WORK_MIN);
    const here = (field === "rest" ? "rest" : "work") === st.mode;
    put({ [field]: v, ...(here && !running ? { left: v * 60 } : {}) });
  };

  const minField = (field, label) => (
    <label className="flex items-center gap-2" style={{ fontSize: 11, color: C.muted }}>
      <span style={{ minWidth: 58 }}>{label}</span>
      <input type="number" min={MIN_MIN} max={MAX_MIN} inputMode="numeric"
        aria-label={`${label} минут`} value={st[field]}
        onChange={(e) => setMin(field, e.target.value)}
        style={{ ...S.inp, width: 56, padding: "2px 5px", fontSize: 11.5 }} />
      <span>мин</span>
    </label>);

  return (
    <div style={{ ...S.card, marginBottom: 10 }} aria-label="томат">
      <div style={S.lbl}>томат</div>
      <div className="flex flex-wrap items-center gap-3" style={{ marginTop: 6 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 1 auto" }}>
          {minField("work", "Работа:")}
          {minField("rest", "Перерыв:")}
        </div>

        {/* Часы — посередине. Зелёные, когда отзвенели: отрезок кончился. */}
        <div style={{ flex: "1 1 120px", textAlign: "center", minWidth: 110 }}>
          <div aria-label="часы томата" data-done={done ? "" : undefined}
            style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1,
              fontVariantNumeric: "tabular-nums",
              fontFamily: "ui-monospace, monospace",
              color: done ? OK : C.text }}>
            {clockText(left)}</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
            {st.mode === "rest" ? "перерыв" : "работа"}</div>
        </div>

        <div className="flex gap-2" style={{ flex: "0 0 auto" }}>
          <button type="button" aria-label="запустить" title="Запустить"
            disabled={running} onClick={play}
            style={{ ...btn(true, ACC), padding: "5px 9px", opacity: running ? 0.5 : 1 }}>
            <Icon d={PLAY} /></button>
          <button type="button" aria-label="пауза" title="Пауза"
            disabled={!running} onClick={pause}
            style={{ ...btn(false), padding: "5px 9px", opacity: running ? 1 : 0.5 }}>
            <Icon d={PAUSE} /></button>
        </div>
      </div>
    </div>);
}
