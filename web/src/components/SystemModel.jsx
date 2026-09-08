import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { detectStorage, STORAGE_LABEL, listScenarios, getScenario, saveScenario,
  deleteScenario, syncSchedule, pickScenario, rememberScenario, touchScenario,
  forgetScenario } from "../storage.js";
import { SOLO, whoAmI, getWorkspace, listOrg, putWorkspace, reviewTaskRemote,
  addRole, removeRole, setUserRole,
  takeTaskRemote, submitTaskRemote, commentTaskRemote, dropCommentRemote, getRatings,
  putSpaceRemote, setupTaskRemote }
  from "../identity.js";
import { askAssistant, listMemory } from "../assistant.js";
import { callFromLocation } from "../calls.js";
import { C, OK, WARN, BAD, NEU, ACC, S, btn, durText, nm, NumField, TxtField }
  from "./ui.jsx";
import { WHY_ASSET, WHY_FUNC, WHY_TRAIT, WORKER_KINDS, checkAsset, countWorkers, crewOf,
  normalizeAssets,
  normalizeFactors, normalizeFuncs, pruneWorkers, workersOf } from "../lib/funcs.js";
import { forecast, load, reach, transfers } from "../lib/plan.js";
import { actionsOf, goalRuns, normalizeGoals, perMonth, planGoal } from "../lib/goals.js";
import GoalsPanel from "./GoalsPanel.jsx";
import AssetPanel from "./AssetPanel.jsx";
import TasksBoard, { autoFlow, runsOfFunc } from "./TasksBoard.jsx";
import TasksTab from "./TasksTab.jsx";
import Timeline from "./Timeline.jsx";
import ReviewBoard from "./ReviewBoard.jsx";
import PeoplePanel from "./PeoplePanel.jsx";
import AssistantSettings from "./AssistantSettings.jsx";
import CallsBoard from "./CallsBoard.jsx";
import { useHistory, sameDoc } from "../lib/history.js";
import { readDraft, saveDraft, clearDraft } from "../lib/draft.js";
import Modal from "./Modal.jsx";
import ProfilePanel, { RemindersCard, warnMinOf } from "./ProfilePanel.jsx";
import ReportsPanel from "./ReportsPanel.jsx";
import { normalizeReports, reportFromLocation } from "../lib/reports.js";
import { emptySpace, filesOf, normalizeSpace } from "../lib/space.js";

/* ════════════════════════════════════════════════════════════════
   СХЕМА ЖИЗНЕСПОСОБНОСТИ · v9

   Модель состоит из активов. Актив — это:

     · воркеры: исполнители и проверяющие, его люди;
     · функции: то, что эти люди выполняют;
     · ресурсы: то, что функции потребляют и передают.

   Больше в модели ничего нет. Прежние стрелки «актив → ресурс» с
   интенсивностью, периодом, знаком и условиями, гипотезы, ключевые
   результаты OKR и расчёт по ним — убраны целиком: они описывали движение
   ресурсов в обход того, что его на самом деле производит, и работа
   человека к ним не относилась никак.

   Считает теперь одно: функции (см. lib/plan.js). Из времени одного
   выполнения выходит, сколько раз функция срабатывает за месяц; из вилок
   входов и выходов — сколько ресурса при этом уходит и приходит. Прогноз
   поэтому не линия, а лента: вилка — гипотеза, и притворяться знанием она
   не должна. Фактические выполнения приходят из принятых задач и
   уточняют её средним арифметическим.
   ════════════════════════════════════════════════════════════════ */

const KINDS0=[
  {id:"res",sign:"◆",name:"ресурс",color:"#7CE0FF",dir:"up"},
  {id:"growth",sign:"▲",name:"рост",color:"#3DDC97",dir:"up"},
  {id:"cost",sign:"▼",name:"затрата",color:"#FF9E64",dir:"down"},
];
const NOKIND={id:"",sign:"?",name:"без типа",color:NEU,dir:"up"};
const kindLookup=(kinds)=>(id)=>kinds.find(k=>k.id===id)||NOKIND;
const NW=208,NH=126;

/* Стартовая модель — маленькая, но замкнутая: спрос превращается в заявки,
   заявки в обработанные, обработанные возвращаются спросом. Пустое
   приложение не показывает ни одной связи, а на выдуманно большом не видно,
   из чего оно собрано. */
const ENTITIES0=normalizeAssets([
  {id:"mkt",name:"Рынок услуг",color:"#FFD166",x:24,y:24},
  {id:"usr",name:"Пользователи",color:"#7CE0FF",x:398,y:24},
  {id:"vm",name:"Виртуальный менеджер",color:"#3DDC97",x:398,y:300},
]);
const T=(id,e,k,l,unit,have)=>({id,e,k,l,unit,have});
const TRAITS0=[
  T("dem","mkt","res","спрос","обращ.",3000),
  T("act","usr","growth","активные пользователи","чел.",20),
  T("req","usr","res","заявки","шт.",0),
  T("hdl","vm","growth","обработанные заявки","шт.",0),
];
/* Стартовая цель — образец записи, а не значение по умолчанию: она
   показывает, из чего цель состоит. Прежде цель была числом в поле
   ресурса, и по ней нельзя было сказать ни к какому сроку, ни какой ценой. */
const GOALS0=normalizeGoals([
  {id:"g_act",trait:"act",qty:10,rate:"week",dueKind:"in",dueIn:3,dueUnit:"мес",
    days:[1,2,3,4,5],costs:[],hours:2,hoursPer:"day"},
]);
const P=(trait,lo,hi)=>({id:`p_${trait}`,trait,lo,hi});
/* Стартовые функции приводим к нынешней записи здесь же: иначе первая
   отмена правки дописала бы недостающие поля, документ перестал бы совпадать
   с исходным, и черновик решил бы, что есть несохранённые изменения. */
const FUNCS0=normalizeFuncs([
  {id:"f_req",e:"usr",name:"Сбор заявок",
    takes:[P("dem",2,4)],gives:[P("req",1,1)],
    dur:2,durUnit:"ч",owners:[],reviewers:[],x:0,y:0},
  {id:"f_hdl",e:"vm",name:"Обработка заявки",
    takes:[P("req",1,1)],gives:[P("hdl",1,1),P("act",0,1)],
    dur:4,durUnit:"ч",owners:[],reviewers:[],x:0,y:0},
  {id:"f_dem",e:"mkt",name:"Сарафанное радио",
    takes:[P("hdl",1,1)],gives:[P("dem",1,3)],
    dur:1,durUnit:"дн",owners:[],reviewers:[],x:0,y:0},
]);

/* ─────── график: лента гипотезы и линия факта ───────
   Лента, а не линия: вилка входов и выходов — гипотеза, и рисовать её одной
   чертой значило бы показать знание, которого нет. Факт ложится поверх
   отдельной линией, когда выполнения появились. */
/* `upTo` — до какого месяца дорисован хвост. Ось всегда во весь горизонт:
   так видно, что впереди ещё есть куда расти, а сам хвост удлиняется, когда
   ползунок месяца едет вперёд. */
function Chart({lo,hi,fact,months,goalLine,cursorMonth,upTo}){
  const W=700,H=240,PL=54,PB=26,PT=12,PR=12;
  const all=[...(lo||[]),...(hi||[]),...(fact||[]),...(goalLine!=null?[goalLine]:[])];
  const max=Math.max(1,...all.filter(isFinite))*1.1;
  const x=i=>PL+(i/Math.max(1,months))*(W-PL-PR);
  const y=v=>PT+(1-Math.min(v,max)/max)*(H-PT-PB);
  const step=Math.max(1,Math.ceil(months/6));
  // Ноль месяцев — это всё равно точка «сейчас», а не пустота.
  const till=(row)=>(row||[]).slice(0,Math.max(1,(upTo??months)+1));
  const LO=till(lo),HI=till(hi),FT=fact?till(fact):null;
  const band=HI.length&&LO.length
    ?[...HI.map((v,i)=>`${x(i)},${y(v)}`),
      ...LO.map((v,i)=>`${x(LO.length-1-i)},${y(LO[LO.length-1-i])}`)].join(" ")
    :null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{display:"block"}}>
      {[0,.25,.5,.75,1].map((f,i)=>(<g key={i}>
        <line x1={PL} y1={y(max*f)} x2={W-PR} y2={y(max*f)} stroke={C.line}/>
        <text x={PL-6} y={y(max*f)+4} textAnchor="end" fontSize="10" fill={C.muted}
          fontFamily="ui-monospace, monospace">{nm(max*f)}</text></g>))}
      {Array.from({length:months+1}).map((_,i)=>i%step===0&&(
        <text key={i} x={x(i)} y={H-8} textAnchor="middle" fontSize="10" fill={C.muted}
          fontFamily="ui-monospace, monospace">{i}м</text>))}
      {band&&<polygon points={band} fill={`${WARN}22`} stroke="none"/>}
      {!!HI.length&&<polyline fill="none" stroke={WARN} strokeWidth="1.6"
        points={HI.map((v,i)=>`${x(i)},${y(v)}`).join(" ")}/>}
      {!!LO.length&&<polyline fill="none" stroke={WARN} strokeWidth="1.6"
        strokeDasharray="4 3" points={LO.map((v,i)=>`${x(i)},${y(v)}`).join(" ")}/>}
      {FT&&!!FT.length&&<polyline fill="none" stroke={OK} strokeWidth="2.2"
        points={FT.map((v,i)=>`${x(i)},${y(v)}`).join(" ")}/>}
      {goalLine!=null&&(<><line x1={PL} y1={y(goalLine)} x2={W-PR} y2={y(goalLine)}
        stroke={ACC} strokeWidth="1.4" strokeDasharray="5 4"/>
        <text x={W-PR} y={y(goalLine)-5} textAnchor="end" fontSize="10" fill={ACC}>цель</text></>)}
      {cursorMonth!=null&&<line x1={x(cursorMonth)} y1={PT} x2={x(cursorMonth)} y2={H-PB}
        stroke={ACC} strokeWidth="1.8"/>}
    </svg>);
}

