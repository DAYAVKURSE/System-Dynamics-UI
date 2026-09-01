import React, { useMemo, useState } from "react";
import { C, OK, WARN, BAD, NEU, ACC, S, btn, nm, NumField, TxtField } from "./ui.jsx";
import { PER, unitOf } from "../lib/sim.js";

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

export function newTask({goalId,okrId=null,title="Новая задача",body=""}){
  return {id:uid("tk"),goalId,okrId,title,body,status:"backlog",
    start:nowLocal(),end:"",repeat:"once",days:[],time:"",warn:10,
    effects:[],comments:[]};
}

// Метрика задачи: что она тратит и что приносит, и с какой периодичностью.
export const newEffect=(dir="spend")=>
  ({id:uid("ef"),dir,trait:"",amount:0,per:"мес",basis:"hypo"});
export const EFFECT_DIRS=[
  {id:"spend",name:"тратит",sign:-1,color:BAD},
  {id:"gain",name:"приносит",sign:1,color:OK},
];

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
export function GoalWork({g,okrs,setOkrs,tasks,setTasks,traits=[],entities=[],
  okrValue,okrShown,entityName,openId,setOpenId}){
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
  const addTask=()=>{
    const t=newTask({goalId:g.id});
    setTasks(p=>[...p,t]); setOpenId(t.id);
  };
  return (

          <div key={g.id} style={{...S.card,marginBottom:8}}>
            <div className="flex items-center gap-2" style={{marginBottom:2}}>
              <span style={{fontSize:13.5,fontWeight:700,flex:1}}>{g.l}</span>
              <span style={{fontSize:11,color:C.muted}}>
                задач: {done}/{gt.length}</span>
              <button style={btn(true)} title="Создать задачу к этой цели"
                onClick={addTask}>+ задача</button>
            </div>
            <div style={{fontSize:11,color:C.muted,marginBottom:8}}>
              {entityName(g.e)} · нужно {nm(Number(g.want))} {g.unit}
              {g.by!=null?` к ${g.by}-му мес.`:""}</div>

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
                  {(t.effects||[]).length>0&&(
                    <div style={{fontSize:10.5,color:C.muted,marginTop:4,lineHeight:1.5}}>
                      {(t.effects||[]).map((ef,ei)=>{
                        const tr=traits.find(x=>x.id===ef.trait);
                        const d=EFFECT_DIRS.find(x=>x.id===ef.dir)||EFFECT_DIRS[0];
                        return (<span key={ef.id||ei} style={{color:d.color}}>
                          {ei?" · ":""}{d.name} {nm(Math.abs(Number(ef.amount)||0))}
                          {" "}{tr?unitOf(tr).split("/")[0]:"?"}/{ef.per||"мес"}
                        </span>);})}
                    </div>)}
                  {/* Редактор открывается здесь же, под своей целью, а не
                      уезжает вниз страницы: иначе после нажатия «+ задача»
                      непонятно, куда смотреть. */}
                  {on&&<div style={{marginTop:8}}>
                    <TaskEditor task={t} goals={[g]} traits={traits}
                      entities={entities} setTasks={setTasks}
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
export function TaskEditor({task,goals,traits=[],entities=[],setTasks,onClose,onDelete}){
  const up=(f,v)=>setTasks(p=>p.map(t=>t.id===task.id?{...t,[f]:v}:t));
  const addComment=(text)=>{
    if(!text.trim()) return;
    up("comments",[...(task.comments||[]),
      {id:uid("c"),text:text.trim(),at:new Date().toISOString()}]);
  };
  const effects=task.effects||[];
  const addEffect=(dir)=>up("effects",[...effects,newEffect(dir)]);
  const upEffect=(i,f,v)=>up("effects",effects.map((e,ei)=>ei===i?{...e,[f]:v}:e));
  const delEffect=(i)=>up("effects",effects.filter((_,ei)=>ei!==i));
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

          <div className="flex flex-wrap gap-2" style={{marginBottom:8}}>
            <div style={{flex:"2 1 180px"}}>
              <div style={S.lbl}>цель</div>
              <select style={S.inp} value={task.goalId}
                onChange={e=>up("goalId",e.target.value)}>
                {goals.map(g=>(<option key={g.id} value={g.id}>{g.l}</option>))}
                {!goals.some(g=>g.id===task.goalId)&&
                  <option value={task.goalId}>цель удалена</option>}
              </select>
            </div>
            <div style={{flex:"1 1 130px"}}>
              <div style={S.lbl}>статус</div>
              <select style={S.inp} value={task.status}
                onChange={e=>up("status",e.target.value)}>
                {STATUSES.map(s=>(<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2" style={{marginBottom:8}}>
            <div style={{flex:"1 1 190px"}}>
              <div style={S.lbl}>дата и время начала</div>
              <div className="flex gap-2" style={{alignItems:"center"}}>
                <input type="datetime-local" style={{...S.inp,flex:1}}
                  value={task.start||""}
                  onChange={e=>up("start",e.target.value)}/>
                <button style={btn(false)}
                  onClick={()=>up("start",nowLocal())}>Сейчас</button>
              </div>
            </div>
            <div style={{flex:"1 1 190px"}}>
              <div style={S.lbl}>дата и время конца</div>
              <input type="datetime-local" style={S.inp} value={task.end||""}
                onChange={e=>up("end",e.target.value)}/>
            </div>
          </div>

          <div style={S.lbl}>периодичность</div>
          <select style={{...S.inp,marginBottom:8}} value={task.repeat}
            onChange={e=>up("repeat",e.target.value)}>
            {REPEATS.map(r=>(<option key={r.id} value={r.id}>{r.name}</option>))}
          </select>

          {/* Дни повтора нужны только при «в определённые дни». */}
          {task.repeat==="weekly"&&(<>
            <div style={S.lbl}>дни повтора</div>
            <div className="flex flex-wrap gap-2" style={{margin:"6px 0 8px"}}>
              {DAYS.map((d,i)=>{
                const on=(task.days||[]).includes(i);
                return (<button key={d} style={btn(on)}
                  onClick={()=>up("days",on
                    ?(task.days||[]).filter(x=>x!==i)
                    :[...(task.days||[]),i].sort((a,b)=>a-b))}>{d}</button>);})}
            </div>
          </>)}

          {/* Время повтора не имеет смысла для разовой задачи. */}
          {task.repeat!=="once"&&(<>
            <div style={S.lbl}>время повтора</div>
            <input type="time" style={{...S.inp,marginBottom:8}} value={task.time||""}
              onChange={e=>up("time",e.target.value)}/>
          </>)}

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

          <div style={S.lbl}>метрика — что задача тратит и что приносит</div>
          <div style={{fontSize:10.5,color:C.muted,margin:"4px 0 6px",lineHeight:1.5}}>
            Это движение в модели: каждая строка — стрелка к ресурсу, она
            видна на схеме и участвует в прогнозе. Часы не превращаются в
            рубли: «тратит 2 ч/день» и «приносит 5000 ₽/мес» — две разные
            строки. Метрика перестаёт считаться, когда задача в статусе
            «Готово».
          </div>
          <div style={{marginBottom:8}}>
            {!(task.effects||[]).length&&<div style={{fontSize:11.5,color:C.muted,
              marginBottom:6}}>Пока ничего не тратит и не приносит.</div>}
            {(task.effects||[]).map((ef,i)=>{
              const t=traits.find(x=>x.id===ef.trait);
              const dir=EFFECT_DIRS.find(d=>d.id===ef.dir)||EFFECT_DIRS[0];
              return (
              <div key={ef.id||i} style={{background:C.panel2,
                border:`1px solid ${C.line}`,borderRadius:6,padding:8,marginBottom:6}}>
                <div className="flex flex-wrap gap-2" style={{alignItems:"center"}}>
                  {EFFECT_DIRS.map(d=>(
                    <button key={d.id} style={btn(ef.dir===d.id,d.color)}
                      onClick={()=>upEffect(i,"dir",d.id)}>{d.name}</button>))}
                  <NumField value={ef.amount} style={{flex:"0 1 92px"}}
                    onCommit={v=>upEffect(i,"amount",v??0)}/>
                  <span style={{fontSize:11.5,color:C.muted}}>
                    {t?unitOf(t).split("/")[0]:"ед."} за</span>
                  <select style={{...S.inp,flex:"0 1 96px"}} value={ef.per||"мес"}
                    onChange={e=>upEffect(i,"per",e.target.value)}>
                    {Object.keys(PER).map(pp=>(
                      <option key={pp} value={pp}>{pp}</option>))}
                  </select>
                  <button style={{...btn(false),padding:"3px 7px"}}
                    onClick={()=>delEffect(i)}>✕</button>
                </div>
                <select style={{...S.inp,marginTop:6}} value={ef.trait||""}
                  onChange={e=>upEffect(i,"trait",e.target.value)}>
                  <option value="">— какой ресурс —</option>
                  {entities.map(en=>(
                    <optgroup key={en.id} label={en.name}>
                      {traits.filter(x=>x.e===en.id).map(x=>(
                        <option key={x.id} value={x.id}>{x.l}</option>))}
                    </optgroup>))}
                </select>
                <div className="flex flex-wrap gap-2"
                  style={{alignItems:"center",marginTop:6}}>
                  <button style={btn(true,ef.basis==="fact"?OK:WARN)}
                    onClick={()=>upEffect(i,"basis",ef.basis==="fact"?"hypo":"fact")}>
                    {ef.basis==="fact"?"◆ факт":"◇ гипотеза"}</button>
                  <span style={{fontSize:10.5,color:C.muted,flex:1}}>
                    {t
                      ?`${dir.name} ${nm(Math.abs(Number(ef.amount)||0))} ${unitOf(t).split("/")[0]} за ${ef.per||"мес"} — ресурс «${t.l}»`
                      :"выберите ресурс, иначе строка не считается"}
                  </span>
                </div>
              </div>);})}
            <div className="flex flex-wrap gap-2">
              <button style={btn(false)} onClick={()=>addEffect("spend")}>
                + тратит</button>
              <button style={btn(false)} onClick={()=>addEffect("gain")}>
                + приносит</button>
            </div>
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
  traits=[],entities=[],okrValue,okrShown,entityName}){
  // Прогресс считается по модельным числам, показываются — по человеческим.
  const show=okrShown||((o,v)=>Number(v));
  const [openId,setOpenId]=useState(null);
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

  return (
    <div>
      {/* ─── Доска ─── */}
      <div style={{...S.card,marginBottom:10}}>
        <div style={S.lbl}>доска задач</div>
        {!goals.length&&<div style={{fontSize:11.5,color:C.muted,marginTop:6,
          lineHeight:1.6}}>
          Целей пока нет. Поставьте цель во вкладке «Цели» — задачи всегда
          принадлежат какой-либо цели.</div>}
        <div className="flex flex-wrap gap-2" style={{margin:"6px 0 8px"}}>
          <button style={btn(filter==="all")} onClick={()=>setFilter("all")}>
            все цели</button>
          {goals.map(g=>(<button key={g.id} style={btn(filter===g.id)}
            onClick={()=>setFilter(g.id)}>{g.l}</button>))}
        </div>
        <div className="flex flex-wrap gap-2" style={{alignItems:"center"}}>
          <TxtField value={draft} placeholder="название новой задачи"
            style={{flex:"2 1 180px"}} onCommit={setDraft}/>
          <button style={btn(true)} disabled={!goals.length} onClick={addTask}>
            + задача</button>
        </div>
      </div>

      {open&&<TaskEditor task={open} goals={goals} traits={traits} entities={entities}
        setTasks={setTasks} onClose={()=>setOpenId(null)} onDelete={()=>delT(open.id)}/>}

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
    </div>);
}
