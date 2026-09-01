import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { detectStorage, STORAGE_LABEL, listScenarios, getScenario, saveScenario,
  deleteScenario, syncSchedule } from "../storage.js";
import { C, OK, WARN, BAD, NEU, ACC, S, btn, nm, NumField, TxtField } from "./ui.jsx";
import { evaluate, toDisplay, toStorage, refsOf, splitComparison } from "../lib/expr.js";
import { PER, isFlow, perOf, shown, stored, unitOf, normalizeTraits, Cond,
  condSides, condRefs, condKind, condK, asGate, asRatio, edgeK, sourceTrait,
  simulate, resolveStep, scheduleOf, lastSubmission, reachMonth, isFact,
  factEdges, frac, depsOf,
  adviseFor } from "../lib/sim.js";
import TasksBoard, { GoalWork, newTask, nowLocal, okrFromRec } from "./TasksBoard.jsx";
import ReportsGantt from "./ReportsGantt.jsx";
import { useHistory, sameDoc } from "../lib/history.js";
import { readDraft, saveDraft, clearDraft } from "../lib/draft.js";

/* ════════════════════════════════════════════════════════════════
   СХЕМА ЖИЗНЕСПОСОБНОСТИ · v8
   Поля с локальным черновиком: значение уходит в модель по расфокусу
   или по Enter, поэтому пересчёт не дёргает ввод.
   ════════════════════════════════════════════════════════════════ */

// Классификации ресурсов. Это только начальный набор: список редактируется
// во вкладке «Типы», живёт в состоянии и сохраняется вместе с моделью.
// dir — в какую сторону изменение считается хорошим: "up" рост это хорошо,
// "down" хорошо, когда величина падает (затраты, разрушение).
const KINDS0=[
  {id:"growth",sign:"↑",name:"рост",color:"#3DDC97",dir:"up"},
  {id:"res",sign:"◆",name:"производимый ресурс",color:"#4EA8FF",dir:"up"},
  {id:"cost",sign:"−",name:"затраты",color:"#FFB13D",dir:"down"},
  {id:"destroy",sign:"↓",name:"разрушение",color:"#FF5C7A",dir:"down"},
  {id:"repro",sign:"∞",name:"воспроизводимость",color:"#C792EA",dir:"up"},
  {id:"payback",sign:"₽",name:"окупаемость",color:"#FFD166",dir:"up"},
];
// Ресурс может ссылаться на классификацию, которой больше нет (например, в
// сценарии, сохранённом до её удаления) — показываем заглушку, а не падаем.
const NOKIND={id:"",sign:"?",name:"без типа",color:NEU,dir:"up"};
const kindLookup=(kinds)=>(id)=>kinds.find(k=>k.id===id)||NOKIND;
const NW=208,NH=112;

/* ─────── ДАННЫЕ ─────── */
const ENTITIES0=[
  {id:"ref",name:"Реферальная система",color:"#C792EA",x:24,y:24},
  {id:"usr",name:"Пользователи",color:"#7CE0FF",x:398,y:24},
  {id:"mkt",name:"Рынок услуг",color:"#FFD166",x:772,y:24},
  {id:"vm",name:"Виртуальный менеджер",color:"#3DDC97",x:24,y:300},
  {id:"bt",name:"BlockTree",color:"#FF9E64",x:398,y:300},
  {id:"dec",name:"Система принятия решений",color:"#FF5C7A",x:772,y:300},
  {id:"set",name:"Настройки и функционал",color:"#8B9DFF",x:398,y:576},
];
const T=(id,e,k,l,unit,have,want,by)=>
  ({id,e,k,l,unit,have:have??null,want:want??null,by:by??null});
const TRAITS0=normalizeTraits([
  T("u9","usr","res","активные пользователи","чел./мес",null,10,6),
  T("u1","usr","growth","получение рекомендаций","реком./мес"),
  T("u2","usr","growth","автоматизация своих задач","задач/мес"),
  T("u3","usr","growth","получение прибыли","₽/мес"),
  T("u4","usr","res","деньги с продаж","₽/мес"),
  T("u5","usr","res","реклама другим пользователям","реком./мес"),
  T("u6","usr","res","услуги, выкладываемые и выполняемые на рынке","услуг"),
  T("u7","usr","cost","трудозатраты","ч/мес"),
  T("u8","usr","destroy","несоответствие ожиданиям","случаев/мес"),
  T("u10","usr","repro","новых пользователей с одного за цикл","коэф."),
  T("u11","usr","payback","₽ дохода на 1 час своего труда","₽/ч"),
  T("r5","ref","res","активные реферы","чел."),
  T("r1","ref","growth","оптимизация условий и рост базы","правок/квартал"),
  T("r2","ref","res","новые пользователи","чел./мес"),
  T("r3","ref","cost","трудозатраты на корректировку и поддержание","ч/мес"),
  T("r4","ref","destroy","неэффективность","впустую приведённых/мес"),
  T("r6","ref","repro","новых реферов с одного рефера за цикл","коэф."),
  T("r7","ref","payback","₽ оборота на 1 ₽ выплаты реферу","₽"),
  T("m1","mkt","growth","увеличение спроса","заказов/мес"),
  T("m2","mkt","res","способ заработка","₽/мес"),
  T("m3","mkt","res","пополнение рынка услуг","услуг/мес"),
  T("m4","mkt","cost","трудозатраты на поддержание","ч/мес"),
  T("m5","mkt","destroy","уменьшение спроса","ушедших/мес"),
  T("m6","mkt","repro","новых услуг на одну существующую за цикл","коэф."),
  T("m7","mkt","payback","₽ оборота на 1 час выкладки","₽/ч"),
  T("v1","vm","growth","развитие базы знаний","кейсов/мес"),
  T("v2","vm","growth","улучшение модели","оценок/мес"),
  T("v3","vm","res","автоматизация задач и работы","задач/мес"),
  T("v4","vm","cost","ИИ-токены (платит пользователь)","$/мес"),
  T("v5","vm","destroy","неэффективность","неверных инструкций/мес"),
  T("v6","vm","repro","доля задач без нового обучения","коэф."),
  T("v7","vm","payback","₽ сэкономленного времени на $1 токенов","₽"),
  T("b1","bt","growth","взаимодействие с пользователями","действий/мес"),
  T("b2","bt","growth","взаимодействие с агентами","вызовов/мес"),
  T("b3","bt","res","память","записей"),
  T("b4","bt","res","опыт","решённых кейсов"),
  T("b5","bt","res","контроль","отслеживаемых задач"),
  T("b6","bt","cost","трудозатраты на обновления","ч/мес"),
  T("b7","bt","destroy","неэффективность","ошибок структуры/мес"),
  T("b8","bt","repro","доля решений из памяти без переспроса","коэф."),
  T("b9","bt","payback","часов сэкономлено на 1 час обновления","ч"),
  T("d1","dec","growth","опыт, знания, намерения","разборов/мес"),
  T("d2","dec","res","оптимизация механик","механик/квартал"),
  T("d3","dec","res","процент от сделок","₽/мес"),
  T("d4","dec","cost","трудозатраты","ч/мес"),
  T("d5","dec","destroy","неверно подобранные механики","шт./квартал"),
  T("d6","dec","destroy","не решённые задачи","шт. в очереди"),
  T("d7","dec","destroy","плохой анализ","выводов без данных/мес"),
  T("d8","dec","repro","доля решений по регламенту без тебя","коэф."),
  T("d9","dec","payback","₽ комиссии на 1 час разбора","₽/ч"),
  T("s1","set","growth","обновления","релизов/мес"),
  T("s2","set","res","удобство","принятых обращений/мес"),
  T("s3","set","cost","трудозатраты на разработку","ч/мес"),
  T("s4","set","destroy","неиспользование","% неоткрытых функций"),
  T("s5","set","repro","доля функций, понятных без объяснений","коэф."),
  T("s6","set","payback","часов пользователям на 1 час разработки","ч"),
]);

const E=(id,from,to,carrier,gives,per,sign,conds,note,basis)=>
  ({id,from,to,carrier,gives,per,sign,conds:conds||[],note,basis:basis||"hypo"});
const EDGES0=[
  E("e28","ref","u9","приведённые активные пользователи",20,"мес",1,
    [Cond("r5","min",5),Cond("u9","max",7000000000)],
    "10 реферов при пороге 5 приводят 20 активных пользователей за месяц. "+
    "Второе условие — насыщение: если у платформы уже 7 млрд активных пользователей, "+
    "реферы почти перестают приводить новых."),
  E("e27","usr","r5","пользователи, становящиеся реферами",10,"мес",1,
    [Cond("u9","min",20)],
    "Из 20 активных пользователей половина соглашается быть рефером."),
  E("e13","ref","u1","персональные рекомендации от рефера",24,"мес",1,
    [Cond("r5","min",10)],
    "Рефер раздаёт рекомендации, только если он есть."),
  E("e14","ref","u3","выплата реферу, % от сделок приведённых",900,"мес",1,
    [Cond("r5","min",10)],
    "5% с оборота приведённых — это готовый расчёт, а не предположение.","fact"),
  E("e1","usr","r2","регистрации по реферальной ссылке",4,"мес",1,
    [Cond("u9","min",10)],
    "Есть кому пересылать ссылку — есть регистрации."),
  E("e2","usr","m1","заказы услуг",6,"мес",1,[Cond("u9","min",8)],"Спрос — оформленные заказы."),
  E("e3","usr","m2","выручка исполнителей",18000,"мес",1,[Cond("u6","min",6)],
    "Заработок появляется, когда на рынке есть что покупать."),
  E("e4","usr","m4","часы на разработку и выкладку услуг",16,"мес",1,[],
    "Рынок держится на труде пользователей."),
  E("e5","usr","m5","ушедшие заказчики",2,"мес",1,[],"Отток бьёт по спросу."),
  E("e6","usr","u7","свои часы на постановку задач",6,"мес",1,[],"Расход пользователя."),
  E("e7","usr","v1","описанные кейсы и правки",8,"мес",1,[Cond("u9","min",10)],
    "База знаний растёт с описанных случаев."),
  E("e8","usr","v2","оценки и исправления ответов",36,"мес",1,[Cond("u9","min",10)],
    "Три оценки с пользователя в месяц."),
  E("e9","usr","v3","задачи, отданные менеджеру",20,"мес",1,[Cond("u9","min",10)],
    "Автоматизация измеряется переданными задачами."),
  E("e10","usr","b1","действия пользователей в BlockTree",108,"мес",1,[Cond("u9","min",12)],
    "Девять действий на пользователя в месяц."),
  E("e11","usr","s4","доля неоткрытых функций",35,"мес",1,[],
    "Неиспользование растёт от функций, которых никто не касался."),
  E("e12","usr","s2","принятый фидбек по удобству",6,"мес",1,[Cond("u9","min",12)],
    "Удобство подтверждается внедрёнными обращениями."),
  E("e15","mkt","d3","комиссия платформы, 15% с оборота",2700,"мес",1,[Cond("m2","min",12000)],
    "Единственный денежный приход платформы — точный процент от известного оборота.","fact"),
  E("e16","mkt","u3","заработок на выполненных услугах",15300,"мес",1,[Cond("m2","min",12000)],
    "Оборот за вычетом комиссии — арифметика, а не гипотеза.","fact"),
  E("e17","vm","b2","вызовы агентов, записанные в BlockTree",180,"мес",1,[Cond("v3","min",20)],
    "Менеджер пишет в память, если ему отдают задачи."),
  E("e18","dec","u8","неудачные решения, дошедшие до пользователя",2,"мес",1,[],
    "Промахи регулятора становятся разочарованием."),
  E("e19","dec","d5","механики, подобранные неверно",2,"квартал",1,[],"Самопетля."),
  E("e20","dec","d6","задачи, оставшиеся без решения",8,"мес",1,[],"Очередь копится."),
  E("e21","dec","d7","выводы, сделанные без данных",3,"мес",1,[],
    "Выводы, под которыми нет измерений."),
  E("e22","dec","d4","часы на разбор и перерешение",20,"мес",1,[],
    "Разбор ошибок съедает время механик."),
  E("e23","dec","v5","неверные инструкции менеджеру",3,"мес",1,[],
    "Ошибка регулятора становится неэффективностью менеджера."),
  E("e24","dec","b7","ошибки в структуре записи",2,"мес",1,[],
    "Кривая структура делает накопленное бесполезным."),
  E("e25","dec","s1","выпущенные обновления",2,"мес",1,[Cond("d1","min",6)],
    "Нужно минимум 6 разборов в месяц."),
  E("e26","dec","s3","часы на разработку функционала",30,"мес",1,[],"Цена обновлений."),
];