/* ─────── СХЕМА ───────
   Активы и передачи между ними. Передача — выход функции с указанным
   получателем: другого способа ресурсу переехать в этой модели нет. */
function SchemeSVG({entities,traits,funcs,moves,zoom,sel,valuesFor,
  onSelectEntity,onMoveEntity,assetOk,onWhy,onOpenFunc}){
  const DRAG_MIN=4;
  const drag=useRef(null);
  // Пока блок ведут, его положение живёт здесь, а не в модели: правка модели
  // на каждое движение пальца перерисовывала бы всё приложение целиком.
  const [dragPos,setDragPos]=useState(null);

  const down=(ev,e)=>{
    if(!onMoveEntity) return;
    drag.current={id:e.id,sx:ev.clientX,sy:ev.clientY,ox:e.x,oy:e.y,moved:false};
  };
  useEffect(()=>{
    if(!onMoveEntity) return undefined;
    // Слушаем на окне, а не на блоке: Safari (значит, и Telegram на iOS)
    // ненадёжно держит pointer capture внутри <svg>.
    const move=(ev)=>{
      const d=drag.current; if(!d) return;
      const dx=ev.clientX-d.sx, dy=ev.clientY-d.sy;
      if(!d.moved&&Math.hypot(dx,dy)<DRAG_MIN) return;
      d.moved=true;
      d.x=Math.max(0,Math.round(d.ox+dx/zoom));
      d.y=Math.max(0,Math.round(d.oy+dy/zoom));
      setDragPos({id:d.id,x:d.x,y:d.y});
    };
    const up=()=>{
      const d=drag.current; if(!d) return;
      drag.current=null; setDragPos(null);
      if(d.moved) onMoveEntity(d.id,d.x,d.y); else onSelectEntity(d.id);
    };
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

  const ents=dragPos
    ? entities.map(e=>e.id===dragPos.id?{...e,x:dragPos.x,y:dragPos.y}:e)
    : entities;
  const anchor=(a,b)=>{const ax=a.x+NW/2,ay=a.y+NH/2,bx=b.x+NW/2,by=b.y+NH/2;
    const dx=bx-ax,dy=by-ay;
    const s=Math.min(dx===0?1e9:NW/2/Math.abs(dx),dy===0?1e9:NH/2/Math.abs(dy));
    return [ax+dx*s,ay+dy*s];};
  const ent=(id)=>ents.find(e=>e.id===id);
  const CW=Math.max(1000,...ents.map(e=>e.x+NW+24));
  const CH=Math.max(740,...ents.map(e=>e.y+NH+24));

  return (
    <div style={{overflow:"auto",WebkitOverflowScrolling:"touch"}}>
      <svg viewBox={`0 0 ${CW} ${CH}`} width={CW*zoom} height={CH*zoom}
        style={{display:"block"}}>
        <defs>
          <marker id="aw" markerWidth="9" markerHeight="9" refX="8" refY="3"
            orient="auto"><path d="M0,0 L8,3 L0,6 z" fill={ACC}/></marker></defs>

        {/* Передачи между активами: сколько ресурса в месяц уезжает.

            Каждая идёт своей полосой. Двусторонний обмен — обычное дело
            (одни отдают заявки, другие возвращают пользователей), и по одной
            линии такие передачи прятали бы друг друга: видно было бы только
            ту, что нарисована последней. */}
        {moves.map((w,i)=>{
          const a=ent(w.from),b=ent(w.to); if(!a||!b) return null;
          const [x1,y1]=anchor(a,b),[x2,y2]=anchor(b,a);
          const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)||1;
          // Полоса своя у каждой пары «откуда → куда»: обратная передача
          // уходит на другую сторону линии, а не ложится поверх.
          /* Своя полоса у каждой передачи. Сторону задавать не нужно: у
             встречной передачи линия направлена в другую сторону, и её
             перпендикуляр сам смотрит на другую сторону. Умножать это ещё
             и на «кто из активов раньше по алфавиту» значило бы отменить
             один поворот другим — обе таблички легли бы в одно место. */
          const same=moves.filter(v=>v.from===w.from&&v.to===w.to);
          const at=same.indexOf(w);
          /* Полосы разведены на высоту таблички: подпись лежит НА своей
             линии, а не сбоку от неё, и соседние подписи не наезжают друг
             на друга. Прежде табличку отодвигали от линии, чтобы развести
             подписи, — и получалось, что подпись висит сама по себе, и к
             какой стрелке она относится, приходилось угадывать. */
          const off=14+at*26;
          const ox=(-dy/len)*off,oy=(dx/len)*off;
          /* На своей же линии: табличка непрозрачная и закрывает отрезок
             под собой — так видно, что она именно на этой стрелке. Когда
             передач между теми же активами несколько, они делят линию
             поровну: одной полосы им мало — на косой линии соседние
             таблички наехали бы друг на друга углами. */
          const t=(at+1)/(same.length+1);
          const mx=x1+dx*t+ox,my=y1+dy*t+oy;
          const txt=`${w.name}: ${nm(w.lo)}–${nm(w.hi)}/мес`;
          const fn=funcs.find(f=>f.id===w.func);
          /* Стрелку рисует функция — значит по стрелке до неё и надо
             доходить. Прежде передачу было видно, а дотянуться до того, что
             её делает, приходилось через актив и вкладку. */
          return (<g key={w.id} style={{cursor:onOpenFunc?"pointer":"default"}}
            onPointerDown={ev=>ev.stopPropagation()}
            onClick={ev=>{ev.stopPropagation(); if(onOpenFunc) onOpenFunc(w.func);}}>
            <title>{fn?`${fn.name||"без названия"} — открыть функцию`:txt}</title>
            {/* Широкая прозрачная линия под тонкой: попасть пальцем в
                полуторапиксельную черту невозможно. */}
            <line x1={x1+ox} y1={y1+oy} x2={x2+ox} y2={y2+oy} stroke="transparent"
              strokeWidth="16"/>
            <line x1={x1+ox} y1={y1+oy} x2={x2+ox} y2={y2+oy} stroke={ACC}
              strokeWidth="1.6" strokeDasharray="4 3" markerEnd="url(#aw)"
              style={{pointerEvents:"none"}}/>
            <rect x={mx-70} y={my-11} width="140" height="22" rx="6" fill={C.panel}
              stroke={ACC} strokeWidth="1"/>
            <text x={mx} y={my+3.5} textAnchor="middle" fontSize="9" fill={ACC}
              style={{pointerEvents:"none"}}>
              {txt.length>26?txt.slice(0,25)+"…":txt}</text></g>);})}

        {ents.map(e=>{
          const ts=traits.filter(t=>t.e===e.id);
          const fs=funcs.filter(f=>f.e===e.id);
          const ok=assetOk(e.id);
          return (<g key={e.id} onPointerDown={ev=>down(ev,e)}
            style={{cursor:onMoveEntity?"grab":"pointer",touchAction:"none"}}>
            <rect x={e.x} y={e.y} width={NW} height={NH} rx="12" fill={C.panel}
              stroke={sel===e.id?ACC:C.line} strokeWidth={sel===e.id?2.6:1.6}/>
            <rect x={e.x} y={e.y} width="5" height={NH} rx="2.5" fill={e.color}/>
            <text x={e.x+14} y={e.y+26} fontSize="13.5" fontWeight="700" fill={C.text}>
              {e.name.length>23?e.name.slice(0,22)+"…":e.name}</text>
            <text x={e.x+14} y={e.y+44} fontSize="10.5" fill={ok?C.text:BAD}>актив</text>
            {!ok&&(<g style={{cursor:"help"}}
              onPointerDown={ev=>{ev.stopPropagation();}}
              onClick={ev=>{ev.stopPropagation();onWhy("asset",e.id);}}>
              <circle cx={e.x+52} cy={e.y+40} r="7.5" fill="transparent" stroke={BAD}/>
              <text x={e.x+52} y={e.y+43.5} textAnchor="middle" fontSize="9" fill={BAD}>?</text>
            </g>)}
            <text x={e.x+14} y={e.y+64} fontSize="10.5" fill={C.muted}>
              {countWorkers(e)} воркеров ·
              {" "}{fs.length} функц. · {ts.length} ресурс.</text>
            {ts.slice(0,2).map((t,i)=>{
              const v=valuesFor(t.id);
              return (<text key={t.id} x={e.x+14} y={e.y+84+i*17} fontSize="10.5"
                fill={C.muted} fontFamily="ui-monospace, monospace">
                {(t.l.length>14?t.l.slice(0,13)+"…":t.l)}: {nm(v.lo)}–{nm(v.hi)}</text>);})}
          </g>);})}
      </svg>
    </div>);
}

function whenText(iso){
  const d=new Date(iso);
  if(isNaN(d.getTime())) return "прошлого сеанса";
  const mins=Math.round((Date.now()-d.getTime())/60000);
  if(mins<1) return "только что";
  if(mins<60) return `${mins} мин назад`;
  const h=Math.round(mins/60);
  if(h<24) return `${h} ч назад`;
  return d.toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",
    minute:"2-digit"});
}

/* Порядок вкладок один на всех: роль решает, какие из них показать, но не
   в каком порядке — иначе у двух людей приложение выглядело бы по-разному
   не только составом, но и расположением. */
/* «Прогноз» отдельной вкладкой не стоит: он про ту же схему, только во
   времени, и ползунок месяца у них общий. Он живёт подвкладкой под схемой —
   рядом с «Управлением», где схему и правят. Роль по-прежнему решает,
   показывать ли его: вкладка `sim` открывает подвкладку, а не раздел. */
/* Главных вкладок четыре. «Деятельность» и «Прогноз» ушли под схему: обе про
   ту же модель, только во времени, и ползунок месяца у них общий со
   схемой. Держать их наверху значило разложить одно и то же по трём
   местам, между которыми надо помнить, где что. */
/* «Анкета» стоит первой и открыта всем вошедшим, а не по роли: это
   единственное место, где человек говорит о СЕБЕ, а не о работе. Спрятать
   её за ролью значило бы, что свою же анкету нельзя открыть без чужого
   разрешения. */
