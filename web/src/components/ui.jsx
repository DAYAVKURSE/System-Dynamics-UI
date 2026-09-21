import React, { useState, useEffect, useRef } from "react";
import logoUrl from "../assets/logo.png";
import { deliverFile } from "../storage.js";
import { getTelegram } from "../telegram.js";
import { leftInUnit, timeLeft } from "../lib/funcs.js";

/* ════════════════════════════════════════════════════════════════
   ПРИМИТИВЫ ИНТЕРФЕЙСА · Blocktree Liquid Glass

   Палитра, поверхности и кнопки живут здесь, и только здесь: схема,
   доска задач и все панели берут их отсюда, а своих значений не заводят.
   Поэтому смена дизайн-системы — правка этого файла, а не всех сорока.

   Значения не выписаны числами, а взяты из `styles/tokens.css`: цвет,
   радиус, отступ и тень — это `var(--…)`. Токен меняется в одном месте, и
   приложение меняется целиком; выписанный руками #163049 так бы не смог.

   ─── что такое «стекло» ───

   Панель — не полупрозрачная плашка, а материал: заливка `surface-glass`,
   граница `border-glass`, `backdrop-filter: blur() saturate(170%)` и тень
   из трёх слоёв, где верхний блик и делает поверхность стеклом. Без
   насыщенности под размытием получается мутное окно, а не стекло; без
   блика — плоский прямоугольник.

   Тонирование — сигнал, а не украшение: мята — актив, успех, главное
   действие; циан — информация и фокус; коралл — опасность; янтарь —
   предупреждение и выбранное; фиалковый — агент и виртуальный сотрудник.
   Привязка цвета к смыслу одна на всё приложение.
   ════════════════════════════════════════════════════════════════ */

/* Имена прежние — `C.ink`, `C.panel`, `OK`, `ACC` — потому что их зовут
   из сорока файлов, а значения теперь токенные. Менять заодно и имена
   значило бы делать две правки там, где нужна одна. */
export const C = {
  ink: "var(--bg-base)",
  elevated: "var(--bg-elevated)",
  panel: "var(--surface-glass)",
  panel2: "var(--surface-glass-strong)",
  line: "var(--border-glass)",
  lineSoft: "var(--border-glass-soft)",
  text: "var(--text-primary)",
  second: "var(--text-secondary)",
  muted: "var(--text-muted)",
};
export const OK = "var(--accent-mint)";
export const WARN = "var(--accent-amber)";
export const BAD = "var(--accent-coral)";
export const ACC = "var(--accent-cyan)";
export const VIO = "var(--accent-violet)";
/* «Нейтральный» больше не отдельный серо-синий: тихое здесь — это тихий
   текст, а не ещё один цвет. */
export const NEU = "var(--text-muted)";

/* Тонировка по смыслу: заливка 12–16%, граница 45–55%, свой текст и своё
   свечение. Числа — из руководства по компонентам; собраны в одном месте,
   чтобы чип, кнопка и вкладка тонировались одинаково. */
export const TINT = {
  [OK]: { bg: "rgba(60,242,160,.15)", line: "rgba(60,242,160,.5)",
    text: "var(--chip-mint-text)", glow: "var(--shadow-glow-mint)" },
  [ACC]: { bg: "rgba(77,225,255,.14)", line: "rgba(77,225,255,.5)",
    text: "var(--chip-cyan-text)", glow: "var(--shadow-glow-cyan)" },
  [WARN]: { bg: "rgba(255,196,77,.15)", line: "rgba(255,196,77,.55)",
    text: "var(--chip-amber-text)", glow: "var(--shadow-glow-amber)" },
  [BAD]: { bg: "rgba(255,90,120,.14)", line: "rgba(255,90,120,.5)",
    text: "var(--chip-coral-text)", glow: "var(--shadow-glow-coral)" },
  [VIO]: { bg: "rgba(180,140,255,.16)", line: "rgba(180,140,255,.5)",
    text: "var(--chip-violet-text)", glow: "none" },
};
export const tintOf = (color) => TINT[color] || TINT[ACC];
/* Граница опасного — тот же коралл на половине, что и у тонированной
   кнопки: раньше в сорока местах стоял руками выписанный #5A2436. */
export const DANGER_LINE = "rgba(255,90,120,.5)";

/* ─────── СТАТУС БЕЗ ПОЛОСКИ СЛЕВА ───────

   Бренд-бук: «откажитесь от цветной рамки слева как маркера статуса — это
   решение из прошлой версии интерфейса. Вместо него используйте
   тонированную капсулу, кольцо вокруг аватара или мягкое свечение по
   контуру карточки».

   Полоска говорила цветом, но только на своём краю: на узкой карточке её
   видно, на широкой — она теряется. Свечение по контуру говорит тем же
   цветом всей формой. `null` — состояния нет, и карточка остаётся
   обычной. */
