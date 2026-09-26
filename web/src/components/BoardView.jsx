import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, BAD, WARN, ACC, OK, btn } from "./ui.jsx";
import Modal from "./Modal.jsx";
import { inkOn, initials } from "../boardColors.js";
import {
  addSticker, blockMember, deleteSticker, getBoard, removeMember, setStickerStatus, setStickerText,
  unblockMember,
} from "../boards.js";

/* ════════════════════════════════════════════════════════════════
   БРЕЙНШТОРМ-ДОСКА (владелец, 2026-09-25)

   Одна и та же доска и в мини-приложении из общего чата (BoardApp — на
   весь экран), и во вкладке «Брейншторм» основного приложения
   (BrainstormPanel — с меню досок слева, `side`).

   «Все участники могли открыть и видели одно и то же на ней. Когда
   кто-то что-то пишет, что-то добавляет, неважно, любое действие должно
   отображаться у всех одинаково.» Поэтому доска — не своя копия, а
   отражение сервера: состояние приходит длинным опросом (GET с `rev` —
   сервер держит запрос до первого изменения), и каждое действие
   кого угодно доезжает до всех за один оборот.

   Своё — единственное исключение. Текст своего стикера человек видит
   сразу, как напечатал, а на сервер он уходит с задержкой в четверть
   секунды: слать по запросу на каждую букву незачем. Пока у стикера есть
   неотправленный или неподтверждённый текст, входящее состояние его НЕ
   перезатирает — иначе ответ, собранный до последней буквы, съедал бы её
   прямо под пальцами. Черновик снимается, когда сервер вернул ровно тот
   же текст.

   Раскладка — как просил владелец: «Новые стикеры должны появляться
   справа от предыдущих. А если экран занят, то ниже, с переносом на
   следующую строку. И вся доска должна расширяться только вниз, но не в
   стороны».
   ════════════════════════════════════════════════════════════════ */

const RETRY_MS = 1500;       // сеть упала — повтор через полторы секунды
const SAVE_MS = 250;         // задержка перед отправкой набранного текста
const AV = 32;               // аватарка участника
const OVERLAP = Math.round(AV * 0.4);   // внахлёст — на 40 %
const SPREAD_GAP = 8;        // раздвинутые — с зазором
const MENU_W = 216;
const TEXT_LIGHT = "#F4F7F8";
/* Стикер без автора в списке участников (не должно случаться: удалённого
   сервер убирает вместе со стикерами) — нейтральным сизым, а не дырой. */
const FALLBACK = "#6A7FB5";
/* Ряд стикеров — сетка с колонками не уже 148 px, растянутыми на всю
   ширину: на телефоне это ровно два стикера в ряд от края до края, на
   широком экране — сколько влезет, около 150–170 px каждый. Заполняется
   слева направо и переносится вниз; вбок доска не растёт. */
const STICKER_COLS = "repeat(auto-fill, minmax(min(148px, 100%), 1fr))";
const MAIN_ACTION = "linear-gradient(135deg, var(--accent-mint), var(--accent-cyan))";

/* ─────── статусы стикера (владелец, 2026-09-26) ───────
   Значок справа внизу стикера; нажатие раскрывает список с названиями.
   Выбирает создатель доски, остальные только видят. «Применена» —
   «подходит» на доске, у которой в блоке «Концептов» есть техпроцесс:
   её ставит и приложение само (сервер отдаёт уже показываемый статус). */
export const STICKER_STATUS = {
  no: { label: "Не подходит", color: "#FF5A78", path: "M7 7l10 10M17 7L7 17" },
  rework: { label: "На доработку", color: "#FFC24D", path: "M19 12a7 7 0 1 1-2.05-4.95M19 5v4h-4" },
  fit: { label: "Подходит", color: "#3CF2A0", path: "M5 12.5l4.5 4.5L19 7.5" },
  applied: { label: "Применена", color: "#49E1FF",
    path: "M12 4l2.35 4.76 5.25.77-3.8 3.7.9 5.23L12 16l-4.7 2.46.9-5.23-3.8-3.7 5.25-.77z" },
};
export const STATUS_ORDER = ["no", "rework", "fit", "applied"];
const BADGE = 24;

/* Текст людей — имена и стикеры — не переводится: сборка оборачивает
   выражения в JSX переводом (i18n-babel.js), и русский стикер в
   английском интерфейсе вышел бы наполовину английским. Элемент, в
   отличие от строки, перевод пропускает как есть. */
const raw = (s) => React.createElement(React.Fragment, null, s);

const sleep = (ms, signal) => new Promise((done) => {
  const t = setTimeout(done, ms);
  signal?.addEventListener?.("abort", () => { clearTimeout(t); done(); }, { once: true });
});

/* Отказ, после которого доски больше не показать: вместо неё — экран с
   причиной. Сбой сети и ошибки сервера сюда не входят — их переживает
   повтор. */