export const SELF_TAB=["me","Анкета"];
export const TAB_LIST=[SELF_TAB,["tasks","Задачи"],["review","Проверка"],
  ["scheme","Схема"],["reports","Отчёты"],["tools","Инструменты"]];

/* ════════════════ ГЛАВНОЕ ════════════════ */
/* Пространство — вспомогательный слой, и терять из-за него модель нельзя.
   Достройка (normalizeSpace) терпит мусор, но если она всё же упадёт, на
   экране должна остаться модель с пустым пространством, а не исключение:
   в загрузке сценария исключение уходило в .catch, .finally ставило
   ready=true — и на сервер уезжала демонстрационная модель ПОВЕРХ
   рабочей. */
const safeSpace=(v)=>{ try{ return normalizeSpace(v); }catch{ return emptySpace(); } };

/* Документ из внешней записи — сценария с диска или JSON из выгрузки —
   поверх текущего `cur`. Старые записи могут не знать про часть
   документа: недостающее остаётся текущим, а не превращается в пустоту.
   Путь один на все входы нарочно: пока «Загрузить» из выгрузки собирал
   документ своим набором сеттеров, он молча терял пространство, цели,
   факторы и отчёты — всё, что появилось в документе позже него. */
export function docFrom(data,cur){
  const d=data&&typeof data==="object"?data:{};
  const arr=(v,c,need)=>Array.isArray(v)&&(!need||v.length)?v:c;
  return {
    entities:normalizeAssets(arr(d.entities,cur.entities,true)),
    traits:arr(d.traits,cur.traits),
    kinds:arr(d.kinds,cur.kinds,true),
    tasks:arr(d.tasks,cur.tasks),
    funcs:normalizeFuncs(arr(d.funcs,cur.funcs)),
    goals:normalizeGoals(arr(d.goals,cur.goals)),
    factors:normalizeFactors(arr(d.factors,cur.factors)),
    reports:normalizeReports(arr(d.reports,cur.reports)),
    space:safeSpace(d.space??cur.space),
  };
}