export const statusEdge = (color) => (color
  ? { border: `1px solid ${tintOf(color).line}`, boxShadow: tintOf(color).glow }
  : { border: `1px solid ${C.line}` });

/** Стекло: заливка, граница, размытие с насыщенностью и тень. */
export const glass = (level = "md") => ({
  background: "var(--surface-glass)",
  border: "1px solid var(--border-glass)",
  backdropFilter: `blur(var(--blur-${level})) saturate(175%)`,
  WebkitBackdropFilter: `blur(var(--blur-${level})) saturate(175%)`,
  boxShadow: level === "lg" ? "var(--shadow-glass-bar)" : "var(--shadow-glass-panel)",
});

/* ─────── «СКАЧАТЬ» ───────

   Сохранить файл из мини-приложения на телефон нельзя: WebView Telegram
   не даёт, и ссылка со скачиванием там просто ничего не делает (владелец,
   2026-09-20: «кнопка „Скачать" не работает»). Поэтому «Скачать» — это
   отправка файла себе в чат с ботом: оттуда он сохраняется и
   пересылается штатными средствами. Кнопка одна на все места: договор
   участника, материал на входе, вещь на выходе.

   Вещь без файла (текст, код) уходит сообщением: скачивать там нечего, а
   забрать надо. */
export function Download({url,text,name,label="Скачать",style,...rest}){
  const [state,setState]=useState("");   // "", "идёт", куда ушло, ошибка
  const href=url||(text!=null
    ?`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`:"");
  /* В обычном браузере ссылка работает сама — и это честнее всего: файл
     ложится туда, куда человек скажет. В Telegram она не делает НИЧЕГО
     (владелец, 2026-09-20: «по-прежнему не работает»), поэтому нажатие
     перехватывается: файл уходит в чат с ботом, а если бот не смог —
     открывается внешним окном, где его сохраняют штатно. */
  const go=async(e)=>{
    const tg=getTelegram();
    if(!tg||!href) return;
    e.preventDefault();
    e.stopPropagation();
    setState("идёт");
    try{
      const r=await deliverFile({url:href,name});
      setState(r?.sent==="link"?"ссылка в чате":"в чате с ботом");
      return;
    }catch(err){
      const abs=href.startsWith("/")?`${window.location.origin}${href}`:href;
      if(!href.startsWith("data:")){
        try{
          if(tg.openLink) tg.openLink(abs); else window.open(abs,"_blank","noopener");
          setState("открыл в браузере");
          return;
        }catch{ /* и так не вышло — скажем словами */ }
      }
      setState(err.message||"не удалось отправить");
    }
  };
  const bad=state&&!["идёт","в чате с ботом","ссылка в чате","открыл в браузере"]
    .includes(state);
  return (
    <span className="flex items-center gap-2" style={{alignItems:"center"}}>
      <a href={href} target="_blank" rel="noreferrer" download={name||true}
        onClick={go} style={{...btn(false),textDecoration:"none",...style}} {...rest}>
        {state==="идёт"?"Отправляю…":label}</a>
      {state&&state!=="идёт"&&(
        <span style={{fontSize:10,color:bad?BAD:OK}}>{state}</span>)}
    </span>);
}

/* ─────── ПЕРЕТАСКИВАНИЕ СТРОК ЗА ТРИ ПОЛОСКИ ───────

   Строка ИДЁТ ЗА ПАЛЬЦЕМ (владелец, 2026-09-20: «пользователь должен
   видеть полную анимацию движения выбранной строки»): пока её ведут, она
   сдвинута ровно на столько, на сколько уехал палец, приподнята тенью и
   лежит поверх соседей. Прошли над соседом — списки меняются местами, и
   отсчёт начинается заново от нового места: иначе строка «убегала» бы от
   пальца на высоту соседа.

   Один механизм на все списки, где порядок задаёт человек: разделы
   отчётов, воркеры актива. Сосед узнаётся по атрибуту `attr` на его
   корневом узле. */
