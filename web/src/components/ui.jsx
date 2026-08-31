import React, { useState, useEffect } from "react";

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
export const btn=(on,col)=>({background:on?(col||ACC)+"22":C.panel2,
  border:`1px solid ${on?(col||ACC):C.line}`,color:on?(col||ACC):C.muted,borderRadius:6,
  padding:"6px 10px",fontSize:12,cursor:"pointer",whiteSpace:"nowrap"});

/* ─────── ПОЛЯ С ЧЕРНОВИКОМ ───────
   Значение уходит наружу по расфокусу или по Enter, поэтому пересчёт
   модели не дёргает ввод под пальцами. */
export function NumField({value,onCommit,placeholder,style}){
  const [d,setD]=useState(value==null?"":String(value));
  const [f,setF]=useState(false);
  useEffect(()=>{ if(!f) setD(value==null?"":String(value)); },[value,f]);
  const commit=()=>{ const s=String(d).trim().replace(",",".");
    onCommit(s===""?null:(isFinite(Number(s))?Number(s):null)); };
  return <input inputMode="decimal" placeholder={placeholder} value={d}
    style={{...S.inp,...style}} onFocus={()=>setF(true)} onChange={e=>setD(e.target.value)}
    onBlur={()=>{setF(false);commit();}}
    onKeyDown={e=>{if(e.key==="Enter") e.currentTarget.blur();}}/>;
}
export function TxtField({value,onCommit,placeholder,style,area}){
  const [d,setD]=useState(value??"");
  const [f,setF]=useState(false);
  useEffect(()=>{ if(!f) setD(value??""); },[value,f]);
  const p={value:d,placeholder,style:{...S.inp,...style},onFocus:()=>setF(true),
    onChange:e=>setD(e.target.value),onBlur:()=>{setF(false);onCommit(d);}};
  return area ? <textarea {...p}/> : <input {...p}/>;
}
