import React, { useMemo, useState } from "react";
import { C, OK, WARN, BAD, NEU, ACC, S, btn, nm, TxtField } from "./ui.jsx";

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
    start:nowLocal(),end:"",repeat:"once",days:[],time:"",warn:10,comments:[]};
}

// Ключевой результат из рекомендации вкладки «Цели».
export function okrFromRec(goalId,r){
  return {id:uid("kr"),goalId,type:r.type,
    refId:r.type==="seed"?r.tid:r.eid,
    label:r.label,from:Number(r.from)||0,to:Number(r.to)||0,
    unit:r.unit||"",per:r.per||null,month:r.month??null,createdAt:new Date().toISOString()};
}

const pctOf=(o,current)=>{
  const span=Number(o.to)-Number(o.from);
  if(!isFinite(span)||span===0) return current>=Number(o.to)?1:0;
  return Math.max(0,Math.min(1,(current-Number(o.from))/span));
};

export default function TasksBoard({goals,okrs,setOkrs,tasks,setTasks,
  okrValue,entityName}){
  const [openId,setOpenId]=useState(null);
  const [filter,setFilter]=useState("all");
  const [draft,setDraft]=useState("");

  const goalById=useMemo(()=>Object.fromEntries(goals.map(g=>[g.id,g])),[goals]);
  const open=tasks.find(t=>t.id===openId)||null;

  const upT=(id,f,v)=>setTasks(p=>p.map(t=>t.id===id?{...t,[f]:v}:t));
  const delT=(id)=>{setTasks(p=>p.filter(t=>t.id!==id));setOpenId(null);};
  const addTask=()=>{
    if(!goals.length) return;
    const goalId=filter!=="all"&&goalById[filter]?filter:goals[0].id;
    const t=newTask({goalId,title:draft.trim()||"Новая задача"});
    setTasks(p=>[...p,t]); setDraft(""); setOpenId(t.id);
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
      {/* ─── OKR: цели и их ключевые результаты ─── */}
      <div style={{...S.card,marginBottom:10}}>
        <div style={S.lbl}>цели и ключевые результаты</div>
        <div style={{fontSize:11.5,color:C.muted,marginTop:6,lineHeight:1.6}}>
          Цель модели — это Objective. Рекомендация, взятая в работу во вкладке
          «Цели», становится ключевым результатом: его прогресс считается по
          фактическому значению рычага в модели, а не отмечается вручную.
        </div>
      </div>

      {!goals.length&&<div style={{...S.card,marginBottom:10,color:C.muted,fontSize:12.5}}>
        Целей пока нет. Поставьте цель во вкладке «Цели» — задачи всегда
        принадлежат какой-либо цели.</div>}

      {goals.map(g=>{
        const krs=okrs.filter(o=>o.goalId===g.id);
        const gt=tasks.filter(t=>t.goalId===g.id);
        const done=gt.filter(t=>t.status==="done").length;
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
                    {nm(o.from)} → <b style={{color:C.text}}>{nm(o.to)}</b> {o.unit}
                    {o.per?` за ${o.per}`:""} · сейчас {nm(cur)}
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
          </div>);})}

      {/* ─── Доска ─── */}
      <div style={{...S.card,marginBottom:10}}>
        <div style={S.lbl}>доска задач</div>
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

      {open&&(
        <div style={{...S.card,marginBottom:10,borderColor:ACC}}>
          <div className="flex items-center gap-2" style={{marginBottom:8}}>
            <span style={S.lbl}>задача</span>
            <span style={{flex:1}}/>
            <button style={{...btn(false),color:BAD,borderColor:"#5A2436"}}
              onClick={()=>delT(open.id)}>Удалить</button>
            <button style={btn(false)} onClick={()=>setOpenId(null)}>✕</button>
          </div>

          <div style={S.lbl}>название</div>
          <TxtField value={open.title} style={{marginBottom:8,fontWeight:600}}
            onCommit={v=>upT(open.id,"title",v)}/>

          <div style={S.lbl}>содержимое задачи</div>
          <TxtField area value={open.body} placeholder="что именно нужно сделать"
            style={{minHeight:70,marginBottom:8,lineHeight:1.5}}
            onCommit={v=>upT(open.id,"body",v)}/>

          <div className="flex flex-wrap gap-2" style={{marginBottom:8}}>
            <div style={{flex:"2 1 180px"}}>
              <div style={S.lbl}>цель</div>
              <select style={S.inp} value={open.goalId}
                onChange={e=>upT(open.id,"goalId",e.target.value)}>
                {goals.map(g=>(<option key={g.id} value={g.id}>{g.l}</option>))}
                {!goalById[open.goalId]&&
                  <option value={open.goalId}>цель удалена</option>}
              </select>
            </div>
            <div style={{flex:"1 1 130px"}}>
              <div style={S.lbl}>статус</div>
              <select style={S.inp} value={open.status}
                onChange={e=>upT(open.id,"status",e.target.value)}>
                {STATUSES.map(s=>(<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2" style={{marginBottom:8}}>
            <div style={{flex:"1 1 190px"}}>
              <div style={S.lbl}>дата и время начала</div>
              <div className="flex gap-2" style={{alignItems:"center"}}>
                <input type="datetime-local" style={{...S.inp,flex:1}}
                  value={open.start||""}
                  onChange={e=>upT(open.id,"start",e.target.value)}/>
                <button style={btn(false)}
                  onClick={()=>upT(open.id,"start",nowLocal())}>Сейчас</button>
              </div>
            </div>
            <div style={{flex:"1 1 190px"}}>
              <div style={S.lbl}>дата и время конца</div>
              <input type="datetime-local" style={S.inp} value={open.end||""}
                onChange={e=>upT(open.id,"end",e.target.value)}/>
            </div>
          </div>

          <div style={S.lbl}>периодичность</div>
          <select style={{...S.inp,marginBottom:8}} value={open.repeat}
            onChange={e=>upT(open.id,"repeat",e.target.value)}>
            {REPEATS.map(r=>(<option key={r.id} value={r.id}>{r.name}</option>))}
          </select>

          {/* Дни повтора нужны только при «в определённые дни». */}
          {open.repeat==="weekly"&&(<>
            <div style={S.lbl}>дни повтора</div>
            <div className="flex flex-wrap gap-2" style={{margin:"6px 0 8px"}}>
              {DAYS.map((d,i)=>{
                const on=(open.days||[]).includes(i);
                return (<button key={d} style={btn(on)}
                  onClick={()=>upT(open.id,"days",on
                    ?(open.days||[]).filter(x=>x!==i)
                    :[...(open.days||[]),i].sort((a,b)=>a-b))}>{d}</button>);})}
            </div>
          </>)}

          {/* Время повтора не имеет смысла для разовой задачи. */}
          {open.repeat!=="once"&&(<>
            <div style={S.lbl}>время повтора</div>
            <input type="time" style={{...S.inp,marginBottom:8}} value={open.time||""}
              onChange={e=>upT(open.id,"time",e.target.value)}/>
          </>)}

          <div style={S.lbl}>предупредить</div>
          <select style={{...S.inp,marginBottom:4}}
            value={open.warn==null?"":String(open.warn)}
            onChange={e=>upT(open.id,"warn",
              e.target.value===""?null:Number(e.target.value))}>
            {WARNS.map(w=>(<option key={String(w.v)} value={w.v==null?"":String(w.v)}>
              {w.name}</option>))}
          </select>
          <div style={{fontSize:10.5,color:C.muted,marginBottom:8,lineHeight:1.5}}>
            Напоминание придёт обычным сообщением от бота. Чтобы оно дошло,
            у бота должен быть начат диалог — откройте его и нажмите «Начать».
          </div>

          <div style={S.lbl}>комментарии</div>
          <div style={{margin:"6px 0"}}>
            {!(open.comments||[]).length&&
              <div style={{fontSize:11.5,color:C.muted}}>Пока нет.</div>}
            {(open.comments||[]).map(c=>(
              <div key={c.id} style={{background:C.panel2,border:`1px solid ${C.line}`,
                borderRadius:6,padding:7,marginBottom:5}}>
                <div style={{fontSize:12,lineHeight:1.5}}>{c.text}</div>
                <div className="flex items-center gap-2" style={{marginTop:3}}>
                  <span style={{fontSize:10,color:C.muted,flex:1}}>{fmtDT(c.at)}</span>
                  <button style={{...btn(false),padding:"2px 6px"}}
                    onClick={()=>upT(open.id,"comments",
                      open.comments.filter(x=>x.id!==c.id))}>✕</button>
                </div>
              </div>))}
          </div>
          <TxtField value="" placeholder="добавить комментарий и нажать Enter"
            onCommit={v=>addComment(open.id,v)}/>
        </div>)}

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