export function useRowDrag({attr,id,onOver}){
  const [dy,setDy]=useState(0);
  const from=useRef(null);
  const down=(e)=>{
    from.current=e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const move=(e)=>{
    if(from.current==null) return;
    setDy(e.clientY-from.current);
    const under=typeof document.elementFromPoint==="function"
      ?document.elementFromPoint(e.clientX,e.clientY):null;
    const over=under?.closest?.(`[${attr}]`)?.getAttribute(attr);
    if(over&&String(over)!==String(id)){
      onOver?.(over);
      from.current=e.clientY;
      setDy(0);
    }
  };
  const up=(e)=>{
    from.current=null;
    setDy(0);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  return {
    bind:{onPointerDown:down,onPointerMove:move,onPointerUp:up,onPointerCancel:up},
    style:dy
      ?{transform:`translateY(${dy}px)`,transition:"none",position:"relative",
        zIndex:5,boxShadow:"0 8px 20px #000a",opacity:0.96}
      :{transition:"transform .18s ease-out"},
  };
}

/* ─────── ЗВЁЗДЫ ───────

   Оценка от одного до пяти (владелец, 2026-09-20): ряд серых звёзд, и
   нажатие зажигает жёлтым все до нажатой включительно. Без нажатия
   оценки нет — ноль звёзд это «не оценил», а не «ноль». */
export function Stars({value=0,onPick,label="оценка"}){
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={label}
      style={{alignItems:"center"}}>
      {[1,2,3,4,5].map(n=>(
        <button key={n} type="button" role="radio" aria-checked={n===Number(value)}
          aria-label={`оценка ${n}`} disabled={!onPick}
          onClick={()=>onPick?.(n)}
          style={{background:"none",border:"none",padding: "0 0",lineHeight:1,
            fontSize:24,cursor:onPick?"pointer":"default",
            color:n<=Number(value)?WARN:NEU}}>★</button>))}
    </div>);
}

/** Стрелка «свернуть/развернуть» — просто стрелка, а не кнопка в рамке
    (владелец, 2026-09-21: «везде, где рисуется эта стрелочка, она должна
    выглядеть не как кнопка, а просто как стрелка»). Нажимается — да,
    рамки и фона у неё нет. */
export function Arrow({open,label,onClick,size=11,style}){
  return (
    <button type="button" aria-label={label} aria-expanded={open} onClick={onClick}
      data-arrow=""
      style={{background:"transparent",border:0,padding:"0 var(--space-4)",
        color:C.muted,cursor:"pointer",fontSize:size,lineHeight:"18px",
        fontFamily:"var(--font-sans)",flex:"0 0 auto",...style}}>
      {open?"▾":"▸"}</button>);
}

/** Три полоски: за них строку и тянут. Промежуток между полосками — свой,
    2 px: на шкале отступов такого нет, а без него три полоски сливаются в
    одну (владелец, 2026-09-21). */
export function Grip({label,bind,style}){
  return (
    <span data-drag="" role="button" tabIndex={0} aria-label={label} {...bind}
      style={{display:"inline-flex",flexDirection:"column",justifyContent:"center",
        gap: 2,padding: "var(--space-4) 0",cursor:"grab",touchAction:"none",flex:"0 0 auto",
        ...style}}>
      {[0,1,2].map(i=>(
        <span key={i} style={{width:12,height:2,borderRadius: "var(--radius-sm)",background:C.muted}}/>))}
    </span>);
}

export const nm=(n)=>!isFinite(n)?"—":
  (Math.abs(n)>=100?Math.round(n):Math.round(n*100)/100).toLocaleString("ru-RU");

export const S = {
  /* Поле ввода — мелкий элемент, значит `radius-sm` и стекло потише: оно
     лежит ВНУТРИ панели, и спорить с ней материалом ему незачем. */
  inp: { background: "var(--surface-glass)", border: "1px solid var(--border-glass)",
    color: C.text, borderRadius: "var(--radius-sm)",
    padding: "var(--space-8) var(--space-12)", fontSize: 14, lineHeight: "20px",
    width: "100%", fontFamily: "var(--font-sans)",
    outline: "none" },
  /* Надзаголовок — `eyebrow`: капс с разрядкой, самый тихий читаемый цвет. */
  lbl: { color: C.muted, fontSize: 11.5, lineHeight: "14px", fontWeight: 700,
    letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "var(--font-sans)" },
  card: { ...glass("md"), borderRadius: "var(--radius-lg)", padding: "var(--space-20)",
    color: C.text },
};
/* ─────── три плашки разницы версий: «+», «±», «−» ───────
   Владелец (2026-09-20): «везде, где есть гит-версионирование и зелёная и
   красная плашка, добавь также жёлтую плашку между ними, которая будет
   показывать конфликтующие изменения, наложенные поверх старых: добавлен
   текст — зелёная, убран — красная, заменён — жёлтая».

   Жёлтая стоит МЕЖДУ зелёной и красной: замена и есть середина между
   «появилось» и «пропало» — старое никуда не делось, поверх него легло
   новое. Пустая плашка не прячется: «ничего» — такой же ответ, как список,
   а исчезнувшая плашка читалась бы как «здесь ещё не смотрели».

   Что показывать внутри — знает вызывающий: `item(x, sign)`. Сама тройка
   одна на все места, чтобы версии схемы и версии техпроцесса не разъехались
   ни цветом, ни порядком. */
export function DiffBoxes({ added = [], changed = [], removed = [], item, gap = 6 }) {
  const box = (sign, list, color, label) => (
    <fieldset aria-label={label} style={{ border: `1px solid ${color}`, borderRadius: "var(--radius-sm)",
      padding: "var(--space-4) var(--space-8) var(--space-8)", margin: 0, minWidth: 0 }}>
      <legend style={{ color, fontWeight: 700, fontSize: 12, padding: "0 var(--space-4)" }}>{sign}</legend>
      {!list.length && <div style={{ fontSize: 11, color: C.muted }}>ничего</div>}
      {list.map((x, i) => (
        <div key={i} style={{ marginTop: i ? gap : 0, minWidth: 0 }}>{item(x, sign)}</div>))}
    </fieldset>);
  return (
    <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-4)" }}>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>{box("+", added, OK, "добавлено")}</div>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>{box("±", changed, WARN, "заменено")}</div>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>{box("−", removed, BAD, "убрано")}</div>
    </div>);
}