/* ─────── ГРАФИК ─────── */
function Chart({lines,months,goalLine,goalMonth,cursorMonth}){
  const W=700,H=240,PL=54,PB=26,PT=12,PR=12;
  const max=Math.max(1,...lines.flatMap(l=>l.data).concat(goalLine?[goalLine]:[])
    .filter(isFinite))*1.1;
  const x=i=>PL+(i/Math.max(1,months))*(W-PL-PR);
  const y=v=>PT+(1-Math.min(v,max)/max)*(H-PT-PB);
  const step=Math.max(1,Math.ceil(months/6));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{display:"block"}}>
      {[0,.25,.5,.75,1].map((f,i)=>(<g key={i}>
        <line x1={PL} y1={y(max*f)} x2={W-PR} y2={y(max*f)} stroke={C.line}/>
        <text x={PL-6} y={y(max*f)+4} textAnchor="end" fontSize="10" fill={C.muted}
          fontFamily="ui-monospace, monospace">{nm(max*f)}</text></g>))}
      {Array.from({length:months+1}).map((_,i)=>i%step===0&&(
        <text key={i} x={x(i)} y={H-8} textAnchor="middle" fontSize="10" fill={C.muted}
          fontFamily="ui-monospace, monospace">{i}м</text>))}
      {goalLine!=null&&(<><line x1={PL} y1={y(goalLine)} x2={W-PR} y2={y(goalLine)}
        stroke={ACC} strokeWidth="1.4" strokeDasharray="5 4"/>
        <text x={W-PR} y={y(goalLine)-5} textAnchor="end" fontSize="10" fill={ACC}>цель</text></>)}
      {goalMonth!=null&&<line x1={x(goalMonth)} y1={PT} x2={x(goalMonth)} y2={H-PB}
        stroke={OK} strokeWidth="1.4" strokeDasharray="3 3"/>}
      {cursorMonth!=null&&<line x1={x(cursorMonth)} y1={PT} x2={x(cursorMonth)} y2={H-PB}
        stroke={ACC} strokeWidth="1.8"/>}
      {lines.map(l=><polyline key={l.id} fill="none" stroke={l.color} strokeWidth="2"
        points={l.data.map((v,i)=>`${x(i)},${y(v)}`).join(" ")}/>)}
    </svg>);
}

/* ─────── ПОЛЕ ЧИСЛОВОГО ВЫРАЖЕНИЯ ───────
   Хранится выражение со ссылками по id, показывается — с именами ресурсов.
   Список под полем вставляет ресурс, чтобы не набирать название руками и
   не промахиваться мимо него. */
function ExprField({value,onCommit,traits,scope,entities,kindOf,placeholder}){
  const nameOf=(id)=>traits.find(t=>t.id===id)?.l;
  const idOf=(name)=>{
    const norm=(x)=>String(x||"").trim().toLowerCase();
    // Сначала ищем среди ресурсов, доступных этому полю: если имена в разных
    // активах совпадают, предпочтение своей области видимости.
    return scope.find(t=>norm(t.l)===norm(name))?.id
      ?? traits.find(t=>norm(t.l)===norm(name))?.id ?? null;
  };
  const byEntity=entities
    .map(en=>({en,list:scope.filter(t=>t.e===en.id)}))
    .filter(g=>g.list.length);
  return (
    <div>
      <TxtField value={toDisplay(value,nameOf)} placeholder={placeholder}
        style={{fontFamily:"ui-monospace, Menlo, monospace",fontSize:12}}
        onCommit={v=>onCommit(toStorage(v,idOf))}/>
      <select style={{...S.inp,marginTop:4,fontSize:11.5}} value=""
        onChange={e=>{ if(e.target.value)
          onCommit(`${value?value+" ":""}{${e.target.value}}`); }}>
        <option value="">+ вставить ресурс</option>
        {byEntity.map(({en,list})=>(
          <optgroup key={en.id} label={en.name}>
            {list.map(t=>(<option key={t.id} value={t.id}>
              {kindOf(t.k).sign} {t.l}</option>))}
          </optgroup>))}
      </select>
    </div>);
}

/* ─────── СТРОКА СТРЕЛКИ ─────── */
function ArrowRow({ed,traits,entities,valueOf,kindOf,now,onEdit,onDelete}){
  const t=traits.find(x=>x.id===ed.to); if(!t) return null;
  const en=(id)=>entities.find(e=>e.id===id);
  const conds=ed.conds||[];
  const k=edgeK(ed,valueOf);
  const fact=isFact(ed);
  // «Текущий актив» для условия — источник стрелки: именно его ресурсы
  // определяют, сколько он отдаёт. Левое поле предлагает только их.
  const own=en(ed.from);
  const ownTraits=traits.filter(x=>x.e===ed.from);
  const src=traits.find(x=>x.id===ed.fromTrait);
  const setConds=(next)=>onEdit(ed.id,"conds",next);
  // Правку условия сразу приводим к новой форме: иначе у старого условия
  // остались бы и trait/amt, и left/right, и было бы непонятно, что считать.
  const updCond=(i,f,v)=>setConds(conds.map((c,ci)=>{
    if(ci!==i) return c;
    return f==="expr"?{expr:v}:{...condSides(c),[f]:v};
  }));
  const setKind=(i,kind)=>setConds(conds.map((c,ci)=>
    ci!==i?c:(kind==="gate"?asGate(c):asRatio(c,kind))));
  const delCond=(i)=>setConds(conds.filter((_,ci)=>ci!==i));
  // Новое условие — сравнение: это то, что спрашивают чаще всего («когда
  // вообще переносить»), и оно читается одной строкой.
  const addCond=()=>setConds([...conds,{expr:""}]);
  // В подстановке ресурсов актив-источник идёт первым: чаще всего условие
  // именно про него.
  const nearFirst=[...entities].sort((a,b)=>
    (a.id===ed.from?-1:0)-(b.id===ed.from?-1:0));
  return (
    <div style={{background:C.panel2,
      border:`1px solid ${k>0?(fact?OK+"55":WARN+"55"):BAD+"55"}`,borderRadius:8,
      padding:10,marginBottom:8}}>
      <div className="flex items-center gap-2" style={{fontSize:12.5,marginBottom:8}}>
        <span style={{color:en(ed.from)?.color,fontWeight:600}}>{en(ed.from)?.name}</span>
        <span style={{color:C.muted}}>→</span>
        <span style={{color:kindOf(t.k).color}}>{kindOf(t.k).sign}</span>
        <span style={{flex:1}}>{t.l}</span>
        <button onClick={()=>onDelete(ed.id)} style={{...btn(false),padding:"3px 7px"}}>✕</button>
      </div>
      <div className="flex flex-wrap gap-2" style={{marginBottom:7,alignItems:"center"}}>
        <button onClick={()=>onEdit(ed.id,"basis",fact?"hypo":"fact")}
          style={btn(true,fact?OK:WARN)} title={fact
            ?"Точный расчёт (проценты, доли известной величины) — переключить на гипотезу"
            :"Поведенческое допущение (конверсия, отклик) — переключить на факт"}>
          {fact?"◆ факт":"◇ гипотеза"}</button>
        <span style={{fontSize:11,color:C.muted,flex:1}}>
          {fact?"точный расчёт — не зависит от поведения людей"
            :"предположение о поведении — может не сбыться"}</span>
      </div>
      <div style={S.lbl}>перенос — что, откуда и как часто</div>
      <div style={{background:C.ink,border:`1px solid ${C.line}`,borderRadius:6,
        padding:8,margin:"5px 0 10px"}}>
        <div style={S.lbl}>берётся из ресурса{own?` актива «${own.name}»`:""}</div>
        <select style={S.inp} value={ed.fromTrait||""}
          onChange={e=>onEdit(ed.id,"fromTrait",e.target.value||null)}>
          <option value="">— ниоткуда: величина появляется —</option>
          {ownTraits.filter(x=>x.id!==ed.to).map(x=>(
            <option key={x.id} value={x.id}>{x.l} · {unitOf(x)}</option>))}
        </select>
        <div style={{fontSize:11.5,color:src?C.muted:WARN,marginTop:4,lineHeight:1.5}}>
          {src
            ?`Сколько придёт сюда, на столько же убудет «${src.l}». Не хватит — стрелка передаст меньше; если на этот же ресурс претендуют другие стрелки, каждая получит свою долю.`
            :"Ничего не тратится: величина берётся извне модели. Так и надо для приходящего снаружи — спроса, новых пользователей. Но если это ваш ресурс, выберите его выше, иначе один и тот же час работы уйдёт сразу в несколько мест."}
        </div>
        <div className="flex flex-wrap gap-2" style={{marginTop:8,alignItems:"center"}}>
          <span style={{fontSize:12,color:C.muted}}>за попытку берёт</span>
          <NumField value={ed.gives} style={{flex:"0 1 84px"}}
            onCommit={v=>onEdit(ed.id,"gives",v??0)}/>
          <span style={{fontSize:12,color:C.muted}}>{t.unit}, попытка каждый</span>
          <select style={{...S.inp,flex:"0 1 96px"}} value={ed.per}
            onChange={e=>onEdit(ed.id,"per",e.target.value)}>
            {Object.keys(PER).map(p=><option key={p} value={p}>{p}</option>)}</select>
          <button onClick={()=>onEdit(ed.id,"sign",ed.sign>0?-1:1)}
            style={btn(true,ed.sign>0?OK:BAD)}>{ed.sign>0?"катализирует":"купирует"}</button>
        </div>
        {(()=>{
          const per=PER[ed.per]??1;
          const asked=ed.gives*per;                 // что задано полями выше
          const want=now?now.want:asked*k;          // после условий
          const moved=now?now.moved:want;           // после дележа источника
          // Нехватку считаем по доле, а не по разнице: иначе округление
          // показывало бы «недодали 0» там, где недодали чуть-чуть.
          const short=now&&now.src&&now.want>0&&now.share<0.9999;
          const col=moved<=0?BAD:(short||k<0.9999?WARN:OK);
          // Расшифровка запроса: «730» из полей «1 за попытку × попытка
          // каждый час» иначе выглядит взявшимся из ниоткуда.
          const from=per!==1?` (${nm(ed.gives)} за попытку × ${nm(per)} попыток за месяц)`:"";
          return (
          <div style={{fontSize:11.5,color:col,lineHeight:1.5,marginTop:7}}>
            {k<=0
              ?`Перенос сейчас не идёт: условия не выполняются. Запрошено ${nm(shown(t,asked))} ${unitOf(t)}${from}.`
              :`Переносится ${nm(shown(t,moved))} из ${nm(shown(t,asked))} ${unitOf(t)}${from}.`}
            {k>0&&k<0.9999&&` Условия пропускают ${Math.round(k*100)}%.`}
            {short&&` У «${src?.l||"источника"}» на всех не хватает: есть ${nm(shown(src||t,now.supply))}, просят ${nm(shown(src||t,now.demand))} ${unitOf(src||t)} — каждый получает свою долю запроса.`}
          </div>);})()}
      </div>
      <div style={{marginBottom:10}}>
        <div style={S.lbl}>название движения</div>
        <TxtField value={ed.carrier} placeholder="например: звонки рефералам"
          onCommit={v=>onEdit(ed.id,"carrier",v)}/>
        <div style={{fontSize:10.5,color:C.muted,marginTop:4,lineHeight:1.5}}>
          Так движение называется в списках, в задачах и в рекомендациях. На
          самой схеме подписей нет — там у стрелки только число движений,
          Ф/Г и процент условий, иначе схема превращается в текст.
        </div>
      </div>

      {/* Когда движение происходит: окно дат и календарные детали. Отсюда же
          берутся напоминания по задачам этого движения — расписание должно
          быть одно, а не своё у задачи и своё у стрелки. */}
      <div style={S.lbl}>когда это происходит</div>
      <div style={{background:C.ink,border:`1px solid ${C.line}`,borderRadius:6,
        padding:8,margin:"5px 0 10px"}}>
        <div className="flex flex-wrap gap-2" style={{marginBottom:6}}>
          <div style={{flex:"1 1 180px"}}>
            <div style={S.lbl}>дата и время начала</div>
            <div className="flex gap-2" style={{alignItems:"center"}}>
              <input type="datetime-local" style={{...S.inp,flex:1}} value={ed.start||""}
                onChange={e=>onEdit(ed.id,"start",e.target.value)}/>
              <button style={btn(false)}
                onClick={()=>onEdit(ed.id,"start",nowLocal())}>Сейчас</button>
            </div>
          </div>
          <div style={{flex:"1 1 180px"}}>
            <div style={S.lbl}>дата и время конца</div>
            <input type="datetime-local" style={S.inp} value={ed.end||""}
              onChange={e=>onEdit(ed.id,"end",e.target.value)}/>
          </div>
        </div>
        <div style={{fontSize:10.5,color:C.muted,marginBottom:6,lineHeight:1.5}}>
          Периодичность — это «попытка каждый {ed.per}» выше: второго поля
          частоты нет намеренно, иначе они противоречили бы друг другу.
        </div>
        {ed.per==="нед"&&(<>
          <div style={S.lbl}>дни недели</div>
          <div className="flex flex-wrap gap-2" style={{margin:"6px 0"}}>
            {["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map((d,i)=>{
              const on=(ed.days||[]).includes(i);
              return (<button key={d} style={btn(on)}
                onClick={()=>onEdit(ed.id,"days",on
                  ?(ed.days||[]).filter(x=>x!==i)
                  :[...(ed.days||[]),i].sort((a,b)=>a-b))}>{d}</button>);})}
          </div>
        </>)}
        {ed.per!=="мес"&&ed.per!=="квартал"&&ed.per!=="год"&&(<>
          <div style={S.lbl}>время</div>
          <input type="time" style={S.inp} value={ed.time||""}
            onChange={e=>onEdit(ed.id,"time",e.target.value)}/>
        </>)}
      </div>

      <div style={S.lbl}>условия — когда перенос вообще происходит</div>
      <div style={{margin:"5px 0 10px"}}>
        {conds.map((c,i)=>{
          const kind=condKind(c);
          const kk=condK(c,valueOf);
          // Условие «бери, пока есть» на собственный источник не нужно:
          // нехватку и так режет дележ источника. Вреда от него теперь тоже
          // нет (поток в условии — это фонд месяца, а не остаток), поэтому
          // только подсказка, без жёлтой тревоги.
          const selfGate=ed.fromTrait&&condRefs(c).includes(ed.fromTrait);
          const selfWarn=selfGate&&(
            <div style={{fontSize:10.5,color:C.muted,lineHeight:1.5,marginTop:6}}>
              Условие смотрит на «{src?.l||"источник"}» — ресурс, из которого
              стрелка и так берёт. «Бери, пока есть» уже встроено: когда
              источника не хватает, перенос урезается сам. Условие имеет
              смысл только как порог — например «не трогай, пока меньше 100».
            </div>);
          if(kind==="gate"){
            const R=evaluate(c.expr,valueOf);
            const parts=splitComparison(c.expr||"");
            // Показываем обе стороны числами: «неверно» само по себе не
            // объясняет, чего именно не хватило.
            const L1=parts?evaluate(parts.left,valueOf):null;
            const L2=parts?evaluate(parts.right,valueOf):null;
            const bad=!!R.error;
            return (
            <div key={i} style={{background:C.ink,
              border:`1px solid ${bad?BAD+"66":C.line}`,borderRadius:6,
              padding:8,marginBottom:6}}>
              <div className="flex items-center gap-2" style={{marginBottom:6}}>
                <span style={{...S.lbl,flex:1}}>условие {i+1}</span>
                <button onClick={()=>delCond(i)}
                  style={{...btn(false),padding:"3px 7px"}}>✕</button>
              </div>
              <select style={{...S.inp,marginBottom:8}} value={kind}
                onChange={e=>setKind(i,e.target.value)}>
                <option value="gate">пропускает, если верно</option>
                <option value="min">пропорция: чем больше, тем сильнее</option>
                <option value="max">насыщение: не больше, чем</option>
              </select>
              <ExprField value={c.expr} traits={traits} scope={traits}
                entities={nearFirst} kindOf={kindOf}
                placeholder="например: 10 - [ресурс] > [другой] + [третий]"
                onCommit={v=>updCond(i,"expr",v)}/>
              <div style={{fontSize:10.5,marginTop:6,lineHeight:1.5,
                color:bad?BAD:(kk>0?OK:C.muted)}}>
                {bad
                  ? `${R.error} — условие не учитывается, пока не исправлено`
                  : parts&&!L1.error&&!L2.error
                    ? `в начале месяца ${nm(L1.value)} ${parts.op} ${nm(L2.value)} — ${kk>0?"верно":"неверно"}${selfGate?"; дальше проверяется на каждой попытке: источник убывает, и как только условие перестаёт выполняться, попытки останавливаются":kk>0?", перенос идёт":", переноса нет"}`
                    : `в начале месяца ${kk>0?"верно, перенос идёт":"неверно, переноса нет"}`}
              </div>
              {selfWarn}
            </div>);
          }
          const {left,right,mode}=condSides(c);
          const L=evaluate(left,valueOf), R=evaluate(right,valueOf);
          const bad=L.error||R.error;
          return (
          <div key={i} style={{background:C.ink,border:`1px solid ${bad?BAD+"66":C.line}`,
            borderRadius:6,padding:8,marginBottom:6}}>
            <div className="flex items-center gap-2" style={{marginBottom:6}}>
              <span style={{...S.lbl,flex:1}}>условие {i+1}</span>
              <button onClick={()=>delCond(i)}
                style={{...btn(false),padding:"3px 7px"}}>✕</button>
            </div>
            <select style={{...S.inp,marginBottom:8}} value={kind}
              onChange={e=>setKind(i,e.target.value)}>
              <option value="gate">пропускает, если верно</option>
              <option value="min">пропорция: чем больше, тем сильнее</option>
              <option value="max">насыщение: не больше, чем</option>
            </select>

            <div style={S.lbl}>у «{own?.name||"актива-источника"}»</div>
            <div style={{margin:"4px 0 8px"}}>
              <ExprField value={left} traits={traits} scope={ownTraits} entities={entities}
                kindOf={kindOf} placeholder="число или формула"
                onCommit={v=>updCond(i,"left",v)}/>
            </div>

            <div style={{...S.lbl,marginBottom:4}}>
              {mode==="min"?"не меньше, чем":"не больше, чем"}</div>
            <div style={{margin:"4px 0 6px"}}>
              <ExprField value={right} traits={traits} scope={traits} entities={entities}
                kindOf={kindOf} placeholder="число или формула"
                onCommit={v=>updCond(i,"right",v)}/>
            </div>

            {bad
              ? <div style={{fontSize:10.5,color:BAD,lineHeight:1.5}}>
                  {L.error?`слева: ${L.error}`:""}{L.error&&R.error?" · ":""}
                  {R.error?`справа: ${R.error}`:""}
                  {" — условие не учитывается, пока не исправлено"}
                </div>
              : <div style={{fontSize:10.5,color:C.muted,lineHeight:1.5}}>
                  сейчас {nm(L.value)} {mode==="min"?"против":"при потолке"} {nm(R.value)} —
                  {mode==="min"
                    ? ` чем больше слева относительно правой части, тем сильнее эффект: ${Math.round(kk*100)}%`
                    : ` пока слева не выше правой — эффект полный; выше — насыщение: ${Math.round(kk*100)}%`}
                </div>}
            {selfWarn}
          </div>);})}
        <button style={btn(false)} onClick={addCond}>+ добавить условие</button>
      </div>

      <div><div style={S.lbl}>пояснение</div>
        <TxtField area value={ed.note} style={{minHeight:46,lineHeight:1.5}}
          onCommit={v=>onEdit(ed.id,"note",v)}/></div>
    </div>);
}