const goneOf = (e) => {
  if (e?.blocked) return { kind: "blocked", text: "Вы были заблокированы." };
  if (e?.removed) return { kind: "removed", text: "Вас удалили с доски." };
  if (e?.status === 404) return { kind: "missing", text: "Доски нет." };
  return null;
};

/* ─────── черновики своих стикеров ───────

   Хранилище вне React: отправка живёт дольше рендера (ответ приходит
   через сотни миллисекунд, а доску за это время могут и сменить), и
   замыкания из позапрошлого рендера здесь только мешали бы. Наружу —
   только снимок черновиков для экрана (`onChange`).

   По одному запросу на стикер за раз: два PATCH одного стикера в пути
   могли бы доехать в обратном порядке, и на сервере остался бы старый
   текст. Напечатали ещё, пока первый в пути, — следующий уйдёт сразу за
   ним.

   Последние буквы не теряются ни при смене доски, ни при уходе: всё
   неотправленное — и ждущее задержки, и напечатанное, пока предыдущий
   PATCH был в пути, — уходит вдогонку, следом за запросом в пути (не
   наперегонки с ним). Окно свернули или закрыли (Telegram закрывает
   мини-приложение, не размонтируя React) — ждущее задержки уходит сразу,
   запросом, который браузер довезёт и после закрытия страницы
   (`keepalive`). */
function draftStore(onChange, onFail) {
  let bid = null;
  let era = 0;                // номер «эпохи» доски: ответ из прошлой — мимо
  let drafts = {};            // sid → текст, ещё не подтверждённый сервером
  let server = {};            // sid → текст, каким его прислал сервер
  let sent = {};              // sid → текст последнего ушедшего PATCH
  const timers = new Map();
  const flying = new Map();   // sid → PATCH в пути (обещание)
  const again = new Set();
  const emit = () => onChange({ ...drafts });
  const drop = (sid) => {
    if (!(sid in drafts)) return;
    delete drafts[sid];
    emit();
  };
  /* Черновик больше не нужен, когда отправлять нечего и сервер уже
     показывает то же самое. */
  const settle = (sid) => {
    if (!(sid in drafts) || timers.has(sid) || flying.has(sid)) return;
    if (server[sid] === drafts[sid]) drop(sid);
  };
  const schedule = (sid, ms = SAVE_MS) => {
    clearTimeout(timers.get(sid));
    timers.set(sid, setTimeout(() => { timers.delete(sid); send(sid); }, ms));
  };
  /* Страница уходит (свернули, закрыли) — запрос должен пережить её. */
  const leaving = () => typeof document !== "undefined" && document.visibilityState === "hidden";
  async function send(sid, { keepalive = leaving() } = {}) {
    if (flying.has(sid)) { again.add(sid); return; }
    if (!(sid in drafts)) return;
    const board = bid;
    const mine = era;
    const text = drafts[sid];
    sent[sid] = text;
    const req = setStickerText(board, sid, text, { keepalive });
    flying.set(sid, req);
    let retry = false;
    try {
      await req;
    } catch (e) {
      // Отказ по существу (не автор, стикера нет, заблокирован) —
      // повторять бессмысленно: черновик снимается, причина — на экран.
      // Черновика уже нет (стикер только что убрали сами) — и говорить
      // не о чем: «Стикера нет» тут не новость.
      if (e?.status >= 400 && e?.status < 500) {
        if (mine === era && sid in drafts) { drop(sid); onFail(e); }
      } else retry = true;
    }
    if (mine !== era) return;
    flying.delete(sid);
    if (again.delete(sid) || retry) { schedule(sid, retry ? RETRY_MS : 0); return; }
    settle(sid);
  }
  return {
    /** Человек напечатал: на экран — сразу, на сервер — чуть погодя. */
    type(sid, text) {
      drafts[sid] = text;
      emit();
      schedule(sid);
    },
    /** Пришло состояние доски. */
    seen(stickers) {
      server = Object.fromEntries((stickers || []).map((s) => [s.id, s.text]));
      for (const sid of Object.keys(drafts)) {
        if (!(sid in server) && !timers.has(sid) && !flying.has(sid)) this.forget(sid);
        else settle(sid);
      }
    },
    /** Стикера больше нет — и черновика тоже. */
    forget(sid) {
      clearTimeout(timers.get(sid));
      timers.delete(sid);
      again.delete(sid);
      drop(sid);
    },
    /** Окно уходит: ждущее задержки — сразу и с keepalive. Напечатанное
     *  поверх запроса в пути уйдёт следом за ним (`again`). */
    flush() {
      for (const [sid, t] of [...timers]) {
        clearTimeout(t);
        timers.delete(sid);
        send(sid, { keepalive: true });
      }
    },
    /** Другая доска (или уход с доски): всё неотправленное — вдогонку, и
     *  дальше — с чистого листа. */
    switchTo(next) {
      if (bid) {
        const board = bid;
        for (const sid of Object.keys(drafts)) {
          const text = drafts[sid];
          const inFlight = flying.get(sid);
          const behind = timers.has(sid) || again.has(sid) || (inFlight && sent[sid] !== text);
          if (!behind) continue;
          const push = () => setStickerText(board, sid, text, { keepalive: true }).catch(() => {});
          // Следом за запросом в пути, а не наперегонки: иначе старый текст
          // мог бы доехать последним и остаться на сервере.
          if (inFlight) inFlight.then(push, push); else push();
        }
      }
      for (const t of timers.values()) clearTimeout(t);
      timers.clear(); again.clear(); flying.clear();
      era += 1;
      bid = next;
      drafts = {};
      server = {};
      sent = {};
      emit();
    },
  };
}