/* Старый текст замены — зачёркнут и приглушён, новый — цветом замены:
   «было → стало» одной строкой, без второй плашки. */
export const WAS_STYLE = { color: C.muted, textDecoration: "line-through" };

/* ─────── полоса прокрутки над широким рядом ───────
   Доска задач шире экрана: колонки статусов уезжают вправо, и по самой
   доске не видно, что за краем есть ещё (владелец, 2026-09-20: «нужно
   сделать линию прокрутки… над задачами, которая будет визуально
   показывать, что движение должно происходить вправо или влево»).

   Полоса — та же линия, что и рамки карточек, с бегунком цвета акцента:
   где бегунок — там сейчас окно, сколько он занимает — столько видно.
   Стрелки по краям горят, пока в ту сторону есть что показать, и гаснут
   у края. Нажатие на стрелку везёт на шаг, нажатие по линии — туда,
   бегунок можно тянуть. Когда ряд помещается целиком, полосы нет: ей
   нечего показывать.

   Полоса возит ОКНО, а не задачи: колонка — ответ на вопрос «что с
   работой», и переложить задачу отсюда нельзя (см. TasksBoard). */
export function ScrollRail({ target, label = "прокрутка", step = 200 }) {
  const [st, setSt] = useState({ frac: 0, size: 1, left: 0, max: 0 });
  const track = useRef(null);
  const drag = useRef(null);
  useEffect(() => {
    const el = target?.current;
    if (!el) return undefined;
    const read = () => {
      const max = Math.max(0, el.scrollWidth - el.clientWidth);
      const size = el.scrollWidth > 0 ? Math.min(1, el.clientWidth / el.scrollWidth) : 1;
      const left = Math.min(max, Math.max(0, el.scrollLeft));
      setSt({ frac: max > 0 ? left / max : 0, size, left, max });
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    let ro = null;
    if (typeof ResizeObserver === "function") { ro = new ResizeObserver(read); ro.observe(el); }
    window.addEventListener("resize", read);
    return () => { el.removeEventListener("scroll", read); ro?.disconnect(); window.removeEventListener("resize", read); };
  }, [target]);
  if (st.max <= 0) return null;
  const go = (left) => {
    const el = target?.current;
    if (!el) return;
    const x = Math.min(st.max, Math.max(0, left));
    if (typeof el.scrollTo === "function") el.scrollTo({ left: x, behavior: "smooth" });
    else el.scrollLeft = x;
  };
  /* Нажатие по линии — окно уезжает так, чтобы бегунок встал под палец. */
  const atTrack = (clientX) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || !(r.width > 0)) return 0;
    const share = (clientX - r.left) / r.width - st.size / 2;
    return (share / (1 - st.size || 1)) * st.max;
  };
  const onTrack = (e) => { if (!drag.current) go(atTrack(e.clientX)); };
  const onThumbDown = (e) => {
    e.stopPropagation();
    drag.current = { x0: e.clientX, left0: st.left };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onThumbMove = (e) => {
    if (!drag.current) return;
    const r = track.current?.getBoundingClientRect();
    if (!r || !(r.width > 0)) return;
    const el = target?.current;
    if (!el) return;
    const px = (e.clientX - drag.current.x0) / (r.width * (1 - st.size) || 1) * st.max;
    el.scrollLeft = Math.min(st.max, Math.max(0, drag.current.left0 + px));
  };
  const onThumbUp = (e) => { drag.current = null; e.currentTarget.releasePointerCapture?.(e.pointerId); };
  const canL = st.left > 0.5, canR = st.left < st.max - 0.5;
  const arrow = (dir, on) => (
    <button type="button" aria-label={dir < 0 ? "левее" : "правее"} disabled={!on}
      onClick={() => go(st.left + dir * step)}
      style={{ background: "transparent", border: "none", padding: "0 var(--space-4)", cursor: on ? "pointer" : "default",
        color: on ? ACC : C.muted, fontSize: 14, lineHeight: 1, opacity: on ? 1 : 0.35 }}>
      {dir < 0 ? "‹" : "›"}
    </button>);
  return (
    <div className="flex items-center" style={{ gap: "var(--space-4)", margin: "0 0 var(--space-4)" }} data-noswipe="">
      {arrow(-1, canL)}
      <div ref={track} role="scrollbar" aria-label={label} aria-orientation="horizontal"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(st.frac * 100)}
        onPointerDown={onTrack}
        style={{ flex: 1, height: 12, display: "flex", alignItems: "center", cursor: "pointer", touchAction: "none" }}>
        <div style={{ position: "relative", width: "100%", height: 3, borderRadius: "var(--radius-sm)", background: C.line }}>
          <div aria-label="бегунок" onPointerDown={onThumbDown} onPointerMove={onThumbMove}
            onPointerUp={onThumbUp} onPointerCancel={onThumbUp}
            style={{ position: "absolute", top: -2, height: 7, borderRadius: "var(--radius-sm)", background: ACC,
              left: `${st.frac * (1 - st.size) * 100}%`, width: `${Math.max(st.size * 100, 8)}%`,
              boxShadow: `0 0 0 1px ${C.ink}`, transition: drag.current ? "none" : "left .12s" }} />
        </div>
      </div>
      {arrow(1, canR)}
    </div>);
}

