import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from "react";
import { detectStorage, STORAGE_LABEL, listScenarios, getScenario, saveScenario,
  deleteScenario, syncSchedule, pickScenario, rememberScenario, touchScenario,
  forgetScenario, savedRoom, listScenarioVersions, getScenarioVersion } from "../storage.js";
import { SOLO, whoAmI, getWorkspace, listOrg, putWorkspace, reviewTaskRemote,
  addRole, removeRole, setUserRoles,
  takeTaskRemote, dropTaskRemote, submitTaskRemote, messageTaskRemote, markTaskRemote, seeChatRemote,
  getRatings, resetIdentity, mayEdit, tabShown, actingAs, setActingAs, joinFromLocation,
  sendIssue, setupTaskRemote }
  from "../identity.js";
import { callFromLocation } from "../calls.js";
import RegisterPanel from "./RegisterPanel.jsx";
import { FACTORS_ON } from "../lib/flags.js";
import { diffDocs } from "../lib/scenarioDiff.js";
import LooseCrew from "./LooseCrew.jsx";
import { handColor } from "../lib/hands.js";
import { syncProcFuncs } from "../lib/process.js";
import { procFuncs as procFuncs2, replaceName, setFuncHead, setTaskChecks } from "../lib/proc2.js";
import { Brand, C, OK, WARN, BAD, NEU, ACC, ICON, IconButton, NameField, S, TAB_LINE,
  tab as tabStyle, tintOf, btn, durText, nm, NumField, TxtField, DiffBoxes, WAS_STYLE , VIO} from "./ui.jsx";
import { WHY_ASSET, WHY_FUNC, WHY_TRAIT, WORKER_KINDS, activeFuncs, checkAsset, countWorkers,
  crewOf,
  normalizeAssets,
  editFunc, exceptOf, normalizeFactors, normalizeFunc, normalizeFuncs, pruneWorkers, workersOf }
  from "../lib/funcs.js";
import ProcessPanel from "./ProcessPanel.jsx";
import { normalizeProcs } from "../lib/process.js";
import { forecast, load, reach, transfers } from "../lib/plan.js";
import { pickByOrderOf } from "../lib/pickOrder.js";
import { actionsOf, goalRuns, normalizeGoals, perMonth, planGoal } from "../lib/goals.js";
import GoalsPanel from "./GoalsPanel.jsx";
import AssetPanel from "./AssetPanel.jsx";
import TasksBoard, { autoFlow, crewFor, roleOf, runsOfFunc } from "./TasksBoard.jsx";
import { swipeFrom, swipeStep, tabAfter } from "../lib/swipe.js";
/* Имена барабана — со своим префиксом: в компоненте есть свои `step` и
   `settled`, и одноимённый импорт они перекрывали. */
import { EYE, GAP, NOMINAL_W, NOMINAL_WIN, bend, centers, deg as degOf, dimAt, hold, lens as lensAt,
  nearest, radiusOf, settled as drumSettled, shown as drumShown, step as drumStep } from "../lib/drum.js";

/* Края барабана гаснут: вкладка, уехавшая за обод, не должна обрезаться
   ровной линией — она должна растворяться (владелец, 2026-09-21). */
const TABS_MASK = "linear-gradient(90deg, transparent 0, #000 18px,"
  + " #000 calc(100% - 18px), transparent 100%)";
/* Окно барабана: вкладка плюс место, куда ей вырасти посередине. */
const DRUM_H = "calc(var(--control-h) + var(--space-8))";
import { elbow } from "../lib/paths.js";
import Timeline from "./Timeline.jsx";
import ReviewBoard from "./ReviewBoard.jsx";
import PeoplePanel from "./PeoplePanel.jsx";
import AgentsPanel from "./AgentsPanel.jsx";
import MarketPanel from "./MarketPanel.jsx";
import VirtualPanel from "./VirtualPanel.jsx";
import JoinPanel from "./JoinPanel.jsx";
import CallsBoard from "./CallsBoard.jsx";
import { useHistory, sameDoc } from "../lib/history.js";
import { readDraft, saveDraft, clearDraft } from "../lib/draft.js";
import Modal from "./Modal.jsx";
import ProfilePanel, { RemindersCard, warnMinOf } from "./ProfilePanel.jsx";
import IssuesPanel, { IssueModal } from "./IssuesPanel.jsx";
import { WandModal, captureScreen } from "./WandModal.jsx";
import { askFromApp } from "../assistant.js";
import { record as recordAction } from "../lib/appLog.js";
import ReportsPanel from "./ReportsPanel.jsx";
import { normalizeReports, reportFromLocation } from "../lib/reports.js";
import { countKind, dropKind } from "../lib/traits.js";
import { normalizeMaterials, withStock } from "../lib/units.js";

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

/* Как часто позванный переспрашивает свой срез, пока вкладка на виду. */
const POLL_MS=30000;
const KINDS0=[
  {id:"res",sign:"◆",name:"ресурс",color:ACC,dir:"up"},
  {id:"growth",sign:"▲",name:"рост",color:OK,dir:"up"},
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
  {id:"usr",name:"Пользователи",color:ACC,x:398,y:24},
  {id:"vm",name:"Виртуальный менеджер",color:OK,x:398,y:300},
]);
const T=(id,e,k,l,unit)=>({id,e,k,l,unit});
const TRAITS0=[
  T("dem","mkt","res","спрос","обращ."),
  T("act","usr","growth","активные пользователи","чел."),
  T("req","usr","res","заявки","шт."),
  T("hdl","vm","growth","обработанные заявки","шт."),
];
/* Сколько чего есть — не поле ресурса, а материалы (lib/units.js): в
   образце это две записи «×N», чтобы прогнозу было с чего начинать. */
const MATERIALS0=[
  {id:"m_dem",trait:"dem",kind:"text",qty:3000,text:"обращения с рынка",at:null,by:null},
  {id:"m_act",trait:"act",kind:"text",qty:20,text:"пользователи на старте",at:null,by:null},
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
/* Должность исполнителя названа у каждой стартовой функции: без неё
   задача не заводится вовсе (владелец, 2026-09-19), и стартовая схема
   отвечала бы на «Применить цель» пустотой. «Исполнитель» — встроенная
   должность, она есть в любой рабочей области. */
const DOER={owners:["executor"],setters:[],reviewers:[]};
const FUNCS0=normalizeFuncs([
  {id:"f_req",e:"usr",name:"Сбор заявок",
    takes:[P("dem",2,4)],gives:[P("req",1,1)],
    dur:2,durUnit:"ч",owners:[],reviewers:[],posts:DOER,x:0,y:0},
  {id:"f_hdl",e:"vm",name:"Обработка заявки",
    takes:[P("req",1,1)],gives:[P("hdl",1,1),P("act",0,1)],
    dur:4,durUnit:"ч",owners:[],reviewers:[],posts:DOER,x:0,y:0},
  {id:"f_dem",e:"mkt",name:"Сарафанное радио",
    takes:[P("hdl",1,1)],gives:[P("dem",1,3)],
    dur:1,durUnit:"дн",owners:[],reviewers:[],posts:DOER,x:0,y:0},
]);

/* ─────── график: лента гипотезы и линия факта ───────
   Лента, а не линия: вилка входов и выходов — гипотеза, и рисовать её одной
   чертой значило бы показать знание, которого нет. Факт ложится поверх
   отдельной линией, когда выполнения появились. */
/* Лента рисуется на ВЕСЬ горизонт сразу (владелец, 2026-09-20: «графики в
   прогнозах не работают»). Прежде хвост дорисовывался по ползунку месяца, а
   ползунок стоит на нуле, пока его не двигали, — и график был пуст: одна
   точка полилинией не рисуется. Выбранный месяц по-прежнему отмечен
   чертой, но лента от него не зависит. */
function Chart({lo,hi,fact,months,goalLine,cursorMonth}){
  const W=700,H=240,PL=54,PB=26,PT=12,PR=12;
  const all=[...(lo||[]),...(hi||[]),...(fact||[]),...(goalLine!=null?[goalLine]:[])];
  const max=Math.max(1,...all.filter(isFinite))*1.1;
  const x=i=>PL+(i/Math.max(1,months))*(W-PL-PR);
  const y=v=>PT+(1-Math.min(v,max)/max)*(H-PT-PB);
  const step=Math.max(1,Math.ceil(months/6));
  const till=(row)=>(row||[]).slice(0,months+1);
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
          fontFamily="var(--font-sans)">{nm(max*f)}</text></g>))}
      {Array.from({length:months+1}).map((_,i)=>i%step===0&&(
        <text key={i} x={x(i)} y={H-8} textAnchor="middle" fontSize="10" fill={C.muted}
          fontFamily="var(--font-sans)">{i}м</text>))}
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
/* ════════════════ КАМЕРА СХЕМЫ ════════════════
   Владелец (2026-09-14): «при увеличении съезжает всё остальное
   пространство; схема должна быть в окне фиксированного размера;
   если двумя пальцами раздвигаю объект, по окончании он оказывается
   далеко за пределами пальцев; движение должно быть плавным; лист
   может быть каким угодно большим, но при полном уменьшении он
   умещается в рамку».

   Как это делают карты, Figma и Miro — и как сделано здесь:
   · ОКНО фиксированной высоты, лист внутри него — через `viewBox` svg:
     страница от масштаба не меняется, меняется только то, что в окне.
   · КАМЕРА `{x, y, z}` — левый верхний угол видимого в координатах листа
     и масштаб — живёт в ref и применяется к svg НАПРЯМУЮ на каждое
     движение пальцев, без перерисовки React: отсюда плавность. React
     перерисовывает по концу жеста и по правкам схемы, и тогда берёт ту
     же камеру — расходиться им не из чего.
   · ЩИПОК — геометрический, вокруг точки между пальцами: точка листа
     под серединой пальцев остаётся под ней на каждом движении. Отдельно
     «умно» увеличивать объект или подпись стрелки в таких редакторах не
     принято: увеличивается вид целиком, а объект под пальцами остаётся
     под пальцами — это и есть ощущение «раздвинул именно его».
   · ПРЕДЕЛЫ: минимум — «вписать лист в окно» (`fitZoom`), максимум —
     `ZOOM_MAX`; камера не уезжает за лист: если лист меньше окна, он
     стоит по центру.
   · ОДИН ПАЛЕЦ по пустому месту (и мышь) — прокрутка листа; колесо —
     прокрутка, с Ctrl (щипок на тачпаде) — масштаб вокруг курсора;
     кнопки «−»/«+» — масштаб вокруг центра окна с коротким плавным
     переходом.
   ═══════════════════════════════════════════════ */
export const ZOOM_MAX=2.5;
/* Размер окна, когда его нечем измерить (тесты, скрытая вкладка). */
const BOX_FALLBACK={w:1000,h:600};
export const fitZoom=(w,h,cw,ch)=>Math.min(w/cw,h/ch);