/* ─────── лицо участника ───────
   Картинка — только у зарегистрированного с картинкой (адрес даёт
   сервер); у остальных — две первые буквы имени на подложке его цвета,
   буквы чёрные или белые, что контрастнее. Картинка не загрузилась —
   тоже буквы: пустой кружок читается как поломка. */
function Face({ m, size = AV }) {
  const [bad, setBad] = useState(false);
  useEffect(() => { setBad(false); }, [m.avatar]);
  if (m.avatar && !bad) {
    return <img src={m.avatar} alt="" aria-hidden="true" width={size} height={size}
      onError={() => setBad(true)}
      style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />;
  }
  return <span aria-hidden="true" style={{ lineHeight: 1 }}>{raw(initials(m.name))}</span>;
}

const faceStyle = (m, size, ring) => ({
  width: size, height: size, flex: `0 0 ${size}px`, borderRadius: "50%", overflow: "hidden",
  padding: 0, border: "none", display: "flex", alignItems: "center", justifyContent: "center",
  background: m.color || FALLBACK, color: inkOn(m.color || FALLBACK),
  fontSize: Math.round(size * 0.4), fontWeight: 700, letterSpacing: "0.01em",
  boxShadow: ring ? `0 0 0 2px ${ring}` : "none",
  // Заблокированный — приглушён: он ещё в участниках, но войти не может.
  opacity: m.blocked ? 0.38 : 1, filter: m.blocked ? "grayscale(1)" : "none",
  transition: "opacity .2s ease, filter .2s ease",
});

/* ─────── меню участника ───────
   Выпадает у самой аватарки. Рисуется порталом в body и `fixed`: ряд
   аватарок прокручивается вбок, и меню внутри него обрезалось бы его
   краем. Позиция — от аватарки, но всегда в пределах экрана. */
function MemberMenu({ anchor, m, count, canManage, onBlock, onUnblock, onRemove, onClose }) {
  const box = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, tip: MENU_W / 2, up: false });
  const [shown, setShown] = useState(false);

  const place = useCallback(() => {
    const r = anchor?.getBoundingClientRect?.();
    if (!r) return;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const w = Math.min(MENU_W, Math.max(0, vw - 16));
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8));
    const h = box.current?.offsetHeight || 0;
    let top = r.bottom + 10;          // под аватаркой и её полоской
    const up = Boolean(h && vh && top + h > vh - 8 && r.top - h - 8 >= 8);
    if (up) top = r.top - h - 8;
    // Уголок смотрит на аватарку, даже когда меню прижато к краю экрана.
    const tip = Math.max(16, Math.min(r.left + r.width / 2 - left, w - 16));
    setPos({ top, left, tip, up });
  }, [anchor]);

  useLayoutEffect(() => { place(); }, [place]);
  useEffect(() => {
    const raf = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(() => setShown(true)) : setTimeout(() => setShown(true), 0);
    const outside = (e) => {
      if (box.current?.contains(e.target) || anchor?.contains?.(e.target)) return;
      onClose();
    };
    const key = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf); else clearTimeout(raf);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, onClose, place]);

  const node = (
    <div ref={box} data-board-menu="" data-noswipe="" aria-label={`участник ${m.name}`}
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 45,
        width: MENU_W, maxWidth: "calc(100vw - 16px)", boxSizing: "border-box",
        background: "var(--bg-elevated)", color: C.text,
        border: "1px solid var(--border-glass)", borderRadius: "var(--radius-md)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.12), 0 18px 40px rgba(0,0,0,.55)",
        padding: "var(--space-12)", fontFamily: "var(--font-sans)",
        opacity: shown ? 1 : 0, transform: shown ? "translateY(0)" : "translateY(-4px)",
        transition: "opacity .14s ease, transform .14s ease" }}>
      <span aria-hidden="true" style={{ position: "absolute", left: pos.tip - 6, width: 12, height: 12,
        background: "var(--bg-elevated)", transform: "rotate(45deg)",
        border: "1px solid var(--border-glass)",
        ...(pos.up
          ? { bottom: -7, borderTop: "none", borderLeft: "none" }
          : { top: -7, borderBottom: "none", borderRight: "none" }) }} />
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
        <span style={faceStyle(m, 36)}><Face m={m} size={36} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="label-md" style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
            {raw(m.name)}</div>
          <div style={{ fontSize: "var(--fs-hint)", color: C.second, marginTop: 2 }}>
            {`Стикеров: ${count}`}</div>
        </div>
      </div>
      <div aria-hidden="true" style={{ height: 3, borderRadius: 2, background: m.color || FALLBACK,
        marginTop: "var(--space-8)" }} />
      {canManage && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)",
          marginTop: "var(--space-12)" }}>
          {m.blocked
            ? <button type="button" style={{ ...btn(true, OK), width: "100%" }}
              onClick={onUnblock}>Разблокировать</button>
            : <button type="button" style={{ ...btn(true, WARN), width: "100%" }}
              onClick={onBlock}>Заблокировать</button>}
          <button type="button" style={{ ...btn(true, BAD), width: "100%" }}
            onClick={onRemove}>Удалить</button>
        </div>)}
    </div>);
  return typeof document === "undefined" ? node : createPortal(node, document.body);
}