/* Карточка-спойлер: заголовок сворачивает содержимое нажатием (владелец,
   2026-09-19: «в анкете все формы должны скрываться под спойлерами при
   нажатии»). Открыта по умолчанию — свернуть решает человек. */
export function FoldCard({ title, children, aria, open: open0 = true }) {
  const [open, setOpen] = useState(open0);
  return (
    <div style={{ ...S.card, marginBottom: "var(--space-8)" }}>
      <button type="button" aria-expanded={open} aria-label={aria || title}
        onClick={() => setOpen((v) => !v)} className="flex items-center gap-2"
        style={{ width: "100%", background: "transparent", border: "none", padding: 0,
          cursor: "pointer", textAlign: "left" }}>
        <span style={{ ...S.lbl, flex: 1 }}>{title}</span>
        <span style={{ fontSize: 11, color: C.muted }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && children}
    </div>);
}

/* Часы в понятное: 2 880 ч — это «4 мес», а не число, в котором надо
   считать нули. Меньше суток остаётся часами: «3 ч» понятнее «0,1 дн». */
export function durText(h){
  const n=Number(h)||0;
  if(n<=0) return "—";
  if(n<24) return `${nm(Math.round(n*10)/10)} ч`;
  if(n<168) return `${nm(Math.round(n/24*10)/10)} дн`;
  if(n<730) return `${nm(Math.round(n/168*10)/10)} нед`;
  return `${nm(Math.round(n/730*10)/10)} мес`;
}

/* ─────── КНОПКА ───────

   Подпись прежняя — `btn(on, col)`, — потому что её зовут отовсюду; а
   вариантов теперь пять, как в дизайн-системе:

   · выключенная — `ghost`: только граница, тихий текст, без заливки;
   · включённая — тонированная по смыслу цвета: мята «успех», циан
     «информация», коралл «опасность», янтарь «выбрано», фиалковый «агент»;
   · `btn(true, OK, { solid: true })` — единственная сплошная в системе,
     градиент мята→циан с текстом `on-mint`. Главное действие экрана, и
     больше одной такой на экране не ставят.

   Опасное действие тонируют, но сплошным не делают никогда: отказ не
   должен визуально перевешивать основной поток. */
export const btn = (on, col, { solid = false } = {}) => {
  /* РАЗМЕР — НА ТРЕТЬ МЕНЬШЕ (владелец, 2026-09-21). Было 42px высоты
     (10+20+10+рамка), стало 28: `space-4` по вертикали, `space-12` по
     горизонтали и `label-sm` вместо `label-md`. Оба отступа — со шкалы
     сетки, а не подобраны на глаз.

     28px — это меньше 44px, которые обычно просят для пальца. Здесь так
     и задумано: кнопок в форме много, и высота каждой решает, помещается
     ли форма на экран. */
  const base = { borderRadius: "var(--radius-md)",
    /* Вертикальные отступы разные ровно на оптическую поправку: строка
       опускается, высота кнопки та же (lib/capShift.js). */
    paddingTop: "calc(var(--space-4) + var(--text-nudge))",
    paddingBottom: "calc(var(--space-4) - var(--text-nudge))",
    paddingLeft: "var(--space-12)", paddingRight: "var(--space-12)",
    minHeight: "var(--control-h)",
    fontSize: 13, lineHeight: "18px", fontWeight: 600, fontFamily: "var(--font-sans)",
    cursor: "pointer", whiteSpace: "nowrap",
    transition: "background .15s ease, border-color .15s ease, box-shadow .15s ease" };
  if (solid) {
    return { ...base, background: `linear-gradient(135deg, ${OK}, ${ACC})`,
      border: "1px solid transparent", color: "var(--on-mint)", fontWeight: 700,
      boxShadow: "var(--shadow-glow-mint)" };
  }
  if (!on) {
    return { ...base, background: "transparent",
      border: "1px solid var(--border-glass)", color: C.muted };
  }
  const t = tintOf(col || ACC);
  return { ...base, background: t.bg, border: `1px solid ${t.line}`, color: t.text,
    boxShadow: t.glow };
};