const SchemeSVG=React.forwardRef(function SchemeSVG({entities,traits,funcs,moves,sel,valuesFor,
  onSelectEntity,onMoveEntity,assetOk,onWhy,onOpenFunc},ref){
  const DRAG_MIN=4;
  const drag=useRef(null);
  const box=useRef(null);
  const svgRef=useRef(null);
  /* Пальцем схема перехватывает жесты только ПОСЛЕ одиночного нажатия по
     ней (владелец, 2026-09-18: «скроллю страницу, палец останавливается на
     схеме — прокрутка прекращается»). Пока не нажали, `touch-action`
     оставляет прокрутку странице, а касания до схемы не доходят. Мышь
     работает всегда: колесо и перетаскивание страницу не листают. */
  const [live,setLive]=useState(false);
  const tap=useRef(null);
  useEffect(()=>{
    if(!live) return undefined;
    const off=(ev)=>{ if(!box.current?.contains(ev.target)) setLive(false); };
    window.addEventListener("pointerdown",off,true);
    return ()=>window.removeEventListener("pointerdown",off,true);
  },[live]);
  const armTouch=(ev)=>{
    if(ev.pointerType!=="touch"||live) return;
    // Первое касание — только «разбудить»: жест уходит странице.
    ev.stopPropagation();
    tap.current={x:ev.clientX,y:ev.clientY};
  };
  const armEnd=(ev)=>{
    if(ev.pointerType!=="touch"||live||!tap.current) return;
    const moved=Math.abs(ev.clientX-tap.current.x)>8||Math.abs(ev.clientY-tap.current.y)>8;
    tap.current=null;
    if(!moved) setLive(true);   // прокрутили — схема осталась спящей
  };
  const cam=useRef(null);            // {x,y,z}; null — ещё не вписана
  const size=useRef({...BOX_FALLBACK});
  const pinch=useRef(null);
  const pan=useRef(null);
  const anim=useRef(null);
  const [,bump]=useState(0);         // перерисовка по концу жеста
  // Пока блок ведут, его положение живёт здесь, а не в модели: правка модели
  // на каждое движение пальца перерисовывала бы всё приложение целиком.
  const [dragPos,setDragPos]=useState(null);

  const ents=dragPos
    ? entities.map(e=>e.id===dragPos.id?{...e,x:dragPos.x,y:dragPos.y}:e)
    : entities;
  // Лист: не меньше окна по умолчанию, дальше растёт за блоками.
  const CW=Math.max(1000,...ents.map(e=>e.x+NW+24));
  const CH=Math.max(740,...ents.map(e=>e.y+NH+24));

  const zMin=()=>fitZoom(size.current.w,size.current.h,CW,CH);
  const clampZ=(z)=>Math.max(zMin(),Math.min(ZOOM_MAX,z));
  /* Лист не теряется: по каждой оси хотя бы половина окна остаётся над
     листом (как в картах — за край можно заглянуть, но не уехать в пустоту).
     Жёстко «не дальше края» нельзя: тогда якорь щипка у края листа
     срывался бы. Лист меньше окна — по центру. */
  const settle=(c)=>{
    const vw=size.current.w/c.z, vh=size.current.h/c.z;
    c.x=vw>=CW?(CW-vw)/2:Math.max(-vw/2,Math.min(CW-vw/2,c.x));
    c.y=vh>=CH?(CH-vh)/2:Math.max(-vh/2,Math.min(CH-vh/2,c.y));
    return c;
  };
  const fitCam=()=>settle({x:0,y:0,z:zMin()});
  const viewBox=(c)=>`${c.x} ${c.y} ${size.current.w/c.z} ${size.current.h/c.z}`;
  const apply=()=>{ if(svgRef.current&&cam.current) svgRef.current.setAttribute("viewBox",viewBox(cam.current)); };
  if(!cam.current) cam.current=fitCam();

  /* Масштаб `z` так, чтобы точка листа под точкой окна (sx, sy) осталась
     под ней. Это и есть якорь щипка и колеса. */
  const zoomAt=(z,sx,sy)=>{
    const c=cam.current;
    const wx=c.x+sx/c.z, wy=c.y+sy/c.z;
    const nz=clampZ(z);
    c.z=nz; c.x=wx-sx/nz; c.y=wy-sy/nz;
    settle(c); apply();
  };
  const panBy=(dx,dy)=>{ const c=cam.current; c.x-=dx/c.z; c.y-=dy/c.z; settle(c); apply(); };
  /* Плавный переход к масштабу — для кнопок и колеса: рывок в полтора
     раза читается как скачок, а 160 мс — как движение. */
  const animateZoom=(target,sx,sy,ms=160)=>{
    const z0=cam.current.z, z1=clampZ(target);
    if(anim.current) cancelAnimationFrame(anim.current);
    if(typeof requestAnimationFrame!=="function"||ms<=0){ zoomAt(z1,sx,sy); bump(n=>n+1); return; }
    const t0=performance.now();
    // Время — своё, а не из аргумента кадра: у него другая точка отсчёта.
    const step=()=>{
      const k=Math.min(1,Math.max(0,(performance.now()-t0)/ms)), e=1-(1-k)*(1-k);   // ease-out
      zoomAt(z0+(z1-z0)*e,sx,sy);
      if(k<1) anim.current=requestAnimationFrame(step); else { anim.current=null; bump(n=>n+1); }
    };
    anim.current=requestAnimationFrame(step);
  };
  React.useImperativeHandle(ref,()=>({
    zoomBy:(k)=>animateZoom(cam.current.z*k,size.current.w/2,size.current.h/2),
    fit:()=>{ cam.current=fitCam(); apply(); bump(n=>n+1); },
    zoom:()=>cam.current.z,
  }));

  /* Размер окна — с экрана; окно скрыто (0×0) — прежний размер. При первом
     измерении лист вписывается в окно. */
  useLayoutEffect(()=>{
    const el=box.current; if(!el) return undefined;
    let first=true;
    const measure=()=>{
      const r=el.getBoundingClientRect();
      if(!(r.width>0&&r.height>0)) return;
      size.current={w:r.width,h:r.height};
      if(first){ first=false; cam.current=fitCam(); } else settle(cam.current);
      apply();
    };
    measure();
    if(typeof ResizeObserver==="function"){
      const ro=new ResizeObserver(measure); ro.observe(el);
      return ()=>ro.disconnect();
    }
    window.addEventListener("resize",measure);
    return ()=>window.removeEventListener("resize",measure);
  },[]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Лист вырос или сжался — камера остаётся в его пределах.
  useLayoutEffect(()=>{ settle(cam.current); apply(); });

  /* ─── щипок: два пальца ─── */
  useEffect(()=>{
    const el=box.current; if(!el) return undefined;
    const dist=(t)=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
    const mid=(t)=>{
      const r=el.getBoundingClientRect();
      return [(t[0].clientX+t[1].clientX)/2-r.left,(t[0].clientY+t[1].clientY)/2-r.top];
    };
    const start=(ev)=>{
      if(ev.touches.length!==2) return;
      // Второй палец отменяет перетаскивание и прокрутку: жест — масштаб.
      drag.current=null; setDragPos(null); pan.current=null;
      if(anim.current){ cancelAnimationFrame(anim.current); anim.current=null; }
      const [mx,my]=mid(ev.touches);
      const c=cam.current;
      pinch.current={d0:dist(ev.touches),z0:c.z,wx:c.x+mx/c.z,wy:c.y+my/c.z};
      ev.preventDefault();
    };
    const move=(ev)=>{
      const pz=pinch.current; if(!pz||ev.touches.length!==2) return;
      ev.preventDefault();
      const [mx,my]=mid(ev.touches);
      const c=cam.current;
      c.z=clampZ(pz.z0*dist(ev.touches)/pz.d0);
      // Та же точка листа — под нынешней серединой пальцев, даже если она сдвинулась.
      c.x=pz.wx-mx/c.z; c.y=pz.wy-my/c.z;
      settle(c); apply();
    };
    const end=(ev)=>{ if(pinch.current&&ev.touches.length<2){ pinch.current=null; bump(n=>n+1); } };
    el.addEventListener("touchstart",start,{passive:false});
    el.addEventListener("touchmove",move,{passive:false});
    el.addEventListener("touchend",end);
    el.addEventListener("touchcancel",end);
    return ()=>{
      el.removeEventListener("touchstart",start);
      el.removeEventListener("touchmove",move);
      el.removeEventListener("touchend",end);
      el.removeEventListener("touchcancel",end);
    };
  },[CW,CH]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── колесо: прокрутка; с Ctrl (щипок на тачпаде) — масштаб у курсора ─── */
  useEffect(()=>{
    const el=box.current; if(!el) return undefined;
    const wheel=(ev)=>{
      ev.preventDefault();
      if(ev.ctrlKey||ev.metaKey){
        const r=el.getBoundingClientRect();
        zoomAt(cam.current.z*Math.exp(-ev.deltaY*0.0025),ev.clientX-r.left,ev.clientY-r.top);
      } else panBy(-ev.deltaX,-ev.deltaY);
    };
    el.addEventListener("wheel",wheel,{passive:false});
    return ()=>el.removeEventListener("wheel",wheel);
  },[CW,CH]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── один палец / мышь: блок — перетаскивание, пустое место — прокрутка ─── */
  const down=(ev,e)=>{
    if(!onMoveEntity) return;
    drag.current={id:e.id,sx:ev.clientX,sy:ev.clientY,ox:e.x,oy:e.y,moved:false};
  };
  const downBg=(ev)=>{
    if(ev.target.closest&&ev.target.closest("[data-entity]")) return;
    if(ev.pointerType==="mouse"&&ev.button!==0) return;
    pan.current={sx:ev.clientX,sy:ev.clientY};
  };
  useEffect(()=>{
    // Слушаем на окне, а не на блоке: Safari (значит, и Telegram на iOS)
    // ненадёжно держит pointer capture внутри <svg>.
    const move=(ev)=>{
      if(pinch.current) return;
      const p=pan.current;
      if(p){ panBy(ev.clientX-p.sx,ev.clientY-p.sy); p.sx=ev.clientX; p.sy=ev.clientY; return; }
      const d=drag.current; if(!d) return;
      const dx=ev.clientX-d.sx, dy=ev.clientY-d.sy;
      if(!d.moved&&Math.hypot(dx,dy)<DRAG_MIN) return;
      d.moved=true;
      const z=cam.current.z;
      d.x=Math.max(0,Math.round(d.ox+dx/z));
      d.y=Math.max(0,Math.round(d.oy+dy/z));
      setDragPos({id:d.id,x:d.x,y:d.y});
    };
    const up=(ev)=>{
      if(pan.current){ pan.current=null; bump(n=>n+1); }
      const d=drag.current; if(!d) return;
      drag.current=null; setDragPos(null);
      if(d.moved){ if(onMoveEntity) onMoveEntity(d.id,d.x,d.y); } else onSelectEntity(d.id);
    };
    const noScroll=(ev)=>{ if(drag.current||pan.current) ev.preventDefault(); };
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
  },[onMoveEntity,onSelectEntity,CW,CH]);   // eslint-disable-line react-hooks/exhaustive-deps
  const ent=(id)=>ents.find(e=>e.id===id);

  return (
    /* Окно фиксированной высоты: страница под ним не двигается, что бы ни
       делали с масштабом. `touch-action: none` — жесты внутри наши. */
    <div ref={box} data-scheme-box="" data-live={live?"1":"0"}
      onPointerDownCapture={armTouch} onPointerUp={armEnd} onPointerCancel={()=>{tap.current=null;}}
      style={{height:"min(56vh, 520px)",minHeight:280,overflow:"hidden",touchAction:live?"none":"pan-y",
        position:"relative",border:`1px solid ${C.line}`,borderRadius: "var(--radius-sm)",background:C.ink,
        cursor:pan.current?"grabbing":"default"}}>
      {/* Пока схема спит — подпись: одно нажатие и она берёт жесты себе. */}
      {!live&&(
        <div aria-hidden="true" style={{position:"absolute",right:8,top:8,zIndex:2,pointerEvents:"none",
          fontSize:"var(--fs-hint)",color:C.muted,background:`${C.ink}cc`,border:`1px solid ${C.line}`,
          borderRadius: "var(--radius-sm)",padding: "0 var(--space-4)"}}>нажмите, чтобы двигать схему</div>)}
      <svg ref={svgRef} viewBox={viewBox(cam.current)} width="100%" height="100%"
        preserveAspectRatio="xMidYMid meet" style={{display:"block"}}
        onPointerDown={downBg}>
        <defs>
          <marker id="aw" markerWidth="9" markerHeight="9" refX="8" refY="3"
            orient="auto"><path d="M0,0 L8,3 L0,6 z" fill={ACC}/></marker>
          {/* Свечение узла: box-shadow в SVG нет, поэтому размываем копию
              его рамки — тот же мягкий контур, что у карточек. */}
          <filter id="nodeGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="5"/>
          </filter></defs>

        {/* Передачи между активами: сколько ресурса в месяц уезжает.

            Каждая идёт своей полосой. Двусторонний обмен — обычное дело
            (одни отдают заявки, другие возвращают пользователей), и по одной
            линии такие передачи прятали бы друг друга: видно было бы только
            ту, что нарисована последней. */}
        {moves.map((w)=>{
          const a=ent(w.from),b=ent(w.to); if(!a||!b) return null;
          /* Своя полоса у каждой передачи между одной парой активов:
             обратная и соседние не ложатся поверх. Смещается средняя
             линия колена, а не вся стрелка. */
          const same=moves.filter(v=>v.from===w.from&&v.to===w.to);
          const at=same.indexOf(w);
          /* Строго вертикально и горизонтально, со скруглёнными углами
             (владелец, 2026-09-19): косая линия идёт «примерно туда», а
             колено говорит точно — вниз, потом вправо. */
          const { d: arc, mid }=elbow(a,b,{w:NW,h:NH,lane:(at-(same.length-1)/2)*26,r:14});
          const [mx,my]=mid;
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
            <path d={arc} fill="none" stroke="transparent" strokeWidth="16"/>
            <path data-move="" d={arc} fill="none" stroke={ACC}
              strokeWidth="1.6" strokeDasharray="4 3" markerEnd="url(#aw)"
              strokeLinecap="round" strokeLinejoin="round" style={{pointerEvents:"none"}}/>
            <rect x={mx-70} y={my-11} width="140" height="22" rx="11"
              fill="rgba(7,10,15,.9)" stroke="rgba(77,225,255,.45)" strokeWidth="1"/>
            <text x={mx} y={my+3.5} textAnchor="middle" fontSize="9"
              fill="var(--chip-cyan-text)"
              style={{pointerEvents:"none"}}>
              {txt.length>26?txt.slice(0,25)+"…":txt}</text></g>);})}

        {ents.map(e=>{
          const ts=traits.filter(t=>t.e===e.id);
          const fs=funcs.filter(f=>f.e===e.id);
          const ok=assetOk(e.id);
          /* `data-entity` — метка для подложки «участники без актива»:
             человека отпускают НА БЛОК, и спросить надо именно тот, что
             под пальцем (`elementFromPoint`), а не ближайший. */
          return (<g key={e.id} data-entity={e.id} onPointerDown={ev=>down(ev,e)}
            style={{cursor:onMoveEntity?"grab":"pointer",touchAction:live?"none":"pan-y"}}>
            {/* УЗЕЛ СХЕМЫ: состояние говорит КОНТУР и мягкое свечение, а
                не полоска слева (дизайн-система Blocktree Liquid Glass).
                Свечение рисуется отдельным прямоугольником под узлом:
                box-shadow в SVG нет, а размытая копия рамки даёт тот же
                эффект и не мешает нажатию. */}
            <rect x={e.x} y={e.y} width={NW} height={NH} rx="16" fill="none"
              stroke={ok?OK:BAD} strokeWidth="6" opacity="0.18"
              filter="url(#nodeGlow)" style={{pointerEvents:"none"}}/>
            <rect x={e.x} y={e.y} width={NW} height={NH} rx="16"
              fill="var(--surface-glass-strong)"
              stroke={sel===e.id?ACC:(ok?OK:BAD)} strokeWidth={sel===e.id?2.6:1.4}
              data-state={ok?"ok":"bad"}/>
            <text x={e.x+16} y={e.y+27} fontSize="14" fontWeight="600" fill={C.text}>
              {e.name.length>23?e.name.slice(0,22)+"…":e.name}</text>
            <text x={e.x+16} y={e.y+45} fontSize="11" fill={ok?OK:BAD}>● актив</text>
            {!ok&&(<g style={{cursor:"help"}}
              onPointerDown={ev=>{ev.stopPropagation();}}
              onClick={ev=>{ev.stopPropagation();onWhy("asset",e.id);}}>
              <circle cx={e.x+68} cy={e.y+41} r="7.5" fill="transparent" stroke={BAD}/>
              <text x={e.x+68} y={e.y+44.5} textAnchor="middle" fontSize="9" fill={BAD}>?</text>
            </g>)}
            <text x={e.x+14} y={e.y+64} fontSize="10.5" fill={C.muted}>
              {countWorkers(e)} воркеров ·
              {" "}{new Set(fs.map(f=>f.chain?.id||f.id)).size} функц. · {ts.length} ресурс.</text>
            {ts.slice(0,2).map((t,i)=>{
              const v=valuesFor(t.id);
              return (<text key={t.id} x={e.x+14} y={e.y+84+i*17} fontSize="10.5"
                fill={C.muted} fontFamily="var(--font-sans)">
                {(t.l.length>14?t.l.slice(0,13)+"…":t.l)}: {nm(v.lo)}–{nm(v.hi)}</text>);})}
          </g>);})}

      </svg>
    </div>);
});

/* « · 12.09.2026» к имени сохранённого сценария; без даты — ничего. */
function savedOn(iso){
  const d=new Date(iso||"");
  return isNaN(d.getTime())?"":` · ${d.toLocaleDateString("ru-RU")}`;
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
/* «Рынок услуг» — первой, перед анкетой (владелец, 2026-09-13), и всем:
   заказ оставляет любой зарегистрированный, роль тут не спрашивается. */
export const MARKET_TAB=["market","Рынок услуг"];
export const TAB_LIST=[MARKET_TAB,SELF_TAB,["tasks","Задачи"],["review","Проверка"],
  ["scheme","Схема"],["reports","Отчёты"],["tools","Инструменты"]];

/* ════════════════ ГЛАВНОЕ ════════════════ */
/* Документ из внешней записи — сценария с диска или JSON из выгрузки —
   поверх текущего `cur`. Старые записи могут не знать про часть
   документа: недостающее остаётся текущим, а не превращается в пустоту.
   Путь один на все входы нарочно: пока «Загрузить» из выгрузки собирал
   документ своим набором сеттеров, он молча терял цели, факторы и
   отчёты — всё, что появилось в документе позже него. */
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
    materials:normalizeMaterials(arr(d.materials,cur.materials)),
    procs:normalizeProcs(arr(d.procs,cur.procs)),
  };
}

/* ═══ ВЕРСИИ СЦЕНАРИЯ (владелец, 2026-09-19) ═══
   Кнопка с числом версий после выбора сценария; внутри — список сохранений,
   а у версии две формы: что добавилось и что убралось, как в техпроцессе. */
function ScenarioDiff({ added = [], removed = [], changed = [] }) {
  /* Заменённая строка — «было → стало» на одном месте: старое зачёркнуто,
     новое обычным текстом (владелец, 2026-09-20). */
  const line = (x, sign) => (
    <div style={{ fontSize: "var(--fs-hint)", overflowWrap: "anywhere" }}>
      {sign === "±" ? (<>
        <span style={WAS_STYLE}>{x.from}</span>
        <span style={{ color: WARN }}> → </span>
        <span>{x.to}</span>
      </>) : x}
    </div>);
  return <DiffBoxes added={added} changed={changed} removed={removed} item={line} gap={4} />;
}

function ScenarioVersions({ id, when, stamp = "" }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState([]);
  const [which, setWhich] = useState(null);
  const [diff, setDiff] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setOpen(false); setWhich(null); setDiff(null);
    if (!id) { setList([]); return; }
    listScenarioVersions(id).then((v) => setList(Array.isArray(v) ? v : [])).catch(() => setList([]));
    /* `stamp` — время последнего сохранения: без него список версий
       оставался бы вчерашним до переоткрытия вкладки. */
  }, [id, stamp]);
  const show = async (v) => {
    if (which === v.v) { setWhich(null); setDiff(null); return; }
    setWhich(v.v); setDiff(null); setBusy(true);
    try {
      const i = list.findIndex((x) => x.v === v.v);
      const [now, prev] = await Promise.all([
        getScenarioVersion(id, v.v),
        i > 0 ? getScenarioVersion(id, list[i - 1].v) : Promise.resolve(null),
      ]);
      setDiff(diffDocs(prev?.data || {}, now?.data || {}));
    } catch { setDiff({ added: [], removed: [], changed: [] }); }
    setBusy(false);
  };
  if (!id) return null;
  return (
    <div style={{ marginBottom: "var(--space-8)" }}>
      <button type="button" aria-expanded={open} aria-label="версии сценария"
        onClick={() => setOpen((v) => !v)}
        style={{ ...btn(false), width: "100%", textAlign: "center" }}>
        {open ? "▾" : "▸"} Версии ({list.length})</button>
      {open && (
        <div style={{ marginTop: "var(--space-4)" }}>
          {!list.length && <div style={{ fontSize: "var(--fs-hint)", color: C.muted }}>Версий пока нет — сохраните схему.</div>}
          {[...list].reverse().map((v) => (
            <div key={v.v} style={{ borderTop: `1px solid ${C.line}`, padding: "var(--space-4) 0" }}>
              <button type="button" aria-expanded={which === v.v} aria-label={`версия ${v.v}`}
                onClick={() => show(v)} className="flex items-center gap-2"
                style={{ width: "100%", background: "transparent", border: "none", padding: 0, cursor: "pointer", color: C.text, textAlign: "left" }}>
                <span style={{ fontSize: "var(--fs-hint)", whiteSpace: "nowrap" }}>{which === v.v ? "▾" : "▸"} №{v.v}</span>
                <span style={{ flex: 1, fontSize: "var(--fs-hint)", color: C.muted, textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {when(v.at)}</span>
              </button>
              {which === v.v && (busy
                ? <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginTop: "var(--space-4)" }}>смотрю…</div>
                : diff && <ScenarioDiff added={diff.added} removed={diff.removed}
                    changed={diff.changed} />)}
            </div>))}
        </div>)}
    </div>);
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
  /* Материалы — единицы ресурсов, заведённые руками (lib/units.js). Часть
     документа: из них и из принятых сдач считается, сколько ресурса есть. */
  const [materials,setMaterials]=useState(MATERIALS0);
  /* Технологические процессы — что за чем следует, текстом (lib/process.js).
     Часть документа: из них собираются функции, и без них самих функции
     нельзя было бы ни пересобрать, ни снять. */
  const [procs,setProcs]=useState([]);
  /* Считать ли гипотетически принятые процессы. Состояние интерфейса, не
     документа: галочка — вопрос «а что если», и в сохранённую модель ответ
     на него не уезжает. Включена с самого начала (владелец, 2026-09-20:
     «гипотезы должны быть включены по умолчанию»): процесс принимают
     гипотетически, чтобы увидеть его в прогнозе, а не чтобы ещё раз
     включать. */
  const [hypoOn,setHypoOn]=useState(true);
  /* Пространство вкладки задач — часть документа наравне с отчётами:
     положение блоков, стрелки и заметки живут с моделью, а не в браузере.
     У позванного оно своё и уезжает на сервер отдельно (см. ниже). */
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
  /* Горизонт расчёта — 24 месяца: поле убрано из шапки (владелец,
     2026-09-19), а прогнозу без глубины считать нечего. */
  const horizon=24;
  const schemeRef=useRef(null);   // камера схемы: «−»/«+» зовут её напрямую
  // Заготовка заказа/услуги из настроек функции — до открытия рынка.
  const [marketDraft,setMarketDraft]=useState(null);
  const [json,setJson]=useState(""); const [jsonMsg,setJsonMsg]=useState("");
  const [savedList,setSavedList]=useState([]);
  const [savedSel,setSavedSel]=useState("");
  const [saveName,setSaveName]=useState("");
  const [savedMsg,setSavedMsg]=useState("");
  const [savedBusy,setSavedBusy]=useState(false);
  const [savedWhere,setSavedWhere]=useState("");
  const [savedKind,setSavedKind]=useState("");
  const [openTask,setOpenTask]=useState(null);
  const [simMonth,setSimMonth]=useState(0);
  // Что открыто под схемой: правка модели или её будущее.
  const [under,setUnder]=useState("edit");
  // Спойлер процессов на «Управлении»: закрыт при открытии, помнится в сеансе.
  const [procsOpen,setProcsOpen]=useState(false);
  const [me,setMe]=useState(SOLO);
  /* Выбранный раздел схемы может оказаться закрытым для роли — тогда
     открывается первый, который ей доступен (владелец, 2026-09-20).
     Иначе вкладка показывала бы пустоту под рядом кнопок. */
  useEffect(()=>{
    if(tabShown(me,"scheme",under)) return;
    const first=["edit","time","sim"].find(k=>tabShown(me,"scheme",k));
    if(first) setUnder(first);
  },[me,under]);
  /* Регистрацию отложили: у кого доступ уже есть, тот уходит из неё
     «Назад» в приложение, а вернуться может кнопкой в шапке. */
  const [regAway,setRegAway]=useState(false);
  const [openCards,setOpenCards]=useState(()=>new Set());
  const [openCall,setOpenCall]=useState(()=>callFromLocation());
  /* Пришли по ссылке для регистрации (владелец, 2026-09-20): страницу,
     заполненную за человека, он забирает себе. Ключ живёт до тех пор,
     пока не вступил или не ушёл в приложение. */
  const [joinKey,setJoinKey]=useState(()=>joinFromLocation());
  const [people,setPeople]=useState([]);
  /* РОЛИ — один список на всё приложение: они открывают вкладки, по ним
     заключают договоры («Люди и роли»), ими же названы роли у функций и
     отмечены воркеры. Прежде рядом жил второй список — «должности», — и
     это был тот же вопрос «кто он здесь», заданный дважды.

     Приходят тем же запросом, что и люди: два запроса за одним ответом
     расходились бы. Перечитываются после каждой правки из блока воркеров:
     список ведёт сервер, и показывать своё предположение о нём незачем. */
  const [roles,setRoles]=useState([]);
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
  /* Окно «Напишите сообщение об ошибке» — значком в шапке (владелец,
     2026-09-21). Оно ни от чего не зависит и ничего не ждёт: человек
     говорит, что сломалось, и возвращается к работе. */
  const [issueOpen,setIssueOpen]=useState(false);
  /* Волшебная палочка (владелец, 2026-09-21): что человек видел, снимается
     в момент нажатия, до открытия окна, — иначе в снимок попало бы само
     окно. null — закрыто, "taking" — снимаем, объект — открыто. */
  const [wand,setWand]=useState(null);
  const openWand=async()=>{
    if(wand) return;
    setWand("taking");
    const seen=await captureScreen();
    setWand(seen);
  };
  useEffect(()=>{ if(openCall && me.tabs.includes("tools")) { setTab("tools"); setTool("calls"); } },
    [openCall,me.tabs]);

  const ent=(id)=>entities.find(e=>e.id===id);
  const kindOf=useMemo(()=>kindLookup(kinds),[kinds]);

  // ─── история правок: отмена и возврат ───
  const doc=useMemo(()=>({entities,traits,kinds,tasks,funcs,goals,factors,reports,materials,
    procs}),
    [entities,traits,kinds,tasks,funcs,goals,factors,reports,materials,procs]);
  /* Ресурсы с посчитанным «есть»: расчёт, доска задач и карточка ресурса
     смотрят на остаток по материалам, а не на записанное число. Правят
     при этом `traits` — по id, так что подмена здесь их не задевает. */
  const traitsLive=useMemo(()=>withStock({traits,tasks,funcs,materials}),
    [traits,tasks,funcs,materials]);
  const loadGen=useRef(0);   // сколько раз документ клали на экран целиком
  const restoreDoc=useCallback((d)=>{
    loadGen.current+=1;
    // Документ достраивается до нынешней записи, но НЕ переносится из
    // прежних версий: модели, собранные под старый расчёт, работать не
    // должны — см. lib/funcs.js.
    setEntities(normalizeAssets(d.entities));
    setTraits(Array.isArray(d.traits)?d.traits:[]);
    setKinds(d.kinds); setTasks(d.tasks); setFuncs(normalizeFuncs(d.funcs));
    setGoals(normalizeGoals(d.goals));
    setFactors(normalizeFactors(d.factors));
    setReports(normalizeReports(d.reports));
    setMaterials(normalizeMaterials(d.materials));
    setProcs(normalizeProcs(d.procs));
    setSel(s=>d.entities.some(e=>e.id===s)?s:(d.entities[0]?.id??null));
  },[]);
  const hist=useHistory(doc,restoreDoc);

  // ─── черновик: страховка от внезапного закрытия вкладки ───
  const [recovery,setRecovery]=useState(()=>readDraft());
  const [draftBlocked,setDraftBlocked]=useState(false);
  const savedDoc=useRef(doc);
  const docRef=useRef(doc); docRef.current=doc;
  const saveNameRef=useRef(saveName); saveNameRef.current=saveName;
  const meRef=useRef(me); meRef.current=me;
  const writeDraft=useCallback(()=>{
    /* Позванному черновик не полагается: его правда — на сервере, а
       «восстановить» подставило бы вчерашний срез поверх сегодняшнего. */
    if(!meRef.current.solo&&!meRef.current.isOwner){ clearDraft(); setDraftBlocked(false); return; }
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
  /* Запись нового актива — отдельно от нажатия «+ актив»: технологический
     процесс заводит актив тем же способом, чтобы он встал рядом с
     существующими, а не в угол. */
  const freshEntity=(name="Новый актив")=>{
    const id="en"+Date.now().toString(36)+entities.length.toString(36);
    const y=entities.length?Math.max(...entities.map(e=>e.y))+NH+40:24;
    /* Палитра серий — акценты системы по кругу: своих цветов график не
       заводит, иначе привязка «цвет → смысл» держалась бы только на словах. */
    const palette=[ACC,VIO,WARN,OK,BAD,"var(--chip-violet-text)","var(--chip-cyan-text)"];
    return {id,name,owners:[],reviewers:[],color:palette[entities.length%palette.length],x:24,y};
  };
  const addEntity=()=>{
    const e=freshEntity();
    setEntities(p=>[...p,e]);
    setSel(e.id);
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
    /* Через `editFunc`: у функции, которой срезали вход или выход, слетает
       и «принято» — рецепт стал другим, а человек его в глаза не видел. У
       тех, кого удаление не задело, пометка остаётся: чужой актив им не
       родня. */
    setFuncs(p=>p.filter(f=>f.e!==id).map(f=>editFunc(f,(x)=>({...x,
      takes:x.takes.filter(t=>!own.has(t.trait)),
      gives:x.gives.filter(g=>!own.has(g.trait))}))));
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
    setFuncs(p=>p.map(f=>editFunc(f,(x)=>({...x,
      takes:x.takes.filter(t=>t.trait!==id),
      gives:x.gives.filter(g=>g.trait!==id)}))));
  };
  /* Воркер актива — прямой выбор из всех людей схемы: сперва отмечают, кто
     здесь работает, и уже из отмеченных выбирают постановщика, исполнителя
     и проверяющего У КАЖДОЙ ФУНКЦИИ.

     Снятая отметка уносит человека со всех функций этого актива: иначе он
     остался бы назначенным, не значась в активе, и задача висела бы на
     том, кого здесь нет. Прежние списки ролей у самого актива при этом
     тоже чистятся — они больше не редактируются, но у старых моделей
     остались, и `crewOf` читает их как членство. */
  /* Процессы с пересборкой их функций — как в ProcessPanel.commit. */
  const commitProcs=(next)=>{
    setProcs(next);
    setFuncs(p=>syncProcFuncs(p,next,{entities,traits,positions:roles,people,rolesOf},normalizeFunc,procFuncs2));
  };
  /* Шапка функции из процесса — критерии и ожидаемый результат — живёт в
     ТЕКСТЕ процесса (владелец, 2026-09-19). Правка из карточки функции
     пишет туда же: иначе пересборка функций из текста её бы стёрла.
     Строка «Функция:» зашита в id цепочки — «<процесс>_<строка+1>». */
  const setFuncHeadIn=(f,patch)=>{
    const proc=procs.find(p=>p.id===f.proc);
    const row=Number(String(f.chain?.id||"").split("_").pop())-1;
    if(!proc||!(row>=0)) return;
    commitProcs(procs.map(p=>(p.id===proc.id?{...p,text:setFuncHead(p.text,row,patch)}:p)));
  };
  /* Критерии задачи из процесса — строками «Критерий:» в его тексте; правка
     из карточки задачи пишет туда же (владелец, 2026-09-19). */
  const setTaskChecksIn=(f,list)=>{
    const proc=procs.find(p=>p.id===f.proc);
    if(!proc||!(f.taskRow>=0)) return;
    commitProcs(procs.map(p=>(p.id===proc.id?{...p,text:setTaskChecks(p.text,f.taskRow,list)}:p)));
  };
  /* Должности актива: одна должность — у одного актива (владелец,
     2026-09-18). Отметка переводит должность сюда, снимая её с другого. */
  const togglePost=(rid)=>{
    setEntities(p=>{
      const has=(p.find(x=>x.id===sel)?.posts||[]).some(z=>String(z)===String(rid));
      return p.map(x=>{
        const drop=(x.posts||[]).filter(z=>String(z)!==String(rid));
        if(x.id!==sel) return drop.length===(x.posts||[]).length?x:{...x,posts:drop};
        return {...x,posts:has?drop:[...drop,rid]};
      });
    });
  };
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
  /* Порядок воркеров задаётся перетаскиванием за полоски (владелец,
     2026-09-20): человека ставят НА МЕСТО того, над кем его отпустили, —
     так же, как разделы отчётов. */
  const orderWorker=(pid,overId)=>{
    setEntities(p=>p.map(e=>{
      if(e.id!==sel) return e;
      const list=crewOf(e).map(String);
      const i=list.indexOf(String(pid));
      const j=list.indexOf(String(overId));
      if(i<0||j<0||i===j) return e;
      const next=[...list];
      next.splice(i,1);
      next.splice(j,0,String(pid));
      return {...e,crew:next};
    }));
  };
  /* Влияет ли этот порядок на выбор — тоже свойство актива: у одного актива
     порядок значит «кто берёт первым», у другого — просто список. Пишется
     явным булевым, отсутствие читается как «да» (`pickByOrderOf`). */
  const setPickByOrder=(on)=>{
    setEntities(p=>p.map(e=>(e.id===sel?{...e,pickByOrder:!!on}:e)));
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
    materials:w?.materials||[],
    procs:w?.procs||[],
  }),[]);
  /* Разобрались ли, что открывать. До этого момента на экране может стоять
     встроенная демонстрационная модель, и выгружать её на сервер нельзя. */
  const [ready,setReady]=useState(false);
  /* Первое собственное изменение — ответ на «Восстановить?»: человек начал
     работать с тем, что на экране, и старый черновик ему не нужен.
     Сравниваем не с сохранённым, а с тем, что легло на экран при последней
     ЗАГРУЗКЕ (`loadGen` растёт в `restoreDoc`): загрузка достраивает
     документ, и против сырой записи он выглядел бы «изменённым». */
  const baseline=useRef({gen:0,doc:null});
  useEffect(()=>{
    if(baseline.current.gen!==loadGen.current||!baseline.current.doc){
      baseline.current={gen:loadGen.current,doc}; return;
    }
    if(recovery&&ready&&!sameDoc(doc,baseline.current.doc)){ clearDraft(); setRecovery(null); }
  },[doc,recovery,ready]);   // eslint-disable-line react-hooks/exhaustive-deps

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
  /* Два вида напоминаний. `task` — исполнителю: «пора начинать»; ждущая
     постановки сюда не идёт, начинать в ней пока нечего. `setup` —
     ПОСТАНОВЩИКУ: «нужно поставить задачу», и ждать нечего — она уже висит.
     Оба повторяются раз в минуту, пока человек не ответит кнопкой. */
  const scheduled=useMemo(()=>{
    const mine=(v)=>v!=null&&v!==""&&String(v)===String(me.id);
    const work=tasks
      .filter(t=>mine(t.assignee)&&t.status!=="wait"&&t.canceled!==true)
      .map(t=>({...t,kind:"task",start:t.start||null,repeat:"once",end:null,warn}));
    const setup=tasks
      .filter(t=>mine(roleOf(t,"setter"))&&t.status==="wait"&&t.canceled!==true)
      .map(t=>({...t,kind:"setup",start:null,repeat:"once",end:t.end||"",warn}));
    return [...work,...setup];
  },[tasks,warn,me.id]);
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

  /* Срез позванного применяется одинаково при входе и при каждом
     переспросе: реестр опубликованного, документ, люди. Ключ — сам ответ:
     тот же ответ ничего не перерисовывает. `savedDoc` — тоже он: правда
     позванного лежит на сервере, и черновик «несохранённых правок» ему не
     полагается (см. writeDraft). */
  const lastWs=useRef("");
  const applyWorkspace=useCallback((w)=>{
    if(!w||typeof w!=="object") return;
    const key=JSON.stringify(w);
    if(key===lastWs.current) return;
    lastWs.current=key;
    setPublished(Array.isArray(w.published)?w.published:[]);
    const loaded=fromWorkspace(w);
    restoreDoc(loaded);
    savedDoc.current=loaded;
    /* Список людей организации — владельцу; позванному сервер кладёт в
       срез имена тех, с кем он работает: воркеров его активов и
       участников его задач. Без них постановщику было бы не из кого
       выбирать исполнителя, а «поставил: 100» читалось бы номером. */
    if(Array.isArray(w.people)) setPeople(w.people);
  },[restoreDoc,fromWorkspace]);
  const pulled=useRef(false);
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
      applyWorkspace(w);
    }).catch(()=>{});
  },[me.solo,me.isOwner,applyWorkspace]);
  /* Обновление без перезагрузки — позванному. Модель приезжала один раз:
     задачу, поставленную после открытия, человек видел, лишь открыв
     приложение заново. Теперь срез переспрашивается раз в полминуты, пока
     вкладка на виду, сразу — когда она снова на виду, и после каждого
     своего действия (взял, сдал, поставил, оценил): ответ сервера и есть
     правда, и если он отказал, доска должна показать его, а не своё.
     Владелец не переспрашивает: его модель живёт в его окне и уезжает на
     сервер сама, и класть серверную поверх его правок нельзя. Событий от
     сервера нет — опрос проще и переживает обрывы сети в WebView. */
  const pullNow=useCallback(()=>{
    if(me.solo||me.isOwner||!me.known) return;
    if(typeof document!=="undefined"&&document.visibilityState==="hidden") return;
    getWorkspace().then(applyWorkspace).catch(()=>{});
  },[me.solo,me.isOwner,me.known,applyWorkspace]);
  useEffect(()=>{
    if(me.solo||me.isOwner||!me.known) return undefined;
    const id=setInterval(pullNow,POLL_MS);
    const onShow=()=>{ if(document.visibilityState==="visible") pullNow(); };
    document.addEventListener("visibilitychange",onShow);
    return ()=>{ clearInterval(id); document.removeEventListener("visibilitychange",onShow); };
  },[me.solo,me.isOwner,me.known,pullNow]);
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
    /* Классификацию СНИМАЕМ, а не подменяем другой: у ресурса их может быть
       несколько, и переводить его в первую попавшуюся значило бы решить за
       человека, чем теперь считать эту вещь. Остался без единой — так и
       будет: «не сказано» честнее выдуманного. */
    const used=countKind(traits,id);
    if(used) setTraits(p=>dropKind(p,id));
    setKinds(rest);
    return used
      ?`Удалено. У ${used} ресурс(ов) эта классификация снята.`
      :"Удалено.";
  };

  // ─── сценарии на диске ───
  const refreshSavedList=async()=>{
    try{ setSavedList(await listScenarios()); }
    catch{ setSavedMsg("Не удалось получить список сохранённых сценариев."); }
  };
  useEffect(()=>{ if(tab!=="tools"||tool!=="export") return;
    refreshSavedList();
    detectStorage().then(k=>{ setSavedKind(k); setSavedWhere(STORAGE_LABEL[k]||""); }).catch(()=>{});
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
  /* Значок «сохранить» в шапке: сохраняет туда же, куда и кнопка во
     вкладке «Инструменты». Имени у сценария ещё нет — там его и называют,
     поэтому значок открывает то место, а не выдумывает имя за человека. */
  const saveNow=()=>{
    if(!saveName.trim()){ setTab("tools"); setTool("export"); return; }
    saveToDisk();
  };
  const openScenario=useCallback(async(id,{guard}={})=>{
    const s=await getScenario(id);
    if(!s) throw new Error("Сценарий не найден.");
    // Пока схема ехала с диска, человек мог применить черновик — тогда
    // подставлять её поверх нельзя: он потеряет свои правки.
    if(guard&&!guard()) return null;
    const loaded=docFrom(s.data,docRef.current);
    restoreDoc(loaded);
    savedDoc.current=loaded;
    /* Автозагрузка при старте (с `guard`) плашку «Восстановить» не гасит:
       владелец (2026-09-14) видел её пару секунд — до того, как доезжала
       схема с диска, — и решить не успевал. Плашка живёт до первого
       собственного изменения или до ответа на неё; черновик тоже. */
    if(!guard){ clearDraft(); setRecovery(null); }
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
  /* Роли человека — ИДЕНТИФИКАТОРАМИ: по ним сверяются роли функции
     (`byPost`, `eligible`) и собираются поручения. Их несколько: он и
     дизайнер, и проверяющий. */
  const rolesOf=useCallback((id)=>{
    const u=people.find(p=>String(p.id)===String(id));
    return (u?.roles||[]).map(String);
  },[people]);
  /* А это — ИМЯ роли, для строки человека: в ней стоят слова, а не коды.
     Не названа — пусто, и рядом об этом сказано словом. */
  const roleName=useCallback((id)=>roles.find(r=>r.id===String(id))?.name||"",[roles]);
  /* Отказ от поручения в своей анкете. У владельца модель под рукой —
     он пишет её сам, тем же исключением, что стоит в карточке воркера;
     позванный отправляет отказ на сервер (ProfilePanel сделает это сам,
     если обработчика нет). */
  const refuseFuncHere=useCallback((funcId,off)=>{
    setFuncs(list=>list.map(f=>{
      if(f.id!==funcId) return f;
      const was=exceptOf(f).map(String);
      const mineId=String(me.id);
      const next=off?[...new Set([...was,mineId])]:was.filter(x=>x!==mineId);
      return editFunc(f,x=>({...x,except:next}));
    }));
  },[setFuncs,me.id]);
  const personName=useCallback((id)=>{
    if(id==null||id==="") return "не назначен";
    return people.find(p=>String(p.id)===String(id))?.name||String(id);
  },[people]);
  /* Решение проверяющего — не только статус: оценка и слова уходят в
     историю исполнителя, из которой потом растёт его рейтинг. Пишем их
     отдельным списком `reviews`, а не в комментарии: комментарий может
     оставить кто угодно и когда угодно, а решение — это ровно приём или
     возврат, с оценкой и автором. */
  /* Решение проверяющего — приём или возврат. Оценка человеку к нему
     больше не привязана: она своя, кнопкой «Поставить оценку» (владелец,
     2026-09-20). */
  const decide=useCallback((task,accept,note)=>{
    const at=new Date().toISOString();
    const review={id:"rv"+Date.now().toString(36),at,by:me.id??null,
      accept:!!accept,mark:null,comment:String(note||""),hidden:false};
    setTasks(p=>p.map(t=>t.id===task.id?{...t,
      status:accept?"done":"backlog",
      // Возвращённая задача снова лежит и ждёт: её берут в работу заново,
      // иначе она вернулась бы уже взятой и «Взять в работу» не появилось.
      taken:accept?t.taken:false,
      reviews:[...(t.reviews||[]),review],
      // Те же слова — и в обсуждение задачи: возврат читают как «что
      // доработать», а не ищут в решениях.
      chat:note?[...(t.chat||[]),
        {id:"m"+Date.now().toString(36),text:note,at,by:me.id??null}]
        :(t.chat||[]),
    }:t));
    reviewTaskRemote(task.id,{accept,comment:note}).then(pullNow,()=>{});
  },[setTasks,me.id,pullNow]);
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
  useEffect(()=>{ setTasks(p=>autoFlow(p,{funcs,traits:traitsLive,factors})); },[tasks,funcs,traitsLive,factors,tick]);


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
  /* Функции глазами расчёта: без гипотетических процессов, пока галочка
     «включить гипотезы» не стоит (`activeFuncs`). Модели ниже несут
     `procs` и `hypoOn` — по ним расчёт (`liveModel`) сам отсеивает. */
  const liveFuncs=useMemo(()=>activeFuncs({funcs,procs,hypoOn}),[funcs,procs,hypoOn]);
  const runsPlan=useMemo(()=>goalRuns({traits:traitsLive,funcs,procs,hypoOn},goals,{runsOf}),
    [traitsLive,funcs,procs,hypoOn,goals,runsOf]);
  /* Очередь действий по применённым целям — та же, что человек видел в
     форме цели, только собранная со всех целей сразу. */
  const appliedSteps=useMemo(()=>{
    const by=new Map();
    goals.filter(g=>g.appliedAt).forEach(g=>{
      actionsOf(planGoal({traits:traitsLive,funcs,procs,hypoOn},g,{runsOf})).forEach(st=>{
        const was=by.get(st.func);
        by.set(st.func,was
          ?{...was,runs:was.runs+st.runs,startHours:Math.min(was.startHours,st.startHours)}
          :st);
      });
    });
    return [...by.values()].sort((a,b)=>a.startHours-b.startHours||b.runs-a.runs);
  },[traitsLive,funcs,procs,hypoOn,goals,runsOf]);
  const fc=useMemo(()=>forecast({traits:traitsLive,funcs,factors,procs,hypoOn},
    {span,runsOf,plan:runsPlan}),
    [traitsLive,funcs,factors,procs,hypoOn,span,runsOf,runsPlan]);
  const moves=useMemo(()=>transfers({funcs,traits:traitsLive,procs,hypoOn},{runsOf,plan:runsPlan}),
    [funcs,traitsLive,procs,hypoOn,runsOf,runsPlan]);
  const workload=useMemo(()=>load({funcs,procs,hypoOn},{runsOf,plan:runsPlan}),
    [funcs,procs,hypoOn,runsOf,runsPlan]);
  // Есть ли что включать: без гипотетических процессов галочка — мебель.
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
  /* Нажали на сущность в шаге процесса — открываем её так же, как если бы
     выбрали актив на схеме и нужную вкладку в карточке: актив — карточку,
     ресурс — вкладку «Ресурсы» с этим ресурсом, должность — «Воркеров»
     актива шага. Карточка стоит под формой процессов, на «Управлении». */
  const openTraitCard=useCallback((tid)=>{
    const t=traits.find(x=>x.id===tid); if(!t) return;
    setSel(t.e);
    setFocus({kind:"trait",id:tid,n:Date.now()});
  },[traits]);
  const openWorkersCard=useCallback((eid)=>{
    setSel(eid);
    setFocus({kind:"workers",id:eid,n:Date.now()});
  },[]);

  const assetOk=useCallback((id)=>checkAsset(id,{funcs,traits,entities}).ok,
    [funcs,traits,entities]);

  /* Ряд вкладок, какой человек видит: свайп ходит по нему же, а не по
     всему списку — иначе он приводил бы туда, куда не пускают. */
  const tabsShown=useMemo(()=>TAB_LIST.filter(([k])=>k===SELF_TAB[0]||k===MARKET_TAB[0]
    ||me.isOwner||me.solo||me.tabs.includes(k)),[me.isOwner,me.solo,me.tabs]);
  /* ═══ БАРАБАН ВКЛАДОК ═══

     Ряд не прокручивается браузером: положение — одно число `offset`
     (сколько пикселей ряда левее середины окна), и ведём его мы сами,
     кадр за кадром. Так сделано не ради красоты, а потому что нативная
     прокрутка плодила ровно те три беды, на которые жаловался владелец
     (2026-09-21): вид считался по событию `scroll`, а события приходят
     реже кадров — отсюда и «многоугольник», и рывок вправо в конце
     анимации, когда ряд уже стоял, а вид досчитывался.

     Счёт — в lib/drum.js. Здесь руки: померить, покрасить, довезти.

     АКТИВНА ТА, ЧТО ПОСЕРЕДИНЕ. Нажатие барабан не двигает и вкладку не
     меняет вовсе: вкладку выбирают, докрутив её до середины, — как на
     счётчике. */
  const drumWin=useRef(null);
  const drumRow=useRef(null);
  const tabEls=useRef(new Map());
  const geom=useRef({cs:[],win:NOMINAL_WIN,letters:[]});
  const motion=useRef({at:0,v:0}); // где барабан и с какой скоростью
  const aim=useRef(0);              // куда он едет
  const frame=useRef(0);            // кадр хода
  const placed=useRef(false);       // первый раз ставим без хода
  const grab=useRef(null);          // палец на барабане

  /* Разметка: ширины вкладок и окна и место каждой буквы внутри своей
     вкладки. Без разметки (тест) — сговорённые числа. */
  const measure=useCallback(()=>{
    const ws=tabsShown.map(([k])=>{
      const el=tabEls.current.get(k);
      return (el&&el.offsetWidth)||NOMINAL_W;
    });
    const letters=tabsShown.map(([k])=>{
      const el=tabEls.current.get(k);
      if(!el) return [];
      const mid=(el.clientWidth||NOMINAL_W)/2;
      return [...el.querySelectorAll("[data-letter]")].map((sp)=>
        ({el:sp,u:(sp.offsetLeft||0)+(sp.offsetWidth||0)/2-mid}));
    });
    geom.current={cs:centers(ws),
      win:(drumWin.current&&drumWin.current.clientWidth)||NOMINAL_WIN,letters};
    return geom.current;
  },[tabsShown]);

  /* Положить всем вкладкам и буквам их вид. Стилем, а не состоянием:
     кадров много, и setState на каждом дёргал бы всё дерево вкладки.
     Счёт — в lib/drum.js: вкладка встаёт на дугу целиком, а каждая
     буква — на свою точку дуги относительно вкладки; так изгиб виден
     внутри слова. */
  const paint=useCallback(()=>{
    const {cs,win,letters}=geom.current;
    const half=(win||NOMINAL_WIN)/2;
    const R=radiusOf(half);
    const {at,v}=motion.current;
    const pos=drumShown(at,v);
    if(drumRow.current) drumRow.current.style.transform=`translateX(${(half-pos).toFixed(2)}px)`;
    tabsShown.forEach(([k],i)=>{
      const el=tabEls.current.get(k);
      if(!el||cs[i]==null) return;
      const x=cs[i]-pos;
      const b=bend(x,R);
      const g=lensAt(x/half);
      el.style.transform=`translate3d(${b.dx.toFixed(2)}px,0,${b.dz.toFixed(2)}px)`
        +` rotateY(${degOf(b.th)}deg) scale(${g.toFixed(3)})`;
      for(const L of letters[i]||[]){
        const lb=bend(L.u,R);
        L.el.style.transform=`translate3d(${lb.dx.toFixed(2)}px,0,${lb.dz.toFixed(2)}px)`
          +` rotateY(${degOf(lb.th)}deg)`;
        L.el.style.opacity=dimAt(b.th+lb.th).toFixed(3);
      }
    });
  },[tabsShown]);

  /* Ход — кадрами, пока не доехал: тяжёлый, с задержкой и зубьями
     (lib/drum.js). Без кадров (тест) — сразу на цель. */
  const run=useCallback(()=>{
    motion.current=drumStep(motion.current,aim.current);
    if(drumSettled(motion.current,aim.current)){
      motion.current={at:aim.current,v:0};
      frame.current=0;
      paint();
      return;
    }
    paint();
    frame.current=requestAnimationFrame(run);
  },[paint]);
  const kick=useCallback(()=>{
    if(typeof requestAnimationFrame!=="function"){
      motion.current={at:aim.current,v:0}; paint(); return;
    }
    if(!frame.current) frame.current=requestAnimationFrame(run);
  },[paint,run]);
  useEffect(()=>()=>{
    if(frame.current&&typeof cancelAnimationFrame==="function") cancelAnimationFrame(frame.current);
  },[]);

  /* Открытая вкладка всегда посередине: свайп по странице меняет вкладку,
     и барабан доезжает следом (владелец, 2026-09-19: «смена вкладки должна
     происходить с анимацией передвижения вкладки»). Первый раз — без
     хода: при открытии приложения барабану неоткуда ехать. */
  useEffect(()=>{
    const {cs}=measure();
    const i=tabsShown.findIndex(([k])=>k===tab);
    if(i<0||cs[i]==null){ paint(); return; }
    aim.current=hold(cs,cs[i]);
    if(!placed.current){ motion.current={at:aim.current,v:0}; placed.current=true; paint(); return; }
    kick();
  },[tab,tabsShown,measure,paint,kick]);
  useEffect(()=>{
    if(typeof window==="undefined") return undefined;
    const again=()=>{ const {cs}=measure();
      const i=tabsShown.findIndex(([k])=>k===tab);
      if(cs[i]!=null){ aim.current=cs[i]; motion.current={at:cs[i],v:0}; }
      paint(); };
    window.addEventListener("resize",again);
    return ()=>window.removeEventListener("resize",again);
  },[tab,tabsShown,measure,paint]);

  /* Палец на барабане: цель идёт за пальцем, барабан — за целью, с
     тяжестью. Отпустили — ближайшая к цели вкладка становится открытой.
     Нажатие без движения не делает НИЧЕГО: барабан на нажатие не
     отзывается (владелец, 2026-09-21). */
  const drumDown=(e)=>{
    if(e.button!=null&&e.button!==0) return;
    measure();
    grab.current={x:e.clientX,from:aim.current};
    if(e.currentTarget.setPointerCapture&&e.pointerId!=null){
      try{ e.currentTarget.setPointerCapture(e.pointerId); }catch{ /* не умеет — не беда */ }
    }
  };
  const drumMove=(e)=>{
    const g=grab.current;
    if(!g) return;
    aim.current=hold(geom.current.cs,g.from-(e.clientX-g.x));
    kick();
  };
  const drumUp=()=>{
    if(!grab.current) return;
    grab.current=null;
    const {cs}=geom.current;
    const i=nearest(cs,aim.current);
    if(i<0) return;
    /* Вкладка меняется В МОМЕНТ ОТПУСКАНИЯ, а не когда доедет: доезд —
       это уже показ выбранного, и ждать его нечего. */
    const next=tabsShown[i]&&tabsShown[i][0];
    if(next&&next!==tab) goTab(next); else { aim.current=cs[i]; kick(); }
  };
  /* Страница вкладки въезжает с той стороны, откуда пришли: без этого
     смена вкладки — мгновенная подмена, и непонятно, вперёд ты ушёл или
     назад. Сдвиг ставится без перехода, а возврат к нулю — с ним. */
  const [slide,setSlide]=useState(0);
  const goTab=(next)=>{
    if(next===tab) return;
    recordAction(`открыта вкладка «${(TAB_LIST.find(([k])=>k===next)||[])[1]||next}»`);
    const keys=tabsShown.map(([k])=>k);
    const dir=keys.indexOf(next)>keys.indexOf(tab)?1:-1;
    setTab(next);
    setSlide(dir*26);
    const back=()=>setSlide(0);
    if(typeof requestAnimationFrame==="function") requestAnimationFrame(()=>requestAnimationFrame(back));
    else back();
  };
  /* Свайп через весь экран меняет вкладку (владелец, 2026-09-19;
     `lib/swipe.js`). Одним пальцем: два — это щипок на карте. */
  const swipe=useRef(null);
  const onTouchStart=(e)=>{
    const t=e.touches.length===1?e.touches[0]:null;
    swipe.current=t&&swipeFrom(e.target)?{x:t.clientX,y:t.clientY}:null;
  };
  const onTouchMove=(e)=>{ if(e.touches.length>1) swipe.current=null; };
  const onTouchEnd=(e)=>{
    const from=swipe.current;
    swipe.current=null;
    const t=e.changedTouches&&e.changedTouches[0];
    if(!from||!t) return;
    const step=swipeStep({dx:t.clientX-from.x,dy:t.clientY-from.y,
      width:typeof window==="undefined"?0:window.innerWidth});
    if(!step) return;
    goTab(tabAfter(tabsShown.map(([k])=>k),tab,step));
  };

  /* ═══ РЕГИСТРАЦИЯ — СВОЙ ЭКРАН ═══

     Договор роли не часть вкладки. Панель стояла ВЫШЕ содержимого вкладок
     и потому показывалась на той, что открыта, — «почему-то он
     отображается на вкладке «Рынок услуг»» (владелец, 2026-09-20). Теперь
     она занимает экран целиком, и у неё есть «Назад»: тому, у кого доступ
     уже есть, — обратно в приложение, а вернуться он может кнопкой в
     шапке. Кому идти некуда (незваный, позванный без ролей, ждущий
     владельца), тому и «Назад» показывать незачем. */
  /* Ссылка на чужую страницу — раньше всего остального: пока человек не
     решил, вступает он или нет, показывать ему приложение не из чего. */
  if(joinKey&&!me.solo) return (
    <div style={{background:C.ink,color:C.text,minHeight:"100%",
      fontFamily:"var(--font-sans)"}}>
      <JoinPanel me={me} token={joinKey}
        onJoined={m=>{ setJoinKey(null); resetIdentity();
          if(m) setMe(m); else whoAmI().then(setMe).catch(()=>{}); }}
        onSkip={()=>setJoinKey(null)}/>
    </div>);

  const needReg=!me.solo&&(!me.known||!!me.pending||!!me.agreement||!!me.waiting);
  const canSkip=!!me.isOwner||(me.tabs||[]).length>0;
  const onRegDone=m=>{ if(m) setMe(m); else whoAmI().then(setMe).catch(()=>{}); };
  if(needReg&&!(regAway&&canSkip)) return (
    <div style={{background:C.ink,color:C.text,minHeight:"100%",padding: "var(--space-12)",
      fontFamily:"var(--font-sans)"}}>
      <div className="flex items-center gap-2"
        style={{...TAB_LINE,marginBottom: "var(--space-16)"}}>
        <div style={{flex:"0 0 auto"}}><Brand size={22}/></div>
      </div>
      <RegisterPanel me={me} onDone={onRegDone}
        onBack={canSkip?()=>setRegAway(true):undefined}/>
    </div>);

  return (
    <div style={{color:C.text,minHeight:"100%",padding: "var(--space-16)",
      fontFamily:"var(--font-sans)",
      /* Свайп вбок принадлежит вкладкам, а не истории браузера: иначе
         движение от края уносило бы со страницы назад. */
      overscrollBehaviorX:"contain"}}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {/* Шапка — одной строкой (владелец, 2026-09-19): знак слева, вкладки
          сразу за ним, значки — у правого края. Полоса под рядом и есть то,
          что делает вкладки вкладками: открытая её разрывает. */}
      <div className="flex items-center gap-2" style={TAB_LINE}>
        <div style={{flex:"0 0 auto"}}><Brand size={22}/></div>
        {/* «Анкета» — всем: это единственное место, где человек говорит о
            себе. «Отчёты» — владельцу: карту пишет он, а остальным сервер
            её и не отдаёт — рисовать пустую карту с кнопками, которые
            ничего не сохранят, значило бы обещать работу, которой не
            будет. Наружу отчёт уходит ссылкой.

            ЖЁЛОБ ВКЛАДОК — ТЕМНЕЕ БАРА (владелец, 2026-09-21): знак с
            именем лежат на стекле, вкладки — в углублении под ним. Разница
            в тоне и показывает, что вкладки едут, а знак стоит.

            `data-noswipe` — чтобы прокрутка вкладок НЕ меняла вкладку:
            свайп по странице листает разделы, и без этой метки движение
            пальца по самому ряду читалось бы как переход (владелец,
            2026-09-21). */}
        <div className="flex items-center" data-noswipe=""
          style={{flex:1,minWidth:0,gap:"var(--space-4)",
            background:"rgba(5,7,12,.55)",border:"1px solid var(--border-glass-soft)",
            borderRadius:"var(--radius-pill)",padding:"var(--space-4)"}}>
          {/* ОКНО БАРАБАНА. Ряд внутри двигаем мы сами (см. выше), поэтому
              здесь `overflow:hidden`, а не прокрутка: браузеру тут делать
              нечего. Маска по краям гасит вкладку, ушедшую за обод, —
              обрезать её ровной линией нельзя, барабан круглый.

              `touchAction:"pan-y"` — вбок палец крутит барабан, вдоль
              страницы прокрутка остаётся браузеру. */}
          <div ref={drumWin} data-drum="" onPointerDown={drumDown}
            onPointerMove={drumMove} onPointerUp={drumUp} onPointerCancel={drumUp}
            style={{flex:1,minWidth:0,position:"relative",overflow:"hidden",
              height:DRUM_H,touchAction:"pan-y",cursor:"grab",
              /* Одна перспектива на всё окно: буквы одной вкладки и
                 соседних лежат в одном пространстве, и цилиндр — один. */
              perspective:`${EYE}px`,perspectiveOrigin:"50% 50%",
              maskImage:TABS_MASK,WebkitMaskImage:TABS_MASK}}>
            <div ref={drumRow} className="flex items-center"
              style={{position:"absolute",left:0,top:0,height:"100%",
                gap:`${GAP}px`,willChange:"transform",transformStyle:"preserve-3d"}}>
              {tabsShown.map(([k,t])=>(
                <button key={k} data-tab={k} type="button" tabIndex={-1}
                  aria-current={tab===k?"page":undefined} aria-label={t}
                  ref={(el)=>{ if(el) tabEls.current.set(k,el); else tabEls.current.delete(k); }}
                  /* Ушедшая за обод вкладка показывает нам спину — и спина
                     скрыта самим браузером (backface), а не нами: так она
                     остаётся в дереве доступности и её видно тестам. */
                  /* Капсулы у открытой вкладки больше нет (владелец,
                     2026-09-21): рамка стоит на месте, в середине окна, а
                     открытой становится та, что в неё попала. Она лишь
                     ярче остальных — цветом текста. */
                  style={{...tabStyle(false),color:tab===k?C.text:C.muted,
                    flex:"0 0 auto",position:"relative",
                    transformOrigin:"50% 50%",transformStyle:"preserve-3d",
                    backfaceVisibility:"hidden",WebkitBackfaceVisibility:"hidden"}}>
                  {/* Буква за буквой: каждая встаёт на свою точку дуги —
                      так и виден изгиб внутри слова. Пробел — тоже буква,
                      иначе слово из двух половин сомкнётся. */}
                  {[...t].map((ch,j)=>(
                    <span key={j} data-letter="" style={{display:"inline-block",
                      whiteSpace:"pre",transformOrigin:"50% 50%",
                      backfaceVisibility:"hidden",WebkitBackfaceVisibility:"hidden"}}>{ch}</span>))}
                </button>))}
            </div>
            {/* РАМКА-ЛИНЗА — НЕПОДВИЖНА (владелец, 2026-09-21): «зелёная
                рамка не появляется на той вкладке, которая становится
                активной, а всегда посередине; активной становится та, что
                в неё попала; рамка — часть увеличительного стекла; на
                движение не влияет». Ширина — те же 60 % окна, что держит
                линза; блик сверху — стекло. Нажатий не ловит и в
                разметку ряда не входит: движение считается без неё. */}
            <div aria-hidden="true" data-lens=""
              style={{position:"absolute",left:"20%",right:"20%",top:"50%",
                height:"calc(var(--control-h) + 4px)",transform:"translateY(-50%)",
                borderRadius:"var(--radius-pill)",pointerEvents:"none",zIndex:2,
                border:`1px solid ${tintOf(OK).line}`,
                boxShadow:`${tintOf(OK).glow}, inset 0 1px 0 rgba(255,255,255,.35), inset 0 -10px 16px rgba(255,255,255,.04)`,
                background:"linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,0) 55%)"}}/>
          </div>
          {/* Стрелки справа больше нет (владелец, 2026-09-21): барабан
              говорит сам — вкладка у обода завёрнута и гаснет, значит ряд
              продолжается. Освободившееся место барабан забрал себе. */}
        </div>
      </div>

      {/* Значки — ПОД линией шапки, у правого края (владелец, 2026-09-19). */}
      <div className="flex items-center gap-2"
        style={{justifyContent:"flex-end",marginTop: "var(--space-12)",
          marginBottom: "var(--space-16)"}}>
        {/* Работаем под чужой страницей — путь назад стоит первым, перед
            «Отменить» и «Вернуть» (владелец, 2026-09-20): человек должен
            видеть, что он не у себя, и уйти одним нажатием. */}
        {!!me.actingAs&&(
          <button type="button" style={{...btn(true,WARN),marginRight: "var(--space-4)" }}
            onClick={()=>{ setActingAs(""); resetIdentity();
              whoAmI().then(m=>{ setMe(m); setTab("me"); }).catch(()=>{}); }}>
            Вернуться на свою страницу</button>)}
        {/* Сообщить об ошибке — слева от «Отменить» (владелец, 2026-09-21):
            ошибку замечают посреди работы, и значок должен быть там же,
            где рука уже находится. */}
        <IconButton label="сообщить об ошибке" title="Сообщить об ошибке"
          onClick={()=>setIssueOpen(true)} icon={ICON.alert}/>
        {/* Волшебная палочка — между «!» и «Отменить» (владелец,
            2026-09-21): вопрос ассистенту о том, что сейчас на экране. */}
        <IconButton label="вопрос ассистенту" title="Вопрос ассистенту"
          disabled={wand==="taking"} onClick={openWand} icon={ICON.wand}/>
        <IconButton label="отменить" title="Отменить последнее изменение модели (Ctrl+Z)"
          disabled={!hist.canUndo} onClick={hist.undo} icon={ICON.undo}/>
        <IconButton label="вернуть" title="Вернуть отменённое (Ctrl+Shift+Z)"
          disabled={!hist.canRedo} onClick={hist.redo} icon={ICON.redo}/>
        {(me.solo||me.isOwner)&&(
          <IconButton label="сохранить" title={saveName.trim()
            ? `Сохранить сценарий «${saveName.trim()}»` : "Назвать сценарий и сохранить"}
            disabled={savedBusy} onClick={saveNow} icon={ICON.save}/>)}
      </div>

      {/* Ушли из регистрации «Назад» — путь обратно остаётся на виду. */}
      {needReg&&(
        <div className="flex" style={{marginBottom: "var(--space-8)"}}>
          <button style={btn(true,ACC)} aria-label="вернуться к регистрации"
            onClick={()=>setRegAway(false)}>
            {me.agreement?"Подписать договор":"Регистрация"}</button>
        </div>)}

      {/* Страница вкладки: въезжает с той стороны, откуда пришли. В покое
          transform снят вовсе, а не «translateX(0)»: любой transform на
          обёртке делает её опорой для position:fixed потомков, и плавающие
          меню с окнами вставали относительно страницы, а не экрана —
          «в самом верху, а не там, где нажал» (владелец, 2026-09-20). */}
      <div style={{transform:slide?`translateX(${slide}px)`:"none",opacity:slide?0.4:1,
        transition:slide?"none":"transform .22s ease-out, opacity .22s ease-out"}}>
      {recovery && (me.solo||me.isOwner) && (
        <div style={{...S.card,marginBottom: "var(--space-8)",borderColor:ACC}}>
          <div style={{fontSize:"var(--fs-body)",lineHeight:1.6,marginBottom: "var(--space-8)"}}>
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
        <div style={{fontSize:"var(--fs-hint)",color:WARN,marginBottom: "var(--space-8)",lineHeight:1.6}}>
          Браузер не даёт сохранить черновик — правки не переживут закрытия
          вкладки. Сохраняй сценарий на диск во вкладке «Инструменты».
        </div>)}


      {me.known && !me.pending && !me.agreement && !me.waiting && !me.tabs.length && (
        <div style={{...S.card,marginBottom: "var(--space-8)",fontSize:"var(--fs-hint)",color:C.muted,
          lineHeight:1.6}}>
          {(me.inactive||[]).length
            ? <>Ваши роли не действуют: {me.inactive.map(r=>`«${r.name}» — ${r.why}`).join("; ")}.
                Интерфейс роли откроется, когда владелец выдаст новый договор и вы его подпишете.</>
            : <>Ваши роли ничего не открывают — возможно, их удалили. Подпишите
                договор другой роли или попросите владельца назначить роль заново.</>}
        </div>)}

      {/* ═══ РЫНОК УСЛУГ · заказы и услуги всех зарегистрированных ═══
          Из настроек функции сюда приводят «Сделать заказ» и «Сделать
          услугой» — с формой, заполненной словами функции. */}
      {tab==="market" && (
        <MarketPanel me={me} traits={traitsLive} draft={marketDraft}
          onDraftDone={()=>setMarketDraft(null)}/>)}

      {/* ═══ АНКЕТА · страница человека ═══
          Своя — по умолчанию; чужая открывается нажатием на человека в
          списке воркеров. Вкладкой, а не окном: страница длинная, и в
          окне её пришлось бы листать поверх того, что под ним. */}
      {tab==="me" && (
        <ProfilePanel me={me} personId={person} people={people}
          tasks={tasks} funcs={funcs} published={published} ratings={ratings}
          entities={entities} rolesOf={rolesOf}
          onRefuseFunc={me.isOwner?refuseFuncHere:undefined}
          traitName={id=>traits.find(t=>t.id===id)?.l||"ресурс удалён"}
          onSaved={p=>{
            /* Имя едет вместе с анкетой: назвал себя человек сам — так он
               зовётся везде, где приложение его показывает (владелец,
               2026-09-20). */
            setMe(m=>({...m,profile:p,...(p?.name?{name:p.name}:{})}));
            setPeople(list=>list.map(u=>(String(u.id)===String(me.id)?{...u,...p}:u)));
          }}/>)}

      {/* ═══ ОТЧЁТЫ · карта проектов ═══
          Открыта всем вошедшим, как и анкета: отчёт — это то, что человек
          показывает о своей работе, а ссылку на блок карты дают кому
          угодно. Прятать её за ролью значило бы, что показать сделанное
          можно только с чужого разрешения. */}
      {tab==="reports" && (me.isOwner||me.solo) && (
        <ReportsPanel nodes={reports} setNodes={setReports}
          model={{traits:traitsLive,funcs,tasks,factors,materials,procs,hypoOn}} entities={entities}
          nameOf={personName} materials={materials} setMaterials={setMaterials} meId={me.id}
          runsOf={runsOf}
          focus={reportFocus} onFocus={setReportFocus}/>)}

      {/* ═══ ЗАДАЧИ ═══ */}
      {tab==="tasks" && me.tabs.includes("tasks") && (
        <TasksBoard funcs={funcs} entities={entities} traits={traitsLive} materials={materials}
          factors={factors}
          tasks={myTasks} setTasks={setTasks}
          openId={openTask} setOpenId={setOpenTask}
          people={people} canAssign={me.isOwner} nameOf={personName}
          onTake={t=>{ takeTaskRemote(t.id).then(pullNow,()=>{}); }}
          onDrop={t=>{ dropTaskRemote(t.id).then(pullNow,()=>{}); }}
          meId={me.id}
          /* У владельца сдача и комментарий уезжают в составе модели через
             putWorkspace; POST'ить их ещё раз значило бы записать дважды. */
          onSay={(t,text,role)=>{ if(!me.isOwner) messageTaskRemote(t.id,text,role).then(pullNow,()=>{}); }}
          onSeen={(t,role)=>{ if(!me.isOwner) seeChatRemote(t.id,role).then(()=>{},()=>{}); }}
          onRate={(t,m)=>{ if(!me.isOwner) markTaskRemote(t.id,m).then(pullNow,()=>{}); }}
          onSubmit={(t,sb)=>{ if(!me.isOwner) submitTaskRemote(t.id,sb).then(pullNow,()=>{}); }}
          /* «r» на вкладке — только смотреть: кнопок работы нет вовсе
             (владелец, 2026-09-20). */
          ro={!mayEdit(me,"tasks")}/>)}

      {/* ═══ ПРОВЕРКА ═══ */}
      {tab==="review" && me.tabs.includes("review") && (
        <ReviewBoard tasks={tasks} traits={traitsLive} entities={entities} funcs={funcs}
          factors={factors} materials={materials} ratings={ratings}
          meId={me.id} isOwner={me.isOwner} nameOf={personName}
          setTasks={setTasks} people={people} canAssign={me.isOwner}
          published={published}
          onSay={(t,text,role)=>{ if(!me.isOwner) messageTaskRemote(t.id,text,role).then(pullNow,()=>{}); }}
          onSeen={(t,role)=>{ if(!me.isOwner) seeChatRemote(t.id,role).then(()=>{},()=>{}); }}
          onRate={(t,m)=>{ if(!me.isOwner) markTaskRemote(t.id,m).then(pullNow,()=>{}); }}
          /* Постановка у владельца уезжает в составе модели через
             putWorkspace; у позванного постановщика модель не пишется —
             каждая правка формы и «Поставить» идут своей операцией, и
             форма ждёт ответа сервера, а не меняет статус у себя. */
          onSetup={me.isOwner?undefined
            :(t,patch)=>setupTaskRemote(t.id,patch).then(r=>{ pullNow(); return r; })}
          onAccept={(t,note)=>decide(t,true,note)}
          onReturn={(t,note)=>decide(t,false,note)}
          ro={!mayEdit(me,"review")}/>)}

      {/* ═══ СХЕМА ═══ */}
      {tab==="scheme" && me.tabs.includes("scheme") && (<>
        {/* Две формы рядом (владелец, 2026-09-13): слева кнопки схемы без
            подписи «масштаб», справа — «прогноз» с ползунком месяца.
            Прежде всё стояло одной строкой, и слово «месяц» в её конце
            читалось как ни к чему не относящееся. */}
        {/* Одной строкой и одной высоты (владелец, 2026-09-13): без
            переноса, обе тянутся по высоте строки; под прогнозом никаких
            подписей. */}
        <div className="flex gap-2" style={{marginBottom: "var(--space-8)",alignItems:"stretch",flexWrap:"nowrap"}}>
          <div style={{...S.card,padding: "var(--space-4)",marginBottom: 0,flex:"1 1 0",minWidth:0,
            display:"flex",alignItems:"center"}}
            aria-label="масштаб">
            <div className="flex items-center gap-2 flex-wrap">
              <button style={btn(false)} aria-label="уменьшить"
                onClick={()=>schemeRef.current?.zoomBy(1/1.25)}>−</button>
              <button style={btn(false)} aria-label="увеличить"
                onClick={()=>schemeRef.current?.zoomBy(1.25)}>+</button>
              {mayEdit(me,"scheme:edit")&&(<>
                <button style={btn(false)} onClick={alignGrid}
                  title="Расставит блоки по сетке, сохранив расстановку по рядам">
                  ⌗ выровнять</button>
                <button style={btn(true,OK)} onClick={addEntity}>+ актив</button>
              </>)}
            </div>
          </div>
          <div style={{...S.card,padding: "var(--space-4)",marginBottom: 0,flex:"1 1 0",minWidth:0,
            display:"flex",flexDirection:"column",justifyContent:"center"}}
            aria-label="прогноз на схеме">
            <div style={S.lbl}>прогноз</div>
            <div className="flex items-center gap-2" style={{marginTop: 0}}>
              <input type="range" min={0} max={span} value={simMonth}
                aria-label="месяц на схеме"
                title="На блоке — сколько ресурса будет к этому месяцу, вилкой"
                onChange={e=>setSimMonth(Number(e.target.value))}
                style={{flex:1,minWidth:60}}/>
              <span style={{fontSize:"var(--fs-hint)",color:ACC,minWidth:34}}>{simMonth} мес</span>
            </div>
            {/* Галочка гипотез — здесь, под ползунком прогноза (владелец,
                2026-09-20: «этот чекбокс должен быть на форме прогноза, под
                полоской прокрутки прогноза»), и ВСЕГДА (владелец,
                2026-09-20: «эта кнопка должна быть всегда»). Прежде она
                висела на условии «есть гипотетические процессы» — и
                пропадала на одной схеме, возвращаясь на другой: человек
                искал переключатель там, где его только что видел. */}
            <label className="flex items-center gap-2"
              style={{fontSize:"var(--fs-hint)",color:hypoOn?WARN:C.muted,marginTop: "var(--space-4)",cursor:"pointer"}}>
              <input type="checkbox" checked={hypoOn} onChange={e=>setHypoOn(e.target.checked)}/>
              включить гипотезы
            </label>
          </div>
        </div>

        {/* Подложка с теми, кто ещё не попал ни в один актив. Стоит НАД
            схемой: человека с неё перетаскивают на блок, и тащить снизу
            вверх через всю страницу было бы дорогой в один конец. */}
        <LooseCrew people={people} entities={entities} funcs={funcs} roleName={roleName}
          onAdd={(pid,eid)=>setEntities(p=>p.map(x=>(x.id===eid
            ? {...x,crew:[...crewOf(x),pid]} : x)))}
          /* Нажатие (без перетаскивания) — окно с его страницей, как у
             воркера в карточке актива. */
          onOpen={id=>setCard(id)}/>

        <SchemeSVG ref={schemeRef} entities={entities} traits={traits} funcs={funcs} moves={moves}
          sel={sel} valuesFor={valuesFor}
          /* Нажатие на актив ведёт к его карточке: с «Деятельности» и
             «Прогноза» раздел под схемой переключается на «Управление». */
          onSelectEntity={id=>{ setSel(id); setUnder("edit"); }} onMoveEntity={moveE}
          assetOk={assetOk} onWhy={(kind,id)=>setWhy({kind,id})}
          onOpenFunc={openFuncCard}
          /* Руки правятся через текст процесса — единственный источник. */
          />

        {/* Под схемой три вкладки: чем схема собрана, куда она идёт и что
            по ней уже делали — «Деятельность»: слово «Timeline» называло
            способ показа, а не то, что показывают. Ползунок месяца — общий: он стоит над ними,
            потому что одинаково относится и к числам на блоках, и к хвостам
            графиков. */}
        {/* Порядок — как идёт работа: сперва схему собирают («Управление»;
            технологические процессы — там же, первыми, под спойлером),
            потом смотрят, что по ней делали («Деятельность») и куда она
            идёт («Прогноз»). */}
        <div className="flex gap-2" style={{margin: "var(--space-8) 0",overflowX:"auto"}}>
          {/* Внутренние вкладки — по праву роли (владелец, 2026-09-20):
              роль, назвавшая «Деятельность», открывает её одну. */}
          {tabShown(me,"scheme","edit")&&(
          <button style={btn(under==="edit",OK)} onClick={()=>setUnder("edit")}>
            Управление</button>)}
          {/* Отдельного доступа у них нет: «Прогноз» и «Деятельность» —
              разделы СХЕМЫ, и открывает их та же вкладка. Прежде они
              спрашивали свои `sim` и `timeline`, которых в списке вкладок
              больше нет, — и роль, открывшая схему, получала её без
              половины разделов. */}
          {tabShown(me,"scheme","time")&&(
          <button style={btn(under==="time",OK)} onClick={()=>setUnder("time")}>
            Деятельность</button>)}
          {tabShown(me,"scheme","sim")&&(
          <button style={btn(under==="sim",OK)} onClick={()=>setUnder("sim")}>
            Цели</button>)}
        </div>
        {/* Одна строка под вкладками — чем этот раздел занят (владелец,
            2026-09-19). */}
        <div style={{fontSize:"var(--fs-hint)",color:C.muted,margin:"0 0 var(--space-12)"}}>
          {under==="edit"?"Что умеет делать система"
            :under==="time"?"Что делает в текущий момент"
              :"Что будет делать система"}</div>

        {/* Процессы — первыми на «Управлении», под спойлером: раздел
            открывают нажатием, а до того он не заслоняет карточку актива.
            Выбранный на схеме актив подсвечивает процессы, где он занят. */}
        {under==="edit" && (
          <ProcessPanel procs={procs} setProcs={setProcs} people={people} rolesOf={rolesOf}
            selected={sel} shown={procsOpen} onToggle={setProcsOpen}
            onOpenAsset={id=>setSel(id)} onOpenTrait={openTraitCard}
            onOpenWorkers={openWorkersCard}
            entities={entities} setEntities={setEntities}
            traits={traits} setTraits={setTraits} kinds={kinds}
            funcs={funcs} setFuncs={setFuncs}
            makeEntity={freshEntity}
            /* Должности — те же, что у функций в карточке актива; новая
               заводится на сервере и возвращается, чтобы встать в выбор. */
            positions={roles}
            /* Задачи по снятым функциям процесса — как при удалении актива:
               выполнять больше нечего. */
            onDropFuncs={ids=>setTasks(p=>p.filter(t=>!ids.includes(t.funcId)))}/>)}

        {/* Таймлайну — все функции, не только считаемые: задача по
            гипотетической функции есть и при выключенной галочке, и
            называть её функцию «удалённой» — ложь (владелец, 2026-09-20). */}
        {under==="time" && (
          <Timeline tasks={myTasks} funcs={funcs} traits={traitsLive} entities={entities}
            procs={procs} hypoOn={hypoOn} nameOf={personName} meId={me.id}/>)}

        {under==="edit" && selE && (
          <div style={{...S.card,marginTop: "var(--space-8)"}}>
            <div className="flex items-center gap-2" style={{marginBottom: "var(--space-4)"}}>
              <span style={S.lbl}>актив</span>
              <span style={{flex:1}}/>
              <button style={{ ...btn(true, BAD) }}
                onClick={()=>delEntity(selE.id)}>Удалить актив</button>
            </div>
            {/* Название — двойным нажатием (владелец, 2026-09-19). */}
            <div style={{marginBottom: "var(--space-4)"}}>
              <NameField value={selE.name} aria-label="название актива"
                style={{fontSize:"var(--fs-title)",fontWeight:700,display:"block"}}
                onCommit={v=>setEntities(p=>p.map(e=>e.id===selE.id?{...e,name:v}:e))}/>
            </div>
            <div style={{fontSize:"var(--fs-hint)",color:C.muted,lineHeight:1.6}}>
              {FACTORS_ON ? "Актив — это воркеры, функции, факторы и ресурсы." : "Актив — это воркеры, функции и ресурсы."} Они и есть вкладки ниже.
            </div>

            <AssetPanel entityId={selE.id}
              me={me} published={published}
              onMarket={(f,kind)=>{ setMarketDraft({kind,func:f,at:Date.now()}); setTab("market"); }}
              workers={workers} rolesOf={rolesOf} roleName={roleName}
              funcs={funcs} setFuncs={setFuncs}
              traits={traitsLive} setTraits={setTraits} materials={materials}
              entities={entities} kinds={kinds} kindOf={kindOf}
              factors={factors} setFactors={setFactors}
              people={people} nameOf={personName} runsOf={runsOf}
              tasks={tasks} onOrderWorker={orderWorker} onToggleCrew={toggleCrew}
              pickByOrder={pickByOrderOf(selE)} onPickByOrder={setPickByOrder}
              onOpenPerson={id=>setCard(id)}
              positions={roles}
              posts={selE.posts||[]} onTogglePost={togglePost}
              onSetRoles={me.isOwner&&!me.solo
                ?(pid,list)=>setUserRoles(pid,list).then(refreshOrg):undefined}
              focus={focus}
              onFuncHead={setFuncHeadIn} onTaskChecks={setTaskChecksIn}
              onWhyFunc={id=>setWhy({kind:"func",id})}
              onWhyTrait={id=>setWhy({kind:"trait",id})}
              onDeleteTrait={delTrait}
              onUpKind={upK} onAddKind={addKind} onDelKind={id=>setKindMsg(delKind(id))}
              kindMsg={kindMsg}/>
          </div>)}

        {/* ═══ ПРОГНОЗ — вторая подвкладка ═══ */}
        {under==="sim" && (<div>
        {/* Последовательность действий по применённым целям — общая, на
            всю модель. Внутри цели видно её собственную очередь, здесь —
            всё вместе: чем занята модель прямо сейчас и что за чем идёт. */}
        {!!appliedSteps.length&&(
          <div style={{...S.card,marginBottom: "var(--space-8)"}}>
            <div style={S.lbl}>последовательность действий · по применённым целям</div>
            {appliedSteps.map((st,i)=>(
              <div key={st.func} className="flex items-center gap-2"
                style={{fontSize:"var(--fs-hint)",padding: "var(--space-4) 0",
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
          </div>)}

        {/* Цели: сколько, чего, к какому сроку, каким темпом и какой ценой.
            Модель отвечает тем, что из цели следует, — см. GoalsPanel. */}
        <GoalsPanel goals={goals} setGoals={setGoals} traits={traitsLive}
          model={{traits:traitsLive,funcs,procs,hypoOn}} runsOf={runsOf}
          /* Постановщика назначают на схеме, в ролях функции, — и задача
             рождается уже с ним: форма постановки его не выбирает. Без
             этого позванный постановщик не увидел бы задачу в «ждут
             постановки»: ему показывают только те, где постановщик — он. */
          onTasks={list=>setTasks(p=>[...p,...list.map(t=>{
            /* Задача рождается С ЛЮДЬМИ (владелец, 2026-09-20): кого
               ставить, решают должности функции и порядок воркеров
               актива. Пустых ролей не бывает — иначе на «Проверке»
               стояло бы «не назначен». */
            const f=funcs.find(x=>x.id===t.funcId)||null;
            const crew=crewFor(f,{entities,people,rolesOf});
            const has=(v)=>v!=null&&v!=="";
            return {...t,
              setter:has(t.setter)?t.setter:crew.setter,
              assignee:has(t.assignee)?t.assignee:crew.assignee,
              reviewer:has(t.reviewer)?t.reviewer:crew.reviewer};
          })])}
          onDropGoal={id=>setTasks(p=>p.filter(t=>(
            /* Уходит цель — уходит и заведённая ею работа. Кроме уже
               СДЕЛАННОЙ: принятая сдача это то, что и правда произошло, и
               стирать её значило бы переписать прошлое — а заодно и факт в
               прогнозе, который по ней и посчитан. */
            t.goalId!==id||t.status==="done"||(t.submissions||[]).length>0)))}
          /* Отзыв цели: `all` — стирать ли и сделанное. Нет — уходит
             только невыполненная работа, результаты остаются; да —
             уходит всё, что цель завела, вместе с результатами
             (владелец, 2026-09-20). */
          onRecallGoal={(id,all)=>setTasks(p=>p.filter(t=>(
            t.goalId!==id
            ||(!all&&(t.status==="done"||(t.submissions||[]).length>0)))))}/>

        {/* Прогнозы под целями — на одной форме (владелец, 2026-09-19):
            что будет с ресурсами и сколько это стоит по людям. Внутренние
            формы остаются своими. */}
        <div style={{...S.card,marginBottom: "var(--space-8)"}}>
        <div style={S.lbl}>прогноз</div>
        {entities.map(en=>{
          const ts=traitsLive.filter(t=>t.e===en.id);
          if(!ts.length) return null;
          return (
            <div key={en.id} style={{...S.card,marginBottom: "var(--space-8)"}}>
              <div className="flex items-center gap-2" style={{marginBottom: "var(--space-4)"}}>
                <span style={{width:8,height:8,borderRadius: "var(--radius-sm)",background:en.color}}/>
                <span style={{fontSize:"var(--fs-body)",fontWeight:700,flex:1}}>{en.name}</span>
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
                    border:`1px solid ${C.line}`,borderRadius: "var(--radius-sm)",padding: "var(--space-8)",marginBottom: "var(--space-4)"}}>
                    <div className="flex items-center gap-2" style={{cursor:"pointer"}}
                      onClick={()=>toggleCard(t.id)}>
                      <span style={{fontSize:"var(--fs-body)",fontWeight:600,flex:1}}>{t.l}</span>
                      <span style={{fontSize:"var(--fs-hint)",color:WARN}}>
                        {nm(lo[last]??0)}–{nm(hi[last]??0)} {t.unit}</span>
                      <span style={{fontSize:"var(--fs-hint)",color:C.muted}}>{on?"▾":"▸"}</span>
                    </div>
                    <div style={{fontSize:"var(--fs-hint)",color:C.muted,marginTop: "var(--space-4)"}}>
                      сейчас {nm(Number(t.have)||0)} · через {span} мес
                      {line!=null?` · цель ${nm(line)}`:""}
                      {flow!=null?` · цель требует ${nm(Math.round(flow*10)/10)} в месяц`:""}
                      {r&&(r.sure!=null?` · наверняка к ${r.sure} мес`
                        :r.best!=null?` · в лучшем случае к ${r.best} мес`
                          :" · по прогнозу не достигается")}
                    </div>
                    {on&&(
                      <div style={{marginTop: "var(--space-8)"}} aria-label={`график: ${t.l}`}>
                        <Chart lo={lo} hi={hi} fact={fc.fact?fc.fact[t.id]:null}
                          months={span} goalLine={line}
                          cursorMonth={simMonth}/>
                      </div>)}
                  </div>);
              })}
            </div>);
        })}

        <div style={{...S.card,marginBottom: "var(--space-8)"}}>
          <div style={S.lbl}>нагрузка исполнителей</div>
          {Object.keys(workload).length===0
            ? <div style={{fontSize:"var(--fs-hint)",color:C.muted,marginTop: "var(--space-8)"}}>
                Исполнители на функции ещё не назначены.</div>
            : Object.entries(workload).map(([pid,h])=>(
                <div key={pid} className="flex items-center gap-2"
                  style={{marginTop: "var(--space-4)",fontSize:"var(--fs-hint)"}}>
                  <span style={{flex:1}}>{personName(pid)}</span>
                  <span style={{color:h>160?BAD:h>120?WARN:OK}}>{nm(h)} ч/мес</span>
                </div>))}
        </div>
        </div>
        </div>)}
      </>)}

      {/* ═══ ИНСТРУМЕНТЫ ═══ */}
      {tab==="tools" && me.tabs.includes("tools") && (
        <div className="flex gap-2" style={{marginBottom: "var(--space-8)","--cell":"100px"}}>
          {[["people","Роли"],["assistant","Агенты"],["virtual","Виртуальные сотрудники"],
            ["reminders","Напоминания"],["calls","Звонки"],["issues","Issues"],
            ["export","Выгрузка"]]
            // «Люди и роли» — дело владельца. «Выгрузка» тоже: схем у
            // не-владельца не бывает, у него одна — та, где его назначили.
            // «Люди и роли» и «Выгрузка» — дело владельца; остальные —
            // по праву роли на внутренней вкладке (владелец, 2026-09-20).
            .filter(([k])=>((k!=="people"&&k!=="export")||me.isOwner||me.solo)
              &&tabShown(me,"tools",k))
            .map(([k,t])=>(
              <button key={k} style={btn(tool===k,OK)} onClick={()=>setTool(k)}>{t}</button>))}
        </div>)}

      {tab==="tools" && me.tabs.includes("tools") && tool==="people" && (
        <PeoplePanel me={me} onPeople={setPeople}
          /* Роли и анкеты меняют и «кто я»: анкету, назначенную своей
             роли, владелец должен увидеть без перезагрузки. Список ролей
             тоже перечитывается: схема берёт названия должностей отсюда. */
          onChanged={()=>{ resetIdentity(); whoAmI().then(m=>setMe(m)).catch(()=>{}); refreshOrg(); }}
          /* Переименованная роль (владелец, 2026-09-18: «после изменения
             имени роли она не изменилась на схеме»): новое имя — в список
             ролей, в тексты процессов («Кто:», «Кому:», «От кого:») и в
             функции, собранные из них. */
          onRoleRenamed={async (id,from,to)=>{
            const o=await listOrg().catch(()=>null);
            const nextRoles=o?.roles||roles.map(r=>r.id===String(id)?{...r,name:to}:r);
            const nextPeople=o?.users||people;
            setRoles(nextRoles); if(o?.users) setPeople(o.users);
            const m={entities,traits,positions:nextRoles,people:nextPeople,rolesOf};
            const next=procs.map(p=>({...p,text:replaceName(p.text,"who",from,to,m)}));
            setProcs(next);
            setFuncs(f=>syncProcFuncs(f,next,m,normalizeFunc,procFuncs2));
          }}/>)}

      {/* Агенты — всем, у кого есть «Инструменты»: у каждого свои
          провайдеры, модели и память; участником организации агент
          становится только у владельца. */}
      {tab==="tools" && me.tabs.includes("tools") && tool==="assistant" && (
        <AgentsPanel me={me} onChanged={()=>{ if(me.isOwner&&!me.solo) refreshOrg(); }}/>)}

      {/* Напоминания — всем, у кого есть «Инструменты»: за сколько
          предупреждать, решает тот, кому напоминают. Ответ сервера кладётся
          в «кто я», и расписание выше пересчитывается с новым «за сколько». */}
      {/* Виртуальные сотрудники — свой раздел, следом за агентами
          (владелец, 2026-09-20): третий вид участника. */}
      {tab==="tools" && me.tabs.includes("tools") && tool==="virtual" && (
        <VirtualPanel me={me}
          /* Вошли под чужой страницей — приложение перечитывает «кто я»
             целиком: вкладки, анкета и модель теперь её. */
          onEnter={()=>{ resetIdentity(); whoAmI().then(m=>{ setMe(m); setTab("me"); })
            .catch(()=>{}); }}/>)}

      {tab==="tools" && me.tabs.includes("tools") && tool==="reminders" && (
        <RemindersCard me={me} onSaved={p=>{ setMe(m=>({...m,profile:p})); }}/>)}

      {/* Issues — сообщения об ошибках, присланные значком из шапки
          (владелец, 2026-09-21): список и «Удалить» рядом с каждым. */}
      {tab==="tools" && me.tabs.includes("tools") && tool==="issues" && (
        <IssuesPanel me={me}/>)}

      {tab==="tools" && me.tabs.includes("tools") && tool==="calls" && (
        <CallsBoard me={me} people={people} openCall={openCall}
          onLeaveCall={()=>setOpenCall(null)} nameOf={personName}/>)}

      {tab==="tools" && me.tabs.includes("tools") && tool==="export"
        && (me.isOwner||me.solo) && (
        <div style={S.card}>
          <div className="flex flex-wrap gap-2" style={{marginBottom: "var(--space-8)"}}>
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
            {jsonMsg&&<span style={{fontSize:"var(--fs-hint)",color:C.muted,alignSelf:"center"}}>{jsonMsg}</span>}
          </div>
          <TxtField area value={json} style={{minHeight:300,
            fontFamily:"var(--font-sans)",fontSize:"var(--fs-hint)"}}
            onCommit={setJson}/>

          {/* ═══ СОХРАНЕНИЕ НА ДИСКЕ СЕРВЕРА ═══ */}
          <div style={{marginTop: "var(--space-12)",borderTop:`1px solid ${C.line}`,paddingTop: "var(--space-8)"}}>
            <div style={S.lbl}>сохранённые сценарии{savedWhere?` · ${savedWhere}`:""}</div>
            <div className="flex flex-wrap gap-2" style={{margin: "var(--space-8) 0"}}>
              <input placeholder="имя сценария" value={saveName}
                onChange={e=>setSaveName(e.target.value)}
                onBlur={e=>setSaveName(e.target.value)}
                style={{...S.inp,flex:"1 1 160px"}}/>
              <button style={btn(true)} disabled={savedBusy} onClick={saveToDisk}>
                Сохранить</button>
            </div>
            <div className="flex flex-wrap gap-2" style={{marginBottom: "var(--space-8)"}}>
              <select style={{...S.inp,flex:"1 1 160px"}} value={savedSel}
                onChange={e=>setSavedSel(e.target.value)}>
                <option value="">— выбери сценарий —</option>
                {/* Дата рядом с именем: два «Моя схема» иначе не различить,
                    а список и так стоит новыми вперёд. */}
                {savedList.map(s=>(<option key={s.id} value={s.id}>
                  {s.name}{savedOn(s.savedAt)}</option>))}
              </select>
              <button style={btn(false)} disabled={savedBusy} onClick={loadFromDisk}>
                Загрузить</button>
              <button style={{ ...btn(true, BAD) }}
                disabled={savedBusy} onClick={deleteFromDisk}>Удалить</button>
            </div>
            <ScenarioVersions id={savedSel} when={whenText}
              stamp={savedList.find(s=>s.id===savedSel)?.savedAt||""}/>
            {/* Предел — до отказа, а не вместо него: у диска сервера и облака
                Telegram пределы разные, и подпись считает по тому, куда
                пишется сейчас. */}
            {savedKind && (()=>{ const room=savedRoom(savedList.length,savedKind);
              return (<div style={{fontSize:"var(--fs-hint)",color:room.warn?WARN:C.muted,marginBottom: "var(--space-8)"}}>
                {room.text}</div>); })()}
            {savedMsg&&<div style={{fontSize:"var(--fs-hint)",color:C.muted}}>{savedMsg}</div>}
          </div>
        </div>)}

      {/* Окно сообщения об ошибке — поверх любой вкладки: значок стоит в
          шапке, и уходить за ним никуда не нужно. */}
      {issueOpen && (
        <IssueModal onClose={()=>setIssueOpen(false)} onSend={sendIssue}/>)}
      {wand && wand!=="taking" && (
        <WandModal seen={wand} onClose={()=>setWand(null)} onSend={askFromApp}/>)}

      {/* ═══ КАРТОЧКА ЧЕЛОВЕКА ═══
          Окном поверх того, что человек сейчас делает, а не переходом на
          страницу: он открывает воркера, чтобы посмотреть анкету и рейтинг,
          и должен вернуться туда же, откуда смотрел. Прежде нажатие
          переключало вкладку, и обратной дороги не было. */}
      {card!=null && (
        <Modal onClose={()=>setCard(null)} title={personName(card)}>
          <ProfilePanel me={me} personId={card} people={people}
            tasks={tasks} funcs={funcs} published={published} ratings={ratings}
            entities={entities} rolesOf={rolesOf}
            onRefuseFunc={me.isOwner&&String(card)===String(me.id)?refuseFuncHere:undefined}
            traitName={id=>traits.find(t=>t.id===id)?.l||"ресурс удалён"}
            onSaved={p=>{
              setMe(m=>({...m,profile:p,...(p?.name?{name:p.name}:{})}));
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

      </div>
    </div>);
}