function StatusIcon({ status, size = 14 }) {
  const st = STICKER_STATUS[status];
  if (!st) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
        stroke="currentColor" strokeWidth="2.2" strokeDasharray="3.2 3">
        <circle cx="12" cy="12" r="8" />
      </svg>);
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={status === "applied" ? "currentColor" : "none"}
      aria-hidden="true" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={st.path} />
    </svg>);
}

/* Список статусов у значка стикера: портал, рядом со значком и внутри
   экрана — как меню участника. */
function StatusMenu({ anchor, status, canSet, onPick, onClose }) {
  const box = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const W = 188;
  const place = useCallback(() => {
    const r = anchor?.getBoundingClientRect?.();
    if (!r) return;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const h = box.current?.offsetHeight || 0;
    const left = Math.max(8, Math.min(r.right - W, vw - W - 8));
    let top = r.bottom + 6;
    if (h && vh && top + h > vh - 8 && r.top - h - 6 >= 8) top = r.top - h - 6;
    setPos({ top, left });
  }, [anchor]);
  useLayoutEffect(() => { place(); }, [place]);
  useEffect(() => {
    const outside = (e) => {
      if (box.current?.contains(e.target) || anchor?.contains?.(e.target)) return;
      onClose();
    };
    const key = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, onClose, place]);
  const node = (
    <div ref={box} role="menu" aria-label="статус стикера" data-noswipe=""
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 46, width: W,
        boxSizing: "border-box", background: "var(--bg-elevated)", color: C.text,
        border: "1px solid var(--border-glass)", borderRadius: "var(--radius-md)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.12), 0 18px 40px rgba(0,0,0,.55)",
        padding: 6, fontFamily: "var(--font-sans)" }}>
      {STATUS_ORDER.map((k) => {
        const st = STICKER_STATUS[k];
        const on = status === k;
        return (
          <button key={k} type="button" role="menuitemradio" aria-checked={on} disabled={!canSet}
            onClick={() => onPick(on ? null : k)}
            style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 36,
              padding: "6px 8px", border: "none", borderRadius: "var(--radius-sm)",
              background: on ? `${st.color}22` : "transparent", color: C.text, textAlign: "left",
              cursor: canSet ? "pointer" : "default", fontFamily: "var(--font-sans)",
              fontSize: "var(--fs-body)", fontWeight: on ? 700 : 500 }}>
            <span aria-hidden="true" style={{ width: 22, height: 22, flex: "0 0 22px", borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: st.color, color: inkOn(st.color) }}>
              <StatusIcon status={k} size={13} />
            </span>
            {st.label}
          </button>);
      })}
    </div>);
  return typeof document === "undefined" ? node : createPortal(node, document.body);
}

/* ─────── поле своего стикера ───────
   Без рамки и растёт вниз вместе с текстом: стикер — лист, а не форма. */
function StickerText({ sid, value, ink, onChange }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea ref={ref} data-sticker-input={sid} aria-label="текст стикера" rows={3}
      maxLength={2000} value={value} onChange={(e) => onChange(e.target.value)}
      style={{ display: "block", width: "100%", flex: "1 1 auto", minHeight: 76, boxSizing: "border-box",
        resize: "none", border: "none", outline: "none", background: "transparent",
        color: ink, caretColor: ink, padding: 0, margin: 0, overflow: "hidden",
        fontFamily: "var(--font-sans)", fontSize: "var(--fs-title)", lineHeight: "20px" }} />);
}