/* ─────── ЗНАК И ИМЯ ПРИЛОЖЕНИЯ ───────

   Знак — картинка, присланная владельцем (2026-09-19): «имелось в виду
   знак наверху, в шапке». Она обрезана по краю рисунка и переведена в
   прозрачный фон инструментом для картинок — не перерисована.

   Логотип стоит ТОЛЬКО здесь: на формах его нет. */
export function Brand({ size = 26, color = OK }) {
  return (
    <span className="flex items-center gap-2" aria-label="blockTree">
      <img src={logoUrl} alt="" aria-hidden="true" width={size} height={size}
        style={{ display: "block", flex: "0 0 auto" }} />
      <span style={{ fontFamily: BRAND_FONT, fontSize: Math.round(size * 0.72),
        fontWeight: 600, letterSpacing: "0.04em", color }}>
        block<span style={{ color: C.text }}>Tree</span></span>
    </span>);
}

/* ─────── КНОПКА-ЗНАЧОК ───────

   Владелец (2026-09-19): «сделай так, чтобы они были значками без
   надписей». Надпись уходит с экрана, но не из приложения: она остаётся
   подписью для читалки и подсказкой при наведении — иначе значок
   пришлось бы угадывать. */
export const ICON = {
  undo: "M9 7H16a5 5 0 0 1 0 10h-6M9 7 12.5 3.5M9 7l3.5 3.5",
  redo: "M15 7H8a5 5 0 0 0 0 10h6M15 7 11.5 3.5M15 7l3.5 3.5",
  save: "M5 4h11l3 3v13H5zM8 4v6h7V4M8 20v-6h8v6",
  /* Восклицательный знак в круге — сообщение об ошибке (владелец,
     2026-09-21). Точка рисуется отрезком нулевой длины: обводка круглая,
     и он выходит точкой, а не чёрточкой. */
  alert: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7.5v5.5M12 16.4v0",
  /* Волшебная палочка — вопрос ассистенту (владелец, 2026-09-21): палочка
     наискось и три искры у кончика. */
  wand: "M4 20 14 10M14 10l2.5-2.5M18 3v3M16.5 4.5h3M20.5 9v2M19.5 10h2M13 3.5v1.5M12.25 4.25h1.5",
};
/* Размер и прозрачность — владелец (2026-09-19): «в 1,5 раза меньше и на
   30% прозрачнее»: значок стоит в стороне от работы и не должен спорить с
   ней за внимание. */
