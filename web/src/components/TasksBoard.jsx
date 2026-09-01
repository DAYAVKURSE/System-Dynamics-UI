import React, { useMemo, useState } from "react";
import { C, OK, WARN, BAD, NEU, ACC, S, btn, nm, NumField, TxtField } from "./ui.jsx";
import { PER, unitOf, shown, lastSubmission } from "../lib/sim.js";
import { putReportFile, MAX_UPLOAD_REPORT_BYTES } from "../storage.js";

/* ════════════════════════════════════════════════════════════════
   ЗАДАЧИ · OKR + канбан-доска

   Цель модели (ресурс с заданным «нужно ... к месяцу») — это Objective.
   Рекомендация из вкладки «Цели», взятая в работу, становится ключевым
   результатом (Key Result): у неё есть измеримое «от → до», и прогресс
   считается по фактическому значению рычага в модели, а не вручную.
   Каждая задача обязательно принадлежит цели.
   ════════════════════════════════════════════════════════════════ */

export const STATUSES=[
  {id:"backlog",name:"Бэклог",color:NEU},
  {id:"progress",name:"В работе",color:ACC},
  {id:"review",name:"Проверка",color:WARN},
  {id:"done",name:"Готово",color:OK},
];

export const REPEATS=[
  {id:"once",name:"один раз"},
  {id:"daily",name:"повторять ежедневно"},
  {id:"weekly",name:"в определённые дни"},
];
const DAYS=["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];

// За сколько минут до начала предупредить. null — не предупреждать.
export const WARNS=[
  {v:null,name:"не предупреждать"},
  {v:0,name:"в момент начала"},
  {v:5,name:"за 5 минут"},
  {v:10,name:"за 10 минут"},
  {v:20,name:"за 20 минут"},
  {v:30,name:"за 30 минут"},
  {v:50,name:"за 50 минут"},
  {v:60,name:"за час"},
  {v:120,name:"за 2 часа"},
  {v:1440,name:"за сутки"},
];

// Формат, который понимает <input type="datetime-local">: без секунд и без
// часового пояса, в локальном времени пользователя.
export function nowLocal(d=new Date()){
  const p=(n)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`+
    `T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fmtDT=(v)=>{
  if(!v) return "—";
  const d=new Date(v);
  return isNaN(d.getTime())?v:d.toLocaleString("ru-RU",
    {day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"});
};
const uid=(p)=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);

// Потолок на файл отчёта: он едет в хранилище вместе с остальными отчётами,
// и мегабайтные фотографии там ни к чему.
// Предел зависит от того, есть ли куда класть файл: на диск сервера влезает
// 20 МБ, внутрь сценария — 2 МБ. Оба живут в storage.js; здесь оставлен
// только реэкспорт для кода, читавшего старое имя.
export const MAX_REPORT_BYTES=MAX_UPLOAD_REPORT_BYTES;

export function newTask({goalId,okrId=null,edgeId=null,title="Новая задача",
  body="",assignee=null,reviewer=null}){
  // Что задача пополняет и тратит, когда и как часто происходит — всё это
  // свойства движения, а не задачи: иначе одно и то же описывалось бы дважды
  // и разъезжалось. У задачи остаётся имя, описание, к чему она относится,
  // за сколько предупредить — и записи о сдаче.
  // Исполнитель и проверяющий — часть постановки задачи, а не её хода:
  // без них непонятно, кому она видна и кто принимает отчёт.
  return {id:uid("tk"),goalId,okrId,edgeId,title,body,status:"backlog",
    assignee,reviewer,warn:10,submissions:[],comments:[]};
}

// Одна сдача задачи: сколько реально перешло, чем отчитались.
export const newSubmission=({amount=0,text="",file=null})=>
  ({id:uid("sb"),at:new Date().toISOString(),amount:Number(amount)||0,text,file});

// Подпись движения: «откуда → ресурс», как оно читается на схеме.
export const moveLabel=(ed,traits,entities)=>{
  if(!ed) return "";
  const to=traits.find(t=>t.id===ed.to);
  const from=entities.find(e=>e.id===ed.from);
  return `${from?.name||"?"} → ${to?.l||"?"}`;
};


// Ключевой результат из рекомендации вкладки «Цели».
export function okrFromRec(goalId,r){
  return {id:uid("kr"),goalId,type:r.type,
    refId:r.type==="seed"?r.tid:r.eid,
    label:r.label,from:Number(r.from)||0,to:Number(r.to)||0,
    unit:r.unit||"",per:r.per||null,month:r.month??null,createdAt:new Date().toISOString()};
}



/* ─────── работа по одной цели: KR, её задачи, создание ───────
   Живёт во вкладке «Цели»: цель, что по ней предлагает модель, и что по ней
   делается — в одном месте. Раньше это было на «Задачах», и между целью и
   работой по ней стояла лишняя вкладка. */
export function GoalWork({g,okrs,setOkrs,tasks,setTasks,traits=[],entities=[],edges=[],
  okrValue,okrShown,entityName,openId,setOpenId,people=[],canAssign=true}){
  const show=okrShown||((o,v)=>Number(v));
  const krs=okrs.filter(o=>o.goalId===g.id);
  const gt=tasks.filter(t=>t.goalId===g.id);
  const done=gt.filter(t=>t.status==="done").length;
  const open=gt.find(t=>t.id===openId)||null;
  const upT=(id,f,v)=>setTasks(p=>p.map(t=>t.id===id?{...t,[f]:v}:t));
  const delOkr=(id)=>{
    setOkrs(p=>p.filter(o=>o.id!==id));
    // Задачи не удаляем: сделанная работа не должна пропадать вместе с
    // ключевым результатом — просто отвязываем.
    setTasks(p=>p.map(t=>t.okrId===id?{...t,okrId:null}:t));
  };
  // Движение задачи задаётся тем, под чем нажали «+ задача»: у цели свои
  // движения, и выбирать их потом селектом в самой задаче незачем.
  const moves=edges.filter(e=>e.to===g.id);
  const addTask=(ed)=>{
    const t=newTask({goalId:g.id,edgeId:ed?ed.id:null,
      title:ed?(ed.carrier||moveLabel(ed,traits,entities)):"Новая задача"});
    setTasks(p=>[...p,t]); setOpenId(t.id);
  };
  return (

          <div key={g.id} style={{...S.card,marginBottom:8}}>
            <div className="flex items-center gap-2" style={{marginBottom:2}}>
              <span style={{fontSize:13.5,fontWeight:700,flex:1}}>{g.l}</span>
              <span style={{fontSize:11,color:C.muted}}>
                задач: {done}/{gt.length}</span>
            </div>
            <div style={{fontSize:11,color:C.muted,marginBottom:8}}>
              {entityName(g.e)} · нужно {nm(Number(g.want))} {g.unit}
              {g.by!=null?` к ${g.by}-му мес.`:""}</div>

            <div style={S.lbl}>движения этой цели — у каждого своя задача</div>
            <div style={{margin:"6px 0 10px"}}>
              {!moves.length&&<div style={{fontSize:11.5,color:WARN,lineHeight:1.6}}>
                В эту цель не входит ни одного движения — задаче нечего
                выполнять. Нарисуйте стрелку на схеме или составьте гипотезу.
              </div>}
              {moves.map(ed=>{
                const mine=tasks.filter(t=>t.edgeId===ed.id);
                return (
                <div key={ed.id} className="flex flex-wrap gap-2"
                  style={{alignItems:"center",padding:"5px 0",
                    borderBottom:`1px solid ${C.line}`}}>
                  <span style={{fontSize:12,flex:"1 1 150px"}}>
                    {ed.carrier||moveLabel(ed,traits,entities)}
                    <span style={{color:C.muted}}> · {nm(Math.abs(Number(ed.gives)||0))}
                      {" "}за {ed.per}</span>
                  </span>
                  <span style={{fontSize:10.5,color:mine.length?OK:C.muted}}>
                    задач: {mine.length}</span>
                  <button style={btn(true)} title="Задача на это движение"
                    onClick={()=>addTask(ed)}>+ задача</button>
                </div>);})}
              {!!moves.length&&
                <div style={{fontSize:10.5,color:C.muted,marginTop:6,lineHeight:1.5}}>
                  Какое движение выполняет задача — решает то, под чем нажата
                  кнопка; в самой задаче это уже не меняется.
                </div>}
            </div>

            {!krs.length&&<div style={{fontSize:11.5,color:C.muted}}>
              Ключевых результатов нет. Во вкладке «Цели» нажмите
              «Взять в работу» у нужной рекомендации.</div>}

            {krs.map(o=>{
              const cur=okrValue(o);
              const p=pctOf(o,cur);
              const col=p>=1?OK:p>0?WARN:BAD;
              const linked=tasks.filter(t=>t.okrId===o.id);
              return (
                <div key={o.id} style={{background:C.panel2,
                  border:`1px solid ${C.line}`,borderRadius:8,padding:9,marginBottom:6}}>
                  <div className="flex items-center gap-2" style={{marginBottom:4}}>
                    <span style={{fontSize:9.5,color:ACC,border:`1px solid ${ACC}66`,
                      borderRadius:3,padding:"1px 4px"}}>KR</span>
                    <span style={{fontSize:12.5,flex:1}}>{o.label}</span>
                    <button style={{...btn(false),padding:"3px 7px"}}
                      onClick={()=>delOkr(o.id)}>✕</button>
                  </div>
                  <div style={{fontSize:11.5,color:C.muted,marginBottom:5}}>
                    {nm(show(o,o.from))} → <b style={{color:C.text}}>{nm(show(o,o.to))}</b>
                    {" "}{o.unit}{o.per?` за ${o.per}`:""} · сейчас {nm(show(o,cur))}
                  </div>
                  <div style={{height:6,borderRadius:3,background:C.ink,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${Math.round(p*100)}%`,
                      background:col,borderRadius:3}}/>
                  </div>
                  <div className="flex items-center gap-2" style={{marginTop:4}}>
                    <span style={{fontSize:10.5,color:col,fontWeight:700}}>
                      {Math.round(p*100)}%</span>
                    <span style={{fontSize:10.5,color:C.muted,flex:1}}>
                      задач: {linked.length}</span>
                    <button style={{...btn(false),padding:"3px 7px"}}
                      onClick={()=>{const t=newTask({goalId:g.id,okrId:o.id,
                        title:o.label});setTasks(p=>[...p,t]);setOpenId(t.id);}}>
                      + задача</button>
                  </div>
                </div>);})}
          
            <div style={S.lbl}>задачи по этой цели</div>
            <div style={{margin:"6px 0 0"}}>
              {!gt.length&&<div style={{fontSize:11.5,color:C.muted}}>
                Пока нет. «+ задача» заведёт первую.</div>}
              {gt.map(t=>{
                const st=STATUSES.find(x=>x.id===t.status);
                const on=t.id===openId;
                return (
                <div key={t.id} style={{background:C.panel2,
                  border:`1px solid ${on?ACC:C.line}`,borderRadius:8,
                  padding:8,marginBottom:6}}>
                  <div className="flex items-center gap-2"
                    style={{cursor:"pointer"}}
                    onClick={()=>setOpenId(on?null:t.id)}>
                    <span style={{width:8,height:8,borderRadius:2,
                      background:st?.color||NEU}}/>
                    <span style={{fontSize:12.5,fontWeight:600,flex:1}}>{t.title}</span>
                    <span style={{fontSize:10.5,color:C.muted}}>{st?.name||"—"}</span>
                  </div>
                  {(()=>{
                    const mv=edges.find(e=>e.id===t.edgeId);
                    const sb=lastSubmission(t);
                    if(!mv&&!sb) return null;
                    return (<div style={{fontSize:10.5,color:C.muted,marginTop:4,
                      lineHeight:1.5}}>
                      {mv?`движение: ${mv.carrier||moveLabel(mv,traits,entities)}`:""}
                      {sb?<span style={{color:OK}}> · сдано {nm(sb.amount)}</span>:null}
                    </div>);})()}
                  {/* Редактор открывается здесь же, под своей целью, а не
                      уезжает вниз страницы: иначе после нажатия «+ задача»
                      непонятно, куда смотреть. */}
                  {on&&<div style={{marginTop:8}}>
                    <TaskEditor task={t} goals={[g]} traits={traits}
                      entities={entities} edges={edges} entityName={entityName}
                      people={people} canAssign={canAssign}
                      setTasks={setTasks}
                      onClose={()=>setOpenId(null)}
                      onDelete={()=>{setTasks(p=>p.filter(x=>x.id!==t.id));
                        setOpenId(null);}}/>
                  </div>}
                </div>);})}
            </div>
          </div>  );
}

/* ─────── редактор одной задачи ───────
   Отдельным компонентом, потому что открывается в двух местах: под своей
   целью во вкладке «Цели» и над доской во вкладке «Задачи». Копия того же
   JSX в двух местах разъехалась бы на первой же правке. */
export function TaskEditor({task,goals,traits=[],entities=[],edges=[],
  entityName,setTasks,onClose,onDelete,people=[],canAssign=true}){
  const up=(f,v)=>upMany({[f]:v});
  // Несколько полей сразу: два up() подряд затирали бы друг друга, потому что
  // оба считают от одного и того же прежнего состояния.
  const upMany=(patch)=>setTasks(p=>p.map(t=>t.id===task.id?{...t,...patch}:t));
  const addComment=(text)=>{
    if(!text.trim()) return;
    up("comments",[...(task.comments||[]),
      {id:uid("c"),text:text.trim(),at:new Date().toISOString()}]);
  };
  const [handing,setHanding]=useState(false);
  const [draftAmount,setDraftAmount]=useState("0");
  const [draftText,setDraftText]=useState("");
  const [draftFile,setDraftFile]=useState(null);
  const [fileErr,setFileErr]=useState("");
  const [fileBusy,setFileBusy]=useState(false);
  const move=edges.find(e=>e.id===task.edgeId)||null;
  const subs=task.submissions||[];
  const goal=goals.find(g=>g.id===task.goalId)||null;
  // Файл отчёта уезжает на диск сервера, а в сценарий попадает ссылка. Без
  // сервера — обратно в data:-URL внутри сценария: потерять отчёт хуже, чем
  // раздуть документ. Куда именно легло, решает storage.js.
  const pickFile=async(f)=>{
    setFileErr("");
    if(!f) return;
    // Предел не проверяем здесь: он разный у диска и у инлайна, а какой из
    // них сейчас работает, знает только storage.js — он и откажет словами.
    setFileBusy(true);
    try{ setDraftFile(await putReportFile(f)); }
    catch(e){ setFileErr(e.message||"не удалось сохранить файл"); }
    setFileBusy(false);
  };
  const submit=()=>{
    // Сдал — не значит принято. Задача уходит на проверку: «Готово» ставит
    // тот, кто отчёт принял. Иначе статус означал бы «я так считаю», а на
    // нём держится и повторяемость движения «после утверждения отчёта».
    upMany({submissions:[...subs,newSubmission({amount:Number(draftAmount)||0,
      text:draftText,file:draftFile})],status:"review"});
    setHanding(false); setDraftText(""); setDraftFile(null); setFileErr("");
  };
  const target=move?traits.find(t=>t.id===move.to):null;
  return (
        <div style={{...S.card,marginBottom:10,borderColor:ACC}}>
          <div className="flex items-center gap-2" style={{marginBottom:8}}>
            <span style={S.lbl}>задача</span>
            <span style={{flex:1}}/>
            <button style={{...btn(false),color:BAD,borderColor:"#5A2436"}}
              onClick={()=>onDelete()}>Удалить</button>
            <button style={btn(false)} onClick={()=>onClose()}>✕</button>
          </div>

          <div style={S.lbl}>название</div>
          <TxtField value={task.title} style={{marginBottom:8,fontWeight:600}}
            onCommit={v=>up("title",v)}/>

          <div style={S.lbl}>содержимое задачи</div>
          <TxtField area value={task.body} placeholder="что именно нужно сделать"
            style={{minHeight:70,marginBottom:8,lineHeight:1.5}}
            onCommit={v=>up("body",v)}/>

          <div style={S.lbl}>цель и гипотеза, на которой она построена</div>
          <div style={{background:C.panel2,border:`1px solid ${C.line}`,borderRadius:8,
            padding:9,margin:"6px 0 8px",fontSize:11.5,lineHeight:1.6}}>
            {goal
              ? <>
                  <div style={{fontSize:12.5,fontWeight:700,color:C.text}}>
                    {goal.l}</div>
                  <div style={{color:C.muted}}>
                    {entityName?entityName(goal.e):""} · нужно {nm(shown(goal,Number(goal.want)))}
                    {" "}{unitOf(goal)}{goal.by!=null?` к ${goal.by}-му месяцу`:""}
                  </div>
                  <div style={{marginTop:5,color:C.muted}}>
                    Гипотеза: {move
                      ? <b style={{color:C.text}}>{moveLabel(move,traits,entities)}
                          {move.carrier?` — ${move.carrier}`:""}, {nm(Math.abs(Number(move.gives)||0))} {target?unitOf(target).split("/")[0]:""} за {move.per}</b>
                      : "движение не выбрано — на чём стоит цель, не сказано"}
                  </div>
                  {move?.note&&<div style={{marginTop:4,color:C.muted}}>{move.note}</div>}
                </>
              : "цель удалена"}
          </div>

          {/* Движение не выбирается: его задаёт то, под чем нажали «+ задача».
              Селект здесь означал бы, что задачу можно переназначить мимо
              цели, под которой она заведена, — и метрика цели разъехалась бы
              с работой по ней. */}
          <div style={S.lbl}>движение, которое выполняет задача</div>
          {move&&target
            ? <div style={{background:C.panel2,border:`1px solid ${C.line}`,
                borderRadius:8,padding:9,margin:"6px 0 8px",fontSize:11.5,lineHeight:1.6}}>
                <div style={{fontSize:12.5,fontWeight:700,color:C.text}}>
                  {moveLabel(move,traits,entities)}
                  {move.carrier?` · ${move.carrier}`:""}</div>
                <div style={{color:C.muted,marginTop:4}}>
                  Гипотетически это движение {Number(move.sign)<0?"уменьшает":"приносит"}
                  {" "}<b style={{color:Number(move.sign)<0?BAD:OK}}>
                    {nm(Math.abs(Number(move.gives)||0))} {unitOf(target).split("/")[0]}
                    {" "}за {move.per}</b> в «{target.l}». Сколько перешло на самом
                  деле — записывается при сдаче, ниже.
                </div>
                <div style={{color:C.muted,marginTop:4}}>
                  Движение задано тем, под чем заведена задача, и здесь не
                  меняется. Что переходит, сколько и как часто, когда
                  начинается и заканчивается — свойства стрелки, во вкладке
                  «Схема».
                </div>
              </div>
            : <div style={{fontSize:11,color:WARN,margin:"6px 0 8px",lineHeight:1.5}}>
                Задача ни к какому движению не привязана — в модели она ничего
                не меняет. Заведите её заново под движением цели.
              </div>}

          <div className="flex flex-wrap gap-2" style={{marginBottom:4}}>
            <div style={{flex:"1 1 150px"}}>
              <div style={S.lbl}>исполнитель</div>
              <select style={S.inp} value={task.assignee||""} disabled={!canAssign}
                onChange={e=>up("assignee",e.target.value||null)}>
                <option value="">— не назначен —</option>
                {people.map(p=>(<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            </div>
            <div style={{flex:"1 1 150px"}}>
              <div style={S.lbl}>проверяющий</div>
              <select style={S.inp} value={task.reviewer||""} disabled={!canAssign}
                onChange={e=>up("reviewer",e.target.value||null)}>
                <option value="">— не назначен —</option>
                {people.map(p=>(<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            </div>
          </div>
          <div style={{fontSize:10.5,color:C.muted,marginBottom:8,lineHeight:1.5}}>
            {canAssign
              ? "Исполнителю задача видна во вкладке «Задачи», проверяющему — во вкладке «Проверка». Больше её не видит никто, кроме владельца."
              : "Кого назначить, решает владелец."}
            {!people.length&&" Пока в модели один человек — добавьте людей через бота."}
          </div>

          <div className="flex flex-wrap gap-2" style={{marginBottom:8}}>
            <div style={{flex:"1 1 130px"}}>
              <div style={S.lbl}>статус</div>
              <select style={S.inp} value={task.status}
                onChange={e=>up("status",e.target.value)}>
                {STATUSES.map(s=>(<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
            </div>
          </div>

          <div style={S.lbl}>предупредить</div>
          <select style={{...S.inp,marginBottom:4}}
            value={task.warn==null?"":String(task.warn)}
            onChange={e=>up("warn",
              e.target.value===""?null:Number(e.target.value))}>
            {WARNS.map(w=>(<option key={String(w.v)} value={w.v==null?"":String(w.v)}>
              {w.name}</option>))}
          </select>
          <div style={{fontSize:10.5,color:C.muted,marginBottom:8,lineHeight:1.5}}>
            Напоминание придёт обычным сообщением от бота. Чтобы оно дошло,
            у бота должен быть начат диалог — откройте его и нажмите «Начать».
          </div>

          <div style={S.lbl}>сдача</div>
          <div style={{background:C.panel2,border:`1px solid ${C.line}`,borderRadius:8,
            padding:9,margin:"6px 0 8px"}}>
            {!subs.length&&<div style={{fontSize:11.5,color:C.muted,marginBottom:8}}>
              Ещё не сдавалась. «Сдать» запишет, сколько ресурса реально
              перешло — это и станет фактом в прогнозе, тогда как гипотеза
              берётся из движения.</div>}
            {subs.map(sb=>(
              <div key={sb.id} style={{background:C.ink,border:`1px solid ${C.line}`,
                borderRadius:6,padding:7,marginBottom:6}}>
                <div className="flex items-center gap-2">
                  <span style={{fontSize:12,fontWeight:600,color:OK,flex:1}}>
                    сдано {nm(sb.amount)} {target?unitOf(target).split("/")[0]:""}</span>
                  <span style={{fontSize:10,color:C.muted}}>{fmtDT(sb.at)}</span>
                  <button style={{...btn(false),padding:"2px 6px"}}
                    onClick={()=>up("submissions",subs.filter(x=>x.id!==sb.id))}>✕</button>
                </div>
                {sb.text&&<div style={{fontSize:11.5,marginTop:4,lineHeight:1.5}}>
                  {sb.text}</div>}
                {sb.file&&<div style={{fontSize:10.5,color:ACC,marginTop:4}}>
                  📎 {sb.file.name} · {Math.round((sb.file.size||0)/1024)} КБ</div>}
              </div>))}

            {!handing
              ? <div className="flex flex-wrap gap-2">
                  <button style={btn(true,OK)} disabled={!move}
                    onClick={()=>{setHanding(true);
                      setDraftAmount(String(Math.abs(Number(move?.gives)||0)));}}>
                    СДАТЬ</button>
                  {!move&&<span style={{fontSize:10.5,color:C.muted}}>
                    сначала выберите движение — сдавать нечего</span>}
                </div>
              : <div>
                  <div className="flex flex-wrap gap-2"
                    style={{alignItems:"center",marginBottom:6}}>
                    <span style={{fontSize:11.5,color:C.muted}}>
                      фактически перешло в «{target?.l||"ресурс"}»</span>
                    <NumField value={draftAmount} placeholder="сколько"
                      style={{flex:"0 1 110px"}}
                      onCommit={v=>setDraftAmount(String(v??0))}/>
                    <span style={{fontSize:11.5,color:C.muted}}>
                      {target?unitOf(target).split("/")[0]:""}</span>
                  </div>
                  <div style={{fontSize:10.5,color:C.muted,marginBottom:6,lineHeight:1.5}}>
                    По движению планировалось {nm(Math.abs(Number(move?.gives)||0))}
                    {" "}{target?unitOf(target).split("/")[0]:""} за {move?.per}.
                    Впишите, сколько перешло на самом деле.
                  </div>
                  <TxtField area value={draftText} placeholder="отчёт текстом"
                    style={{minHeight:56,marginBottom:6,lineHeight:1.5}}
                    onCommit={setDraftText}/>
                  <div className="flex flex-wrap gap-2" style={{alignItems:"center"}}>
                    <label style={{...btn(false),cursor:fileBusy?"default":"pointer",
                      opacity:fileBusy?0.6:1}}>
                      {fileBusy?"Загружаю…":"Загрузить отчёт"}
                      <input type="file" style={{display:"none"}} disabled={fileBusy}
                        onChange={e=>pickFile(e.target.files?.[0])}/>
                    </label>
                    {draftFile&&<span style={{fontSize:10.5,color:ACC}}>
                      📎 {draftFile.name} · {Math.round(draftFile.size/1024)} КБ</span>}
                    {fileErr&&<span style={{fontSize:10.5,color:BAD}}>{fileErr}</span>}
                    <span style={{flex:1}}/>
                    <button style={btn(false)} onClick={()=>{setHanding(false);
                      setDraftFile(null);setFileErr("");}}>Отмена</button>
                    <button style={btn(true,OK)} disabled={fileBusy}
                      onClick={submit}>Сдать</button>
                  </div>
                </div>}
          </div>

          <div style={S.lbl}>комментарии</div>
          <div style={{margin:"6px 0"}}>
            {!(task.comments||[]).length&&
              <div style={{fontSize:11.5,color:C.muted}}>Пока нет.</div>}
            {(task.comments||[]).map(c=>(
              <div key={c.id} style={{background:C.panel2,border:`1px solid ${C.line}`,
                borderRadius:6,padding:7,marginBottom:5}}>
                <div style={{fontSize:12,lineHeight:1.5}}>{c.text}</div>
                <div className="flex items-center gap-2" style={{marginTop:3}}>
                  <span style={{fontSize:10,color:C.muted,flex:1}}>{fmtDT(c.at)}</span>
                  <button style={{...btn(false),padding:"2px 6px"}}
                    onClick={()=>up("comments",
                      task.comments.filter(x=>x.id!==c.id))}>✕</button>
                </div>
              </div>))}
          </div>
          <TxtField value="" placeholder="добавить комментарий и нажать Enter"
            onCommit={v=>addComment(v)}/>
        </div>  );
}

const pctOf=(o,current)=>{
  const span=Number(o.to)-Number(o.from);
  if(!isFinite(span)||span===0) return current>=Number(o.to)?1:0;
  return Math.max(0,Math.min(1,(current-Number(o.from))/span));
};

export default function TasksBoard({goals,okrs,setOkrs,tasks,setTasks,
  traits=[],entities=[],edges=[],okrValue,okrShown,entityName,
  openId:openIdProp,setOpenId:setOpenIdProp,people=[],canAssign=true}){
  // Прогресс считается по модельным числам, показываются — по человеческим.
  const show=okrShown||((o,v)=>Number(v));
  const [ownOpen,setOwnOpen]=useState(null);
  // Открытая задача общая для вкладок «Цели» и «Задачи»: иначе на одной
  // вкладке она открыта, на другой нет, и непонятно, что редактируешь.
  const openId=openIdProp!==undefined?openIdProp:ownOpen;
  const setOpenId=setOpenIdProp||setOwnOpen;
  const [filter,setFilter]=useState("all");
  const [draft,setDraft]=useState("");

  const goalById=useMemo(()=>Object.fromEntries(goals.map(g=>[g.id,g])),[goals]);
  const open=tasks.find(t=>t.id===openId)||null;

  const upT=(id,f,v)=>setTasks(p=>p.map(t=>t.id===id?{...t,[f]:v}:t));
  const delT=(id)=>{setTasks(p=>p.filter(t=>t.id!==id));setOpenId(null);};
  // Задача создаётся и из карточки цели: нажал на цель — получил задачу,
  // уже привязанную к ней, и сразу открытую для заполнения.
  const addTaskFor=(goalId,title)=>{
    const t=newTask({goalId,title:title||"Новая задача"});
    setTasks(p=>[...p,t]); setOpenId(t.id);
    return t;
  };
  const addTask=()=>{
    if(!goals.length) return;
    const goalId=filter!=="all"&&goalById[filter]?filter:goals[0].id;
    addTaskFor(goalId,draft.trim()); setDraft("");
  };
  const addComment=(id,text)=>{
    if(!text.trim()) return;
    upT(id,"comments",[...(tasks.find(t=>t.id===id)?.comments||[]),
      {id:uid("c"),text:text.trim(),at:new Date().toISOString()}]);
  };
  const delOkr=(id)=>{
    setOkrs(p=>p.filter(o=>o.id!==id));
    // Задачи не удаляем: сделанная работа не должна пропадать вместе с
    // ключевым результатом — просто отвязываем.
    setTasks(p=>p.map(t=>t.okrId===id?{...t,okrId:null}:t));
  };
  const moveStatus=(t,dir)=>{
    const i=STATUSES.findIndex(s=>s.id===t.status);
    const next=STATUSES[Math.max(0,Math.min(STATUSES.length-1,i+dir))];
    upT(t.id,"status",next.id);
  };

  const shown=filter==="all"?tasks:tasks.filter(t=>t.goalId===filter);
  // Цель для задачи по движению: та, чей ресурс это движение наполняет, —
  // иначе первая, чтобы задача не осталась без цели.
  const goalOf=(ed)=>goals.find(g=>g.id===ed.to)?.id||goals[0]?.id;

  return (
    <div>
      {/* Сначала доска: на неё смотрят каждый день, а форму добавления
          открывают изредка — поэтому она ниже, а не перед доской. */}
      <div style={{...S.card,marginBottom:10}}>
        <div className="flex flex-wrap gap-2" style={{alignItems:"center"}}>
          <span style={S.lbl}>доска задач</span>
          <span style={{flex:1}}/>
          <button style={btn(filter==="all")} onClick={()=>setFilter("all")}>
            все цели</button>
          {goals.map(g=>(<button key={g.id} style={btn(filter===g.id)}
            onClick={()=>setFilter(g.id)}>{g.l}</button>))}
        </div>
      </div>

{/* Колонки прокручиваются вбок: на телефоне четыре столбца рядом не влезают. */}
      <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch",paddingBottom:6}}>
        <div className="flex gap-2" style={{minWidth:4*248}}>
          {STATUSES.map(s=>{
            const col=shown.filter(t=>t.status===s.id);
            return (
              <div key={s.id} style={{flex:"1 1 240px",minWidth:240,
                background:C.panel,border:`1px solid ${C.line}`,borderRadius:10,padding:8}}>
                <div className="flex items-center gap-2" style={{marginBottom:8}}>
                  <span style={{width:8,height:8,borderRadius:2,background:s.color}}/>
                  <span style={{fontSize:12.5,fontWeight:700,flex:1}}>{s.name}</span>
                  <span style={{fontSize:11,color:C.muted}}>{col.length}</span>
                </div>
                {!col.length&&<div style={{fontSize:11,color:C.muted,padding:"6px 2px"}}>
                  Пусто.</div>}
                {col.map(t=>{
                  const g=goalById[t.goalId];
                  return (
                    <div key={t.id} style={{background:C.panel2,
                      border:`1px solid ${t.id===openId?ACC:C.line}`,borderRadius:8,
                      padding:8,marginBottom:6}}>
                      <div onClick={()=>setOpenId(t.id===openId?null:t.id)}
                        style={{cursor:"pointer"}}>
                        <div style={{fontSize:12.5,fontWeight:600,lineHeight:1.4}}>
                          {t.title}</div>
                        <div style={{fontSize:10.5,color:g?ACC:BAD,marginTop:3}}>
                          {g?g.l:"цель удалена"}</div>
                        <div style={{fontSize:10.5,color:C.muted,marginTop:3}}>
                          {fmtDT(t.start)}
                          {t.repeat!=="once"&&` · ${REPEATS.find(r=>r.id===t.repeat)?.name}`}
                          {(t.comments||[]).length?` · ${t.comments.length} комм.`:""}
                        </div>
                      </div>
                      <div className="flex gap-2" style={{marginTop:6}}>
                        <button style={{...btn(false),padding:"2px 8px"}}
                          disabled={s.id===STATUSES[0].id}
                          onClick={()=>moveStatus(t,-1)}>‹</button>
                        <button style={{...btn(false),padding:"2px 8px"}}
                          disabled={s.id===STATUSES[STATUSES.length-1].id}
                          onClick={()=>moveStatus(t,1)}>›</button>
                      </div>
                    </div>);})}
              </div>);})}
        </div>
      </div>

{open&&<TaskEditor task={open} goals={goals} traits={traits} entities={entities} edges={edges}
        entityName={entityName} people={people} canAssign={canAssign}
        setTasks={setTasks} onClose={()=>setOpenId(null)} onDelete={()=>delT(open.id)}/>}

      {/* ─── Добавление задач: под доской ─── */}
      <div style={{...S.card,marginTop:10,marginBottom:10}}>
        <div style={S.lbl}>завести задачу</div>
        <div style={{fontSize:11.5,color:C.muted,margin:"6px 0 8px",lineHeight:1.6}}>
          Движение само по себе не происходит — его кто-то делает. Задача
          заводится под движением: какое именно она выполняет, решает то, под
          чем нажата кнопка, а не выбор в самой задаче.
        </div>
        {goals.map(g=>{
          const moves=edges.filter(e=>e.to===g.id);
          return (
          <div key={g.id} style={{background:C.panel2,border:`1px solid ${C.line}`,
            borderRadius:8,padding:8,marginBottom:6}}>
            <div style={{fontSize:12.5,fontWeight:700,marginBottom:2}}>{g.l}</div>
            <div style={{fontSize:10.5,color:C.muted,marginBottom:6}}>
              {entityName(g.e)}{g.by!=null?` · к ${g.by}-му мес.`:""}</div>
            {!moves.length&&<div style={{fontSize:11,color:WARN,lineHeight:1.5}}>
              В эту цель не входит ни одного движения — задаче нечего
              выполнять. Нарисуйте стрелку на схеме или составьте гипотезу.</div>}
            {moves.map(ed=>{
              const mine=tasks.filter(t=>t.edgeId===ed.id);
              return (
              <div key={ed.id} className="flex flex-wrap gap-2"
                style={{alignItems:"center",padding:"5px 0",
                  borderTop:`1px solid ${C.line}`}}>
                <span style={{fontSize:12,flex:"1 1 150px"}}>
                  {ed.carrier||moveLabel(ed,traits,entities)}
                  <span style={{color:C.muted}}> · {nm(Math.abs(Number(ed.gives)||0))}
                    {" "}за {ed.per}
                    {Number(ed.threads)>1?` · ${ed.threads} потока`:""}</span>
                </span>
                <span style={{fontSize:10.5,color:mine.length?OK:C.muted}}>
                  задач: {mine.length}</span>
                <button style={btn(true)} title="Задача на это движение"
                  onClick={()=>{
                    const t=newTask({goalId:g.id,edgeId:ed.id,
                      title:ed.carrier||moveLabel(ed,traits,entities)});
                    // Потоки — это столько же копий задачи в списке: одна
                    // задача на поток, иначе «в три потока» осталось бы
                    // числом в параметрах и никак не отразилось на работе.
                    const n=Math.max(1,Math.round(Number(ed.threads)||1));
                    const copies=n<=1?[t]:Array.from({length:n},(_,i)=>
                      ({...newTask({goalId:g.id,edgeId:ed.id,
                        title:`${ed.carrier||moveLabel(ed,traits,entities)} · поток ${i+1}`})}));
                    setTasks(p=>[...p,...copies]); setOpenId(copies[0].id);
                  }}>+ задача{Number(ed.threads)>1?` ×${ed.threads}`:""}</button>
              </div>);})}
          </div>);})}

        <div className="flex flex-wrap gap-2" style={{alignItems:"center",marginTop:8}}>
          <TxtField value={draft} placeholder="название задачи без движения"
            style={{flex:"2 1 180px"}} onCommit={setDraft}/>
          <button style={btn(false)} disabled={!goals.length} onClick={addTask}>
            + задача без движения</button>
        </div>
        <div style={{fontSize:10.5,color:C.muted,marginTop:5,lineHeight:1.5}}>
          Такая задача ничего не двигает в модели — она просто напоминание.
        </div>
        {!goals.length&&<div style={{fontSize:11.5,color:C.muted,marginTop:6,
          lineHeight:1.6}}>
          Целей пока нет. Поставьте цель во вкладке «Прогноз» — задачи всегда
          принадлежат какой-либо цели.</div>}
      </div>
    </div>);
}