/* ─────── СХЕМА (переиспользуемая для «сейчас» и для снимка симуляции) ─────── */
function SchemeSVG({entities,traits,edges,groups,zoom,sel,pair,valuesFor,valuesForFact,
  onSelectEntity,onSelectPair,onMoveEntity}){
  // Перетаскивание активов. Тап и перетаскивание различаем по порогу сдвига:
  // пока палец/курсор не ушёл дальше DRAG_MIN пикселей, это ещё выбор блока.
  const DRAG_MIN=4;
  const drag=useRef(null);
  // Пока блок ведут, его положение живёт здесь, а не в модели. Правка модели
  // на каждое движение пальца перерисовывала бы всё приложение целиком —
  // на телефоне это и давало рывки. В модель уезжает только итог жеста.
  const [dragPos,setDragPos]=useState(null);

  const down=(ev,e)=>{
    if(!onMoveEntity) return;
    drag.current={id:e.id,sx:ev.clientX,sy:ev.clientY,ox:e.x,oy:e.y,moved:false};
  };

  useEffect(()=>{
    if(!onMoveEntity) return undefined;
    // Слушаем на окне, а не на самом блоке. Палец обгоняет блок и уходит за
    // его границы, а Safari (значит, и Telegram на iOS) ненадёжно держит
    // pointer capture на элементах внутри <svg>: события переставали
    // приходить, блок замирал и догонял палец скачком.
    const move=(ev)=>{
      const d=drag.current; if(!d) return;
      const dx=ev.clientX-d.sx, dy=ev.clientY-d.sy;
      if(!d.moved&&Math.hypot(dx,dy)<DRAG_MIN) return;
      d.moved=true;
      // Экранные пиксели → единицы viewBox: масштаб задан zoom.
      d.x=Math.max(0,Math.round(d.ox+dx/zoom));
      d.y=Math.max(0,Math.round(d.oy+dy/zoom));
      setDragPos({id:d.id,x:d.x,y:d.y});
    };
    const up=()=>{
      const d=drag.current; if(!d) return;
      drag.current=null; setDragPos(null);
      // Отменённый жест (звонок, системный жест) тоже засчитываем: человек
      // блок передвинул, терять это движение не за что.
      if(d.moved) onMoveEntity(d.id,d.x,d.y); else onSelectEntity(d.id);
    };
    // Прокрутку холста во время перетаскивания гасим сами: touch-action на
    // элементах внутри <svg> Safari игнорирует, и браузер уводил жест в
    // прокрутку. Слушатель непассивный — в пассивном (а React вешает
    // touchmove именно так) preventDefault не работает.
    const noScroll=(ev)=>{ if(drag.current) ev.preventDefault(); };
    window.addEventListener("pointermove",move);
    window.addEventListener("pointerup",up);
    window.addEventListener("pointercancel",up);
    window.addEventListener("touchmove",noScroll,{passive:false});
    return ()=>{
      window.removeEventListener("pointermove",move);
      window.removeEventListener("pointerup",up);
      window.removeEventListener("pointercancel",up);
      window.removeEventListener("touchmove",noScroll);
    };
  },[zoom,onMoveEntity,onSelectEntity]);

  // Ведомый блок рисуется по «живым» координатам — вместе со своими стрелками.
  const ents=dragPos
    ? entities.map(e=>e.id===dragPos.id?{...e,x:dragPos.x,y:dragPos.y}:e)
    : entities;
  const anchor=(a,b)=>{const ax=a.x+NW/2,ay=a.y+NH/2,bx=b.x+NW/2,by=b.y+NH/2;
    const dx=bx-ax,dy=by-ay;
    const s=Math.min(dx===0?1e9:NW/2/Math.abs(dx),dy===0?1e9:NH/2/Math.abs(dy));
    return [ax+dx*s,ay+dy*s];};
  const ent=(id)=>ents.find(e=>e.id===id);
  const gaugeFor=(enId)=>{
    const pts=traits.filter(t=>t.e===enId&&t.want!=null&&Number(t.want)!==0);
    if(!pts.length) return {hypo:0,fact:0};
    let sh=0,sf=0;
    pts.forEach(t=>{
      const w=Number(t.want);
      sh+=Math.min(1,Math.max(0,(valuesFor(t.id)??0)/w));
      sf+=Math.min(1,Math.max(0,(valuesForFact(t.id)??0)/w));
    });
    return {hypo:sh/pts.length,fact:sf/pts.length};
  };
  // Холст растёт под перетащенные блоки, чтобы их не срезало по краю.
  const CW=Math.max(1000,...ents.map(e=>e.x+NW+24));
  const CH=Math.max(740,...ents.map(e=>e.y+NH+24));
  return (
    <div style={{overflow:"auto",WebkitOverflowScrolling:"touch"}}>
      <svg viewBox={`0 0 ${CW} ${CH}`} width={CW*zoom} height={CH*zoom}
        style={{display:"block"}}>
        <defs>{[OK,WARN,NEU].map((c,i)=>(
          <marker key={i} id={"a"+i} markerWidth="9" markerHeight="9" refX="8" refY="3"
            orient="auto"><path d="M0,0 L8,3 L0,6 z" fill={c}/></marker>))}</defs>
        {groups.map(g=>{
          const a=ent(g.from),b=ent(g.to); if(!a||!b) return null;
          const k=Math.min(...g.list.map(ed=>edgeK(ed,valuesFor)));
          const col=k>=1?OK:k>0?WARN:NEU, mi=k>=1?0:k>0?1:2, on=pair===g.key;
          const fc=g.list.filter(isFact).length;
          const tag=fc===g.list.length?"Ф":fc===0?"Г":"Ф/Г";
          const hit={onClick:()=>onSelectPair(g.key),style:{cursor:"pointer"}};
          if(a.id===b.id){const cx=a.x+NW-16,cy=a.y+8;
            const dpath=`M${cx-40},${cy} C${cx+26},${cy-42} ${cx+42},${cy+30} ${cx},${cy+34}`;
            return (<g key={g.key} {...hit}>
              <path d={dpath} fill="none" stroke="transparent" strokeWidth="24"/>
              <path d={dpath} fill="none" stroke={col} strokeWidth={on?3:1.8}
                markerEnd={`url(#a${mi})`}/>
              <circle cx={cx+34} cy={cy-6} r="13" fill={C.panel} stroke={on?ACC:col}/>
              <text x={cx+34} y={cy-2} textAnchor="middle" fontSize="9.5" fill={col}
                fontFamily="ui-monospace, monospace">{g.list.length}{tag}</text></g>);}
          const [x1,y1]=anchor(a,b),[x2,y2]=anchor(b,a);
          const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)||1,s=(a.id<b.id?1:-1);
          const ox=(-dy/len)*11*s,oy=(dx/len)*11*s;
          const mx=(x1+x2)/2+ox,my=(y1+y2)/2+oy;
          return (<g key={g.key} {...hit}>
            <line x1={x1+ox} y1={y1+oy} x2={x2+ox} y2={y2+oy} stroke="transparent"
              strokeWidth="26"/>
            <line x1={x1+ox} y1={y1+oy} x2={x2+ox} y2={y2+oy} stroke={col}
              strokeWidth={on?3.4:1.8} strokeDasharray={k===0?"5 4":"0"}
              markerEnd={`url(#a${mi})`}/>
            <rect x={mx-30} y={my-13} width="60" height="26" rx="7" fill={C.panel}
              stroke={on?ACC:col} strokeWidth={on?2:1}/>
            <text x={mx} y={my+4} textAnchor="middle" fontSize="10" fill={col}
              fontFamily="ui-monospace, monospace">
              {g.list.length}{tag}·{Math.round(k*100)}%</text></g>);})}
        {ents.map(e=>{
          const ts=traits.filter(t=>t.e===e.id);
          const gs=ts.filter(t=>t.want!=null).length;
          const gv=gaugeFor(e.id);
          return (<g key={e.id}
            onPointerDown={ev=>down(ev,e)}
            style={{cursor:onMoveEntity?"grab":"pointer",touchAction:"none"}}>
            <rect x={e.x} y={e.y} width={NW} height={NH} rx="12" fill={C.panel}
              stroke={sel===e.id?ACC:C.line} strokeWidth={sel===e.id?2.6:1.6}/>
            <rect x={e.x} y={e.y} width="5" height={NH} rx="2.5" fill={e.color}/>
            <text x={e.x+14} y={e.y+26} fontSize="13.5" fontWeight="700" fill={C.text}>
              {e.name.length>23?e.name.slice(0,22)+"…":e.name}</text>
            <text x={e.x+14} y={e.y+46} fontSize="11" fill={C.muted}
              fontFamily="ui-monospace, monospace">
              ресурсов: {ts.length} · {gs?`целей: ${gs}`:"целей нет"}</text>
            <rect x={e.x+14} y={e.y+58} width={NW-28} height={8} rx="4"
              fill={C.ink} stroke={C.line}/>
            <rect x={e.x+14} y={e.y+58} width={Math.max(0,(NW-28)*gv.hypo)}
              height={8} rx="4" fill={WARN}/>
            <rect x={e.x+14} y={e.y+58} width={Math.max(0,(NW-28)*gv.fact)}
              height={8} rx="4" fill={OK}/>
            <text x={e.x+14} y={e.y+80} fontSize="11" fontWeight="700">
              <tspan fill={OK}>{Math.round(gv.fact*100)}% факт</tspan>
              <tspan fill={C.muted}> · </tspan>
              <tspan fill={WARN}>{Math.round(gv.hypo*100)}% гип.</tspan></text>
            <text x={e.x+14} y={e.y+98} fontSize="10.5" fill={C.muted}>
              стрелок наружу: {edges.filter(x=>x.from===e.id).length}</text></g>);})}
      </svg>
    </div>);
}