export function IconButton({ icon, label, title, onClick, disabled, on = false, size = 14,
  dim = 0.7 }) {
  /* Иконная кнопка тулбара — КАПСУЛА, а не квадрат: `radius-pill`,
     стекло `blur-sm`. Размер 28×28 — как в руководстве. */
  const t = on ? tintOf(ACC) : null;
  return (
    <button type="button" aria-label={label} title={title || label} onClick={onClick}
      disabled={disabled}
      style={{ width: "var(--control-h)", height: "var(--control-h)",
        borderRadius: "var(--radius-pill)", flex: "0 0 auto",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        background: t ? t.bg : "var(--surface-glass)",
        border: `1px solid ${t ? t.line : "var(--border-glass)"}`,
        backdropFilter: "blur(var(--blur-sm)) saturate(175%)",
        WebkitBackdropFilter: "blur(var(--blur-sm)) saturate(175%)",
        boxShadow: t ? t.glow : "none",
        color: t ? t.text : C.text, padding: 0, lineHeight: 0,
        opacity: disabled ? 0.45 : dim, cursor: disabled ? "not-allowed" : "pointer" }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d={icon} />
      </svg>
    </button>);
}

/* Шрифт имени — сдержанный техничный гротеск; подключён в `index.html`,
   а список запасных оставляет имя читаемым и без загрузки. */
/* Шрифт имени — тот же системный стек, что и у всего остального: вторых
   гарнитур дизайн-система не допускает. Техничность имени теперь держат
   разрядка и вес, а не отдельная гарнитура. */
export const BRAND_FONT = "var(--font-sans)";

/* ─────── ВКЛАДКА ───────

   Владелец (2026-09-19): «сделай, чтобы они выглядели как вкладки, а не
   как кнопки». Вкладка не обведена со всех сторон: у неё скруглён только
   верх, а низ сливается с полосой под рядом — открытая вкладка эту полосу
   разрывает и этим показывает, что страница ниже принадлежит ей. */
/* ─────── ВЕРХНЯЯ ПАНЕЛЬ И ВКЛАДКИ ───────

   Вкладки больше не «папки с подрезанной линией снизу»: это КАПСУЛЫ на
   стеклянном баре. Активная — тонированная мятой с её свечением, текст
   `chip-mint-text`; неактивная — без фона, тихий текст. Активной на
   экране всегда ровно одна: тонировать две значило бы сказать, что
   открыты обе.

   Линия под рядом убрана вместе с папками — её роль теперь играет сам
   бар: панель кончается там, где кончается стекло. */
export const TAB_LINE = {
  ...glass("lg"),
  borderRadius: "var(--radius-lg)",
  padding: "var(--space-8) var(--space-12)",
};
export const tab = (on) => {
  const t = tintOf(OK);
  return {
    background: on ? t.bg : "transparent",
    border: `1px solid ${on ? t.line : "transparent"}`,
    borderRadius: "var(--radius-pill)",
    color: on ? t.text : C.muted,
    boxShadow: on ? t.glow : "none",
    fontWeight: 600, fontSize: 13, lineHeight: "18px",
    paddingTop: "calc(var(--space-4) + var(--text-nudge))",
    paddingBottom: "calc(var(--space-4) - var(--text-nudge))",
    paddingLeft: "var(--space-12)", paddingRight: "var(--space-12)",
    minHeight: "var(--control-h)",
    cursor: "pointer", whiteSpace: "nowrap",
    fontFamily: "var(--font-sans)",
    transition: "background .15s ease, color .15s ease",
  };
};

/* ─────── ПОЛЯ С ЧЕРНОВИКОМ ───────
   Значение уходит наружу по расфокусу или по Enter, поэтому пересчёт
   модели не дёргает ввод под пальцами. */
export function NumField({value,onCommit,placeholder,style,...rest}){
  const [d,setD]=useState(value==null?"":String(value));
  const [f,setF]=useState(false);
  useEffect(()=>{ if(!f) setD(value==null?"":String(value)); },[value,f]);
  const commit=()=>{ const s=String(d).trim().replace(",",".");
    onCommit(s===""?null:(isFinite(Number(s))?Number(s):null)); };
  return <input inputMode="decimal" placeholder={placeholder} value={d} {...rest}
    style={{...S.inp,...style}} onFocus={()=>setF(true)} onChange={e=>setD(e.target.value)}
    onBlur={()=>{setF(false);commit();}}
    onKeyDown={e=>{if(e.key==="Enter") e.currentTarget.blur();}}/>;
}
/* ─────── НАЗВАНИЕ ФОРМЫ ───────

   Владелец (2026-09-19): «Название отчёта должно редактироваться только при
   двойном нажатии на него, так же, как и названия технологических
   процессов. Сделай так со всеми полями, обозначающими название
   каких-либо форм».

   Одно нажатие принадлежит самой форме — раскрыть, выбрать, — а правка
   двойному. Поле ввода, стоящее там всегда, забирало нажатие себе: чтобы
   раскрыть форму, приходилось целиться мимо её названия. */
export function NameField({value="",onCommit,aria,placeholder="без названия",
  style,children,...rest}){
  const [edit,setEdit]=useState(false);
  const last=useRef(0);
  const stop=(v)=>{
    setEdit(false);
    const t=String(v??"");
    if(t!==String(value??"")) onCommit?.(t);
  };
  if(edit) return (
    <input autoFocus aria-label={aria} defaultValue={value} placeholder={placeholder}
      {...rest} style={{...S.inp,flex:1,minWidth:0,padding: "var(--space-4) var(--space-4)",...style}}
      onBlur={e=>stop(e.target.value)}
      onKeyDown={e=>{ if(e.key==="Enter") e.currentTarget.blur();
        if(e.key==="Escape") setEdit(false); }}/>);
  /* На телефоне двойное нажатие приходит не как `dblclick`, а двумя
     нажатиями подряд — считаем их сами, как в заголовке процесса. */
  const tap=()=>{
    const now=Date.now();
    if(now-last.current<320){ last.current=0; setEdit(true); return; }
    last.current=now;
  };
  return (
    <span data-name-field="" aria-label={aria} title="двойное нажатие — переименовать"
      onClick={tap} onDoubleClick={()=>setEdit(true)} {...rest}
      style={{flex:1,minWidth:0,cursor:"text",whiteSpace:"normal",overflowWrap:"anywhere",
        color:String(value??"").trim()?C.text:C.muted,...style}}>
      {children??(String(value??"").trim()||placeholder)}</span>);
}

export function TxtField({value,onCommit,placeholder,style,area,...rest}){
  const [d,setD]=useState(value??"");
  const [f,setF]=useState(false);
  useEffect(()=>{ if(!f) setD(value??""); },[value,f]);
  // Прочие атрибуты (aria-label и подобные) пробрасываем как есть: поле
  // одно на всё приложение, и без подписи его не найти ни человеку с
  // читалкой, ни тесту.
  const p={...rest,value:d,placeholder,style:{...S.inp,...style},onFocus:()=>setF(true),
    onChange:e=>setD(e.target.value),onBlur:()=>{setF(false);onCommit(d);}};
  return area ? <textarea {...p}/> : <input {...p}/>;
}

/* ─────── ПОЛОСА СРОКА ───────

   Сколько осталось до конца срока: зелёная, пока времени много; жёлтая,
   когда осталось меньше половины; красная — меньше 20%. Длина полосы —
   сама доля: чем меньше осталось, тем короче. Остаток — в единицах срока
   функции (владелец, 2026-09-20): работа мерена днями — и остаток в днях.

   Одна на всё приложение: она стоит и на «Проверке», и под «Томатом» в
   форме задачи, и должна выглядеть там одинаково. */
export function TimeBar({ task, func }) {
  const left = timeLeft(task);
  if (!left) {
    return (
      <div style={{ fontSize: 11, color: C.muted, marginBottom: "var(--space-4)" }}>
        до конца срока: срок не назначен</div>);
  }
  const text = left.left > 0 ? leftInUnit(left.left, func?.durUnit) : "срок прошёл";
  const color = left.tone === "bad" ? BAD : left.tone === "warn" ? WARN : OK;
  return (
    <div style={{ marginBottom: "var(--space-8)" }} aria-label={`до конца срока: ${text}`} data-tone={left.tone}>
      <div style={{ fontSize: 11, color, marginBottom: "var(--space-4)" }}>до конца срока: {text}</div>
      <div style={{ height: 6, borderRadius: "var(--radius-sm)", background: C.ink, border: `1px solid ${C.line}`,
        overflow: "hidden" }}>
        <div data-bar="" style={{ width: `${Math.round(left.share * 100)}%`, height: "100%",
          background: color, borderRadius: "var(--radius-sm)" }} />
      </div>
    </div>);
}

/* ─────── КРУЖОК С ЛИЦОМ ───────

   Картинка у человека одна (владелец, 2026-09-20): по умолчанию — та,
   что стоит у него в Telegram; своя кладётся взамен; «Удалить» оставляет
   пустой кружок с первой буквой имени. Кружок один на всё приложение:
   он стоит и в анкете, и перед названием на «Рынке услуг».

   `logo` — вместо лица знак приложения: так показывается тот, кто
   смотрящему незнаком, и лица у него для этого человека нет. */
export function Avatar({ src = "", name = "", size = 36, logo = false, onClick, title }) {
  const letter = String(name || "").trim().slice(0, 1).toUpperCase();
  /* КОЛЬЦО, А НЕ РАМКА (бренд-бук): тип участника передаётся кольцом
     вокруг аватара — циан у человека, фиалковый у агента и виртуального
     сотрудника. Цветная рамка слева осталась в прежней версии. */
  const ring = logo ? VIO : ACC;
  const round = {
    width: size, height: size, flex: `0 0 ${size}px`, borderRadius: "var(--radius-pill)",
    overflow: "hidden", background: "var(--surface-glass-strong)",
    border: "1px solid var(--border-glass-soft)",
    boxShadow: `0 0 0 2px ${ring}, ${logo ? "none" : "var(--shadow-glow-cyan)"}`,
    display: "flex", alignItems: "center", justifyContent: "center",
    color: logo ? "var(--chip-violet-text)" : C.second,
    fontSize: Math.round(size * 0.42), fontWeight: 700,
    padding: 0, lineHeight: 1,
  };
  const inside = logo
    ? <img src={logoUrl} alt="" aria-hidden="true" width={Math.round(size * 0.72)}
      height={Math.round(size * 0.72)} style={{ display: "block" }} />
    : src
      ? <img src={src} alt="" aria-hidden="true" width={size} height={size}
        style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
      : <span aria-hidden="true">{letter}</span>;
  if (!onClick) {
    return <span aria-label={title || `лицо: ${name || "—"}`} style={round}>{inside}</span>;
  }
  return (
    <button type="button" aria-label={title || `лицо: ${name || "—"}`} onClick={onClick}
      style={{ ...round, cursor: "pointer", flex: "0 0 auto" }}>{inside}</button>);
}