export default function SystemModel(){
  const [entities,setEntities]=useState(ENTITIES0);
  const [traits,setTraits]=useState(TRAITS0);
  const [kinds,setKinds]=useState(KINDS0);
  const [kindMsg,setKindMsg]=useState("");
  const [funcs,setFuncs]=useState(FUNCS0);
  const [tasks,setTasks]=useState([]);
  /* Цели — часть документа наравне с ресурсами и функциями: они уехали с
     ресурса, где были одним числом, и стали записью со сроком, темпом и
     ценой (см. lib/goals.js). */
  const [goals,setGoals]=useState(GOALS0);
  /* Факторы — то, что меняет ресурсы без человека. Часть документа наравне
     с ресурсами: фактор один, а функций от него может быть несколько. */
  const [factors,setFactors]=useState([]);
  /* Отчёты — карта проектов и разделов. Часть документа наравне с
     ресурсами: она про ту же работу, только собранную по заказам, а не по
     активам, и жить отдельно от модели ей незачем. */
  const [reports,setReports]=useState([]);
  /* Пространство вкладки задач — часть документа наравне с отчётами:
     положение блоков, стрелки и заметки живут с моделью, а не в браузере.
     У позванного оно своё и уезжает на сервер отдельно (см. ниже). */
  const [space,setSpace]=useState(()=>normalizeSpace(null));
  // Какой блок карты просят открыть ссылкой — читается из адреса один раз.
  const [reportFocus,setReportFocus]=useState(()=>
    reportFromLocation(typeof window==="undefined"?"":window.location.search));
  /* Пришли по ссылке на блок карты — открываем сразу отчёты: человек
     просил не приложение вообще, а конкретный раздел. */
  const [tab,setTab]=useState(()=>(
    reportFromLocation(typeof window==="undefined"?"":window.location.search)
      ?"reports":"tasks"));
  const [sel,setSel]=useState("usr");
  const [why,setWhy]=useState(null);
  /* Что попросили открыть в карточке актива — например, функцию, которая
     рисует стрелку передачи. Метка `n` нужна, чтобы повторное нажатие на ту
     же стрелку снова открыло карточку, а не осталось незамеченным. */
  const [focus,setFocus]=useState(null);
  // Кого раскрыли в списке воркеров: вся его история — в окне.
  const [person,setPerson]=useState(null);
  /* Кого показывают карточкой поверх схемы. Окно, а не вкладка: человека
     смотрят, не отходя от того, что сейчас собирают, — и закрывают,
     возвращаясь ровно туда, где были. Прежде нажатие уносило на страницу
     человека, и вернуться было некуда. */
  const [card,setCard]=useState(null);
  /* Реестр опубликованных оценок и ответ сервера про рейтинги. Не часть
     `doc`: реестр ведёт сервер (PUT его отбрасывает), и в историю правок он
     не идёт. */
  const [published,setPublished]=useState([]);
  const [ratings,setRatings]=useState(null);
  const [horizon,setHorizon]=useState(24);
  const [zoom,setZoom]=useState(0.6);
  const [json,setJson]=useState(""); const [jsonMsg,setJsonMsg]=useState("");
  const [savedList,setSavedList]=useState([]);
  const [savedSel,setSavedSel]=useState("");
  const [saveName,setSaveName]=useState("");
  const [savedMsg,setSavedMsg]=useState("");
  const [savedBusy,setSavedBusy]=useState(false);
  const [savedWhere,setSavedWhere]=useState("");
  const [openTask,setOpenTask]=useState(null);
  const [simMonth,setSimMonth]=useState(0);
  // Что открыто под схемой: правка модели или её будущее.
  const [under,setUnder]=useState("edit");
  const [me,setMe]=useState(SOLO);
  const [openCards,setOpenCards]=useState(()=>new Set());
  const [openCall,setOpenCall]=useState(()=>callFromLocation());
  const [people,setPeople]=useState([]);
  /* Должности (роли организации) — чтобы в списке воркеров было видно, кем
     человек вообще числится. Приходят тем же запросом, что и люди: два
     запроса за одним ответом расходились бы. */
  const [roles,setRoles]=useState([]);
  /* Должности и люди перечитываются после каждой правки из блока воркеров:
     список ведёт сервер, и показывать своё предположение о нём незачем. */
  const refreshOrg=useCallback(()=>listOrg().then(o=>{
    if(o?.users) setPeople(o.users);
    if(o?.roles) setRoles(o.roles);
  }).catch(()=>{}),[]);
  useEffect(()=>{ let live=true;
    whoAmI().then(m=>{ if(live) setMe(m); }).catch(()=>{});
    return ()=>{ live=false; };
  },[]);
  /* Люди нужны не только на своей вкладке: их выбирают в воркеры актива и
     назначают на задачи. Пока список подтягивался открытием «Людей и
     ролей», в воркерах было написано «людей ещё нет» — и это была
     неправда: они были, просто их не спросили. */
  useEffect(()=>{ let live=true;
    if(!me.known||me.solo) return undefined;
    listOrg().then(o=>{ if(!live||!o) return;
      if(o.users) setPeople(o.users);
      if(o.roles) setRoles(o.roles);
    }).catch(()=>{});
    return ()=>{ live=false; };
  },[me.known,me.solo]);
  const [tool,setTool]=useState("people");
  useEffect(()=>{ if(openCall && me.tabs.includes("tools")) { setTab("tools"); setTool("calls"); } },
    [openCall,me.tabs]);

  const ent=(id)=>entities.find(e=>e.id===id);
  const kindOf=useMemo(()=>kindLookup(kinds),[kinds]);

  // ─── история правок: отмена и возврат ───
  const doc=useMemo(()=>({entities,traits,kinds,tasks,funcs,goals,factors,reports,space}),
    [entities,traits,kinds,tasks,funcs,goals,factors,reports,space]);
  const restoreDoc=useCallback((d)=>{
    // Документ достраивается до нынешней записи, но НЕ переносится из
    // прежних версий: модели, собранные под старый расчёт, работать не
    // должны — см. lib/funcs.js.
    setEntities(normalizeAssets(d.entities));
    setTraits(Array.isArray(d.traits)?d.traits:[]);
    setKinds(d.kinds); setTasks(d.tasks); setFuncs(normalizeFuncs(d.funcs));
    setGoals(normalizeGoals(d.goals));
    setFactors(normalizeFactors(d.factors));
    setReports(normalizeReports(d.reports));
    setSpace(safeSpace(d.space));
    setSel(s=>d.entities.some(e=>e.id===s)?s:(d.entities[0]?.id??null));
  },[]);
  const hist=useHistory(doc,restoreDoc);

  // ─── черновик: страховка от внезапного закрытия вкладки ───
  const [recovery,setRecovery]=useState(()=>readDraft());
  const [draftBlocked,setDraftBlocked]=useState(false);
  const savedDoc=useRef(doc);
  const docRef=useRef(doc); docRef.current=doc;
  const saveNameRef=useRef(saveName); saveNameRef.current=saveName;
  const writeDraft=useCallback(()=>{
    if(sameDoc(docRef.current,savedDoc.current)){ clearDraft(); setDraftBlocked(false); return; }
    setDraftBlocked(!saveDraft(docRef.current,{name:saveNameRef.current}));
  },[]);
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

  // ─── активы ───
  const moveE=(id,x,y)=>{
    // NaN уедет в сохранённый сценарий и актив пропадёт со схемы навсегда.
    if(!Number.isFinite(x)||!Number.isFinite(y)) return;
    setEntities(p=>p.map(e=>e.id===id
      ?{...e,x:Math.max(0,Math.round(x)),y:Math.max(0,Math.round(y))}:e));
  };
  const addEntity=()=>{
    const id="en"+Date.now();
    const y=entities.length?Math.max(...entities.map(e=>e.y))+NH+40:24;
    const palette=["#7CE0FF","#C792EA","#FFD166","#3DDC97","#FF9E64","#FF5C7A","#8B9DFF"];
    setEntities(p=>[...p,{id,name:"Новый актив",owners:[],reviewers:[],
      color:palette[p.length%palette.length],x:24,y}]);
    setSel(id);
  };
  const GAP_X=48, GAP_Y=56;
  const alignGrid=()=>{
    const rows=[];
    [...entities].sort((a,b)=>a.y-b.y||a.x-b.x).forEach(e=>{
      const row=rows[rows.length-1];
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
    setTraits(p=>p.filter(t=>t.e!==id));
    // Функции живут внутри актива: без него они повисли бы ссылкой в
    // никуда. А чужие функции могли брать и выдавать его ресурсы — такие
    // входы и выходы тоже уходят вместе с ресурсами.
    const gone=new Set(funcs.filter(f=>f.e===id).map(f=>f.id));
    setFuncs(p=>p.filter(f=>f.e!==id).map(f=>({...f,
      takes:f.takes.filter(t=>!own.has(t.trait)),
      gives:f.gives.filter(g=>!own.has(g.trait))})));
    // Задачи выполняли функции этого актива — выполнять больше нечего.
    setTasks(p=>p.filter(t=>!gone.has(t.funcId)));
    // Факторы принадлежат активу так же, как ресурсы: без него им негде быть.
    setFactors(p=>p.filter(x=>x.e!==id));
    setEntities(p=>p.filter(e=>e.id!==id));
    setSel(p=>p===id?(entities.find(e=>e.id!==id)?.id??null):p);
  };
  const delTrait=(id)=>{
    setTraits(p=>p.filter(t=>t.id!==id));
    // Удалённый ресурс не должен оставаться во входах и выходах функций:
    // там он превратился бы в «(ресурс удалён)» и в ноль в расчёте.
    setFuncs(p=>p.map(f=>({...f,
      takes:f.takes.filter(t=>t.trait!==id),
      gives:f.gives.filter(g=>g.trait!==id)})));
  };
  /* Воркер актива — прямой выбор из всех людей схемы: сперва отмечают, кто
     здесь работает, и уже из отмеченных выбирают постановщика, исполнителя
     и проверяющего У КАЖДОЙ ФУНКЦИИ.

     Снятая отметка уносит человека со всех функций этого актива: иначе он
     остался бы назначенным, не значась в активе, и задача висела бы на
     том, кого здесь нет. Прежние списки ролей у самого актива при этом
     тоже чистятся — они больше не редактируются, но у старых моделей
     остались, и `crewOf` читает их как членство. */
  const toggleCrew=(pid)=>{
    const e=entities.find(x=>x.id===sel);
    if(!e) return;
    const has=crewOf(e).some(x=>String(x)===String(pid));
    setEntities(p=>p.map(x=>{
      if(x.id!==sel) return x;
      if(!has) return {...x,crew:[...crewOf(x),pid]};
      const drop=(list)=>(list||[]).filter(z=>String(z)!==String(pid));
      return {...x,crew:drop(crewOf(x)),
        ...Object.fromEntries(WORKER_KINDS.map(k=>[k.id,drop(x[k.id])]))};
    }));
    if(has) setFuncs(p=>pruneWorkers(p,sel,
      Object.fromEntries(WORKER_KINDS.map(k=>[k.id,
        (e[k.id]||[]).filter(z=>String(z)!==String(pid))]))));
  };
  /* Порядок воркеров — свой, руками, и он же решает, кого показывать
     первым в формах выбора: у выбирающего бывают причины, которых в цифрах
     нет. Роли при этом всегда сортируются по рейтингу — там вопрос «кому
     поручить», и первым должен стоять тот, кто лучше справлялся. */
  const orderWorker=(pid,delta)=>{
    setEntities(p=>p.map(e=>{
      if(e.id!==sel) return e;
      const list=crewOf(e);
      const i=list.findIndex(x=>String(x)===String(pid));
      const j=i+delta;
      if(i<0||j<0||j>=list.length) return e;
      [list[i],list[j]]=[list[j],list[i]];
      return {...e,crew:list};
    }));
  };

  /* ─── общая модель ───
     Владелец пишет модель на сервер, остальные её оттуда читают: только так
     исполнитель вообще увидит поставленную ему задачу. */
  const fromWorkspace=useCallback((w)=>({
    entities:w?.entities||[], traits:w?.traits||[],
    kinds:(w?.kinds&&w.kinds.length)?w.kinds:KINDS0,
    tasks:w?.tasks||[], funcs:w?.funcs, goals:w?.goals||[],
    factors:w?.factors||[],
    reports:w?.reports||[],
    space:w?.space||null,
  }),[]);
  /* Разобрались ли, что открывать. До этого момента на экране может стоять
     встроенная демонстрационная модель, и выгружать её на сервер нельзя. */
  const [ready,setReady]=useState(false);

  // ─── напоминания ───
  /* Расписание задачи — её собственное: когда начать. А вот ЗА СКОЛЬКО
     предупредить — не задачи, а человека: напоминание приходит ему, и
     «за сколько» он выбирает в инструментах (`me.profile.warnMin`).
     Прежде это поле стояло в задаче, и постановщик решал за исполнителя;
     теперь в расписание каждой задачи подставляется своё у того, кто его
     шлёт, — расписание у каждого своё, и бот пишет ему же. */
  const warn=warnMinOf(me.profile?.warnMin);
  /* В расписание — только то, что поручено ЭТОМУ человеку: уведомление о
     заказе приходит исполнителю, а не всем, кто задачу видит. Владельцу,
     постановщику и проверяющему чужая работа не напоминает о себе. */
  const scheduled=useMemo(()=>tasks
    .filter(t=>t.assignee!=null&&t.assignee!==""&&String(t.assignee)===String(me.id))
    .map(t=>({...t,start:t.start||null,repeat:"once",end:null,warn})),[tasks,warn,me.id]);
  /* Пересылается и при входе, не только при правке: записи, сделанные до
     v1.1, не несут исполнителя, и кнопки под напоминанием появятся у них
     только после того, как доска пришлёт расписание заново. Ждём, пока
     станет ясно, кто вошёл, а у владельца — ещё и что открыто: до этого на
     экране может стоять встроенная демонстрация, и слать её боту нельзя. */
  const settled=me.known&&(!me.isOwner||ready);
  useEffect(()=>{
    if(!settled) return undefined;
    const id=setTimeout(()=>{ syncSchedule(scheduled).catch(()=>{}); },1200);
    return ()=>clearTimeout(id);
  },[scheduled,settled]);

  const pulled=useRef(false);
  // Что из пространства позванного сервер уже хранит (см. эффект ниже).
  const spaceSaved=useRef(null);
  useEffect(()=>{
    if(me.solo) return;
    if(pulled.current) return;
    pulled.current=true;
    getWorkspace().then(w=>{
      setPublished(Array.isArray(w?.published)?w.published:[]);
      // Владельцу подставлять серверную модель поверх открытой нельзя: он
      // мог начать править до того, как ответ пришёл. Ему она достаётся
      // иначе — автозагрузкой ниже, и только когда открывать больше нечего.
      if(me.isOwner) return;
      restoreDoc(fromWorkspace(w));
      /* Список людей организации — владельцу; позванному сервер кладёт в
         срез имена тех, с кем он работает: воркеров его активов и
         участников его задач. Без них постановщику было бы не из кого
         выбирать исполнителя, а «поставил: 100» читалось бы номером. */
      if(Array.isArray(w?.people)) setPeople(w.people);
      // С этого момента пространство позванного — его собственное на
      // сервере; до ответа выгружать было бы нечего, кроме пустоты.
      spaceSaved.current=JSON.stringify(normalizeSpace(w?.space));
    }).catch(()=>{});
  },[me.solo,me.isOwner,restoreDoc,fromWorkspace]);
  /* Пространство позванного едет на сервер само, отдельно от модели:
     модель целиком пишет владелец, а заметки исполнителя — его, и в
     модель они не попадают. Пока серверное не приехало, писать нечего. */
  useEffect(()=>{
    if(me.solo||me.isOwner||spaceSaved.current==null) return;
    const now=JSON.stringify(space);
    if(now===spaceSaved.current) return;
    const id=setTimeout(()=>{
      putSpaceRemote(space).then(()=>{ spaceSaved.current=now; }).catch(()=>{});
    },1500);
    return ()=>clearTimeout(id);
  },[space,me.solo,me.isOwner]);
  /* Рейтинги — с сервера и его глазами: про себя человек видит только
     адресованные ему слова. Читаются при входе и при каждом заходе на
     анкету: каждое чтение — попытка опубликовать то, что стало анонимным. */
  const onMe=tab==="me";
  useEffect(()=>{
    if(!me.known||me.solo) return;
    getRatings().then(r=>{ if(r&&typeof r==="object") setRatings(r); }).catch(()=>{});
  },[me.known,me.solo,onMe]);
  /* Выгрузка модели на сервер ждёт, пока приложение разберётся, что вообще
     открывать.

     Иначе выходило вот что: приложение поднималось на встроенной
     демонстрационной модели, и через полторы секунды она уезжала на сервер
     ПОВЕРХ настоящей работы владельца — раньше, чем та успевала оттуда
     приехать. Один заход, ничего не трогая, — и работа на сервере
     заменена демонстрацией. Ошибка тем злее, что чинить её нечем: сервер
     хранит одну модель, прежней там уже нет. */
  useEffect(()=>{
    if(me.solo||!me.isOwner||!ready) return;
    const id=setTimeout(()=>{ putWorkspace(doc).catch(()=>{}); },1500);
    return ()=>clearTimeout(id);
  },[doc,me.solo,me.isOwner,ready]);

  // ─── классификации ресурсов ───
  const upK=(id,f,v)=>setKinds(p=>p.map(k=>k.id===id?{...k,[f]:v}:k));
  const addKind=()=>setKinds(p=>[...p,{id:"k"+Date.now(),sign:"•",
    name:"новая классификация",color:ACC,dir:"up"}]);
  const delKind=(id)=>{
    if(kinds.length<=1) return "Нельзя удалить последнюю классификацию.";
    const rest=kinds.filter(k=>k.id!==id);
    const used=traits.filter(t=>t.k===id);
    if(used.length) setTraits(p=>p.map(t=>t.k===id?{...t,k:rest[0].id}:t));
    setKinds(rest);
    return used.length
      ?`Удалено. ${used.length} ресурс(ов) переведено в «${rest[0].name}».`
      :"Удалено.";
  };

  // ─── сценарии на диске ───
  const refreshSavedList=async()=>{
    try{ setSavedList(await listScenarios()); }
    catch{ setSavedMsg("Не удалось получить список сохранённых сценариев."); }
  };
  useEffect(()=>{ if(tab!=="tools"||tool!=="export") return;
    refreshSavedList();
    detectStorage().then(k=>setSavedWhere(STORAGE_LABEL[k]||"")).catch(()=>{});
  },[tab,tool]);
  const saveToDisk=async()=>{
    setSavedBusy(true);
    try{
      const isUpdate=savedSel&&savedList.some(s=>s.id===savedSel);
      const snapshot=doc;
      const saved=await saveScenario({id:isUpdate?savedSel:null,name:saveName,
        data:snapshot});
      savedDoc.current=snapshot; clearDraft(); setRecovery(null);
      setSavedMsg(`Сохранено: «${saved.name}».`);
      setSavedSel(saved.id);
      rememberScenario(saved.id);

      await refreshSavedList();
    }catch(e){ setSavedMsg(e.message||"Не удалось сохранить."); }
    setSavedBusy(false);
  };
  const openScenario=useCallback(async(id,{guard}={})=>{
    const s=await getScenario(id);
    if(!s) throw new Error("Сценарий не найден.");
    // Пока схема ехала с диска, человек мог применить черновик — тогда
    // подставлять её поверх нельзя: он потеряет свои правки.
    if(guard&&!guard()) return null;
    const loaded=docFrom(s.data,docRef.current);
    restoreDoc(loaded);
    savedDoc.current=loaded; clearDraft(); setRecovery(null);
    setSaveName(s.name); setSavedSel(s.id);
    /* Эта схема теперь и есть «последняя открытая»: с неё начнётся
       следующий заход. Отметка ставится и в браузере, и там, где лежит сам
       сценарий, — браузерная память Telegram чистит без предупреждения, а
       с другого устройства её и вовсе нет. */
    touchScenario(s.id);
    return s;
  },[restoreDoc]);

  /* ─── какая схема открывается ───

     Приложение открывается на той схеме, с которой работали в прошлый раз,
     а не на встроенной демонстрационной: она нужна ровно один раз — первому
     заходу, когда сохранённых схем ещё нет.

     Черновик несохранённых правок сильнее: если он есть, показывается плашка
     «восстановить», и подставлять поверх неё что-то с диска нельзя — человек
     потерял бы правки, ради которых черновик и пишется.

     У не-владельца схема одна: та, где его назначил владелец. Она приезжает
     с сервера ниже, и сценариев на диске у него нет вовсе. */
  const opened=useRef(false);
  /* Жив ли ещё компонент. Именно компонент, а не этот заход эффекта:
     эффект перезапускается от каждой смены зависимостей — а «кто я»
     приходит одним запросом и меняет их раньше, чем список схем успевает
     прийти двумя. Уборка внутри эффекта гасила бы незавершённую загрузку,
     а повторный заход упирался бы в `opened` и не делал уже ничего —
     человек оставался на встроенной демонстрационной схеме. */
  const alive=useRef(true);
  useEffect(()=>()=>{ alive.current=false; },[]);
  /* Человек уже применил черновик — значит на экране его правки, и
     подставлять поверх них что-либо нельзя. Прежде автозагрузка вместо
     этого просто НЕ ЗАПУСКАЛАСЬ, пока висит плашка: под ней оставалась
     встроенная демонстрационная схема, и человек, не заметивший плашку,
     каждый раз видел не свою модель. Теперь загрузка идёт своим чередом, а
     «Восстановить» её перебивает. */
  const restored=useRef(false);
  useEffect(()=>{
    if(opened.current) return;
    if(!me.isOwner&&!me.solo) return;   // не-владельцу схему даёт сервер
    opened.current=true;
    const idle=()=>alive.current&&!restored.current;
    /* Что бы ни вышло — открыли схему, не нашли ни одной, не достучались до
       диска, — после этого выгрузка на сервер разрешена. Иначе владелец,
       у которого хранилище недоступно, вообще перестал бы синхронизировать
       модель. */
    const done=()=>{ if(alive.current) setReady(true); };
    pickScenario().then(s=>{
      if(!idle()) return undefined;
      if(s) return openScenario(s.id,{guard:idle}).catch(()=>{});
      /* Сохранённых схем нет — но у владельца есть его же рабочая модель на
         сервере: она уезжает туда сама, при каждой правке. Это ровно то, с
         чем он закончил в прошлый раз, и открывать вместо неё встроенную
         демонстрационную — значит каждый раз терять работу человека,
         которую сервер при этом исправно хранит. */
      /* Дожидаемся ответа «кто я», а не подглядываем в нынешнее значение:
         список схем приходит быстрее, и в этот момент человек ещё числится
         одиночным — тогда за рабочей моделью никто бы не пошёл. Ответ
         запомнен, повторный вызов ничего не стоит. */
      return whoAmI().catch(()=>SOLO).then(m=>{
        if(m.solo||!m.isOwner) return undefined;
        return getWorkspace().then(w=>{
          setPublished(Array.isArray(w?.published)?w.published:[]);
          if(!idle()) return;
          if(!Array.isArray(w?.entities)||!w.entities.length) return;
          const loaded=fromWorkspace(w);
          restoreDoc(loaded);
          // Это не «несохранённые правки»: сервер их уже хранит.
          savedDoc.current=loaded;
        }).catch(()=>{});
      });
    }).catch(()=>{}).finally(done);
    return undefined;
  },[me.isOwner,me.solo,recovery,openScenario,restoreDoc,fromWorkspace]);

  const loadFromDisk=async()=>{
    if(!savedSel){ setSavedMsg("Выбери сохранённый сценарий."); return; }
    setSavedBusy(true);
    try{
      const s=await getScenario(savedSel);
      if(!s) throw new Error("Сценарий не найден.");
      const loaded=docFrom(s.data,docRef.current);
      restoreDoc(loaded);
      savedDoc.current=loaded; clearDraft(); setRecovery(null);
      setSaveName(s.name);
      touchScenario(s.id);
      setSavedMsg(`Загружено: «${s.name}».`);
    }catch(e){ setSavedMsg(e.message||"Не удалось загрузить сценарий."); }
    setSavedBusy(false);
  };
  const deleteFromDisk=async()=>{
    if(!savedSel) return;
    setSavedBusy(true);
    try{
      await deleteScenario(savedSel);
      forgetScenario(savedSel);
      setSavedSel(""); setSavedMsg("Удалено.");
      await refreshSavedList();
    }catch(e){ setSavedMsg(e.message||"Не удалось удалить сценарий."); }
    setSavedBusy(false);
  };

  // Кому какие задачи видны. Владельцу — все; остальным — только его.
  const myTasks=useMemo(()=>(me.isOwner?tasks:tasks.filter(t=>
    String(t.assignee||"")===String(me.id))),[tasks,me.isOwner,me.id]);
  /* Файлы для пространства — из сдач (submissions[].files и .file) и
     разделов отчёта; считаются из модели, а не хранятся. */
  const spaceFiles=useMemo(()=>filesOf({tasks:myTasks,reports}),[myTasks,reports]);
  /* Память помощника — своя у каждого; читается при заходе на вкладку задач. */
  const [memory,setMemory]=useState([]);
  useEffect(()=>{ if(tab!=="tasks"||me.solo) return;
    listMemory().then(m=>setMemory(Array.isArray(m)?m:[])).catch(()=>setMemory([])); },[tab,me.solo]);
  const personName=useCallback((id)=>{
    if(id==null||id==="") return "не назначен";
    return people.find(p=>String(p.id)===String(id))?.name||String(id);
  },[people]);
  /* Должность человека — роль, которую ему дали в организации. Не задана —
     так и сказано словом: пустое место читалось бы как «ещё грузится». */
  const roleName=useCallback((id)=>{
    const u=people.find(p=>String(p.id)===String(id));
    return roles.find(r=>r.id===u?.roleId)?.name||"";
  },[people,roles]);
  /* Решение проверяющего — не только статус: оценка и слова уходят в
     историю исполнителя, из которой потом растёт его рейтинг. Пишем их
     отдельным списком `reviews`, а не в комментарии: комментарий может
     оставить кто угодно и когда угодно, а решение — это ровно приём или
     возврат, с оценкой и автором. */
  const decide=useCallback((task,accept,note,mark,hidden=false)=>{
    const at=new Date().toISOString();
    const review={id:"rv"+Date.now().toString(36),at,by:me.id??null,
      accept:!!accept,mark:Number(mark)||null,comment:String(note||""),hidden:!!hidden};
    setTasks(p=>p.map(t=>t.id===task.id?{...t,
      status:accept?"done":"backlog",
      // Возвращённая задача снова лежит и ждёт: её берут в работу заново,
      // иначе она вернулась бы уже взятой и «Взять в работу» не появилось.
      taken:accept?t.taken:false,
      reviews:[...(t.reviews||[]),review],
      comments:note?[...(t.comments||[]),
        {id:"c"+Date.now().toString(36),text:note,at,by:me.id??null,
          to:t.assignee==null?null:String(t.assignee),hidden:!!hidden}]
        :(t.comments||[]),
    }:t));
    reviewTaskRemote(task.id,{accept,comment:note,mark:review.mark,hidden:!!hidden}).catch(()=>{});
  },[setTasks,me.id]);
  const toggleCard=useCallback((id)=>setOpenCards(p=>{
    const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n;
  }),[]);

  /* Задачи, где человек один и тот же по обе стороны передачи, двигаются
     сами: постановщик, равный исполнителю, ставит задачу без нажатия;
     проверяющий, равный исполнителю, принимает сдачу без нажатия. Здесь, а
     не на доске: правило одно на всё приложение, и задача не должна
     зависеть от того, на какой вкладке человек сейчас стоит. */
  /* Часы тикают сами. «Дедлайн» наступает не от правки модели, а от того,
     что прошёл срок, — поэтому раз в минуту приложение смотрит на время
     заново. Без этого задача, у которой срок истёк при открытом окне,
     осталась бы в бэклоге до первой посторонней правки. */
  const [tick,setTick]=useState(0);
  useEffect(()=>{
    const id=setInterval(()=>setTick(v=>v+1),60000);
    return ()=>clearInterval(id);
  },[]);
  useEffect(()=>{ setTasks(p=>autoFlow(p,{funcs,traits})); },[tasks,funcs,traits,tick]);


  /* ─── РАСЧЁТ ───
     Один источник чисел на всё приложение: функции. Фактические выполнения
     берутся из принятых задач — сдача, которую проверяющий не принял, в
     расчёт не идёт. */
  const runsOf=useCallback((fid)=>runsOfFunc(tasks,fid),[tasks]);
  const span=useMemo(()=>Math.max(horizon,6),[horizon]);
  /* Сколько выполнений требуют ПРИМЕНЁННЫЕ цели. Из этого и считается
     прогноз: функция сама по себе не повторяется, «как часто может» — её
     потолок, а не расписание. Нет применённых целей — ничего и не
     происходит, и это честный ответ, а не пустой график. */
  const runsPlan=useMemo(()=>goalRuns({traits,funcs},goals,{runsOf}),
    [traits,funcs,goals,runsOf]);
  /* Очередь действий по применённым целям — та же, что человек видел в
     форме цели, только собранная со всех целей сразу. */
  const appliedSteps=useMemo(()=>{
    const by=new Map();
    goals.filter(g=>g.appliedAt).forEach(g=>{
      actionsOf(planGoal({traits,funcs},g,{runsOf})).forEach(st=>{
        const was=by.get(st.func);
        by.set(st.func,was
          ?{...was,runs:was.runs+st.runs,startHours:Math.min(was.startHours,st.startHours)}
          :st);
      });
    });
    return [...by.values()].sort((a,b)=>a.startHours-b.startHours||b.runs-a.runs);
  },[traits,funcs,goals,runsOf]);
  /* Семя жребия. Факторы случаются не наверняка, и один и тот же набор
     чисел может развиться по-разному; семя выбирает, КАКОЙ именно вариант
     сейчас на экране. Оно живёт в состоянии, а не в модели: это не свойство
     системы, а то, на какой её вариант мы сейчас смотрим. */
  const [seed,setSeed]=useState(1);
  const fc=useMemo(()=>forecast({traits,funcs,factors},{span,runsOf,plan:runsPlan,seed}),
    [traits,funcs,factors,span,runsOf,runsPlan,seed]);
  const moves=useMemo(()=>transfers({funcs,traits},{runsOf,plan:runsPlan}),
    [funcs,traits,runsOf,runsPlan]);
  const workload=useMemo(()=>load({funcs},{runsOf,plan:runsPlan}),
    [funcs,runsOf,runsPlan]);
  const valuesFor=useCallback((tid)=>{
    const at=Math.min(simMonth,span);
    return {lo:fc.lo[tid]?.[at]??0,hi:fc.hi[tid]?.[at]??0,
      fact:fc.fact?fc.fact[tid]?.[at]??null:null};
  },[fc,simMonth,span]);

  const selE=ent(sel);
  const workers=useMemo(()=>workersOf(entities,sel),[entities,sel]);
  /* Нажали на стрелку передачи — открываем функцию, которая её рисует:
     выбираем её актив, уходим на «Управление» и просим карточку раскрыть
     именно эту функцию. Иначе от стрелки до её причины пришлось бы идти
     руками через актив и вкладку, гадая, какая из функций это делает. */
  const openFuncCard=useCallback((fid)=>{
    const f=funcs.find(x=>x.id===fid); if(!f) return;
    setSel(f.e);
    setUnder("edit");
    setFocus({kind:"func",id:fid,n:Date.now()});
  },[funcs]);

  const assetOk=useCallback((id)=>checkAsset(id,{funcs,traits,entities}).ok,
    [funcs,traits,entities]);

  return (
    <div style={{background:C.ink,color:C.text,minHeight:"100%",padding:12,
      fontFamily:"Inter, 'Segoe UI', system-ui, sans-serif"}}>
      <div className="flex items-start justify-between gap-3" style={{marginBottom:10}}>
        <div><div style={S.lbl}>жизнеспособность · v9</div>
          <div style={{fontSize:19,fontWeight:700}}>Активы: воркеры, функции, ресурсы</div></div>
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
              onClick={()=>{
                // Черновик новее всего, что лежит на диске: он и должен
                // остаться на экране, что бы ни доехало следом.
                restored.current=true;
                setReady(true);
                restoreDoc(recovery.doc);
                if(recovery.name) setSaveName(recovery.name);
                setRecovery(null);
              }}>
              Восстановить</button>
            <button style={btn(false)}
              onClick={()=>{ clearDraft(); setRecovery(null); }}>Отбросить</button>
          </div>
        </div>)}

      {draftBlocked && (
        <div style={{fontSize:11.5,color:WARN,marginBottom:10,lineHeight:1.6}}>
          Браузер не даёт сохранить черновик — правки не переживут закрытия
          вкладки. Сохраняй сценарий на диск во вкладке «Инструменты».
        </div>)}

      <div className="flex gap-2" style={{marginBottom:10,overflowX:"auto"}}>
        {/* «Анкета» — всем: это единственное место, где человек говорит о
            себе. «Отчёты» — владельцу: карту проектов пишет он, а
            остальным сервер её и не отдаёт — рисовать пустую карту с
            кнопками, которые ничего не сохранят, значило бы обещать
            работу, которой не будет. Наружу отчёт уходит ссылкой. */}
        {TAB_LIST.filter(([k])=>k===SELF_TAB[0]
          ||(k==="reports"?(me.isOwner||me.solo):me.tabs.includes(k)))
          .map(([k,t])=>(
          <button key={k} style={btn(tab===k)} onClick={()=>setTab(k)}>{t}</button>))}
      </div>

      {!me.known && !me.solo && (
        <div style={{...S.card,marginBottom:10}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>Вас ещё не позвали</div>
          <div style={{fontSize:11.5,color:C.muted,lineHeight:1.6}}>
            Модель принадлежит владельцу, и доступ выдаёт он. Попросите его
            добавить вас: пусть перешлёт боту ваше сообщение. Если у вас
            закрыт перенос сообщений, отправьте боту «/id» и передайте номер
            владельцу.
          </div>
        </div>)}

      {me.known && !me.tabs.length && (
        <div style={{...S.card,marginBottom:10,fontSize:11.5,color:C.muted,
          lineHeight:1.6}}>
          Ваша роль ничего не открывает — возможно, её удалили. Попросите
          владельца назначить роль заново.
        </div>)}

      {/* ═══ АНКЕТА · страница человека ═══
          Своя — по умолчанию; чужая открывается нажатием на человека в
          списке воркеров. Вкладкой, а не окном: страница длинная, и в
          окне её пришлось бы листать поверх того, что под ним. */}
      {tab==="me" && (
        <ProfilePanel me={me} personId={person} people={people}
          tasks={tasks} funcs={funcs} published={published} ratings={ratings}
          traitName={id=>traits.find(t=>t.id===id)?.l||"ресурс удалён"}
          onSaved={p=>{
            setMe(m=>({...m,profile:p}));
            setPeople(list=>list.map(u=>(String(u.id)===String(me.id)?{...u,...p}:u)));
          }}/>)}

      {/* ═══ ОТЧЁТЫ · карта проектов ═══
          Открыта всем вошедшим, как и анкета: отчёт — это то, что человек
          показывает о своей работе, а ссылку на блок карты дают кому
          угодно. Прятать её за ролью значило бы, что показать сделанное
          можно только с чужого разрешения. */}
      {tab==="reports" && (me.isOwner||me.solo) && (
        <ReportsPanel nodes={reports} setNodes={setReports}
          model={{traits,funcs,tasks,factors}} entities={entities} nameOf={personName}
          runsOf={runsOf}
          focus={reportFocus} onFocus={setReportFocus}/>)}

      {/* ═══ ЗАДАЧИ ═══ */}
      {tab==="tasks" && me.tabs.includes("tasks") && (
        <TasksTab funcs={funcs} entities={entities} traits={traits}
          tasks={myTasks} setTasks={setTasks}
          openId={openTask} setOpenId={setOpenTask}
          people={people} canAssign={me.isOwner} nameOf={personName}
          onTake={t=>{ takeTaskRemote(t.id).catch(()=>{}); }}
          meId={me.id}
          /* У владельца сдача и комментарий уезжают в составе модели через
             putWorkspace; POST'ить их ещё раз значило бы записать дважды. */
          onComment={(t,c)=>{ if(!me.isOwner) commentTaskRemote(t.id,c).catch(()=>{}); }}
          onDropComment={(t,id)=>{ if(!me.isOwner) dropCommentRemote(t.id,id).catch(()=>{}); }}
          onSubmit={(t,sb)=>{ if(!me.isOwner) submitTaskRemote(t.id,sb).catch(()=>{}); }}
          space={space} setSpace={setSpace} files={spaceFiles} memory={memory}
          ask={me.solo?undefined:(q,ctx)=>askAssistant(q,ctx,{task:"space"})}/>)}

      {/* ═══ ПРОВЕРКА ═══ */}
      {tab==="review" && me.tabs.includes("review") && (
        <ReviewBoard tasks={tasks} traits={traits} entities={entities} funcs={funcs}
          meId={me.id} isOwner={me.isOwner} nameOf={personName}
          setTasks={setTasks} people={people} canAssign={me.isOwner}
          published={published}
          onComment={(t,c)=>{ if(!me.isOwner) commentTaskRemote(t.id,c).catch(()=>{}); }}
          onDropComment={(t,id)=>{ if(!me.isOwner) dropCommentRemote(t.id,id).catch(()=>{}); }}
          /* Постановка у владельца уезжает в составе модели через
             putWorkspace; у позванного постановщика модель не пишется —
             каждая правка формы и «Поставить» идут своей операцией, и
             форма ждёт ответа сервера, а не меняет статус у себя. */
          onSetup={me.isOwner?undefined:(t,patch)=>setupTaskRemote(t.id,patch)}
          onAccept={(t,note,mark,hidden)=>decide(t,true,note,mark,hidden)}
          onReturn={(t,note,mark,hidden)=>decide(t,false,note,mark,hidden)}/>)}

      {/* ═══ СХЕМА ═══ */}
      {tab==="scheme" && me.tabs.includes("scheme") && (<>
        <div style={{...S.card,padding:6,marginBottom:10}}>
          <div className="flex items-center gap-2 flex-wrap" style={{marginBottom:4}}>
            <span style={S.lbl}>масштаб</span>
            <button style={btn(false)} onClick={()=>setZoom(z=>Math.max(.32,z-.12))}>−</button>
            <button style={btn(false)} onClick={()=>setZoom(z=>Math.min(1.6,z+.12))}>+</button>
            <button style={btn(true)} onClick={addEntity}>+ актив</button>
            <button style={btn(false)} onClick={alignGrid}
              title="Расставит блоки по сетке, сохранив расстановку по рядам">
              ⌗ выровнять</button>
            <span style={{flex:1}}/>
            <span style={S.lbl}>месяц</span>
            <input type="range" min={0} max={span} value={simMonth}
              aria-label="месяц на схеме"
              onChange={e=>setSimMonth(Number(e.target.value))}
              style={{width:130}}/>
            <span style={{fontSize:11,color:ACC,minWidth:34}}>{simMonth} мес</span>
          </div>
          <div style={{fontSize:10.5,color:C.muted,lineHeight:1.5}}>
            На блоке — сколько ресурса будет к этому месяцу: от и до. Это
            вилка, а не число: сколько функция берёт и выдаёт, задано
            диапазоном. Пунктирные стрелки — передачи между активами.
          </div>
        </div>

        <SchemeSVG entities={entities} traits={traits} funcs={funcs} moves={moves}
          zoom={zoom} sel={sel} valuesFor={valuesFor}
          onSelectEntity={id=>setSel(id)} onMoveEntity={moveE}
          assetOk={assetOk} onWhy={(kind,id)=>setWhy({kind,id})}
          onOpenFunc={openFuncCard}/>

        {/* Под схемой три вкладки: чем схема собрана, куда она идёт и что
            по ней уже делали — «Деятельность»: слово «Timeline» называло
            способ показа, а не то, что показывают. Ползунок месяца — общий: он стоит над ними,
            потому что одинаково относится и к числам на блоках, и к хвостам
            графиков. */}
        <div className="flex gap-2" style={{margin:"10px 0",overflowX:"auto"}}>
          <button style={btn(under==="edit")} onClick={()=>setUnder("edit")}>
            Управление</button>
          {me.tabs.includes("sim")&&(
            <button style={btn(under==="sim")} onClick={()=>setUnder("sim")}>
              Прогноз</button>)}
          {me.tabs.includes("timeline")&&(
            <button style={btn(under==="time")} onClick={()=>setUnder("time")}>
              Деятельность</button>)}
        </div>

        {under==="time" && me.tabs.includes("timeline") && (
          <Timeline tasks={myTasks} funcs={funcs} traits={traits} entities={entities}
            nameOf={personName} meId={me.id}/>)}

        {under==="edit" && selE && (
          <div style={{...S.card,marginTop:10}}>
            <div className="flex items-center gap-2" style={{marginBottom:6}}>
              <span style={S.lbl}>актив</span>
              <span style={{flex:1}}/>
              <button style={{...btn(false),color:BAD,borderColor:"#5A2436"}}
                onClick={()=>delEntity(selE.id)}>Удалить актив</button>
            </div>
            <TxtField value={selE.name} aria-label="название актива"
              style={{fontSize:15,fontWeight:700,marginBottom:6}}
              onCommit={v=>setEntities(p=>p.map(e=>e.id===selE.id?{...e,name:v}:e))}/>
            <div style={{fontSize:11,color:C.muted,lineHeight:1.6}}>
              Актив — это его воркеры, его функции и его ресурсы, а ещё
              факторы: то, что меняет ресурсы без человека. Вкладки ниже —
              они и есть, все одного вида.
            </div>

            <AssetPanel entityId={selE.id}
              me={me} published={published}
              workers={workers} roleOf={roleName}
              funcs={funcs} setFuncs={setFuncs}
              traits={traits} setTraits={setTraits}
              entities={entities} kinds={kinds} kindOf={kindOf}
              factors={factors} setFactors={setFactors}
              people={people} nameOf={personName} runsOf={runsOf}
              tasks={tasks} onOrderWorker={orderWorker} onToggleCrew={toggleCrew}
              onOpenPerson={id=>setCard(id)}
              roles={roles}
              onAddRole={me.isOwner&&!me.solo?(n)=>addRole(n).then(refreshOrg):undefined}
              onDropRole={me.isOwner&&!me.solo?(id)=>removeRole(id).then(refreshOrg):undefined}
              onSetRole={me.isOwner&&!me.solo?(pid,rid)=>setUserRole(pid,rid).then(refreshOrg):undefined}
              focus={focus}
              onWhyFunc={id=>setWhy({kind:"func",id})}
              onWhyTrait={id=>setWhy({kind:"trait",id})}
              onDeleteTrait={delTrait}
              onUpKind={upK} onAddKind={addKind} onDelKind={id=>setKindMsg(delKind(id))}
              kindMsg={kindMsg}/>
          </div>)}

        {/* ═══ ПРОГНОЗ — вторая подвкладка ═══ */}
        {under==="sim" && me.tabs.includes("sim") && (<div>
        <div style={{...S.card,marginBottom:10}}>
          <div style={S.lbl}>прогноз по функциям</div>
          <div style={{fontSize:11.5,color:C.muted,marginTop:6,lineHeight:1.6}}>
            Считается по применённым целям: функция сама по себе не
            повторяется — она работа, и происходит тогда, когда её делают.
            Цель говорит, сколько её выполнений нужно, «как часто может
            повторяться» ставит потолок, а из
            вилок — сколько ресурса при этом уходит и приходит. Поэтому
            прогноз — лента, а не линия: <span style={{color:WARN}}>жёлтым</span>
            {" "}её границы, <span style={{color:OK}}>зелёным</span> — факт по
            принятым выполнениям. Пересчитывается сам при каждой правке.
          </div>
          {/* Факторы случаются не наверняка: один и тот же набор чисел может
              развиться по-разному. Кнопка показывает следующий вариант —
              иначе вероятность было бы видно только в среднем, а посмотреть
              на разброс, ради которого её и заводят, негде. */}
          {funcs.some(f=>f.kind==="factor")&&(
            <div className="flex items-center gap-2" style={{marginTop:8}}>
              <button style={btn(false)} onClick={()=>setSeed(v=>v+1)}>
                ↻ другой вариант</button>
              <span style={{fontSize:10.5,color:C.muted,lineHeight:1.5}}>
                вариант №{seed}: факторы случаются не наверняка, и при тех же
                числах будущее может сложиться иначе
              </span>
            </div>)}
          {!funcs.length
            ? <div style={{fontSize:11.5,color:WARN,marginTop:8,lineHeight:1.6}}>
                Функций нет — считать нечего. Ресурсы останутся на своих
                значениях: сами по себе они не меняются.
              </div>
            : !goals.some(g=>g.appliedAt)&&
              <div style={{fontSize:11.5,color:WARN,marginTop:8,lineHeight:1.6}}>
                Ни одна цель не применена — работать никто не просил, и
                ресурсы остаются на своих значениях. Поставьте цель ниже и
                нажмите «Применить цель»: тогда станет видно, что из этого
                выйдет.
              </div>}
        </div>

        {/* Последовательность действий по применённым целям — общая, на
            всю модель. Внутри цели видно её собственную очередь, здесь —
            всё вместе: чем занята модель прямо сейчас и что за чем идёт. */}
        {!!appliedSteps.length&&(
          <div style={{...S.card,marginBottom:10}}>
            <div style={S.lbl}>последовательность действий · по применённым целям</div>
            {appliedSteps.map((st,i)=>(
              <div key={st.func} className="flex items-center gap-2"
                style={{fontSize:11.5,padding:"4px 0",
                  borderTop:i?`1px solid ${C.line}`:"none"}}>
                <span style={{color:ACC,minWidth:16}}>{i+1}.</span>
                <span style={{flex:1,minWidth:0}}>
                  {st.name||"без названия"}
                  <span style={{color:C.muted}}> · {ent(st.e)?.name||""}</span>
                </span>
                <span style={{color:WARN,whiteSpace:"nowrap"}}>
                  ×{nm(Math.round(st.runs*10)/10)}</span>
                <span style={{color:C.muted,whiteSpace:"nowrap"}}>
                  {st.startHours>0?`с ${durText(st.startHours)}`:"сразу"}</span>
              </div>))}
            <div style={{fontSize:10.5,color:C.muted,marginTop:6,lineHeight:1.5}}>
              Функция не начинается раньше, чем созреют её входы, — поэтому
              это очередь, а не список вперемешку.
            </div>
          </div>)}

        {/* Цели: сколько, чего, к какому сроку, каким темпом и какой ценой.
            Модель отвечает тем, что из цели следует, — см. GoalsPanel. */}
        <GoalsPanel goals={goals} setGoals={setGoals} traits={traits}
          model={{traits,funcs}} runsOf={runsOf}
          /* Постановщика назначают на схеме, в ролях функции, — и задача
             рождается уже с ним: форма постановки его не выбирает. Без
             этого позванный постановщик не увидел бы задачу в «ждут
             постановки»: ему показывают только те, где постановщик — он. */
          onTasks={list=>setTasks(p=>[...p,...list.map(t=>(t.setter!=null&&t.setter!==""
            ?t:{...t,setter:funcs.find(f=>f.id===t.funcId)?.setters?.[0]??null}))])}
          onDropGoal={id=>setTasks(p=>p.filter(t=>(
            /* Уходит цель — уходит и заведённая ею работа. Кроме уже
               СДЕЛАННОЙ: принятая сдача это то, что и правда произошло, и
               стирать её значило бы переписать прошлое — а заодно и факт в
               прогнозе, который по ней и посчитан. */
            t.goalId!==id||t.status==="done"||(t.submissions||[]).length>0)))}/>

        {entities.map(en=>{
          const ts=traits.filter(t=>t.e===en.id);
          if(!ts.length) return null;
          return (
            <div key={en.id} style={{...S.card,marginBottom:10}}>
              <div className="flex items-center gap-2" style={{marginBottom:6}}>
                <span style={{width:8,height:8,borderRadius:2,background:en.color}}/>
                <span style={{fontSize:13.5,fontWeight:700,flex:1}}>{en.name}</span>
              </div>
              {ts.map(t=>{
                const on=openCards.has(t.id);
                const lo=fc.lo[t.id]||[],hi=fc.hi[t.id]||[];
                const last=hi.length-1;
                /* Планка на графике — только у разовой цели: у неё цель это
                   уровень, до которого надо дорасти. У цели с темпом («один
                   в неделю») уровня нет вовсе, и черта на графике врала бы —
                   вместо неё сказано, сколько такой темп требует в месяц. */
                /* На графике показывается только ПРИМЕНЁННАЯ цель:
                   неприменённая — прикидка, и рисовать её планкой значило
                   бы выдать намерение за решение. */
                const g=goals.find(x=>x.trait===t.id&&Number(x.qty)>0&&x.appliedAt);
                const line=g&&g.rate==="once"?Number(g.qty):null;
                const flow=g&&g.rate!=="once"?perMonth(g):null;
                const r=line!=null?reach(fc,t.id,line):null;
                return (
                  <div key={t.id} style={{background:C.panel2,
                    border:`1px solid ${C.line}`,borderRadius:8,padding:9,marginBottom:6}}>
                    <div className="flex items-center gap-2" style={{cursor:"pointer"}}
                      onClick={()=>toggleCard(t.id)}>
                      <span style={{fontSize:12.5,fontWeight:600,flex:1}}>{t.l}</span>
                      <span style={{fontSize:11,color:WARN}}>
                        {nm(lo[last]??0)}–{nm(hi[last]??0)} {t.unit}</span>
                      <span style={{fontSize:11,color:C.muted}}>{on?"▾":"▸"}</span>
                    </div>
                    <div style={{fontSize:10.5,color:C.muted,marginTop:3}}>
                      сейчас {nm(Number(t.have)||0)} · через {span} мес
                      {line!=null?` · цель ${nm(line)}`:""}
                      {flow!=null?` · цель требует ${nm(Math.round(flow*10)/10)} в месяц`:""}
                      {r&&(r.sure!=null?` · наверняка к ${r.sure} мес`
                        :r.best!=null?` · в лучшем случае к ${r.best} мес`
                          :" · по прогнозу не достигается")}
                    </div>
                    {on&&(
                      <div style={{marginTop:8}}>
                        <Chart lo={lo} hi={hi} fact={fc.fact?fc.fact[t.id]:null}
                          months={span} goalLine={line}
                          cursorMonth={simMonth} upTo={simMonth}/>
                      </div>)}
                  </div>);
              })}
            </div>);
        })}

        <div style={{...S.card,marginBottom:10}}>
          <div style={S.lbl}>нагрузка исполнителей</div>
          <div style={{fontSize:11.5,color:C.muted,marginTop:6,lineHeight:1.6}}>
            Сколько часов в месяц выходит по функциям, где человек назначен
            исполнителем. Если функцию делают несколько, часы делятся между
            ними поровну.
          </div>
          {Object.keys(workload).length===0
            ? <div style={{fontSize:11.5,color:C.muted,marginTop:8}}>
                Исполнители на функции ещё не назначены.</div>
            : Object.entries(workload).map(([pid,h])=>(
                <div key={pid} className="flex items-center gap-2"
                  style={{marginTop:6,fontSize:12}}>
                  <span style={{flex:1}}>{personName(pid)}</span>
                  <span style={{color:h>160?BAD:h>120?WARN:OK}}>{nm(h)} ч/мес</span>
                </div>))}
        </div>
        </div>)}
      </>)}

      {/* ═══ ИНСТРУМЕНТЫ ═══ */}
      {tab==="tools" && me.tabs.includes("tools") && (
        <div className="flex gap-2" style={{marginBottom:10,overflowX:"auto"}}>
          {[["people","Люди и роли"],["assistant","Помощник"],["reminders","Напоминания"],
            ["calls","Звонки"],["export","Выгрузка"]]
            // «Люди и роли» — дело владельца. «Выгрузка» тоже: схем у
            // не-владельца не бывает, у него одна — та, где его назначили.
            .filter(([k])=>(k!=="people"&&k!=="export")||me.isOwner||me.solo)
            .map(([k,t])=>(
              <button key={k} style={btn(tool===k)} onClick={()=>setTool(k)}>{t}</button>))}
        </div>)}

      {tab==="tools" && me.tabs.includes("tools") && tool==="people" && (
        <PeoplePanel me={me} onPeople={setPeople}/>)}

      {/* Помощник — всем, у кого есть «Инструменты»: не-владелец видит
          провайдера и «есть ли ключ» без самого ключа, плюс свою память. */}
      {tab==="tools" && me.tabs.includes("tools") && tool==="assistant" && (
        <AssistantSettings me={me}/>)}

      {/* Напоминания — всем, у кого есть «Инструменты»: за сколько
          предупреждать, решает тот, кому напоминают. Ответ сервера кладётся
          в «кто я», и расписание выше пересчитывается с новым «за сколько». */}
      {tab==="tools" && me.tabs.includes("tools") && tool==="reminders" && (
        <RemindersCard me={me} onSaved={p=>{ setMe(m=>({...m,profile:p})); }}/>)}

      {tab==="tools" && me.tabs.includes("tools") && tool==="calls" && (
        <CallsBoard me={me} people={people} openCall={openCall}
          onLeaveCall={()=>setOpenCall(null)} nameOf={personName}/>)}

      {tab==="tools" && me.tabs.includes("tools") && tool==="export"
        && (me.isOwner||me.solo) && (
        <div style={S.card}>
          <div className="flex flex-wrap gap-2" style={{marginBottom:8}}>
            <button style={btn(true)} onClick={()=>{
              setJson(JSON.stringify(doc,null,2));
              setJsonMsg("Выгружено.");}}>
              Выгрузить</button>
            <button style={btn(false)} onClick={()=>{try{const d=JSON.parse(json);
              if(!d||typeof d!=="object") throw new Error("не объект");
              // Тем же путём, что и сценарий с диска: выгрузка — это весь
              // документ, и читать его надо целиком.
              restoreDoc(docFrom(d,docRef.current));
              setJsonMsg("Загружено.");}
              catch{setJsonMsg("Не разобрал JSON.");}}}>Загрузить</button>
            {jsonMsg&&<span style={{fontSize:12,color:C.muted,alignSelf:"center"}}>{jsonMsg}</span>}
          </div>
          <TxtField area value={json} style={{minHeight:300,
            fontFamily:"ui-monospace, Menlo, monospace",fontSize:11.5}}
            onCommit={setJson}/>

          {/* ═══ СОХРАНЕНИЕ НА ДИСКЕ СЕРВЕРА ═══ */}
          <div style={{marginTop:12,borderTop:`1px solid ${C.line}`,paddingTop:10}}>
            <div style={S.lbl}>сохранённые сценарии{savedWhere?` · ${savedWhere}`:""}</div>
            <div className="flex flex-wrap gap-2" style={{margin:"8px 0"}}>
              <input placeholder="имя сценария" value={saveName}
                onChange={e=>setSaveName(e.target.value)}
                onBlur={e=>setSaveName(e.target.value)}
                style={{...S.inp,flex:"1 1 160px"}}/>
              <button style={btn(true)} disabled={savedBusy} onClick={saveToDisk}>
                Сохранить</button>
            </div>
            <div className="flex flex-wrap gap-2" style={{marginBottom:8}}>
              <select style={{...S.inp,flex:"1 1 160px"}} value={savedSel}
                onChange={e=>setSavedSel(e.target.value)}>
                <option value="">— выбери сценарий —</option>
                {savedList.map(s=>(<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
              <button style={btn(false)} disabled={savedBusy} onClick={loadFromDisk}>
                Загрузить</button>
              <button style={{...btn(false),color:BAD,borderColor:"#5A2436"}}
                disabled={savedBusy} onClick={deleteFromDisk}>Удалить</button>
            </div>
            {savedMsg&&<div style={{fontSize:12,color:C.muted}}>{savedMsg}</div>}
          </div>
        </div>)}

      {/* ═══ КАРТОЧКА ЧЕЛОВЕКА ═══
          Окном поверх того, что человек сейчас делает, а не переходом на
          страницу: он открывает воркера, чтобы посмотреть анкету и рейтинг,
          и должен вернуться туда же, откуда смотрел. Прежде нажатие
          переключало вкладку, и обратной дороги не было. */}
      {card!=null && (
        <Modal onClose={()=>setCard(null)} title={personName(card)}>
          <ProfilePanel me={me} personId={card} people={people}
            tasks={tasks} funcs={funcs} published={published} ratings={ratings}
            traitName={id=>traits.find(t=>t.id===id)?.l||"ресурс удалён"}
            onSaved={p=>{
              setMe(m=>({...m,profile:p}));
              setPeople(list=>list.map(u=>(String(u.id)===String(me.id)?{...u,...p}:u)));
            }}/>
        </Modal>)}

      {why && (
        <Modal onClose={()=>setWhy(null)}
          title={why.kind==="asset"?"Что такое актив"
            :why.kind==="func"?"Что такое функция"
              :"Что такое ресурс"}>
          {why.kind==="asset"?WHY_ASSET:why.kind==="func"?WHY_FUNC:WHY_TRAIT}
        </Modal>)}


    </div>);
}