/* Время черновика — человеку, а не машине: «сегодня, 14:05» вместо ISO. */
function whenText(iso){
  const d=new Date(iso);
  if(Number.isNaN(d.getTime())) return "прошлого раза";
  const time=d.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
  const today=new Date();
  const sameDay=d.toDateString()===today.toDateString();
  if(sameDay) return `сегодня, ${time}`;
  return `${d.toLocaleDateString("ru-RU",{day:"numeric",month:"long"})}, ${time}`;
}

/* ════════════════ ГЛАВНОЕ ════════════════ */
export default function SystemModel(){
  const [entities,setEntities]=useState(ENTITIES0);
  const [traits,setTraits]=useState(TRAITS0);
  const [edges,setEdges]=useState(EDGES0);
  const [kinds,setKinds]=useState(KINDS0);
  const [kindMsg,setKindMsg]=useState("");
  const [okrs,setOkrs]=useState([]);
  const [tasks,setTasks]=useState([]);
  const [tab,setTab]=useState("tasks");
  const [sel,setSel]=useState("usr");
  const [selTrait,setSelTrait]=useState(null);
  const [pair,setPair]=useState(null);
  const [horizon,setHorizon]=useState(24);
  const [zoom,setZoom]=useState(0.6);
  const [draft,setDraft]=useState("");
  const [newGoal,setNewGoal]=useState("");
  const [json,setJson]=useState(""); const [jsonMsg,setJsonMsg]=useState("");
  // ─── сохранение сценариев на диске сервера (не меняет модель/расчёты — только I/O) ───
  const [savedList,setSavedList]=useState([]);
  const [savedSel,setSavedSel]=useState("");
  const [saveName,setSaveName]=useState("");
  const [savedMsg,setSavedMsg]=useState("");
  const [savedBusy,setSavedBusy]=useState(false);
  const [savedWhere,setSavedWhere]=useState("");
  const [simSpan,setSimSpan]=useState(24);
  const [simOv,setSimOv]=useState([]); // [{trait,val}] — стартовые условия сценария
  const [simEnt,setSimEnt]=useState(ENTITIES0[0]?.id);
  const [openTask,setOpenTask]=useState(null); // задача, открытая в редакторе
  const [simMonth,setSimMonth]=useState(0); // месяц на ползунке времени главной схемы

  const ent=(id)=>entities.find(e=>e.id===id);
  const trait=(id)=>traits.find(t=>t.id===id);
  // Пустое значение — это «не задано», и превращать его в 0 нельзя.
  const asShown=(t,v)=>(v==null||v===""?v:shown(t,v));
  const asStored=(t,v)=>(v==null?v:stored(t,v));
  const into=(tid)=>edges.filter(e=>e.to===tid);
  const upE=(id,f,v)=>setEntities(p=>p.map(e=>e.id===id?{...e,[f]:v}:e));
  const upT=(id,f,v)=>setTraits(p=>p.map(t=>t.id===id?{...t,[f]:v}:t));
  // Целевым может стать любой ресурс: цель — это не отдельная сущность, а два
  // поля на нём (планка и срок). Ставим их одной правкой, иначе два upT подряд
  // считали бы от одного и того же прежнего состояния и второй затёр бы первый.
  const makeGoal=(id)=>setTraits(p=>p.map(t=>
    t.id===id?{...t,want:t.want==null?stored(t,1):t.want,by:t.by??horizon}:t));
  const dropGoal=(id)=>setTraits(p=>p.map(t=>
    t.id===id?{...t,want:null,by:null}:t));
  const upA=(id,f,v)=>setEdges(p=>p.map(e=>e.id===id?{...e,[f]:v}:e));
  const delA=(id)=>setEdges(p=>p.filter(e=>e.id!==id));
  const kindOf=useMemo(()=>kindLookup(kinds),[kinds]);

  // После загрузки другой модели прежний выбор может указывать на актив,
  // которого в ней нет — тогда панель осталась бы пустой без объяснений.
  const adoptSelection=(list)=>{
    setSelTrait(null); setPair(null);
    setSel(s=>list.some(e=>e.id===s)?s:(list[0]?.id??null));
    setSimEnt(s=>list.some(e=>e.id===s)?s:(list[0]?.id??null));
  };

  // ─── история правок: отмена и возврат ───
  // История следит за документом модели — ровно за тем, что уезжает в
  // сохранённый сценарий. Вкладка, зум и выбранный блок в неё не попадают:
  // отменять «переключение вкладки» пользователь не просил, а вот потерять
  // каскадное удаление актива — реальная беда.
  const doc=useMemo(()=>({entities,traits,edges,kinds,okrs,tasks}),
    [entities,traits,edges,kinds,okrs,tasks]);
  const restoreDoc=useCallback((d)=>{
    setEntities(d.entities); setTraits(normalizeTraits(d.traits)); setEdges(d.edges);
    setKinds(d.kinds); setOkrs(d.okrs); setTasks(d.tasks);
    // Шаг назад может убрать актив, на который сейчас смотрит панель, —
    // тогда выбор надо перевести, иначе панель опустеет без объяснения.
    setPair(null);
    setSelTrait(t=>d.traits.some(x=>x.id===t)?t:null);
    setSel(s=>d.entities.some(e=>e.id===s)?s:(d.entities[0]?.id??null));
    setSimEnt(s=>d.entities.some(e=>e.id===s)?s:(d.entities[0]?.id??null));
  },[]);
  const hist=useHistory(doc,restoreDoc);

  // ─── черновик: страховка от внезапного закрытия вкладки ───
  // Черновик пишется, только пока работа расходится с тем, что лежит на
  // диске: иначе после каждой загрузки сценария приложение предлагало бы
  // «восстановить» ровно то, что и так сохранено.
  const [recovery,setRecovery]=useState(()=>readDraft());
  const [draftBlocked,setDraftBlocked]=useState(false);
  const savedDoc=useRef(doc);   // документ, совпадающий с сохранённым
  const docRef=useRef(doc); docRef.current=doc;
  const saveNameRef=useRef(saveName); saveNameRef.current=saveName;
  const writeDraft=useCallback(()=>{
    if(sameDoc(docRef.current,savedDoc.current)){ clearDraft(); setDraftBlocked(false); return; }
    setDraftBlocked(!saveDraft(docRef.current,{name:saveNameRef.current}));
  },[]);
  // Пауза гасит поток промежуточных состояний, пока пользователь ещё правит.
  useEffect(()=>{ const id=setTimeout(writeDraft,800); return ()=>clearTimeout(id); },
    [doc,writeDraft]);
  useEffect(()=>{
    // Telegram убивает WebView без предупреждения, и последние секунды работы
    // не дожили бы до конца паузы. localStorage синхронный — успевает.
    const onHide=()=>{ if(document.visibilityState==="hidden") writeDraft(); };
    window.addEventListener("pagehide",writeDraft);
    document.addEventListener("visibilitychange",onHide);
    return ()=>{ window.removeEventListener("pagehide",writeDraft);
      document.removeEventListener("visibilitychange",onHide); };
  },[writeDraft]);

  // ─── активы: добавить, подвинуть по схеме, удалить ───
  const moveE=(id,x,y)=>{
    // Нечисловые координаты недопустимы: они не просто ломают отрисовку —
    // NaN уедет в сохранённый сценарий и актив пропадёт со схемы навсегда.
    if(!Number.isFinite(x)||!Number.isFinite(y)) return;
    setEntities(p=>p.map(e=>e.id===id
      ?{...e,x:Math.max(0,Math.round(x)),y:Math.max(0,Math.round(y))}:e));
  };
  const addEntity=()=>{
    const id="en"+Date.now();
    // Кладём новый актив под самым нижним, чтобы он не лёг поверх existing.
    const y=entities.length?Math.max(...entities.map(e=>e.y))+NH+40:24;
    const palette=["#7CE0FF","#C792EA","#FFD166","#3DDC97","#FF9E64","#FF5C7A","#8B9DFF"];
    setEntities(p=>[...p,{id,name:"Новый актив",color:palette[p.length%palette.length],
      x:24,y}]);
    setSel(id); setSelTrait(null); setPair(null);
  };
  // Схема разъезжается: блоки двигают пальцем, новые падают под низ. Кнопка
  // ставит их в сетку, сохраняя расстановку — кто был в одном ряду, там и
  // останется, кто был левее, останется левее. Полная перекладка «как лучше»
  // (по связям, по слоям) сломала бы привычную для автора картину, а вернуть
  // её было бы нечем, кроме отмены.
  const GAP_X=48, GAP_Y=56;
  const alignGrid=()=>{
    const rows=[];
    [...entities].sort((a,b)=>a.y-b.y||a.x-b.x).forEach(e=>{
      const row=rows[rows.length-1];
      // Ряд продолжается, пока блок не ушёл вниз настолько, что перестал бы
      // читаться как стоящий в одну линию с соседями.
      if(row&&e.y-row.y<NH*0.6) row.list.push(e); else rows.push({y:e.y,list:[e]});
    });
    const pos={};
    rows.forEach((row,ri)=>row.list.sort((a,b)=>a.x-b.x).forEach((e,ci)=>{
      pos[e.id]={x:24+ci*(NW+GAP_X),y:24+ri*(NH+GAP_Y)};
    }));
    setEntities(p=>p.map(e=>({...e,...pos[e.id]})));
  };

  const delEntity=(id)=>{
    const own=new Set(traits.filter(t=>t.e===id).map(t=>t.id));
    // Уносим за собой всё, что на актив ссылалось: его ресурсы, входящие в них
    // стрелки, стрелки из него самого и условия, завязанные на его ресурсы.
    setEdges(p=>p.filter(x=>x.from!==id&&!own.has(x.to))
      .map(x=>({...x,conds:(x.conds||[]).filter(c=>!condRefs(c).some(r=>own.has(r)))})));
    setTraits(p=>p.filter(t=>t.e!==id));
    setEntities(p=>p.filter(e=>e.id!==id));
    setSelTrait(null); setPair(null);
    setSel(p=>p===id?(entities.find(e=>e.id!==id)?.id??null):p);
  };

  // Планировщик напоминаний живёт на сервере, поэтому после каждой правки
  // задач отдаём ему актуальный список. Пауза гасит поток промежуточных
  // состояний, пока пользователь ещё правит поля.
  // Расписание задачи собирается из её движения: даты и периодичность живут
  // на стрелке, у задачи остаётся только «за сколько предупредить». Иначе
  // напоминания шли бы по одному расписанию, а модель считала по другому.
  const scheduled=useMemo(()=>tasks.map(t=>{
    const ed=edges.find(e=>e.id===t.edgeId);
    return ed?{...t,...scheduleOf(ed)}:t;
  }),[tasks,edges]);
  useEffect(()=>{
    const id=setTimeout(()=>{ syncSchedule(scheduled).catch(()=>{}); },1200);
    return ()=>clearTimeout(id);
  },[scheduled]);

  // ─── OKR: рекомендация → ключевой результат + задача ───
  const recRef=(r)=>r.type==="seed"?r.tid:r.eid;
  const isTaken=(goalId,r)=>okrs.some(o=>o.goalId===goalId&&o.refId===recRef(r));
  // Прогресс ключевого результата берётся из модели, а не отмечается руками:
  // KR закрыт тогда, когда рычаг реально выведен на нужное значение.
  const okrValue=(o)=>o.type==="seed"
    ? Number(traits.find(t=>t.id===o.refId)?.have??0)
    : Number(edges.find(e=>e.id===o.refId)?.gives??0);
  // Ключевой результат по ресурсу показывается в его периоде — так же, как
  // всё остальное про этот ресурс. Внутри KR числа остаются модельными,
  // иначе прогресс считался бы по разным меркам.
  const okrShown=(o,v)=>o.type==="seed"
    ? shown(traits.find(t=>t.id===o.refId)||{},v)
    : Number(v);
  const takeToWork=(goalId,r)=>{
    // Приложение — инструмент прогноза, поэтому взятый в работу рычаг сразу
    // применяется к модели: прогноз должен показывать, куда система пойдёт с
    // учётом принятого решения. Плюс заводятся KR и задача под него.
    const val=Math.round(r.to*100)/100;
    if(r.type==="seed") upT(r.tid,"have",val); else upA(r.eid,"gives",val);
    const o=okrFromRec(goalId,r);
    setOkrs(p=>[...p,o]);
    setTasks(p=>[...p,newTask({goalId,okrId:o.id,title:r.label,
      body:r.type==="seed"
        ?`Завести ${nm(r.to)} ${r.unit||""} — «${r.label}».`
        :`Поднять «${r.label}» с ${nm(r.from)} до ${nm(r.to)} ${r.unit||""} за ${r.per}.`})]);
  };

  // ─── классификации ресурсов ───
  const upK=(id,f,v)=>setKinds(p=>p.map(k=>k.id===id?{...k,[f]:v}:k));
  const addKind=()=>setKinds(p=>[...p,{id:"k"+Date.now(),sign:"•",
    name:"новая классификация",color:ACC,dir:"up"}]);
  const delKind=(id)=>{
    if(kinds.length<=1) return "Нельзя удалить последнюю классификацию.";
    const rest=kinds.filter(k=>k.id!==id);
    const used=traits.filter(t=>t.k===id);
    // Ресурсы не бросаем без типа — переводим в первую оставшуюся классификацию.
    if(used.length) setTraits(p=>p.map(t=>t.k===id?{...t,k:rest[0].id}:t));
    setKinds(rest);
    return used.length
      ?`Удалено. ${used.length} ресурс(ов) переведено в «${rest[0].name}».`
      :"Удалено.";
  };

  // ─── сохранение сценариев: сервер / облако Telegram / браузер (см. storage.js) ───
  const refreshSavedList=async()=>{
    try{ setSavedList(await listScenarios()); }
    catch{ setSavedMsg("Не удалось получить список сохранённых сценариев."); }
  };
  useEffect(()=>{ if(tab!=="json") return;
    refreshSavedList();
    detectStorage().then(k=>setSavedWhere(STORAGE_LABEL[k]||"")).catch(()=>{});
  },[tab]);
  const saveToDisk=async()=>{
    setSavedBusy(true);
    try{
      const isUpdate=savedSel&&savedList.some(s=>s.id===savedSel);
      const snapshot=doc;
      const saved=await saveScenario({id:isUpdate?savedSel:null,name:saveName,
        data:snapshot});
      // Ровно этот документ теперь лежит на диске — черновик про него молчит.
      savedDoc.current=snapshot; clearDraft(); setRecovery(null);
      setSavedMsg(`Сохранено: «${saved.name}».`);
      setSavedSel(saved.id);
      await refreshSavedList();
    }catch(e){ setSavedMsg(e.message||"Не удалось сохранить."); }
    setSavedBusy(false);
  };
  const loadFromDisk=async()=>{
    if(!savedSel){ setSavedMsg("Выбери сохранённый сценарий."); return; }
    setSavedBusy(true);
    try{
      const s=await getScenario(savedSel);
      if(!s) throw new Error("Сценарий не найден.");
      // Старые сценарии могут не знать про часть документа — недостающее
      // остаётся текущим, а не превращается в пустоту.
      const arr=(v,cur,need)=>Array.isArray(v)&&(!need||v.length)?v:cur;
      const loaded={
        entities:arr(s.data?.entities,entities,true),
        // Приводим к текущей записи здесь же: иначе «что лежит на диске»
        // разошлось бы с тем, что попало в модель, и черновик решил бы,
        // что появились несохранённые правки.
        traits:normalizeTraits(arr(s.data?.traits,traits)),
        edges:arr(s.data?.edges,edges), kinds:arr(s.data?.kinds,kinds,true),
        okrs:arr(s.data?.okrs,okrs), tasks:arr(s.data?.tasks,tasks),
      };
      restoreDoc(loaded);
      savedDoc.current=loaded; clearDraft(); setRecovery(null);
      setSaveName(s.name);
      setSavedMsg(`Загружено: «${s.name}».`);
    }catch(e){ setSavedMsg(e.message||"Не удалось загрузить сценарий."); }
    setSavedBusy(false);
  };
  const deleteFromDisk=async()=>{
    if(!savedSel) return;
    setSavedBusy(true);
    try{
      await deleteScenario(savedSel);
      setSavedSel(""); setSavedMsg("Удалено.");
      await refreshSavedList();
    }catch(e){ setSavedMsg(e.message||"Не удалось удалить сценарий."); }
    setSavedBusy(false);
  };

  const goals=traits.filter(t=>t.want!=null);
  const span=useMemo(()=>Math.max(horizon,...goals.map(g=>g.by??0),6),[horizon,goals]);
  // гипотетический прогноз — по всем стрелкам, включая поведенческие допущения
  const base=useMemo(()=>simulate(traits,edges,span),[traits,edges,span]);
  const live=useMemo(()=>{const o={};traits.forEach(t=>o[t.id]=base[t.id]?.[0]??0);return o;},
    [base,traits]);
  // фактический прогноз — только по стрелкам-фактам (точные расчёты, без предположений)
  const baseFact=useMemo(()=>simulate(traits,factEdges(edges,tasks),span),
    [traits,edges,tasks,span]);
  const liveFact=useMemo(()=>{const o={};traits.forEach(t=>o[t.id]=baseFact[t.id]?.[0]??0);
    return o;},[baseFact,traits]);
  // Тот же расчёт и то же состояние, что у месяца 0 симуляции: карточка
  // стрелки обязана объяснять ровно те числа, которые показывает прогноз.
  const step0=useMemo(()=>resolveStep(traits,edges,{
    stockAt:(id)=>Number(traits.find(t=>t.id===id)?.have??0),
    seedAt:(t)=>Number(t.have??0),
    giveAt:(ed)=>Number(ed.gives)||0,
  }),[traits,edges]);
  const flowNow=useMemo(()=>{
    const by={};
    step0.moves.forEach(f=>{by[f.ed.id]=f;});
    return by;
  },[step0]);

  const advice=useMemo(()=>goals.map(g=>({g,...adviseFor(traits,edges,g,span)})),
    [traits,edges,span,goals.length]);

  const groups=useMemo(()=>{const g={};
    edges.forEach(ed=>{const t=traits.find(x=>x.id===ed.to);if(!t)return;
      const k=ed.from+"|"+t.e;(g[k]=g[k]||{from:ed.from,to:t.e,list:[]}).list.push(ed);});
    return Object.entries(g).map(([k,v])=>({key:k,...v}));},[edges,traits]);

  const selE=ent(sel),selT=selTrait?trait(selTrait):null;
  const pairG=pair?groups.find(g=>g.key===pair):null;

  // Симуляция пересчитывается сама при каждой правке модели — кнопка
  // «запустить» заставляла помнить о ней и показывала устаревший снимок.
  const simRun=useMemo(()=>{
    const seedMod={};
    simOv.forEach(o=>{if(o.trait){
      const t=trait(o.trait);
      seedMod[o.trait]=t?asStored(t,Number(o.val)||0):Number(o.val)||0;
    }});
    return {
      base:simulate(traits,edges,simSpan,seedMod),
      baseFact:simulate(traits,factEdges(edges,tasks),simSpan,seedMod),
      span:simSpan,
    };
  },[traits,edges,tasks,simSpan,simOv]);

  return (
    <div style={{background:C.ink,color:C.text,minHeight:"100%",padding:12,
      fontFamily:"Inter, 'Segoe UI', system-ui, sans-serif"}}>
      <div className="flex items-start justify-between gap-3" style={{marginBottom:10}}>
        <div><div style={S.lbl}>жизнеспособность · v8</div>
          <div style={{fontSize:19,fontWeight:700}}>Активы и движение ресурсов</div></div>
        <div className="flex items-center gap-2"
          style={{flexWrap:"wrap",justifyContent:"flex-end"}}>
          <button style={{...btn(false),opacity:hist.canUndo?1:0.45}}
            disabled={!hist.canUndo} onClick={hist.undo}
            title="Отменить последнее изменение модели (Ctrl+Z)">↶ отменить</button>
          <button style={{...btn(false),opacity:hist.canRedo?1:0.45}}
            disabled={!hist.canRedo} onClick={hist.redo}
            title="Вернуть отменённое (Ctrl+Shift+Z)">↷ вернуть</button>
          <span style={S.lbl}>горизонт</span>
          <NumField value={horizon} style={{width:58}}
            onCommit={v=>setHorizon(Math.max(3,Math.min(120,v||24)))}/>
          <span style={{fontSize:11,color:C.muted}}>мес</span></div>
      </div>

      {recovery && (
        <div style={{...S.card,marginBottom:10,borderColor:ACC}}>
          <div style={{fontSize:12.5,lineHeight:1.6,marginBottom:8}}>
            Остались правки от {whenText(recovery.savedAt)}
            {recovery.name?` (сценарий «${recovery.name}»)`:""} — вкладка
            закрылась раньше, чем они уехали на диск. Восстановить?
          </div>
          <div className="flex flex-wrap gap-2">
            <button style={btn(true)}
              onClick={()=>{ restoreDoc(recovery.doc); setRecovery(null); }}>
              Восстановить</button>
            <button style={btn(false)}
              onClick={()=>{ clearDraft(); setRecovery(null); }}>Отбросить</button>
          </div>
        </div>)}

      {draftBlocked && (
        <div style={{fontSize:11.5,color:WARN,marginBottom:10,lineHeight:1.6}}>
          Браузер не даёт сохранить черновик — правки не переживут закрытия
          вкладки. Сохраняй сценарий на диск во вкладке «JSON».
        </div>)}

      <div className="flex gap-2" style={{marginBottom:10,overflowX:"auto"}}>
        {[["tasks","Задачи"],["reports","Отчёты"],["scheme","Схема"],
          ["sim","Прогноз"],["json","Выгрузить"]].map(([k,t])=>(
          <button key={k} style={btn(tab===k)} onClick={()=>setTab(k)}>{t}</button>))}
      </div>

      {/* ═══ ЗАДАЧИ ═══ */}
      {tab==="tasks" && (
        <TasksBoard goals={goals} okrs={okrs} setOkrs={setOkrs}
          tasks={tasks} setTasks={setTasks} traits={traits} entities={entities}
          edges={edges}
          okrValue={okrValue} okrShown={okrShown}
          openId={openTask} setOpenId={setOpenTask}
          entityName={id=>ent(id)?.name||"—"}/>)}

      {/* ═══ ОТЧЁТЫ ═══ */}
      {tab==="reports" && (
        <ReportsGantt tasks={tasks} edges={edges} traits={traits} goals={goals}
          entityName={id=>ent(id)?.name||"—"}/>)}

      {/* ═══ СХЕМА ═══ */}
      {tab==="scheme" && (<>
        <div style={{...S.card,padding:6,marginBottom:10}}>
          <div className="flex items-center gap-2 flex-wrap" style={{marginBottom:4}}>
            <span style={S.lbl}>масштаб</span>
            <button style={btn(false)} onClick={()=>setZoom(z=>Math.max(.32,z-.12))}>−</button>
            <button style={btn(false)} onClick={()=>setZoom(z=>Math.min(1.6,z+.12))}>+</button>
            <button style={btn(true)} onClick={addEntity}>+ актив</button>
            <button style={btn(false)} onClick={alignGrid}
              title="Расставит блоки по сетке, сохранив расстановку по рядам">
              ⌗ выровнять</button>
          </div>
          <div className="flex items-center gap-2" style={{marginBottom:4,flexWrap:"wrap"}}>
            <span style={S.lbl}>время</span>
            <input type="range" min={0} max={span} step={1}
              value={Math.min(simMonth,span)}
              onChange={e=>setSimMonth(Number(e.target.value))}
              style={{flex:"1 1 140px",accentColor:ACC}}/>
            <span style={{fontSize:12.5,fontWeight:700,color:ACC,minWidth:86,
              textAlign:"right"}}>
              {Math.min(simMonth,span)===0?"сейчас":`+${Math.min(simMonth,span)} мес.`}
            </span>
          </div>
          <div style={{fontSize:11,color:C.muted,marginBottom:4}}>
            Тап по блоку или стрелке — открыть, перетащить — переставить.
            Ползунок времени показывает схему в будущем: числа и проценты на
            ней — прогноз на выбранный месяц; правки всегда меняют «сейчас».
          </div>
          <div style={{overflow:"auto",WebkitOverflowScrolling:"touch"}}>
            <SchemeSVG entities={entities} traits={traits} edges={edges} groups={groups}
              zoom={zoom} sel={sel} pair={pair}
              valuesFor={tid=>base[tid]?.[Math.min(simMonth,span)]??0}
              valuesForFact={tid=>baseFact[tid]?.[Math.min(simMonth,span)]??0}
              onSelectEntity={id=>{setSel(id);setSelTrait(null);setPair(null);}}
              onSelectPair={key=>{setPair(key);setSelTrait(null);}}
              onMoveEntity={moveE}/>
          </div>
        </div>

        {pairG && (
          <div style={{...S.card,marginBottom:10}}>
            <div className="flex items-center justify-between gap-2" style={{marginBottom:8}}>
              <div style={{fontSize:13.5,fontWeight:700}}>
                <span style={{color:ent(pairG.from)?.color}}>{ent(pairG.from)?.name}</span>
                <span style={{color:C.muted}}> → </span>
                <span style={{color:ent(pairG.to)?.color}}>{ent(pairG.to)?.name}</span></div>
              <button style={btn(false)} onClick={()=>setPair(null)}>✕</button></div>
            {pairG.list.map(ed=>(
              <ArrowRow key={ed.id} ed={ed} traits={traits} entities={entities}
                valueOf={id=>step0.state[id]??0}
                kindOf={kindOf} now={flowNow[ed.id]} onEdit={upA} onDelete={delA}/>))}
          </div>)}

        {selE && (
          <div style={{...S.card,marginBottom:10}}>
            <div className="flex items-center gap-2" style={{marginBottom:6}}>
              <span style={{width:9,height:9,borderRadius:2,background:selE.color}}/>
              <TxtField value={selE.name} style={{fontWeight:700,fontSize:14}}
                onCommit={v=>upE(selE.id,"name",v)}/></div>
            <div className="flex flex-wrap gap-2" style={{alignItems:"center",marginBottom:10}}>
              <span style={S.lbl}>цвет</span>
              <input type="color" value={selE.color} onChange={e=>upE(selE.id,"color",e.target.value)}
                style={{width:36,height:26,background:C.ink,border:`1px solid ${C.line}`,
                  borderRadius:5,padding:1,cursor:"pointer"}}/>
              <span style={{flex:1}}/>
              <button style={{...btn(false),color:BAD,borderColor:"#5A2436"}}
                onClick={()=>delEntity(selE.id)}
                title="Удалит актив вместе с его ресурсами и стрелками">
                Удалить актив</button>
            </div>
            <div style={S.lbl}>ресурсы актива</div>
            <div style={{margin:"6px 0 10px"}}>
              {traits.filter(t=>t.e===selE.id).map(t=>{
                const w=t.want!=null?Number(t.want):null;
                const hv=live[t.id]??0, fv=liveFact[t.id]??0;
                const hFrac=frac(hv,w), fFrac=frac(fv,w);
                const hCol=hFrac==null?C.muted:(hFrac>=1?WARN:NEU);
                const fCol=fFrac==null?C.muted:(fFrac>=1?OK:BAD);
                const barPct=hFrac!=null?Math.round(Math.min(1,hFrac)*100):0;
                const factPct=fFrac!=null?Math.round(Math.min(1,fFrac)*100):0;
                return (
                <div key={t.id} onClick={()=>setSelTrait(selTrait===t.id?null:t.id)}
                  style={{padding:"7px 8px",marginBottom:5,borderRadius:7,cursor:"pointer",
                    background:selTrait===t.id?C.panel2:"transparent",
                    border:`1px solid ${selTrait===t.id?C.line:"transparent"}`}}>
                  <div className="flex items-center gap-2" style={{fontSize:12.5}}>
                    <span style={{color:kindOf(t.k).color,fontFamily:"ui-monospace, monospace",
                      fontWeight:700}}>{kindOf(t.k).sign}</span>
                    <span style={{flex:1}}>{t.l}</span>
                    {t.want!=null&&<span style={{fontSize:9.5,color:ACC,
                      border:`1px solid ${ACC}66`,borderRadius:3,padding:"1px 4px"}}>цель</span>}
                  </div>
                  <div style={{fontSize:11,color:C.muted,marginTop:3}}>
                    {isFlow(t)?"поток":"запас"} · {unitOf(t)}
                    <span style={{color:hCol}}> · гип. {nm(shown(t,hv))}</span>
                    <span style={{color:fCol}}> · факт {nm(shown(t,fv))}</span>
                  </div>
                  <div style={{height:5,borderRadius:3,background:C.ink,marginTop:5,
                    overflow:"hidden",position:"relative"}}>
                    <div style={{height:"100%",borderRadius:3,position:"absolute",
                      width:barPct+"%",background:w?WARN:"transparent"}}/>
                    <div style={{height:"100%",borderRadius:3,position:"absolute",
                      width:factPct+"%",background:w?OK:"transparent"}}/>
                  </div>
                  {w!=null&&<div style={{fontSize:9.5,color:C.muted,marginTop:2}}>
                    цель {nm(shown(t,w))} {unitOf(t)}</div>}
                </div>);})}
            </div>

            {selT&&selT.e===selE.id&&(
              <div style={{background:C.panel2,border:`1px solid ${C.line}`,borderRadius:8,
                padding:10,marginBottom:10}}>
                <div className="flex items-center gap-2" style={{marginBottom:8}}>
                  <span style={{color:kindOf(selT.k).color,fontFamily:"ui-monospace, monospace",
                    fontWeight:700}}>{kindOf(selT.k).sign}</span>
                  <TxtField value={selT.l} placeholder="название ресурса"
                    style={{fontWeight:700,fontSize:13}}
                    onCommit={v=>upT(selT.id,"l",v)}/>
                </div>
                {(()=>{
                  const w=selT.want!=null?Number(selT.want):null;
                  const hv=live[selT.id]??0, fv=liveFact[selT.id]??0;
                  const hFrac=frac(hv,w), fFrac=frac(fv,w);
                  const hCol=hFrac==null?C.muted:(hFrac>=1?WARN:NEU);
                  const fCol=fFrac==null?C.muted:(fFrac>=1?OK:BAD);
                  return (<>
                <div className="flex flex-wrap gap-2" style={{marginBottom:8}}>
                  <div style={{flex:"1 1 76px"}}><div style={S.lbl}>нужно</div>
                    <NumField value={asShown(selT,selT.want)} placeholder="нет цели"
                      onCommit={v=>upT(selT.id,"want",asStored(selT,v))}/></div>
                  <div style={{flex:"1 1 76px"}}><div style={S.lbl}>к месяцу</div>
                    <NumField value={selT.by} placeholder={String(span)}
                      onCommit={v=>upT(selT.id,"by",v)}/></div>
                  <div style={{flex:"1 1 76px"}}><div style={S.lbl}>есть сейчас (старт)</div>
                    <NumField value={asShown(selT,selT.have)} placeholder="0"
                      onCommit={v=>upT(selT.id,"have",asStored(selT,v))}/></div>
                  <div style={{flex:"1 1 96px"}}><div style={S.lbl}>единица</div>
                    <TxtField value={selT.unit} placeholder="ч, ₽, чел."
                      onCommit={v=>upT(selT.id,"unit",v)}/></div>
                </div>
                <div className="flex flex-wrap gap-2"
                  style={{marginBottom:8,alignItems:"center"}}>
                  <span style={S.lbl}>это</span>
                  <button style={btn(!isFlow(selT))}
                    onClick={()=>upT(selT.id,"flow",false)}
                    title="Копится: деньги на счету, люди в команде, накопленные часы">
                    запас</button>
                  <button style={btn(isFlow(selT))}
                    onClick={()=>upT(selT.id,"flow",true)}
                    title="Не копится: столько-то за период — зарплата в месяц, часы в день">
                    поток</button>
                  {isFlow(selT)&&(<>
                    <span style={S.lbl}>за</span>
                    <select style={{...S.inp,flex:"0 1 104px"}} value={perOf(selT)}
                      onChange={e=>upT(selT.id,"per",e.target.value)}>
                      {Object.keys(PER).map(p=><option key={p} value={p}>{p}</option>)}
                    </select>
                    <span style={{fontSize:11.5,color:C.muted,flex:"1 1 100%"}}>
                      Все значения ниже — за выбранный период. Смена периода
                      пересчитывает показ, саму модель не меняет.
                    </span>
                  </>)}
                </div>
                <div className="flex flex-wrap gap-2" style={{marginBottom:8}}>
                  <div style={{flex:"1 1 100px"}}>
                    <div style={S.lbl}>гипотетически (все стрелки)</div>
                    <div style={{...S.inp,color:hCol,borderColor:hCol,
                      background:C.panel2,display:"flex",alignItems:"center"}}
                      title="Прогноз с учётом поведенческих допущений">
                      {nm(shown(selT,hv))}</div></div>
                  <div style={{flex:"1 1 100px"}}>
                    <div style={S.lbl}>фактически (только факты)</div>
                    <div style={{...S.inp,color:fCol,borderColor:fCol,
                      background:C.panel2,display:"flex",alignItems:"center"}}
                      title="Прогноз только по стрелкам-фактам — без гипотез">
                      {nm(shown(selT,fv))}</div></div>
                </div>
                {fv===0&&into(selT.id).length>0&&!into(selT.id).some(isFact)&&(
                  <div style={{fontSize:11.5,color:WARN,marginBottom:10,lineHeight:1.5}}>
                    Фактически ноль потому, что все входящие стрелки помечены как
                    гипотезы. Если стрелка — точный расчёт, а не допущение о
                    поведении, переключите её на «◆ факт» ниже.
                  </div>)}
                <div style={{fontSize:11.5,color:C.muted,marginBottom:10}}>
                  <b>{isFlow(selT)?"Поток":"Запас"}.</b>{" "}
                  {isFlow(selT)
                    ?`Не копится: значение — это скорость, «столько-то за ${perOf(selT)}». Зарплата 50 000 ₽/мес: в феврале она те же 50 000, а не 100 000. Приход и расход за период просто складываются.`
                    :"Копится: приход за месяц прибавляется к тому, что уже есть, расход вычитается. Деньги на счету, люди в команде, накопленный опыт. Если перевести это в поток, накопленное исчезнет — останется только скорость."}
                  {" "}«Гипотетически» считает по всем стрелкам, включая допущения о
                  поведении (жёлтое — если дотягивает до цели, серое — нет). «Фактически»
                  считает только по стрелкам, помеченным как факт — точным расчётам вроде
                  процента от известной суммы (зелёное — дотягивает, красное — нет).
                </div></>);})()}
                <div className="flex flex-wrap gap-2" style={{marginBottom:10}}>
                  {kinds.map(k=>(<button key={k.id} style={btn(selT.k===k.id,k.color)}
                    onClick={()=>upT(selT.id,"k",k.id)}>{k.sign} {k.name}</button>))}
                </div>
                <div style={S.lbl}>что в неё приходит</div>
                <div style={{margin:"6px 0 10px"}}>
                  {!into(selT.id).length&&<div style={{fontSize:12,color:BAD}}>
                    Ни одной стрелки — эту величину никто не производит.</div>}
                  {into(selT.id).map(ed=>(
                    <ArrowRow key={ed.id} ed={ed} traits={traits} entities={entities}
                      valueOf={id=>step0.state[id]??0}
                      kindOf={kindOf} now={flowNow[ed.id]} onEdit={upA} onDelete={delA}/>))}
                </div>
                <div style={S.lbl}>добавить стрелку сюда</div>
                <div className="flex flex-wrap gap-2" style={{marginTop:6,marginBottom:10}}>
                  {entities.map(e=>(<button key={e.id}
                    style={{...btn(false),borderColor:e.color+"66",color:e.color}}
                    onClick={()=>setEdges(p=>[...p,{id:"e"+Date.now(),from:e.id,to:selT.id,
                      carrier:"",gives:0,per:"мес",sign:1,conds:[],note:"",basis:"hypo"}])}>
                    от «{e.name}»</button>))}
                </div>
                <button style={{...btn(false),color:BAD,borderColor:"#5A2436"}}
                  onClick={()=>{setTraits(p=>p.filter(x=>x.id!==selT.id));
                    setEdges(p=>p.filter(x=>x.to!==selT.id&&
                      !(x.conds||[]).some(c=>condRefs(c).includes(selT.id))));
                    setSelTrait(null);}}>Удалить ресурс</button>
              </div>)}

            <TxtField value={draft} placeholder="текст нового ресурса"
              style={{marginBottom:6}} onCommit={setDraft}/>
            <div className="flex flex-wrap gap-2">
              {kinds.map(k=>(<button key={k.id}
                style={{...btn(false),borderColor:k.color,color:k.color}}
                onClick={()=>{if(!draft.trim())return;
                  setTraits(p=>[...p,{id:"t"+Date.now(),e:sel,k:k.id,l:draft.trim(),
                    unit:"ед./мес",have:null,want:null,by:null}]);setDraft("");}}>
                + {k.sign} {k.name}</button>))}
            </div>
          </div>)}

        {/* Классификации ресурсов — здесь же, под добавлением ресурса:
            тип задаётся ресурсу при создании, поэтому набор типов должен
            быть под рукой на той же вкладке, а не за переключением. */}
        <div style={{marginTop:10}}>
          <div style={{...S.card,marginBottom:10}}>
            <div style={S.lbl}>классификации ресурсов</div>
            <div style={{fontSize:11.5,color:C.muted,marginTop:6,lineHeight:1.6}}>
              Каждый ресурс относится к одной классификации: она задаёт значок,
              цвет и то, в какую сторону изменение считается хорошим. При удалении
              затронутые ресурсы переводятся в первую оставшуюся классификацию —
              без типа они не остаются.
            </div>
          </div>

          {kinds.map(k=>{
            const used=traits.filter(t=>t.k===k.id).length;
            return (
            <div key={k.id} style={{...S.card,marginBottom:8}}>
              <div className="flex flex-wrap gap-2" style={{alignItems:"center",marginBottom:8}}>
                <TxtField value={k.sign} onCommit={v=>upK(k.id,"sign",(v||"").trim()||"•")}
                  style={{flex:"0 1 54px",textAlign:"center",fontWeight:700,color:k.color,
                    fontFamily:"ui-monospace, Menlo, monospace"}}/>
                <TxtField value={k.name} placeholder="название классификации"
                  style={{flex:"2 1 160px",fontWeight:600}}
                  onCommit={v=>upK(k.id,"name",v)}/>
                <input type="color" value={k.color}
                  onChange={e=>upK(k.id,"color",e.target.value)}
                  style={{width:36,height:32,background:C.ink,border:`1px solid ${C.line}`,
                    borderRadius:5,padding:1,cursor:"pointer"}}/>
              </div>
              <div className="flex flex-wrap gap-2" style={{alignItems:"center"}}>
                <button style={btn(true,k.dir==="up"?OK:BAD)}
                  onClick={()=>upK(k.id,"dir",k.dir==="up"?"down":"up")}
                  title="Куда должен двигаться показатель, чтобы это считалось хорошим">
                  {k.dir==="up"?"↑ рост — это хорошо":"↓ снижение — это хорошо"}</button>
                <span style={{fontSize:11,color:C.muted,flex:1}}>
                  ресурсов с этим типом: {used}</span>
                <button style={{...btn(false),color:BAD,borderColor:"#5A2436"}}
                  disabled={kinds.length<=1}
                  onClick={()=>setKindMsg(delKind(k.id))}>Удалить</button>
              </div>
            </div>);})}

          <div className="flex flex-wrap gap-2" style={{alignItems:"center"}}>
            <button style={btn(true)} onClick={()=>{addKind();setKindMsg("");}}>
              + добавить классификацию</button>
            {kindMsg&&<span style={{fontSize:12,color:C.muted}}>{kindMsg}</span>}
          </div>
        </div>

      </>)}

      {/* ═══ ПРОГНОЗ (цели + остальные ресурсы) ═══ */}
      {tab==="sim" && (<div>
        <div style={{...S.card,marginBottom:10}}>
          <div style={S.lbl}>срок прогона</div>
          <div className="flex items-center gap-2" style={{margin:"6px 0 12px"}}>
            <NumField value={simSpan} style={{width:70}}
              onCommit={v=>setSimSpan(Math.max(1,Math.min(600,v||24)))}/>
            <span style={{fontSize:11,color:C.muted}}>мес — сколько дискретных шагов посчитать</span>
          </div>

          <div style={S.lbl}>стартовые условия сценария (переопределяют «есть сейчас»)</div>
          <div style={{margin:"6px 0 8px"}}>
            {simOv.map((o,i)=>{
              const t=trait(o.trait);
              return (
              <div key={i} className="flex flex-wrap gap-2" style={{alignItems:"center",
                marginBottom:6}}>
                <select style={{...S.inp,flex:"2 1 170px"}} value={o.trait}
                  onChange={e=>setSimOv(p=>p.map((x,xi)=>xi===i?{...x,trait:e.target.value}:x))}>
                  <option value="">— выбери ресурс —</option>
                  {entities.map(en=>(
                    <optgroup key={en.id} label={en.name}>
                      {traits.filter(x=>x.e===en.id).map(x=>(
                        <option key={x.id} value={x.id}>{kindOf(x.k).sign} {x.l}</option>))}
                    </optgroup>))}
                </select>
                <NumField value={o.val} placeholder={t?String(asShown(t,t.have)??0):"0"}
                  style={{flex:"0 1 90px"}}
                  onCommit={v=>setSimOv(p=>p.map((x,xi)=>xi===i?{...x,val:v??0}:x))}/>
                {t&&<span style={{fontSize:11,color:C.muted}}>{unitOf(t)}</span>}
                <button style={{...btn(false),padding:"3px 7px"}}
                  onClick={()=>setSimOv(p=>p.filter((_,xi)=>xi!==i))}>✕</button>
              </div>);})}
            <button style={btn(false)} onClick={()=>setSimOv(p=>[...p,{trait:"",val:0}])}>
              + добавить исходное условие</button>
          </div>

          <div style={{fontSize:11.5,color:C.muted}}>
            Пересчитывается сама при каждой правке модели. Схема с ползунком
            времени — на вкладке «Схема»; здесь — активы и графики.
          </div>
        </div>

        {/* Цели — здесь же, на «Прогнозе»: цель это тот же прогноз ресурса,
            только с планкой и сроком. Разводить их по вкладкам значило бы
            смотреть на одну кривую в двух местах. */}
        <div style={{...S.card,marginBottom:10}}>
          <div style={S.lbl}>поставить цель</div>
          <div className="flex flex-wrap gap-2" style={{marginTop:6}}>
            <select style={{...S.inp,flex:"2 1 200px"}} value={newGoal}
              onChange={e=>setNewGoal(e.target.value)}>
              <option value="">— выбери ресурс —</option>
              {entities.map(en=>(
                <optgroup key={en.id} label={en.name}>
                  {traits.filter(t=>t.e===en.id&&t.want==null).map(t=>(
                    <option key={t.id} value={t.id}>{kindOf(t.k).sign} {t.l}</option>))}
                </optgroup>))}
            </select>
            <button style={btn(true)} disabled={!newGoal} onClick={()=>{
              if(!newGoal) return;
              makeGoal(newGoal); setNewGoal(""); }}>Добавить</button>
          </div>
          <div style={{fontSize:11.5,color:C.muted,marginTop:6}}>
            Целевым можно сделать любой ресурс — хоть отсюда, хоть кнопкой
            «сделать целью» на его карточке ниже. Цель добавится со значением 1 —
            впиши нужное число прямо в карточке.
          </div>
        </div>

        {!goals.length && <div style={{...S.card,marginBottom:10}}>
          Целевых ресурсов пока нет — ниже прогноз по всем остальным.</div>}

        {advice.map(({g,now,recs})=>{
          const by=g.by??span, inTime=now!=null&&now<=by;
          const d=depsOf(edges,g.id);
          const hypoChain=d.edges.map(id=>edges.find(e=>e.id===id)).filter(e=>e&&!isFact(e));
          const w=g.want!=null?Number(g.want):null;
          const hv=live[g.id]??0, fv=liveFact[g.id]??0;
          const hFrac=frac(hv,w), fFrac=frac(fv,w);
          const hCol=hFrac==null?C.muted:(hFrac>=1?WARN:NEU);
          const fCol=fFrac==null?C.muted:(fFrac>=1?OK:BAD);
          const nowFact=reachMonth(baseFact[g.id],w);
          const factInTime=nowFact!=null&&nowFact<=by;
          const lines=[g.id,...d.traits.filter(x=>x!==g.id)].slice(0,5).map((id,i)=>({
            id,color:[ACC,"#C792EA",OK,WARN,"#FF9E64"][i],
            name:trait(id)?.l,
            // График цели рисуется в том же периоде, что и числа над ним,
            // иначе кривая и подпись под ней противоречили бы друг другу.
            data:(base[id]||[]).map(v=>shown(trait(id)||{},v))}));
          return (
            <div key={g.id} style={{...S.card,marginBottom:12}}>
              <div className="flex items-center gap-2" style={{marginBottom:4}}>
                <span style={{color:kindOf(g.k).color,fontFamily:"ui-monospace, monospace",
                  fontWeight:700}}>{kindOf(g.k).sign}</span>
                <span style={{fontSize:14,fontWeight:700,flex:1}}>{g.l}</span>
                <button style={{...btn(false),color:BAD,borderColor:"#5A2436"}}
                  onClick={()=>dropGoal(g.id)}>убрать из целей</button>
              </div>
              <div style={{fontSize:11.5,color:C.muted,marginBottom:8}}>
                {ent(g.e)?.name} · {unitOf(g)} · {isFlow(g)?"поток":"запас"}</div>

              <div className="flex flex-wrap gap-2" style={{marginBottom:10}}>
                <div style={{flex:"1 1 80px"}}><div style={S.lbl}>нужно</div>
                  <NumField value={asShown(g,g.want)}
                    onCommit={v=>upT(g.id,"want",asStored(g,v))}/></div>
                <div style={{flex:"1 1 80px"}}><div style={S.lbl}>к месяцу</div>
                  <NumField value={g.by} placeholder={String(span)}
                    onCommit={v=>upT(g.id,"by",v)}/></div>
                <div style={{flex:"1 1 100px"}}>
                  <div style={S.lbl}>гипотетически (все стрелки)</div>
                  <div style={{...S.inp,color:hCol,borderColor:hCol,
                    background:C.panel2,display:"flex",alignItems:"center"}}
                    title="Прогноз с учётом поведенческих допущений">
                    {nm(shown(g,hv))}</div>
                </div>
                <div style={{flex:"1 1 100px"}}>
                  <div style={S.lbl}>фактически (только факты)</div>
                  <div style={{...S.inp,color:fCol,borderColor:fCol,
                    background:C.panel2,display:"flex",alignItems:"center"}}
                    title="Прогноз только по стрелкам-фактам">{nm(shown(g,fv))}</div>
                </div>
              </div>

              <div style={{fontSize:13,fontWeight:600,color:inTime?WARN:BAD,marginBottom:4}}>
                {now==null?`Гипотетически (с учётом допущений) цель за ${span} мес. не достигается.`
                  :inTime?`Гипотетически цель выходит на ${now}-м месяце — успеваешь, если сбудутся допущения.`
                  :`Гипотетически цель выходит только на ${now}-м месяце, это позже срока.`}
              </div>
              <div style={{fontSize:13,fontWeight:600,color:factInTime?OK:BAD,marginBottom:10}}>
                {nowFact==null?`Гарантированно (без гипотез) цель за ${span} мес. не достигается.`
                  :factInTime?`Гарантированно цель выходит на ${nowFact}-м месяце — это уже без всяких допущений.`
                  :`Гарантированно цель выходит только на ${nowFact}-м месяце, это позже срока.`}
              </div>

              <div style={S.lbl}>на каких гипотезах строится прогноз</div>
              <div style={{margin:"6px 0 10px"}}>
                {hypoChain.length
                  ? hypoChain.map(ed=>{
                      const tt=trait(ed.to);
                      return (
                      <div key={ed.id} className="flex items-center gap-2" style={{fontSize:12,
                        padding:"5px 2px",borderBottom:`1px solid ${C.line}`}}>
                        <span style={{color:WARN}}>◇</span>
                        <span style={{flex:1}}>{ed.carrier||tt?.l}
                          <span style={{color:C.muted}}>
                            {" "}· {ent(ed.from)?.name} → {ent(tt?.e)?.name}</span></span>
                      </div>);})
                  : <div style={{fontSize:12,color:OK}}>
                      Весь путь до цели держится на фактах — ни одной гипотезы.</div>}
              </div>

              <div style={{background:C.panel2,border:`1px solid ${C.line}`,borderRadius:8,
                padding:8,marginBottom:10}}>
                <Chart lines={lines} months={span} goalLine={Number(g.want)} goalMonth={now}
                  cursorMonth={simMonth}/>
                <div className="flex flex-wrap gap-3" style={{marginTop:6,fontSize:11}}>
                  {lines.map(l=><span key={l.id} style={{color:l.color}}>■ {l.name}</span>)}</div>
              </div>

              <div style={S.lbl}>рост/упадок влияющих ресурсов</div>
              <div style={{margin:"6px 0 10px"}}>
                {d.traits.map(tid=>{
                  const t=trait(tid); if(!t) return null;
                  const s=base[tid]||[];
                  const start=s[0]??0, end=s[s.length-1]??0;
                  const delta=end-start;
                  const eps=Math.max(1e-6,Math.abs(start)*0.001);
                  const dir=delta>eps?"up":delta<-eps?"down":"flat";
                  const good=dir==="flat"?null:dir===kindOf(t.k).dir;
                  const col=dir==="flat"?C.muted:(good?OK:BAD);
                  const arrow=dir==="up"?"↑":dir==="down"?"↓":"→";
                  const pct=Math.abs(start)>1e-9?(delta/Math.abs(start)*100):(end!==0?100:0);
                  return (
                    <div key={tid} className="flex items-center gap-2" style={{fontSize:12,
                      padding:"5px 2px",borderBottom:`1px solid ${C.line}`}}>
                      <span style={{color:kindOf(t.k).color,fontFamily:"ui-monospace, monospace"}}>
                        {kindOf(t.k).sign}</span>
                      <span style={{flex:1}}>{t.l}
                        <span style={{color:C.muted}}> · {ent(t.e)?.name}</span></span>
                      <span style={{color:col,fontWeight:700,whiteSpace:"nowrap"}}>
                        {arrow} {nm(start)}→{nm(end)}</span>
                      <span style={{color:col,fontSize:10.5,width:56,textAlign:"right"}}>
                        {delta>=0?"+":""}{nm(pct)}%</span>
                    </div>);
                })}
                {!d.traits.length&&<div style={{fontSize:12,color:C.muted}}>
                  Влияющих ресурсов нет.</div>}
              </div>

              {!!recs.length&&(<>
                <div style={S.lbl}>что поднять, чтобы успеть</div>
                <div style={{marginTop:6}}>
                  {recs.map((r,i)=>{
                    const ed=r.type==="edge"?edges.find(x=>x.id===r.eid):null;
                    const lev=r.type==="seed"
                      ?{label:"стартовое значение",color:ACC}
                      :ed?(isFact(ed)?{label:"◆ факт",color:OK}:{label:"◇ гипотеза",color:WARN})
                      :null;
                    const otherHypo=hypoChain.filter(e=>!(ed&&e.id===ed.id));
                    return (
                    <div key={i} style={{background:C.panel2,border:`1px solid ${C.line}`,
                      borderRadius:8,padding:9,marginBottom:6}}>
                      <div className="flex items-center gap-2" style={{marginBottom:2}}>
                        {lev&&<span style={{fontSize:9.5,color:lev.color,
                          border:`1px solid ${lev.color}66`,borderRadius:3,
                          padding:"1px 4px"}}>{lev.label}</span>}
                      </div>
                      <div style={{fontSize:12.5,lineHeight:1.6}}>
                        <span style={{color:WARN}}>◆ </span>
                        {r.type==="seed"
                          ?<>Завести руками <b>{nm(shown(trait(r.tid)||{},r.to))} {r.unit}</b> — «{r.label}»
                            <span style={{color:C.muted}}> ({ent(r.e)?.name})</span></>
                          :<>Поднять «{r.label}»<span style={{color:C.muted}}> ({ent(r.e)?.name})</span>
                            {" "}с {nm(r.from)} до <b>{nm(r.to)} {r.unit}</b> за {r.per}</>}
                      </div>
                      <div style={{fontSize:11.5,color:OK,marginTop:3}}>
                        тогда цель на {r.month}-м месяце</div>
                      <div style={{fontSize:10.5,color:otherHypo.length?WARN:OK,marginTop:3}}>
                        {otherHypo.length
                          ?`опирается ещё на ${otherHypo.length} гипотез${otherHypo.length===1?"у":otherHypo.length<5?"ы":""} из списка выше`
                          :"больше ни одной гипотезы не требуется"}
                      </div>
                      {isTaken(g.id,r)
                        ? <div style={{fontSize:11.5,color:OK,marginTop:6}}>
                            ✓ взято в работу — прогноз пересчитан, задача во
                            вкладке «Задачи»</div>
                        : <button style={{...btn(false),marginTop:6,color:OK,
                            borderColor:OK+"66"}}
                            onClick={()=>takeToWork(g.id,r)}>Взять в работу</button>}
                    </div>);})}
                </div>
                <div style={{fontSize:11.5,color:C.muted,marginTop:4,lineHeight:1.6}}>
                  Варианты взаимозаменяемы, хватит одного. Каждый рычаг считался отдельно.
                </div></>)}
              {!recs.length&&now!=null&&<div style={{fontSize:12,color:C.muted}}>
                Поднимать ничего не нужно — цель берётся на текущих значениях.</div>}
              {!recs.length&&now==null&&<div style={{fontSize:12,color:BAD,lineHeight:1.6}}>
                Ни один рычаг не выводит на цель: в ресурс не входит ни одной стрелки,
                либо все условия замкнуты сами на себя. Открой её на схеме.</div>}

              {/* Работа по цели — здесь же: ключевые результаты, задачи и их
                  создание. Между целью и работой по ней не должно стоять
                  переключение вкладки. */}
              <div style={{marginTop:12,borderTop:`1px solid ${C.line}`,paddingTop:10}}>
                <GoalWork g={g} okrs={okrs} setOkrs={setOkrs} tasks={tasks}
                  setTasks={setTasks} traits={traits} entities={entities}
                  edges={edges}
                  okrValue={okrValue} okrShown={okrShown}
                  entityName={id=>ent(id)?.name||"—"}
                  openId={openTask} setOpenId={setOpenTask}/>
              </div>
            </div>);})}

        {/* Нецелевые ресурсы — прежние карточки прогноза: график и два числа,
            без планки и без разбора рычагов, потому что планки у них нет. */}
        <div style={{...S.card,marginBottom:10}}>
          <div style={S.lbl}>остальные ресурсы — по активам</div>
          <div className="flex flex-wrap gap-2" style={{marginTop:6}}>
            {entities.map(en=>(<button key={en.id}
              style={{...btn(simEnt===en.id),borderColor:en.color,
                color:simEnt===en.id?C.ink:en.color,
                background:simEnt===en.id?en.color:C.panel2}}
              onClick={()=>setSimEnt(en.id)}>{en.name}</button>))}
          </div>
        </div>
        {entities.filter(en=>en.id===simEnt).map(en=>{
          const plain=traits.filter(t=>t.e===en.id&&t.want==null);
          return (
            <div key={en.id}>
              {plain.map(t=>{
                const hs=simRun.base[t.id]||[], fs=simRun.baseFact[t.id]||[];
                const hEnd=hs[hs.length-1]??0, fEnd=fs[fs.length-1]??0;
                const lines=[
                  {id:"h",color:WARN,name:"гипотетически",data:hs},
                  {id:"f",color:OK,name:"фактически",data:fs},
                ];
                return (
                  <div key={t.id} style={{...S.card,marginBottom:10}}>
                    <div className="flex items-center gap-2" style={{marginBottom:4}}>
                      <span style={{color:kindOf(t.k).color,fontFamily:"ui-monospace, monospace",
                        fontWeight:700}}>{kindOf(t.k).sign}</span>
                      <span style={{fontSize:13,fontWeight:700,flex:1}}>{t.l}</span>
                      <span style={{fontSize:11,color:C.muted}}>
                        {isFlow(t)?"поток":"запас"} · {unitOf(t)}</span>
                    </div>
                    <div style={{background:C.panel2,border:`1px solid ${C.line}`,borderRadius:8,
                      padding:8,marginBottom:6}}>
                      <Chart lines={lines} months={simRun.span} cursorMonth={simMonth}/>
                    </div>
                    <div className="flex flex-wrap gap-3" style={{fontSize:11,
                      alignItems:"center"}}>
                      <span style={{color:ACC}}>■ на {simMonth}-м мес.: гип. {nm(hs[simMonth]??0)}
                        {" "}· факт {nm(fs[simMonth]??0)}</span>
                      <span style={{color:WARN}}>■ гипотетически: {nm(hEnd)} к {simRun.span}-му мес.</span>
                      <span style={{color:OK}}>■ фактически: {nm(fEnd)} к {simRun.span}-му мес.</span>
                      <span style={{flex:1}}/>
                      <button style={{...btn(false),color:ACC,borderColor:ACC+"66"}}
                        onClick={()=>makeGoal(t.id)}>сделать целью</button>
                    </div>
                  </div>);})}
              {!plain.length&&
                <div style={S.card}>
                  {traits.some(t=>t.e===en.id)
                    ?"Все ресурсы этого актива уже целевые — их карточки выше."
                    :"У этого актива пока нет ресурсов."}</div>}
            </div>);})}
      </div>)}

      {/* ═══ ВЫГРУЗИТЬ ═══ */}
      {tab==="json"&&(
        <div style={S.card}>
          <div className="flex flex-wrap gap-2" style={{marginBottom:8}}>
            <button style={btn(true)} onClick={()=>{
              setJson(JSON.stringify({entities,traits,edges,kinds,okrs,tasks},null,2));
              setJsonMsg("Выгружено.");}}>
              Выгрузить</button>
            <button style={btn(false)} onClick={()=>{try{const d=JSON.parse(json);
              if(d.entities){setEntities(d.entities);adoptSelection(d.entities);}
              if(d.traits)setTraits(normalizeTraits(d.traits));
              if(d.edges)setEdges(d.edges);
              // Сценарии, сохранённые до появления редактируемых классификаций,
              // поля kinds не содержат — оставляем текущий набор.
              if(Array.isArray(d.kinds)&&d.kinds.length)setKinds(d.kinds);
              if(Array.isArray(d.okrs))setOkrs(d.okrs);
              if(Array.isArray(d.tasks))setTasks(d.tasks);
              setJsonMsg("Загружено.");}
              catch{setJsonMsg("Не разобрал JSON.");}}}>Загрузить</button>
            {jsonMsg&&<span style={{fontSize:12,color:C.muted,alignSelf:"center"}}>{jsonMsg}</span>}
          </div>
          <TxtField area value={json} style={{minHeight:300,
            fontFamily:"ui-monospace, monospace",fontSize:11}} onCommit={setJson}/>
        </div>)}

      {/* ═══ СОХРАНЕНИЕ НА ДИСКЕ СЕРВЕРА ═══
          Отдельный блок поверх существующей вкладки JSON: ничего из логики/расчётов/
          разметки выше не тронуто — это только I/O к бэкенду для дисковых сценариев. */}
      {tab==="json"&&(
        <div style={{...S.card,marginTop:10}}>
          <div style={S.lbl}>сохранённые сценарии{savedWhere?` · ${savedWhere}`:""}</div>
          <div className="flex flex-wrap gap-2" style={{margin:"6px 0 8px",alignItems:"center"}}>
            <TxtField value={saveName} placeholder="имя сценария" style={{flex:"2 1 180px"}}
              onCommit={setSaveName}/>
            <button style={btn(true)} disabled={savedBusy} onClick={saveToDisk}>
              {savedSel?"Сохранить (обновить)":"Сохранить"}</button>
          </div>
          <div className="flex flex-wrap gap-2" style={{marginBottom:8,alignItems:"center"}}>
            <select style={{...S.inp,flex:"2 1 220px"}} value={savedSel}
              onChange={e=>{const id=e.target.value;setSavedSel(id);
                const s=savedList.find(x=>x.id===id);if(s)setSaveName(s.name);}}>
              <option value="">— выбери сохранённый сценарий —</option>
              {savedList.map(s=>(<option key={s.id} value={s.id}>
                {s.name} · {new Date(s.savedAt).toLocaleString("ru-RU")}</option>))}
            </select>
            <button style={btn(false)} disabled={savedBusy||!savedSel} onClick={loadFromDisk}>
              Загрузить</button>
            <button style={{...btn(false),color:BAD,borderColor:"#5A2436"}}
              disabled={savedBusy||!savedSel} onClick={deleteFromDisk}>Удалить</button>
            <button style={btn(false)} disabled={savedBusy} onClick={refreshSavedList}>
              ↻ обновить список</button>
          </div>
          {savedMsg&&<div style={{fontSize:12,color:C.muted}}>{savedMsg}</div>}
        </div>)}
    </div>);
}
