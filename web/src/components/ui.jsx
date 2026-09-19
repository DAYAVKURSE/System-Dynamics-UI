import React, { useState, useEffect, useRef } from "react";
import logoUrl from "../assets/logo.png";

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
