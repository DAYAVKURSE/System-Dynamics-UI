import React, { useState, useEffect, useRef } from "react";
import logoUrl from "../assets/logo.png";
import { deliverFile } from "../storage.js";
import { getTelegram } from "../telegram.js";

/* Общие примитивы интерфейса: палитра, стили и поля ввода.
   Вынесены сюда, чтобы схема (SystemModel) и доска задач (TasksBoard)
   выглядели одинаково и не дублировали одно и то же. */

export const C={ink:"#0E1420",panel:"#161F2E",panel2:"#1D2839",line:"#2A3852",
  text:"#E6EDF7",muted:"#8FA0BC"};
export const OK="#3DDC97",WARN="#FFB13D",BAD="#FF5C7A",NEU="#5A6B85",ACC="#7CE0FF";

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
          style={{background:"none",border:"none",padding:"0 1px",lineHeight:1,
            fontSize:24,cursor:onPick?"pointer":"default",
            color:n<=Number(value)?WARN:NEU}}>★</button>))}
    </div>);
}

/** Три полоски: за них строку и тянут. */
export function Grip({label,bind,style}){
  return (
    <span data-drag="" role="button" tabIndex={0} aria-label={label} {...bind}
      style={{display:"inline-flex",flexDirection:"column",justifyContent:"center",
        gap:2,padding:"3px 2px",cursor:"grab",touchAction:"none",flex:"0 0 auto",
        ...style}}>
      {[0,1,2].map(i=>(
        <span key={i} style={{width:12,height:2,borderRadius:1,background:C.muted}}/>))}
    </span>);
}

export const nm=(n)=>!isFinite(n)?"—":
  (Math.abs(n)>=100?Math.round(n):Math.round(n*100)/100).toLocaleString("ru-RU");

export const S={
  inp:{background:C.ink,border:`1px solid ${C.line}`,color:C.text,borderRadius:5,
    padding:"7px 8px",fontSize:13,width:"100%",fontFamily:"Inter, system-ui, sans-serif"},
  lbl:{color:C.muted,fontSize:10,letterSpacing:"0.09em",textTransform:"uppercase",
    fontFamily:"ui-monospace, Menlo, monospace"},
  card:{background:C.panel,border:`1px solid ${C.line}`,borderRadius:10,padding:12},
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
    <fieldset aria-label={label} style={{ border: `1px solid ${color}`, borderRadius: 8,
      padding: "4px 8px 8px", margin: 0, minWidth: 0 }}>
      <legend style={{ color, fontWeight: 700, fontSize: 12, padding: "0 4px" }}>{sign}</legend>
      {!list.length && <div style={{ fontSize: 11, color: C.muted }}>ничего</div>}
      {list.map((x, i) => (
        <div key={i} style={{ marginTop: i ? gap : 0, minWidth: 0 }}>{item(x, sign)}</div>))}
    </fieldset>);
  return (
    <div className="flex flex-wrap gap-2" style={{ marginTop: 6 }}>
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
      style={{ background: "transparent", border: "none", padding: "2px 4px", cursor: on ? "pointer" : "default",
        color: on ? ACC : C.muted, fontSize: 14, lineHeight: 1, opacity: on ? 1 : 0.35 }}>
      {dir < 0 ? "‹" : "›"}
    </button>);
  return (
    <div className="flex items-center" style={{ gap: 4, margin: "0 2px 6px" }} data-noswipe="">
      {arrow(-1, canL)}
      <div ref={track} role="scrollbar" aria-label={label} aria-orientation="horizontal"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(st.frac * 100)}
        onPointerDown={onTrack}
        style={{ flex: 1, height: 12, display: "flex", alignItems: "center", cursor: "pointer", touchAction: "none" }}>
        <div style={{ position: "relative", width: "100%", height: 3, borderRadius: 2, background: C.line }}>
          <div aria-label="бегунок" onPointerDown={onThumbDown} onPointerMove={onThumbMove}
            onPointerUp={onThumbUp} onPointerCancel={onThumbUp}
            style={{ position: "absolute", top: -2, height: 7, borderRadius: 4, background: ACC,
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
    <div style={{ ...S.card, marginBottom: 10 }}>
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

export const btn=(on,col)=>({background:on?(col||ACC)+"22":C.panel2,
  border:`1px solid ${on?(col||ACC):C.line}`,color:on?(col||ACC):C.muted,borderRadius:6,
  padding:"6px 10px",fontSize:12,cursor:"pointer",whiteSpace:"nowrap"});

/* ─────── ЗНАК И ИМЯ ПРИЛОЖЕНИЯ ───────

   Знак — картинка, присланная владельцем (2026-09-19): «имелось в виду
   знак наверху, в шапке». Она обрезана по краю рисунка и переведена в
   прозрачный фон инструментом для картинок — не перерисована.

   Логотип стоит ТОЛЬКО здесь: на формах его нет. */
export function Brand({ size = 26, color = OK }) {
  return (
    <span className="flex items-center gap-2" aria-label="Blocktree">
      <img src={logoUrl} alt="" aria-hidden="true" width={size} height={size}
        style={{ display: "block", flex: "0 0 auto" }} />
      <span style={{ fontFamily: BRAND_FONT, fontSize: Math.round(size * 0.72),
        fontWeight: 500, letterSpacing: "0.06em", color }}>Blocktree</span>
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
};
/* Размер и прозрачность — владелец (2026-09-19): «в 1,5 раза меньше и на
   30% прозрачнее»: значок стоит в стороне от работы и не должен спорить с
   ней за внимание. */
export function IconButton({ icon, label, title, onClick, disabled, on = false, size = 12,
  dim = 0.7 }) {
  return (
    <button type="button" aria-label={label} title={title || label} onClick={onClick}
      disabled={disabled}
      style={{ ...btn(on), padding: "3px 5px", lineHeight: 0,
        opacity: disabled ? dim * 0.5 : dim, cursor: disabled ? "default" : "pointer" }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d={icon} />
      </svg>
    </button>);
}

/* Шрифт имени — сдержанный техничный гротеск; подключён в `index.html`,
   а список запасных оставляет имя читаемым и без загрузки. */
export const BRAND_FONT = "Orbitron, 'Exo 2', 'Segoe UI', Inter, system-ui, sans-serif";

/* ─────── ВКЛАДКА ───────

   Владелец (2026-09-19): «сделай, чтобы они выглядели как вкладки, а не
   как кнопки». Вкладка не обведена со всех сторон: у неё скруглён только
   верх, а низ сливается с полосой под рядом — открытая вкладка эту полосу
   разрывает и этим показывает, что страница ниже принадлежит ей. */
export const TAB_LINE = { borderBottom: `1px solid ${C.line}` };
export const tab = (on) => ({
  background: on ? C.panel : "transparent",
  border: `1px solid ${on ? C.line : "transparent"}`,
  borderBottom: `1px solid ${on ? C.panel : C.line}`,
  borderRadius: "8px 8px 0 0",
  color: on ? ACC : C.muted,
  fontWeight: on ? 600 : 400,
  padding: "6px 10px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
  marginBottom: -1,
});

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
      {...rest} style={{...S.inp,flex:1,minWidth:0,padding:"4px 6px",...style}}
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
