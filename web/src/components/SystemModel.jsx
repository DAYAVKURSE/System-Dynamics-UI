import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { detectStorage, STORAGE_LABEL, listScenarios, getScenario, saveScenario,
  deleteScenario, syncSchedule, pickScenario, rememberScenario,
  forgetScenario } from "../storage.js";
import { SOLO, whoAmI, getWorkspace, listOrg, putWorkspace, reviewTaskRemote }
  from "../identity.js";
import { callFromLocation } from "../calls.js";
import { C, OK, WARN, BAD, NEU, ACC, S, btn, nm, NumField, TxtField } from "./ui.jsx";
import { WHY_ASSET, WHY_FUNC, WHY_TRAIT, checkAsset, normalizeAssets,
  normalizeFuncs, pruneWorkers, workersOf } from "../lib/funcs.js";
import { forecast, load, reach, solveRange, transfers } from "../lib/plan.js";
import AssetPanel from "./AssetPanel.jsx";
import TasksBoard, { runsOfFunc } from "./TasksBoard.jsx";
import Timeline from "./Timeline.jsx";
import ReviewBoard from "./ReviewBoard.jsx";
import PeoplePanel from "./PeoplePanel.jsx";
import CallsBoard from "./CallsBoard.jsx";
import { useHistory, sameDoc } from "../lib/history.js";
import { readDraft, saveDraft, clearDraft } from "../lib/draft.js";
import Modal from "./Modal.jsx";
import PersonStats from "./PersonStats.jsx";

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
const T=(id,e,k,l,unit,have,want)=>({id,e,k,l,unit,have,want:want??null});
const TRAITS0=[
  T("dem","mkt","res","спрос","обращ.",3000,null),
  T("act","usr","growth","активные пользователи","чел.",20,500),
  T("req","usr","res","заявки","шт.",0,null),
  T("hdl","vm","growth","обработанные заявки","шт.",0,300),
];
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
  onSelectEntity,onMoveEntity,assetOk,onWhy}){
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
          const off=14+at*20;
          const ox=(-dy/len)*off,oy=(dx/len)*off;
          // Табличка отодвинута сильнее самой линии: она шире ста пикселей,
          // и у линии встречные подписи всё равно наезжали бы друг на друга.
          const lo=78+at*28;
          const mx=(x1+x2)/2+(-dy/len)*lo,my=(y1+y2)/2+(dx/len)*lo;
          const txt=`${w.name}: ${nm(w.lo)}–${nm(w.hi)}/мес`;
          return (<g key={w.id} style={{pointerEvents:"none"}}>
            <line x1={x1+ox} y1={y1+oy} x2={x2+ox} y2={y2+oy} stroke={ACC}
              strokeWidth="1.6" strokeDasharray="4 3" markerEnd="url(#aw)"/>
            <rect x={mx-70} y={my-11} width="140" height="22" rx="6" fill={C.panel}
              stroke={ACC} strokeWidth="1"/>
            <text x={mx} y={my+3.5} textAnchor="middle" fontSize="9" fill={ACC}>
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
              {(e.owners||[]).length+(e.reviewers||[]).length} воркеров ·
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

/* Часы в понятное: 2 880 ч — это «4 мес», а не число, в котором надо
   считать нули. Меньше суток остаётся часами: «3 ч» понятнее «0,1 дн». */
function durText(h){
  const n=Number(h)||0;
  if(n<=0) return "—";
  if(n<24) return `${nm(Math.round(n*10)/10)} ч`;
  if(n<168) return `${nm(Math.round(n/24*10)/10)} дн`;
  if(n<730) return `${nm(Math.round(n/168*10)/10)} нед`;
  return `${nm(Math.round(n/730*10)/10)} мес`;
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
export const TAB_LIST=[["tasks","Задачи"],["review","Проверка"],
  ["timeline","Timeline"],["scheme","Схема"],["tools","Инструменты"]];

/* ════════════════ ГЛАВНОЕ ════════════════ */
export default function SystemModel(){
  const [entities,setEntities]=useState(ENTITIES0);
  const [traits,setTraits]=useState(TRAITS0);
  const [kinds,setKinds]=useState(KINDS0);
  const [kindMsg,setKindMsg]=useState("");
  const [funcs,setFuncs]=useState(FUNCS0);
  const [tasks,setTasks]=useState([]);
  const [tab,setTab]=useState("tasks");
  const [sel,setSel]=useState("usr");
  const [why,setWhy]=useState(null);
  // Кого раскрыли в списке воркеров: вся его история — в окне.
  const [person,setPerson]=useState(null);
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
  // Классификации ресурсов — под спойлером: их правят редко, а место они
  // занимают всегда.
  const [kindsOpen,setKindsOpen]=useState(false);
  const [me,setMe]=useState(SOLO);
  const [openCards,setOpenCards]=useState(()=>new Set());
  const [openCall,setOpenCall]=useState(()=>callFromLocation());
  const [people,setPeople]=useState([]);
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
    listOrg().then(o=>{ if(live&&o?.users) setPeople(o.users); }).catch(()=>{});
    return ()=>{ live=false; };
  },[me.known,me.solo]);
  const [tool,setTool]=useState("people");
  useEffect(()=>{ if(openCall && me.tabs.includes("tools")) { setTab("tools"); setTool("calls"); } },
    [openCall,me.tabs]);

  const ent=(id)=>entities.find(e=>e.id===id);
  const kindOf=useMemo(()=>kindLookup(kinds),[kinds]);

  const adoptSelection=(list)=>{
    setSel(s=>list.some(e=>e.id===s)?s:(list[0]?.id??null));
  };

  // ─── история правок: отмена и возврат ───
  const doc=useMemo(()=>({entities,traits,kinds,tasks,funcs}),
    [entities,traits,kinds,tasks,funcs]);
  const restoreDoc=useCallback((d)=>{
    // Документ достраивается до нынешней записи, но НЕ переносится из
    // прежних версий: модели, собранные под старый расчёт, работать не
    // должны — см. lib/funcs.js.
    setEntities(normalizeAssets(d.entities));
    setTraits(Array.isArray(d.traits)?d.traits:[]);
    setKinds(d.kinds); setTasks(d.tasks); setFuncs(normalizeFuncs(d.funcs));
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
  const toggleWorker=(kind,pid)=>{
    setEntities(p=>p.map(e=>{
      if(e.id!==sel) return e;
      const has=(e[kind]||[]).some(x=>String(x)===String(pid));
      return {...e,[kind]:has?(e[kind]||[]).filter(x=>String(x)!==String(pid))
        :[...(e[kind]||[]),pid]};
    }));
    // Человек, переставший быть воркером, не должен остаться назначенным на
    // функции этого актива: задача висела бы на том, кого в активе нет.
    setFuncs(p=>{
      const e=entities.find(x=>x.id===sel); if(!e) return p;
      const has=(e[kind]||[]).some(x=>String(x)===String(pid));
      if(!has) return p;
      const next={owners:e.owners||[],reviewers:e.reviewers||[],
        [kind]:(e[kind]||[]).filter(x=>String(x)!==String(pid))};
      return pruneWorkers(p,sel,next);
    });
  };
  /* Порядок людей в списке воркеров — свой, руками. По умолчанию список
     сортируется по рейтингу, но выбирает всё равно человек: у него могут
     быть причины, которых в цифрах нет. Поэтому порядок хранится, а
     сортировка по рейтингу — только вид. */
  const orderWorker=(kind,pid,delta)=>{
    setEntities(p=>p.map(e=>{
      if(e.id!==sel) return e;
      const list=[...(e[kind]||[])];
      const i=list.findIndex(x=>String(x)===String(pid));
      const j=i+delta;
      if(i<0||j<0||j>=list.length) return e;
      [list[i],list[j]]=[list[j],list[i]];
      return {...e,[kind]:list};
    }));
  };

  // ─── напоминания ───
  // Расписание задачи — её собственное: когда начать и за сколько
  // предупредить. Прежде оно бралось со стрелки, но стрелок больше нет.
  const scheduled=useMemo(()=>tasks.map(t=>({...t,start:t.start||null,
    repeat:"once",end:null})),[tasks]);
  useEffect(()=>{
    const id=setTimeout(()=>{ syncSchedule(scheduled).catch(()=>{}); },1200);
    return ()=>clearTimeout(id);
  },[scheduled]);

  /* ─── общая модель ───
     Владелец пишет модель на сервер, остальные её оттуда читают: только так
     исполнитель вообще увидит поставленную ему задачу. */
  const pulled=useRef(false);
  useEffect(()=>{
    if(me.solo) return;
    if(pulled.current) return;
    pulled.current=true;
    getWorkspace().then(w=>{
      // Владельцу подставлять серверную модель поверх открытой нельзя: он
      // мог начать править до того, как ответ пришёл.
      if(me.isOwner) return;
      restoreDoc({
        entities:w.entities||[], traits:w.traits||[],
        kinds:(w.kinds&&w.kinds.length)?w.kinds:KINDS0,
        tasks:w.tasks||[], funcs:w.funcs,
      });
    }).catch(()=>{});
  },[me.solo,me.isOwner,restoreDoc]);
  useEffect(()=>{
    if(me.solo||!me.isOwner) return;
    const id=setTimeout(()=>{ putWorkspace(doc).catch(()=>{}); },1500);
    return ()=>clearTimeout(id);
  },[doc,me.solo,me.isOwner]);

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
  const openScenario=useCallback(async(id)=>{
    const s=await getScenario(id);
    if(!s) throw new Error("Сценарий не найден.");
    // Старые сценарии могут не знать про часть документа — недостающее
    // остаётся текущим, а не превращается в пустоту.
    const arr=(v,cur,need)=>Array.isArray(v)&&(!need||v.length)?v:cur;
    const fs=normalizeFuncs(arr(s.data?.funcs,docRef.current.funcs));
    const loaded={
      entities:normalizeAssets(arr(s.data?.entities,docRef.current.entities,true)),
      traits:arr(s.data?.traits,docRef.current.traits),
      kinds:arr(s.data?.kinds,docRef.current.kinds,true),
      tasks:arr(s.data?.tasks,docRef.current.tasks),
      funcs:fs,
    };
    restoreDoc(loaded);
    savedDoc.current=loaded; clearDraft(); setRecovery(null);
    setSaveName(s.name); setSavedSel(s.id);
    // Эта схема теперь и есть «последняя открытая»: с неё начнётся
    // следующий заход.
    rememberScenario(s.id);
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
  useEffect(()=>{
    if(opened.current) return;
    if(!me.isOwner&&!me.solo) return;   // не-владельцу схему даёт сервер
    if(recovery) { opened.current=true; return; }
    opened.current=true;
    let live=true;
    pickScenario().then(s=>{
      if(!live||!s) return;
      openScenario(s.id).catch(()=>{});
    }).catch(()=>{});
    return ()=>{ live=false; };
  },[me.isOwner,me.solo,recovery,openScenario]);

  const loadFromDisk=async()=>{
    if(!savedSel){ setSavedMsg("Выбери сохранённый сценарий."); return; }
    setSavedBusy(true);
    try{
      const s=await getScenario(savedSel);
      if(!s) throw new Error("Сценарий не найден.");
      // Старые сценарии могут не знать про часть документа — недостающее
      // остаётся текущим, а не превращается в пустоту.
      const arr=(v,cur,need)=>Array.isArray(v)&&(!need||v.length)?v:cur;
      const fs=normalizeFuncs(arr(s.data?.funcs,funcs));
      const loaded={
        entities:normalizeAssets(arr(s.data?.entities,entities,true)),
        traits:arr(s.data?.traits,traits),
        kinds:arr(s.data?.kinds,kinds,true),
        tasks:arr(s.data?.tasks,tasks),
        funcs:fs,
      };
      restoreDoc(loaded);
      savedDoc.current=loaded; clearDraft(); setRecovery(null);
      setSaveName(s.name);
      rememberScenario(s.id);
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
  const personName=useCallback((id)=>{
    if(id==null||id==="") return "не назначен";
    return people.find(p=>String(p.id)===String(id))?.name||String(id);
  },[people]);
  /* Решение проверяющего — не только статус: оценка и слова уходят в
     историю исполнителя, из которой потом растёт его рейтинг. Пишем их
     отдельным списком `reviews`, а не в комментарии: комментарий может
     оставить кто угодно и когда угодно, а решение — это ровно приём или
     возврат, с оценкой и автором. */
  const decide=useCallback((task,accept,note,mark)=>{
    const at=new Date().toISOString();
    const review={id:"rv"+Date.now().toString(36),at,by:me.id??null,
      accept:!!accept,mark:Number(mark)||null,comment:String(note||"")};
    setTasks(p=>p.map(t=>t.id===task.id?{...t,
      status:accept?"done":"backlog",
      reviews:[...(t.reviews||[]),review],
      comments:note?[...(t.comments||[]),
        {id:"c"+Date.now().toString(36),text:note,at}]
        :(t.comments||[]),
    }:t));
    reviewTaskRemote(task.id,{accept,comment:note,mark:review.mark}).catch(()=>{});
  },[setTasks,me.id]);
  const toggleCard=useCallback((id)=>setOpenCards(p=>{
    const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n;
  }),[]);

  /* ─── РАСЧЁТ ───
     Один источник чисел на всё приложение: функции. Фактические выполнения
     берутся из принятых задач — сдача, которую проверяющий не принял, в
     расчёт не идёт. */
  const runsOf=useCallback((fid)=>runsOfFunc(tasks,fid),[tasks]);
  const span=useMemo(()=>Math.max(horizon,6),[horizon]);
  const fc=useMemo(()=>forecast({traits,funcs},{span,runsOf}),
    [traits,funcs,span,runsOf]);
  const moves=useMemo(()=>transfers({funcs,traits},{runsOf}),[funcs,traits,runsOf]);
  const workload=useMemo(()=>load({funcs},{runsOf}),[funcs,runsOf]);
  /* План под каждую цель: что нужно сделать и сколько это займёт.
     Прогноз отвечает «куда придём сами», план — «что для этого сделать»;
     оба считаются из одних и тех же функций, поэтому разойтись не могут. */
  const plans=useMemo(()=>traits.filter(t=>t.want!=null)
    .map(t=>({t,...solveRange({traits,funcs},{trait:t.id,runsOf})})),
  [traits,funcs,runsOf]);
  const valuesFor=useCallback((tid)=>{
    const at=Math.min(simMonth,span);
    return {lo:fc.lo[tid]?.[at]??0,hi:fc.hi[tid]?.[at]??0,
      fact:fc.fact?fc.fact[tid]?.[at]??null:null};
  },[fc,simMonth,span]);

  const selE=ent(sel);
  const workers=useMemo(()=>workersOf(entities,sel),[entities,sel]);
  const assetOk=useCallback((id)=>checkAsset(id,{funcs,traits,entities}).ok,
    [funcs,traits,entities]);
  const goals=traits.filter(t=>t.want!=null);

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
              onClick={()=>{ restoreDoc(recovery.doc); setRecovery(null); }}>
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
        {TAB_LIST.filter(([k])=>me.tabs.includes(k)).map(([k,t])=>(
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

      {/* ═══ ЗАДАЧИ ═══ */}
      {tab==="tasks" && me.tabs.includes("tasks") && (
        <TasksBoard funcs={funcs} entities={entities} traits={traits}
          tasks={myTasks} setTasks={setTasks}
          openId={openTask} setOpenId={setOpenTask}
          people={people} canAssign={me.isOwner} nameOf={personName}/>)}

      {/* ═══ ПРОВЕРКА ═══ */}
      {tab==="review" && me.tabs.includes("review") && (
        <ReviewBoard tasks={tasks} traits={traits} entities={entities} funcs={funcs}
          meId={me.id} isOwner={me.isOwner} nameOf={personName}
          onAccept={(t,note,mark)=>decide(t,true,note,mark)}
          onReturn={(t,note,mark)=>decide(t,false,note,mark)}/>)}

      {/* ═══ TIMELINE ═══ */}
      {tab==="timeline" && me.tabs.includes("timeline") && (
        <Timeline tasks={myTasks} funcs={funcs} traits={traits} entities={entities}
          nameOf={personName}/>)}

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
          assetOk={assetOk} onWhy={(kind,id)=>setWhy({kind,id})}/>

        {/* Под схемой две вкладки: чем схема собрана и куда она идёт.
            Ползунок месяца — общий на обе: он стоит над ними, потому что
            одинаково относится и к числам на блоках, и к хвостам графиков. */}
        <div className="flex gap-2" style={{margin:"10px 0",overflowX:"auto"}}>
          <button style={btn(under==="edit")} onClick={()=>setUnder("edit")}>
            Управление</button>
          {me.tabs.includes("sim")&&(
            <button style={btn(under==="sim")} onClick={()=>setUnder("sim")}>
              Прогноз</button>)}
        </div>

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
              Актив — это его воркеры, его функции и его ресурсы. Три вкладки
              ниже — они и есть, все три одного вида.
            </div>

            <AssetPanel entityId={selE.id}
              workers={workers} onToggleWorker={toggleWorker}
              funcs={funcs} setFuncs={setFuncs}
              traits={traits} setTraits={setTraits}
              entities={entities} kinds={kinds} kindOf={kindOf}
              people={people} nameOf={personName} runsOf={runsOf}
              tasks={tasks} onOrderWorker={orderWorker} onOpenPerson={setPerson}
              onWhyFunc={id=>setWhy({kind:"func",id})}
              onWhyTrait={id=>setWhy({kind:"trait",id})}
              onDeleteTrait={delTrait}/>
          </div>)}

        {/* Классификации ресурсов — под карточкой актива: тип задаётся
            ресурсу при создании, значит набор типов должен быть рядом. Но
            под спойлером: правят их редко, а место они занимали всегда. */}
        {under==="edit" && (
        <div style={{...S.card,marginTop:10}}>
          <button style={{background:"none",border:"none",padding:0,width:"100%",
            textAlign:"left",cursor:"pointer",color:C.muted}}
            aria-expanded={kindsOpen} onClick={()=>setKindsOpen(v=>!v)}>
            <span style={S.lbl}>{kindsOpen?"▾":"▸"} классификации ресурсов</span>
            <span style={{fontSize:10.5,color:C.muted}}> · {kinds.length}</span>
          </button>
          {kindsOpen&&(<>
          <div style={{fontSize:11.5,color:C.muted,marginTop:6,lineHeight:1.6}}>
            Каждый ресурс относится к одной классификации: она задаёт значок и
            цвет. Удаление переводит её ресурсы в первую оставшуюся.
          </div>
          <div style={{marginTop:8}}>
            {kinds.map(k=>(
              <div key={k.id} className="flex flex-wrap gap-2"
                style={{alignItems:"center",marginBottom:6}}>
                <TxtField value={k.sign} aria-label={`значок ${k.name}`}
                  style={{flex:"0 0 52px",textAlign:"center"}}
                  onCommit={v=>upK(k.id,"sign",v||"•")}/>
                <TxtField value={k.name} aria-label="название классификации"
                  style={{flex:"1 1 130px"}} onCommit={v=>upK(k.id,"name",v)}/>
                <input type="color" value={k.color} aria-label={`цвет ${k.name}`}
                  onChange={e=>upK(k.id,"color",e.target.value)}
                  style={{width:38,height:30,background:"none",border:"none"}}/>
                <button style={{...btn(false),color:BAD,borderColor:"#5A2436"}}
                  onClick={()=>setKindMsg(delKind(k.id))}>✕</button>
              </div>))}
            <div className="flex flex-wrap gap-2" style={{alignItems:"center"}}>
              <button style={btn(false)} onClick={addKind}>+ классификация</button>
              {kindMsg&&<span style={{fontSize:11,color:C.muted}}>{kindMsg}</span>}
            </div>
          </div></>)}
        </div>)}

        {/* ═══ ПРОГНОЗ — вторая подвкладка ═══ */}
        {under==="sim" && me.tabs.includes("sim") && (<div>
        <div style={{...S.card,marginBottom:10}}>
          <div style={S.lbl}>прогноз по функциям</div>
          <div style={{fontSize:11.5,color:C.muted,marginTop:6,lineHeight:1.6}}>
            Считается по функциям и только по ним: из времени одного
            выполнения выходит, сколько раз функция срабатывает за месяц, из
            вилок — сколько ресурса при этом уходит и приходит. Поэтому
            прогноз — лента, а не линия: <span style={{color:WARN}}>жёлтым</span>
            {" "}её границы, <span style={{color:OK}}>зелёным</span> — факт по
            принятым выполнениям. Пересчитывается сам при каждой правке.
          </div>
          {!funcs.length&&<div style={{fontSize:11.5,color:WARN,marginTop:8,
            lineHeight:1.6}}>
            Функций нет — считать нечего. Ресурсы останутся на своих
            значениях: сами по себе они не меняются.
          </div>}
        </div>

        {!!goals.length&&(
          <div style={{...S.card,marginBottom:10}}>
            <div style={S.lbl}>цели · что для них нужно сделать</div>
            {plans.map(({t,lo,hi})=>{
              const r=reach(fc,t);
              const best=hi.ok?hi:null, sure=lo.ok?lo:null;
              const show=best||sure;
              return (
                <div key={t.id} style={{background:C.panel2,border:`1px solid ${C.line}`,
                  borderRadius:8,padding:9,marginTop:8}}>
                  <div style={{fontSize:12.5,fontWeight:700}}>{t.l}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2,lineHeight:1.6}}>
                    сейчас {nm(Number(t.have)||0)} {t.unit} · нужно {nm(Number(t.want))}
                    {hi.need>0?` · не хватает ${nm(hi.need)}`:" · цель уже взята"}
                  </div>

                  {hi.need>0&&(<>
                    <div style={{...S.lbl,marginTop:8}}>что нужно сделать</div>
                    {!show&&(
                      <div style={{fontSize:11.5,color:BAD,marginTop:5,lineHeight:1.6}}>
                        {hi.missing.length
                          ? `Цель недостижима: ресурс «${traits.find(x=>x.id===hi.missing[0])?.l
                            ||hi.missing[0]}» не выдаёт ни одна функция. Заведите функцию, которая его производит.`
                          : hi.looped
                            ? "Цепочка замкнулась сама на себя: ресурс нужен для того, чтобы получить этот же ресурс. Разорвите круг или задайте начальный запас."
                            : "Ни одна функция не выдаёт этот ресурс."}
                      </div>)}
                    {show&&show.steps.map(st=>{
                      // Осторожная оценка требует больше выполнений: у неё
                      // функция выдаёт по нижней границе. Показываем вилку.
                      const alt=(best&&sure)?sure.steps.find(x=>x.func===st.func):null;
                      const from=alt?Math.min(st.runs,alt.runs):st.runs;
                      const to=alt?Math.max(st.runs,alt.runs):st.runs;
                      return (
                        <div key={st.func} className="flex flex-wrap gap-2"
                          style={{alignItems:"center",padding:"4px 0",
                            borderTop:`1px solid ${C.line}`,fontSize:11.5}}>
                          <span style={{flex:"1 1 140px"}}>
                            {st.name||"без названия"}
                            <span style={{color:C.muted}}> · {ent(st.e)?.name||""}</span>
                          </span>
                          <span style={{color:WARN}}>
                            {from===to?`${nm(from)} выполнений`:`${nm(from)}–${nm(to)} выполнений`}
                          </span>
                          <span style={{color:C.muted}}>{durText(st.calendarHours)}</span>
                        </div>);
                    })}
                    {show&&(
                      <div style={{fontSize:11.5,marginTop:8,lineHeight:1.7}}>
                        <div>работы всего: <b style={{color:WARN}}>
                          {best&&sure&&Math.round(best.workHours)!==Math.round(sure.workHours)
                            ? `${durText(best.workHours)} – ${durText(sure.workHours)}`
                            : durText(show.workHours)}</b></div>
                        <div>займёт по самой длинной цепочке: <b style={{color:ACC}}>
                          {best&&sure&&Math.round(best.criticalHours)!==Math.round(sure.criticalHours)
                            ? `${durText(best.criticalHours)} – ${durText(sure.criticalHours)}`
                            : durText(show.criticalHours)}</b></div>
                        {!sure&&(
                          <div style={{color:C.muted,fontSize:10.5,marginTop:3}}>
                            Это по верхней границе вилок. По нижней цель не
                            достигается вовсе: {lo.missing.length
                              ? `ресурс «${traits.find(x=>x.id===lo.missing[0])?.l
                                ||lo.missing[0]}» по ней никто не выдаёт`
                              : lo.looped
                                ? "цепочка замыкается сама на себя"
                                : "выхода не хватает"}. Называть один срок,
                            когда вилка даёт два разных ответа, нельзя.
                          </div>)}
                      </div>)}
                  </>)}

                  <div style={{fontSize:11,color:C.muted,marginTop:8,lineHeight:1.6}}>
                    по прогнозу: {r.sure!=null?`наверняка к ${r.sure} мес`:"по нижней границе не достигается"}
                    {" · "}
                    {r.best!=null?`в лучшем случае к ${r.best} мес`:"не достигается и по верхней"}
                    {r.fact!=null?` · по факту к ${r.fact} мес`:""}
                  </div>
                </div>);
            })}
            <div style={{fontSize:10.5,color:C.muted,marginTop:8,lineHeight:1.5}}>
              «Что нужно сделать» разворачивается от цели назад: сколько
              выполнений какой функции требуется, что они возьмут на входе и
              чем эти входы произвести. То, что уже лежит в остатках, идёт в
              дело первым. Два числа вместо одного — потому что вилка одного
              не даёт: сколько выполнений понадобится, зависит от того, выйдет
              выход функции по нижней границе или по верхней.
            </div>
          </div>)}

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
                      {t.want!=null?` · цель ${nm(Number(t.want))}`:""}
                    </div>
                    {on&&(
                      <div style={{marginTop:8}}>
                        <Chart lo={lo} hi={hi} fact={fc.fact?fc.fact[t.id]:null}
                          months={span} goalLine={t.want!=null?Number(t.want):null}
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
          {[["people","Люди и роли"],["calls","Звонки"],["export","Выгрузка"]]
            // «Люди и роли» — дело владельца. «Выгрузка» тоже: схем у
            // не-владельца не бывает, у него одна — та, где его назначили.
            .filter(([k])=>(k!=="people"&&k!=="export")||me.isOwner||me.solo)
            .map(([k,t])=>(
              <button key={k} style={btn(tool===k)} onClick={()=>setTool(k)}>{t}</button>))}
        </div>)}

      {tab==="tools" && me.tabs.includes("tools") && tool==="people" && (
        <PeoplePanel me={me} onPeople={setPeople}/>)}

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
              const fs=d.funcs!==undefined?normalizeFuncs(d.funcs):funcs;
              if(d.entities){setEntities(normalizeAssets(d.entities));adoptSelection(d.entities);}
              if(d.traits)setTraits(d.traits);
              if(Array.isArray(d.kinds)&&d.kinds.length)setKinds(d.kinds);
              if(Array.isArray(d.tasks))setTasks(d.tasks);
              if(Array.isArray(d.funcs))setFuncs(fs);
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

      {why && (
        <Modal onClose={()=>setWhy(null)}
          title={why.kind==="asset"?"Что такое актив"
            :why.kind==="func"?"Что такое функция"
              :"Что такое ресурс"}>
          {why.kind==="asset"?WHY_ASSET:why.kind==="func"?WHY_FUNC:WHY_TRAIT}
        </Modal>)}

      {/* История человека: из списка воркеров — по нажатию на имя. Окном, а
          не разворотом в списке: истории может быть много, а список нужен
          целиком, чтобы сравнивать людей между собой. */}
      {person && (
        <Modal onClose={()=>setPerson(null)} title={personName(person)}>
          <PersonStats tasks={tasks} funcs={funcs} personId={person}
            traitName={id=>traits.find(t=>t.id===id)?.l||"ресурс удалён"}/>
        </Modal>)}
    </div>);
}