function Sticker({ s, author, mine, text, onType, onDelete, canSetStatus, onStatus }) {
  const [focus, setFocus] = useState(false);
  const [menu, setMenu] = useState(false);
  const badge = useRef(null);
  const st = STICKER_STATUS[s.status];
  const closeMenu = useCallback(() => setMenu(false), []);
  const color = author?.color || FALLBACK;
  const ink = inkOn(color);
  const name = author?.name || "";
  return (
    <div data-sticker={s.id} role="listitem" aria-label={`стикер: ${name}`}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      style={{ minWidth: 0, minHeight: 128, boxSizing: "border-box",
        background: color, color: ink, borderRadius: 10,
        padding: "var(--space-8) 10px 10px",
        display: "flex", flexDirection: "column", gap: 6,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,.22), 0 8px 18px rgba(0,0,0,.32)${
          focus ? `, 0 0 0 2px ${ink}66` : ""}`,
        transition: "box-shadow .15s ease" }}>
      {/* Шапка — имя автора; у автора — «×», убрать свой стикер. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 20 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: "var(--fs-hint)", lineHeight: "14px",
          fontWeight: 700, opacity: 0.78, overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap" }}>{raw(name)}</span>
        {mine && (
          <button type="button" aria-label="удалить стикер" onClick={onDelete}
            style={{ width: 20, height: 20, flex: "0 0 20px", borderRadius: "50%", padding: 0,
              border: "none", background: `${ink}1f`, color: ink, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 0 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true"
              stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>)}
      </div>
      {mine
        ? <StickerText sid={s.id} value={text} ink={ink} onChange={onType} />
        : <div style={{ fontSize: "var(--fs-title)", lineHeight: "20px", whiteSpace: "pre-wrap",
          overflowWrap: "anywhere", flex: "1 1 auto" }}>{raw(text)}</div>}
      {/* Статус — значком справа внизу; нажатие раскрывает названия. */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "auto" }}>
        <button ref={badge} type="button" data-status={s.status || ""}
          aria-label={`статус: ${st ? st.label : "без статуса"}`} aria-expanded={menu}
          onClick={() => setMenu((v) => !v)}
          style={{ width: BADGE, height: BADGE, flex: `0 0 ${BADGE}px`, borderRadius: "50%", padding: 0,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            border: st ? "1.5px solid rgba(0,0,0,.18)" : `1.5px solid ${ink}55`,
            background: st ? st.color : `${ink}14`, color: st ? inkOn(st.color) : `${ink}99`,
            boxShadow: st ? "0 2px 6px rgba(0,0,0,.25)" : "none" }}>
          <StatusIcon status={s.status} />
        </button>
      </div>
      {menu && (
        <StatusMenu anchor={badge.current} status={s.status} canSet={canSetStatus}
          onClose={closeMenu} onPick={(k) => { setMenu(false); onStatus(k); }} />)}
    </div>);
}

/* Вместо доски — причина: заблокировали, удалили, доски нет. */
function Gone({ text }) {
  return (
    <div role="status" style={{ display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: "var(--space-12)", minHeight: 260, textAlign: "center",
      padding: "var(--space-24) var(--space-16)" }}>
      <span aria-hidden="true" style={{ width: 52, height: 52, borderRadius: "50%",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(255,90,120,.14)", border: "1px solid rgba(255,90,120,.5)", color: BAD }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M5.6 5.6l12.8 12.8" />
        </svg>
      </span>
      <div className="title-lg" style={{ color: TEXT_LIGHT }}>{text}</div>
    </div>);
}

/**
 * Доска.
 *
 * `boardId` — какую показывать (нет — пустое место справа от меню);
 * `side` — меню досок слева под участниками (вкладка основного
 * приложения); `fill` — на весь экран (мини-приложение): тогда доска сама
 * прокручивается вниз; `onBoard` — каждое новое состояние (цвет — шапке
 * Telegram).
 */
/**
 * `only` — показывать только стикеры с этими статусами (окно доски в блоке
 * «Концептов»: подходящие и применённые идеи); `readOnly` — без «+», без
 * правки текста и удаления: смотреть, а не писать.
 */
export default function BoardView({ boardId = null, side = null, fill = false, onBoard,
  only = null, readOnly = false }) {
  const [board, setBoard] = useState(null);
  const [gone, setGone] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [hidden, setHidden] = useState(() => new Set());   // свои удалённые, пока сервер не подтвердил
  const [spread, setSpread] = useState(false);
  const [menuFor, setMenuFor] = useState(null);
  const [confirm, setConfirm] = useState(null);            // { kind: "block"|"remove", m }
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [focusSid, setFocusSid] = useState(null);

  const root = useRef(null);
  const faces = useRef(new Map());          // id участника → кнопка-аватарка (якорь меню)
  const boardRef = useRef(null);
  const idRef = useRef(boardId);
  const onBoardRef = useRef(onBoard);
  onBoardRef.current = onBoard;
  const failRef = useRef(() => {});
  const store = useMemo(() => draftStore(setDrafts, (e) => failRef.current(e)), []);

  /* Состояние с сервера. Ответ со старой доски или старше того, что уже
     на экране (длинный опрос и ответ на действие могут разминуться), —
     мимо. */
  const apply = useCallback((v) => {
    if (!v || String(v.id) !== String(idRef.current)) return;
    const cur = boardRef.current;
    if (cur && cur.id === v.id && Number(v.rev) < Number(cur.rev)) return;
    boardRef.current = v;
    setBoard(v);
    store.seen(v.stickers);
    const ids = new Set((v.stickers || []).map((s) => s.id));
    setHidden((h) => (h.size ? new Set([...h].filter((sid) => ids.has(sid))) : h));
    onBoardRef.current?.(v);
  }, [store]);

  const fail = useCallback((e) => {
    const g = goneOf(e);
    if (g) setGone(g);
    else setErr(e?.message || "Не получилось.");
  }, []);
  failRef.current = fail;

  /* ═══ живое обновление: длинный опрос ═══
     Первый запрос — без rev (ответ сразу), дальше — с rev того, что на
     экране: сервер отвечает на первое же изменение. Сеть упала — повтор
     через полторы секунды; заблокировали, удалили, доски нет — опрос
     кончается, вместо доски причина. Смена доски и уход — abort. */
  useEffect(() => {
    idRef.current = boardId;
    store.switchTo(boardId || null);
    boardRef.current = null;
    setBoard(null); setGone(null); setErr(""); setHidden(new Set());
    setMenuFor(null); setConfirm(null); setFocusSid(null);
    if (!boardId) return undefined;
    const ctl = new AbortController();
    let stopped = false;
    (async () => {
      while (!stopped) {
        let out;
        const sent = boardRef.current ? boardRef.current.rev : undefined;
        const t0 = Date.now();
        try {
          out = await getBoard(boardId, sent, ctl.signal);
        } catch (e) {
          if (stopped) return;
          const g = goneOf(e) || ((e?.status === 401 || e?.status === 403)
            ? { kind: "denied", text: e.message } : null);
          if (g) { setGone(g); return; }
          await sleep(RETRY_MS, ctl.signal);
          continue;
        }
        if (stopped) return;
        const rev = Number(out?.board?.rev);
        /* Сервер вернулся назад (упал и поднялся без последней записи) —
           верим ему, а не тому, что на экране: иначе ответ с меньшим rev
           отбрасывался бы, а запрос со «своим» rev сервер, у которого
           такого нет, отпускал бы сразу — круг без пауз, а доска на экране
           застыла бы. */
        if (out?.board && sent != null && rev < Number(sent)) boardRef.current = null;
        if (out?.board) apply(out.board);
        /* Пустой ответ или тот же (а то и меньший) rev мгновенно — сервер
           не стал ждать: передышка, чтобы не молотить его без пауз. */
        if (!out?.board || (sent != null && rev <= Number(sent) && Date.now() - t0 < 1000)) {
          await sleep(RETRY_MS, ctl.signal);
        }
      }
    })();
    return () => { stopped = true; ctl.abort(); };
  }, [boardId, apply, store]);

  // Уход со страницы — неотправленные буквы вдогонку.
  useEffect(() => () => store.switchTo(null), [store]);

  /* Мини-приложение сворачивают и закрывают, не размонтируя React: набранное
     за последнюю четверть секунды уходит сразу, запросом с keepalive. */
  useEffect(() => {
    const away = () => { if (document.visibilityState === "hidden") store.flush(); };
    const hide = () => store.flush();
    document.addEventListener("visibilitychange", away);
    window.addEventListener("pagehide", hide);
    return () => {
      document.removeEventListener("visibilitychange", away);
      window.removeEventListener("pagehide", hide);
    };
  }, [store]);

  /* Действие с ответом-состоянием: доска обновляется сразу, не дожидаясь
     очередного оборота опроса. */
  const act = async (fn) => {
    setErr("");
    try {
      const out = await fn();
      if (out?.board) apply(out.board);
      return out;
    } catch (e) {
      fail(e);
      return null;
    }
  };

  /* «+» — новый стикер в конце ряда; фокус — в его поле, страница — к
     нему. Какой из стикеров новый, видно по разнице до и после. */
  const add = async () => {
    if (adding || !boardId) return;
    setAdding(true);
    const before = new Set((boardRef.current?.stickers || []).map((s) => s.id));
    const out = await act(() => addSticker(boardId));
    setAdding(false);
    const v = out?.board;
    const fresh = (v?.stickers || []).filter((s) => String(s.by) === String(v.me) && !before.has(s.id));
    if (fresh.length) setFocusSid(fresh[fresh.length - 1].id);
  };

  useEffect(() => {
    if (!focusSid) return;
    const el = root.current?.querySelector(`[data-sticker-input="${focusSid}"]`);
    if (!el) return;                 // ещё не нарисован — повторим со следующим состоянием
    try { el.focus({ preventScroll: true }); } catch { el.focus(); }
    el.closest("[data-sticker]")?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    setFocusSid(null);
  }, [focusSid, board]);

  const dropSticker = async (sid) => {
    setHidden((h) => new Set(h).add(sid));
    store.forget(sid);
    try {
      await deleteSticker(boardId, sid);
    } catch (e) {
      setHidden((h) => { const n = new Set(h); n.delete(sid); return n; });
      fail(e);
    }
  };

  const closeMenu = useCallback(() => setMenuFor(null), []);
  const closeConfirm = useCallback(() => setConfirm(null), []);
  const agree = () => {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    act(() => (c.kind === "block" ? blockMember(boardId, c.m.id) : removeMember(boardId, c.m.id)));
  };

  const members = board?.members || [];
  const byId = useMemo(() => new Map(members.map((m) => [String(m.id), m])), [members]);
  const stickers = (board?.stickers || []).filter((s) => !hidden.has(s.id)
    && (!only || only.includes(s.status)));
  const countOf = (id) => stickers.filter((s) => String(s.by) === String(id)).length;
  const me = board ? String(board.me) : "";
  const open = menuFor != null ? byId.get(String(menuFor)) : null;
  const bg = board?.color || "var(--bg-elevated)";
  const live = board && !gone;
  const creator = board ? byId.get(String(board.by)) : null;

  let main;
  if (gone) main = <Gone text={gone.text} />;
  else if (!boardId) main = null;
  else if (!board) {
    main = <div style={{ fontSize: "var(--fs-hint)", color: "rgba(244,247,248,.6)",
      padding: "var(--space-12) 0" }}>Загружаю…</div>;
  } else {
    main = (
      <>
        <h1 className="title-lg" style={{ margin: "var(--space-4) 0 var(--space-12)", fontWeight: 700,
          letterSpacing: "-0.01em", color: TEXT_LIGHT, overflowWrap: "anywhere" }}>
          {raw(board.name)}</h1>
        {err && <div role="alert" style={{ fontSize: "var(--fs-hint)", color: "var(--chip-coral-text)",
          background: "rgba(255,90,120,.16)", border: "1px solid rgba(255,90,120,.45)",
          borderRadius: "var(--radius-sm)", padding: "var(--space-4) var(--space-8)",
          marginBottom: "var(--space-12)" }}>{err}</div>}
        <div role="list" aria-label="стикеры" style={{ display: "grid", gridTemplateColumns: STICKER_COLS,
          gap: 12, alignItems: "start" }}>
          {stickers.map((s) => {
            const mine = !readOnly && String(s.by) === me;
            return (
              <Sticker key={s.id} s={s} author={byId.get(String(s.by))} mine={mine}
                text={mine && s.id in drafts ? drafts[s.id] : (s.text || "")}
                onType={(t) => store.type(s.id, t)} onDelete={() => dropSticker(s.id)}
                canSetStatus={Boolean(board.isCreator) && !readOnly}
                onStatus={(k) => act(() => setStickerStatus(boardId, s.id, k))} />);
          })}
        </div>
      </>);
  }

  return (
    <div ref={root} data-board={boardId || ""}
      style={{ position: "relative", boxSizing: "border-box", display: "flex", flexDirection: "column",
        background: bg, color: TEXT_LIGHT, fontFamily: "var(--font-sans)",
        transition: "background-color .3s ease",
        ...(fill
          /* На весь экран: доска сама прокручивается — только вниз. */
          ? { height: "100%", minHeight: 200, overflowY: "auto", overflowX: "hidden",
            overscrollBehavior: "contain", WebkitOverflowScrolling: "touch",
            padding: "max(12px, env(safe-area-inset-top, 0px)) 12px 12px" }
          /* Во вкладке прокручивается страница; `clip`, а не `hidden`:
             hidden сделал бы доску своим окном прокрутки, и «+» перестал
             бы держаться у низа экрана. */
          : { minHeight: readOnly ? 240 : "calc(100dvh - 140px)", overflowX: "clip",
            borderRadius: "var(--radius-lg)", border: "1px solid var(--border-glass-soft)",
            padding: "12px 12px 12px" }) }}>

      {/* ═══ шапка: «Участники», аватарки внахлёст, плашка создателя ═══ */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", minHeight: 44,
        minWidth: 0 }}>
        {live && (
          <>
            <button type="button" aria-pressed={spread}
              onClick={() => { setSpread((v) => !v); setMenuFor(null); }}
              style={{ ...btn(spread, ACC), flex: "0 0 auto",
                ...(spread ? {} : { color: TEXT_LIGHT, background: "rgba(255,255,255,.06)" }) }}>
              Участники</button>
            {/* Ряд берёт остаток шапки (основа 0): раздвинутые аватарки
                уходят в прокрутку ряда, а не отнимают место у плашки
                создателя. Край ряда гаснет — видно, что дальше есть ещё. */}
            <div data-noswipe="" className="no-bar" role="group" aria-label="участники доски"
              style={{ flex: "1 1 0", minWidth: 0, display: "flex", alignItems: "flex-start",
                overflowX: "auto", overflowY: "hidden", padding: "4px 4px 2px",
                maskImage: "linear-gradient(to right, #000 calc(100% - 14px), transparent)",
                WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 14px), transparent)" }}>
              {/* Каждая следующая лежит поверх предыдущей: из-под неё
                  выглядывает ЛЕВЫЙ край — первая буква имени, а не хвост
                  вроде «n» от «An». */}
              {members.map((m, i) => (
                <div key={m.id} style={{ flex: "0 0 auto", position: "relative",
                  zIndex: i + 1,
                  marginLeft: i ? (spread ? SPREAD_GAP : -OVERLAP) : 0,
                  transition: "margin-left .28s cubic-bezier(.2,.8,.2,1)",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                  <button type="button" aria-label={`участник: ${m.name}`}
                    aria-expanded={String(menuFor) === String(m.id)}
                    ref={(el) => { if (el) faces.current.set(String(m.id), el); else faces.current.delete(String(m.id)); }}
                    onClick={() => setMenuFor((cur) => (String(cur) === String(m.id) ? null : m.id))}
                    style={{ ...faceStyle(m, AV, bg), cursor: "pointer" }}>
                    <Face m={m} />
                  </button>
                  <span aria-hidden="true" data-stripe={m.color}
                    style={{ width: AV - 8, height: 3, borderRadius: 2, background: m.color || FALLBACK,
                      opacity: m.blocked ? 0.38 : 1 }} />
                </div>))}
            </div>
            <div role="note" aria-label={`создатель доски: ${board.byName || creator?.name || ""}`}
              style={{ flex: "0 1 auto", minWidth: 0, maxWidth: "42%", display: "flex",
                alignItems: "center", gap: 6, padding: "4px 10px 4px 6px",
                borderRadius: "var(--radius-pill)", background: "rgba(0,0,0,.28)",
                border: "1px solid rgba(255,255,255,.16)", fontSize: "var(--fs-hint)",
                fontWeight: 600, color: TEXT_LIGHT }}>
              <span aria-hidden="true" style={{ width: 18, height: 18, flex: "0 0 18px", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: creator?.color || FALLBACK, color: inkOn(creator?.color || FALLBACK) }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
                </svg>
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {raw(board.byName || creator?.name || "")}</span>
            </div>
          </>)}
      </div>

      {/* ═══ тело: меню досок (во вкладке) и сама доска ═══ */}
      <div style={{ display: "flex", gap: 12, flex: "1 0 auto", alignItems: "flex-start",
        paddingTop: "var(--space-8)", paddingBottom: live && !readOnly ? 76 : 0, minWidth: 0 }}>
        {side && (
          <aside style={{ flex: "0 0 clamp(112px, 28%, 148px)", minWidth: 0 }}>{side}</aside>)}
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>{main}</div>
      </div>

      {/* «+» — плавает в правом нижнем углу доски: липнет к низу экрана,
          пока доска длиннее него, и стоит в её углу, когда короче. */}
      {live && !readOnly && (
        <div style={{ position: "sticky", zIndex: 6, height: 0, display: "flex",
          justifyContent: "flex-end", pointerEvents: "none",
          bottom: fill ? "calc(16px + env(safe-area-inset-bottom, 0px))" : 16 }}>
          <button type="button" aria-label="добавить стикер" onClick={add} disabled={adding}
            style={{ pointerEvents: "auto", transform: "translateY(-100%)", width: 56, height: 56,
              borderRadius: "50%", border: "none", padding: 0, cursor: adding ? "default" : "pointer",
              background: MAIN_ACTION, color: "var(--on-mint)",
              boxShadow: "var(--shadow-glow-mint), 0 10px 24px rgba(0,0,0,.45)",
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: adding ? 0.7 : 1, transition: "opacity .15s ease, transform .15s ease" }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"
              stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>)}

      {live && open && (
        <MemberMenu anchor={faces.current.get(String(open.id))} m={open} count={countOf(open.id)}
          canManage={Boolean(board.isCreator) && String(open.id) !== me}
          onClose={closeMenu}
          onBlock={() => { setMenuFor(null); setConfirm({ kind: "block", m: open }); }}
          onUnblock={() => { setMenuFor(null); act(() => unblockMember(boardId, open.id)); }}
          onRemove={() => { setMenuFor(null); setConfirm({ kind: "remove", m: open }); }} />)}

      {confirm && (
        <Modal title={confirm.kind === "block" ? "Заблокировать участника?" : "Удалить участника?"}
          onClose={closeConfirm}>
          {confirm.kind === "block"
            ? `${confirm.m.name} больше не сможет зайти на доску и вместо неё увидит «Вы были заблокированы». Стикеры участника останутся на доске.`
            : `Участник ${confirm.m.name} будет удалён из участников и больше не сможет зайти на доску. Все стикеры участника будут удалены.`}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-12)",
            marginTop: "var(--space-16)" }}>
            <button type="button" style={{ ...btn(true, BAD), flex: "1 1 120px" }}
              onClick={agree}>Согласиться</button>
            <button type="button" style={{ ...btn(false), flex: "1 1 120px" }}
              onClick={closeConfirm}>Отменить</button>
          </div>
        </Modal>)}
    </div>);
}
