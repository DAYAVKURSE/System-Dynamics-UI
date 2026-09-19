import React, { useState, useEffect, useRef } from "react";

/* Общие примитивы интерфейса: палитра, стили и поля ввода.
   Вынесены сюда, чтобы схема (SystemModel) и доска задач (TasksBoard)
   выглядели одинаково и не дублировали одно и то же. */

export const C={ink:"#0E1420",panel:"#161F2E",panel2:"#1D2839",line:"#2A3852",
  text:"#E6EDF7",muted:"#8FA0BC"};
export const OK="#3DDC97",WARN="#FFB13D",BAD="#FF5C7A",NEU="#5A6B85",ACC="#7CE0FF";

export const nm=(n)=>!isFinite(n)?"—":
  (Math.abs(n)>=100?Math.round(n):Math.round(n*100)/100).toLocaleString("ru-RU");

export const S={
  inp:{background:C.ink,border:`1px solid ${C.line}`,color:C.text,borderRadius:5,
    padding:"7px 8px",fontSize:13,width:"100%",fontFamily:"Inter, system-ui, sans-serif"},
  lbl:{color:C.muted,fontSize:10,letterSpacing:"0.09em",textTransform:"uppercase",
    fontFamily:"ui-monospace, Menlo, monospace"},
  card:{background:C.panel,border:`1px solid ${C.line}`,borderRadius:10,padding:12},
};
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

   Владелец (2026-09-19): «Сделай название приложения Blocktree сдержанным,
   но футуристичным шрифтом и с логотипом, похожим на этот» — узел в
   скруглённом квадрате, от которого расходятся связи с точками на концах.

   Знак рисуется, а не кладётся картинкой: он живёт в одном цвете со
   схемой, его не надо отдельно грузить, и на любом экране он остаётся
   чётким. */
export function Brand({ size = 26, color = OK }) {
  const dot = (x, y, r = 2.1) => <circle cx={x} cy={y} r={r} fill={color} />;
  return (
    <span className="flex items-center gap-2" aria-label="Blocktree">
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"
        style={{ display: "block", flex: "0 0 auto" }}>
        <rect x="6" y="6" width="36" height="36" rx="11" fill="none"
          stroke={color} strokeWidth="1.6" strokeOpacity="0.9" />
        <g stroke={color} strokeWidth="1.4" strokeLinecap="round">
          <line x1="24" y1="24" x2="12" y2="24" />
          <line x1="24" y1="24" x2="36" y2="24" />
          <line x1="24" y1="24" x2="15" y2="12" />
          <line x1="24" y1="24" x2="33" y2="15" />
          <line x1="24" y1="24" x2="17" y2="33" />
          <line x1="24" y1="24" x2="26" y2="37" />
          <line x1="24" y1="24" x2="34" y2="31" />
        </g>
        <circle cx="24" cy="24" r="3.2" fill="none" stroke={color} strokeWidth="1.6" />
        {dot(12, 24)}{dot(36, 24)}{dot(15, 12)}{dot(33, 15)}{dot(17, 33)}{dot(26, 37)}{dot(34, 31)}
      </svg>
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
export function IconButton({ icon, label, title, onClick, disabled, on = false, size = 18 }) {
  return (
    <button type="button" aria-label={label} title={title || label} onClick={onClick}
      disabled={disabled}
      style={{ ...btn(on), padding: "5px 7px", lineHeight: 0,
        opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer" }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d={icon} />
      </svg>
    </button>);
}

/* Шрифт имени — сдержанный техничный гротеск; подключён в `index.html`,
   а список запасных оставляет имя читаемым и без загрузки. */
export const BRAND_FONT = "Orbitron, 'Exo 2', 'Segoe UI', Inter, system-ui, sans-serif";

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
