import React, { useState } from "react";
import { C, OK, WARN, BAD, NEU, ACC, S, btn, nm, NumField, TxtField } from "./ui.jsx";
import { DUR_UNITS, WORKER_KINDS, byCrew, hoursOf, isFactor, rangeText, shortage }
  from "../lib/funcs.js";
import { shortStat, statsOf } from "../lib/workers.js";
import { heldBy, unitsOf } from "../lib/units.js";
import { putReportFile, MAX_UPLOAD_REPORT_BYTES } from "../storage.js";

/* ════════════════════════════════════════════════════════════════
   ЗАДАЧИ · выполнения функций

   Задача в этой модели — это одно выполнение функции. Не «работа вообще»
   и не пункт списка: у неё есть функция и три человека из воркеров её
   актива — постановщик, исполнитель и проверяющий.

   Все три обязательны. Постановщик пишет, что именно сделать: содержимое
   задачи — его работа, а не догадка исполнителя и не текст, сочинённый
   машиной. Пустое «что сделать» — это работа, которую никто не поставил.

   Прежде задача цеплялась к стрелке «актив → ресурс» и к ключевому
   результату OKR. Ни того, ни другого больше нет: считает модель по
   функциям, и работа должна цепляться туда же, иначе план и факт снова
   оказались бы про разное.

   ─── зачем сдача записывает числа ───

   У функции заложена вилка: сколько она берёт и сколько выдаёт, и за
   сколько времени. Сдача записывает, что вышло на самом деле: сколько
   часов ушло и сколько каждого ресурса взяли и выдали. Из принятых сдач
   считается среднее арифметическое — оно и уточняет прогноз.

   Поэтому «Готово» ставит не исполнитель, а проверяющий: непринятая
   сдача не должна попадать в расчёт, иначе фактом стало бы то, что
   человек сам о себе написал.
   ════════════════════════════════════════════════════════════════ */

/* Путь задачи, слева направо.

   «Ожидает постановки» — заведена, но ещё не поставлена: нет людей или
   срока. Это состояние ПОСТАНОВЩИКА, и на доске исполнителя ему места нет:
   там показывалась бы работа, которой ещё не поручали. Ставят задачи во
   вкладке «Проверка» — там же, где принимают сдачу: обе эти вещи делает не
   исполнитель.

   Дальше — то, что и правда лежит на доске: бэклог, дедлайн, работа,
   проверка, готово.

   ─── задачи не перекладывают, они переходят сами ───

   Ни одной стрелки «влево-вправо» здесь нет и быть не должно: колонка —
   это не полка, куда работу можно переложить, а ОТВЕТ на вопрос, что с
   ней сейчас. У исполнителя ровно два действия, и оба — про работу, а не
   про доску:

   · задача в бэклоге — «Взять в работу»;
   · задача в работе — «Сдать».

   Остальное происходит само. «Дедлайн» — не полка и не решение: туда
   задача попадает ровно тогда, когда её срок прошёл, а работа ещё не
   сдана. «Проверка» — следствие сдачи, «Готово» — следствие приёма:
   ставит его проверяющий, принимая отчёт с оценкой, иначе исполнитель
   закрывал бы себя сам. */
export const STATUSES=[
  {id:"wait",name:"Ожидает постановки",color:NEU},
  {id:"backlog",name:"Бэклог",color:NEU},
  {id:"deadline",name:"Дедлайн",color:BAD},
  {id:"progress",name:"В работе",color:ACC},
  {id:"review",name:"Проверка",color:WARN},
  {id:"done",name:"Готово",color:OK},
];

/* Колонки доски — всё, кроме ожидания постановки: непоставленная задача
   ещё ничья, и лежать ей на доске незачем. */
export const BOARD=STATUSES.filter(s=>s.id!=="wait");

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

// Предел зависит от того, есть ли куда класть файл: на диск сервера влезает
// 20 МБ, внутрь сценария — 2 МБ. Оба живут в storage.js; здесь оставлен
// только реэкспорт для кода, читавшего старое имя.
export const MAX_REPORT_BYTES=MAX_UPLOAD_REPORT_BYTES;

/** Новая задача — выполнение функции. */
export function newTask({funcId=null,title="Новое выполнение",body="",
  setter=null,assignee=null,reviewer=null,start=null,end=null}){
  // Заводится в «ожидает постановки»: пока нет людей, срока и содержимого,
  // это ещё не задача, а намерение её поставить.
  // endBy — кем поставлен срок. «auto» значит «посчитан от начала»: такой
  // срок едет за началом. «hand» — назначен человеком, и его не двигает
  // ничто: это обещание, а не производная.
  // taken — взял ли исполнитель задачу в работу. Отдельно от статуса
  // нарочно: просроченная задача показывается в «Дедлайне», и без этого
  // признака было бы не сказать, лежит она там нетронутой или её уже
  // делают.
  return {id:uid("tk"),funcId,title,body,status:"wait",taken:false,
    setter,assignee,reviewer,start,end,endBy:"auto",warn:10,
    submissions:[],reviews:[],comments:[]};
}

/**
 * Как называется одно выполнение функции.
 *
 * Выполнения одной функции — РАЗНЫЕ задачи, и называться они должны
 * по-разному. Одно имя функции на все четыре превращало их в неразличимые
 * близнецы: на доске не понять, какую берёшь, в отчёте они сливались, а бот
 * слал четыре одинаковых напоминания подряд.
 *
 * Единственное выполнение остаётся без номера: «№1 из 1» — это не
 * уточнение, а шум.
 */
export function runTitle({ name, no, of } = {}) {
  const base = String(name || "").trim() || "выполнение функции";
  return Number(of) > 1 ? `${base} №${no} из ${of}` : base;
}

/* ─────── близнецы, заведённые прежде ───────

   Задачи, заведённые до того, как выполнения стали нумероваться, носят одно
   и то же имя функции. В отчёте и на доске они читаются как одна и та же
   строка, повторённая четыре раза: не понять, какую берёшь, какую сдал и о
   какой идёт речь.

   Поэтому такие близнецы нумеруются задним числом. Обычно переписывать
   чужие названия нельзя — на них ссылаются в разговоре, — но здесь именно
   этот довод и не работает: сослаться на одну из четырёх одинаковых было
   НЕЛЬЗЯ, потому что имя не указывало ни на одну. Номер не отнимает
   различение, а впервые его даёт.

   Трогаются только точные совпадения внутри одной функции. Название,
   которое человек написал сам, уникально — и остаётся нетронутым. Разойтись
   дважды нельзя: после нумерации имена уже различны, и правило больше не
   срабатывает.

   Порядок — по началу, затем по сроку, затем по идентификатору: он должен
   быть один и тот же при каждом пересчёте, иначе номера прыгали бы от
   перерисовки к перерисовке. */
export function numberTwins(tasks=[]){
  const by=new Map();
  tasks.forEach(t=>{
    const key=`${t.funcId||""}|${String(t.title||"")}`;
    if(!by.has(key)) by.set(key,[]);
    by.get(key).push(t);
  });
  const num={};
  let touched=false;
  by.forEach((list)=>{
    if(list.length<2) return;
    const at=(t)=>{
      const v=t.start||t.end||"";
      const ms=v?new Date(v).getTime():NaN;
      return Number.isNaN(ms)?Infinity:ms;
    };
    [...list].sort((a,b)=>(at(a)-at(b))||String(a.id).localeCompare(String(b.id)))
      .forEach((t,i)=>{
        num[t.id]=runTitle({name:t.title,no:i+1,of:list.length});
        if(num[t.id]!==t.title) touched=true;
      });
  });
  // Тот же массив, когда трогать нечего: иначе состояние менялось бы на
  // каждой перерисовке и приложение крутилось бы вхолостую.
  return touched?tasks.map(t=>(num[t.id]&&num[t.id]!==t.title
    ?{...t,title:num[t.id]}:t)):tasks;
}

/**
 * Срок по умолчанию: начало плюс верхняя граница одного выполнения.
 *
 * Верхняя — потому что срок это обещание: обещать по нижней границе значит
 * заранее назначить срыв. Цикл считается с расписанием: работа на час,
 * которая делается раз в неделю, занимает неделю, а не час.
 */
export function defaultEnd(func,start){
  if(!func) return null;
  const from=start?new Date(start).getTime():Date.now();
  if(Number.isNaN(from)) return null;
  const hours=Math.max(hoursOf(func),
    (Number(func.every)||0)*(DUR_UNITS[func.everyUnit]??1));
  return nowLocal(new Date(from+Math.max(hours,1)*3600000));
}

/** Кто в задаче за какую роль: у задачи по одному человеку на роль. */
export const TASK_ROLE={setters:"setter",owners:"assignee",reviewers:"reviewer"};

/**
 * Чего задаче не хватает, чтобы её можно было начать.
 *
 * Три роли обязательны и срок обязателен — без них некому работать и не к
 * чему успеть. Содержимое НЕ обязательно: что это за работа, уже сказано
 * описанием функции, и требовать переписывать его в каждую задачу значило
 * бы просить второй раз то, что уже есть. Постановщику есть что добавить —
 * добавит; нечего — задача ставится и так.
 */
export function taskGaps(task){
  const gaps=WORKER_KINDS.filter(k=>!task[TASK_ROLE[k.id]]).map(k=>k.task);
  if(!task?.end) gaps.push("срок");
  return gaps;
}

/** Поставлена ли задача до конца — от этого зависит, можно ли её двигать. */
export const isSet=(task)=>taskGaps(task).length===0;

/* ─────── когда человек в задаче один ───────

   Постановка и проверка — это не обряды, а передача работы от одного
   человека другому: постановщик говорит исполнителю, что сделать;
   проверяющий решает, принята ли сдача. Когда по обе стороны один и тот же
   человек, передавать нечего — и нажатие остаётся ритуалом, который
   спрашивает у человека то, что он и так о себе знает.

   · постановщик и исполнитель совпали — задача ставится сама и сразу
     появляется в бэклоге: её и ставить-то не у кого;
   · исполнитель и проверяющий совпали — сдача принимается сама, и задача
     уходит в готовые: сдал и принял один и тот же человек;
   · все трое — один, и тогда задача просто лежит в бэклоге, а как он взял
     её в работу и сдал — она в готовых.

   Что остаётся неизменным: задача всё равно должна быть ОПИСАНА, и
   ресурсов на неё всё равно должно хватать. Автоматическая постановка
   избавляет от нажатия, а не от работы: пустое «что сделать» — это
   по-прежнему работа, которую никто не поставил. */
const same=(a,b)=>a!=null&&b!=null&&String(a)===String(b);
export const selfSet=(t)=>same(t?.setter,t?.assignee);
export const selfReview=(t)=>same(t?.assignee,t?.reviewer);

/**
 * Ниже какого статуса задача не опускается сама по себе.
 *
 * У задачи с автоматической постановкой это бэклог: возвращать её в
 * «ожидает постановки» бессмысленно — она тут же поставится снова.
 */
export function floorStatus(task,{funcs=[],traits=[],tasks=[]}={}){
  if(!selfSet(task)||!isSet(task)) return "wait";
  const f=funcs.find(x=>x.id===task.funcId);
  return f&&shortage(f,traits,heldBy(tasks,f)).length?"wait":"backlog";
}

/** Просрочена ли задача: срок прошёл, а работа ещё не сдана. */
export const overdue=(task,now=Date.now())=>{
  if(!task?.end) return false;
  const end=new Date(task.end).getTime();
  if(Number.isNaN(end)) return false;
  return end<now&&task.status!=="review"&&task.status!=="done";
};

/**
 * Каким статус задачи становится сам собой.
 *
 * Здесь и живёт всё движение по доске, кроме двух нажатий исполнителя.
 * Колонка — не полка: «Дедлайн» это не место, куда задачу кладут, а то,
 * что с ней случилось, — срок прошёл, а работа не сдана. Поэтому она туда
 * попадает сама и сама же оттуда уходит, когда срок передвинут.
 */
export function autoStatus(task,{funcs=[],traits=[],tasks=[],now=Date.now()}={}){
  if(!task) return null;
  // Сдача принята тем же, кто сдавал: принимать не у кого.
  if(task.status==="review"&&selfReview(task)) return "done";
  const work=task.status==="backlog"||task.status==="progress"
    ||task.status==="deadline";
  if(task.status==="wait"&&floorStatus(task,{funcs,traits,tasks})==="wait") return "wait";
  if(task.status!=="wait"&&!work) return task.status;
  /* Взятая в работу задача остаётся работой, невзятая лежит в бэклоге — и
     та, и другая уходит в «Дедлайн», как только срок прошёл. Задача,
     которая УЖЕ в работе, взятой и считается: так открываются записи,
     заведённые до появления этого признака. */
  if(overdue(task,now)) return "deadline";
  return isTaken(task)?"progress":"backlog";
}

/** Взята ли задача в работу. Статус «в работе» — это и есть «взята». */
export const isTaken=(t)=>!!(t?.taken||t?.status==="progress");

/**
 * Развести задачи по статусам, которые они принимают сами.
 *
 * Возвращает ТОТ ЖЕ массив, когда двигать нечего: иначе состояние менялось
 * бы на каждой перерисовке и приложение крутилось бы вхолостую.
 */
export function autoFlow(tasks=[],opts={}){
  let moved=false;
  const next=tasks.map(t=>{
    const to=autoStatus(t,{...opts,tasks:opts.tasks||tasks});
    if(to===t.status) return t;
    moved=true;
    return {...t,status:to};
  });
  return moved?next:tasks;
}

/**
 * Одна сдача: сколько часов ушло и сколько ресурса взяли и выдали.
 *
 * Это и есть фактическое выполнение — то, из чего потом берётся среднее
 * арифметическое. Числа по ресурсам лежат картой «ресурс → сколько»,
 * потому что у функции их несколько и порядок портов не обязан совпадать.
 */
export const newSubmission=({hours=0,takes={},gives={},took={},text="",file=null})=>
  ({id:uid("sb"),at:new Date().toISOString(),hours:Number(hours)||0,
    takes:{...takes},gives:{...gives},
    /* КАКИЕ именно единицы взяли — карта «ресурс → номера». Количества
       говорят, что израсходована одна заявка, и молчат о том, чья; а
       спрашивают потом именно об этом: «покажи весь отчёт вот по этому
       заданию». Задним числом такую связь не восстановить ничем, кроме
       догадки, — поэтому её называет тот, кто работу делал. */
    took:Object.fromEntries(Object.entries(took||{})
      .map(([k,v])=>[k,[...new Set((v||[]).filter(Boolean))]])
      .filter(([,v])=>v.length)),
    text,file});

/** Последняя сдача задачи — по ней и судят о выполнении. */
export const lastSubmission=(t)=>{
  const s=t?.submissions||[];
  return s.length?s[s.length-1]:null;
};

/**
 * Выполнения функции — из принятых задач.
 *
 * Только «Готово»: непринятая сдача — это заявление исполнителя, а не
 * измерение. Пока проверяющий её не принял, в расчёт она не идёт.
 */
export function runsOfFunc(tasks=[],funcId){
  return tasks.filter(t=>t.funcId===funcId&&t.status==="done")
    .map(lastSubmission).filter(Boolean)
    .map(sb=>({at:sb.at,hours:Number(sb.hours)||0,
      takes:sb.takes||{},gives:sb.gives||{}}));
}

/** Подпись функции: «актив · функция», как она читается на схеме. */
export const funcLabel=(f,entities=[])=>{
  if(!f) return "функция удалена";
  const e=entities.find(x=>x.id===f.e);
  return `${e?.name||"?"} · ${f.name||"без названия"}`;
};

/* ─────── чего не хватает, чтобы задачу поставить ───────

   Две разные нехватки, и путать их нельзя. Первая — незаполненность: нет
   людей, срока или содержимого, и это чинит постановщик. Вторая — ресурсы:
   их количество меняется само по себе, поэтому задачу можно описать
   заранее, а поставить — только когда ресурсов хватает. */
export const lackOf=(task,funcs=[],traits=[],tasks=[])=>{
  const f=funcs.find(x=>x.id===task?.funcId);
  /* Своё «уже обработано» у каждой функции: вход, который не расходуется,
     остаётся на полке и достаётся другим — но этой второй раз не даётся,
     работа по нему уже сделана. */
  return f?shortage(f,traits,heldBy(tasks,f)):[];
};

/** Почему задачу нельзя поставить — словами, а не пустой кнопкой. */
export function whyNotSet(task,funcs=[],traits=[],tasks=[]){
  if(!isSet(task)) return `Не хватает: ${taskGaps(task).join(", ")}`;
  const miss=lackOf(task,funcs,traits,tasks);
  if(!miss.length) return "";
  return "Не хватает ресурсов: "
    +miss.map(x=>(x.spend
      ? `${x.name} — есть ${nm(x.have)}, нужно ${nm(x.need)}`
      : `${x.name} — необработанного ${nm(x.have)}, нужно ${nm(x.need)}`
        +(x.done?` (${nm(x.done)} эта функция уже обработала)`:""))).join("; ");
}

/** Можно ли задачу поставить прямо сейчас. */
export const canSet=(task,funcs,traits,tasks)=>!whyNotSet(task,funcs,traits,tasks);

/* ─────── карточка функции задачи ───────
   Одинаково нужна и постановщику, и исполнителю: что за функция, что она
   берёт и выдаёт, сколько на неё заложено. */
function FuncCard({func,entities,traitName}){
  if(!func){
    return (
      <div style={{fontSize:11,color:WARN,margin:"6px 0 8px",lineHeight:1.5}}>
        Задача ни к какой функции не привязана — в модели она ничего не
        уточняет. Задачи заводятся из целей, под функцией.
      </div>);
  }
  return (
    <div style={{background:C.panel2,border:`1px solid ${C.line}`,borderRadius:8,
      padding:9,margin:"6px 0 8px",fontSize:11.5,lineHeight:1.6}}>
      <div style={{fontSize:12.5,fontWeight:700,color:C.text}}>
        {funcLabel(func,entities)}</div>
      {/* Описание функции — то, что за работа вообще. Оно живёт у функции и
          едет в каждую её задачу: переписывать его в каждую задачу руками
          значило бы спрашивать второй раз то, что уже сказано. */}
      {!!String(func.about||"").trim()&&(
        <div style={{color:C.text,marginTop:4,whiteSpace:"pre-wrap"}}>
          {func.about}</div>)}
      <div style={{color:C.muted,marginTop:4}}>
        берёт: {func.takes.length
          ? func.takes.map(p=>`${traitName(p.trait)} ${rangeText(p)}`
            +(p.spend===false?" (не расходует)":"")).join(", ")
          : "ничего"}
      </div>
      <div style={{color:C.muted}}>
        выдаёт: {func.gives.length
          ? func.gives.map(p=>`${traitName(p.trait)} ${rangeText(p)}`).join(", ")
          : "ничего"}
      </div>
      <div style={{color:C.muted,marginTop:4}}>
        на одно выполнение заложено <b style={{color:WARN}}>
          {nm(func.dur)} {func.durUnit}</b>. Сколько ушло на самом деле —
        записывается при сдаче.
      </div>
    </div>);
}

/* ═══ ПОСТАНОВКА ЗАДАЧИ ═══

   Постановка — работа не исполнителя. Постановщик называет людей, ставит
   срок и пишет, ЧТО именно сделать; исполнителю остаётся сделать и сдать.
   Поэтому форма живёт во вкладке «Проверка», рядом с приёмом сдачи: и то,
   и другое делает не тот, кто работу делает.

   На доске задач её нет намеренно — там исполнитель, и поля, которые он
   не заполняет, только предлагали бы ему поставить задачу самому себе.

   Заводить задачи руками здесь тоже нельзя: они появляются из применённых
   целей. Работа, не следующая ни из какой цели, — это работа, о которой
   никто не спросил, зачем она. */
export function TaskSetup({task,tasks=[],funcs=[],traits=[],entities=[],
  setTasks,onClose,onDelete,people=[],canAssign=true,nameOf}){
  const up=(f,v)=>upMany({[f]:v});
  // Несколько полей сразу: два up() подряд затирали бы друг друга, потому что
  // оба считают от одного и того же прежнего состояния.
  const upMany=(patch)=>setTasks(p=>p.map(t=>t.id===task.id?{...t,...patch}:t));

  const func=funcs.find(f=>f.id===task.funcId)||null;
  const traitName=(id)=>traits.find(t=>t.id===id)?.l||"(ресурс удалён)";
  // Назначать можно только воркеров того актива, которому принадлежит
  // функция: люди — свойство актива, и чужой человек в его работе
  // означал бы, что список воркеров ни на что не влияет.
  const asset=entities.find(e=>e.id===func?.e)||null;
  // В том порядке, который владелец задал в списке людей актива: кого
  // поставили выше, того и предлагают первым.
  const pool=(k)=>byCrew(asset||{},
    people.filter(p=>(asset?.[k]||[]).some(id=>String(id)===String(p.id))));
  const gaps=taskGaps(task);
  const why=whyNotSet(task,funcs,traits,tasks);

  return (
    <div style={{...S.card,marginBottom:10,borderColor:ACC}}>
      <div className="flex items-center gap-2" style={{marginBottom:8}}>
        <span style={S.lbl}>постановка задачи</span>
        <span style={{flex:1}}/>
        {onDelete&&(
          <button style={{...btn(false),color:BAD,borderColor:"#5A2436"}}
            onClick={()=>onDelete()}>Удалить</button>)}
        {onClose&&<button style={btn(false)} onClick={()=>onClose()}>✕</button>}
      </div>

      <div style={S.lbl}>название</div>
      <TxtField value={task.title} style={{marginBottom:8,fontWeight:600}}
        onCommit={v=>up("title",v)}/>

      <div className="flex flex-wrap gap-2" style={{marginBottom:4}}>
        {WORKER_KINDS.map(k=>(
          <div key={k.id} style={{flex:"1 1 150px"}}>
            <div style={S.lbl}>{k.task}</div>
            <select style={S.inp} value={task[TASK_ROLE[k.id]]||""} disabled={!canAssign}
              aria-label={k.task}
              onChange={e=>up(TASK_ROLE[k.id],e.target.value||null)}>
              <option value="">— не назначен —</option>
              {/* Рейтинг стоит рядом с именем: постановщик выбирает человека,
                  а не гадает, кого из них уже проверяли и как. */}
              {pool(k.id).map(p=>(
                <option key={p.id} value={p.id}>
                  {p.name} · {shortStat(statsOf(tasks,funcs,p.id))}</option>))}
            </select>
          </div>))}
      </div>
      <div style={{fontSize:10.5,color:C.muted,marginBottom:8,lineHeight:1.5}}>
        {canAssign
          ? "Выбирать можно только воркеров этого актива: люди — его свойство. Поставленная задача уходит исполнителю во вкладку «Задачи»."
          : "Кого назначить, решает владелец."}
        {!pool("owners").length&&asset
          &&" У актива ещё нет исполнителей — добавьте их в карточке актива."}
      </div>

      {/* Когда по обе стороны один и тот же человек, передавать нечего, и
          нажатие остаётся ритуалом: он и так знает, что сам себе поставил и
          сам у себя принял. Сказать об этом надо здесь — там, где людей и
          выбирают, а не там, где человек потом удивится статусу. */}
      {(selfSet(task)||selfReview(task))&&(
        <div style={{fontSize:10.5,color:ACC,marginBottom:8,lineHeight:1.5}}>
          {selfSet(task)&&selfReview(task)
            ? "Всё делает один человек: задача сама встаёт в бэклог, а после сдачи — в готовые. Описать её и дождаться ресурсов всё равно надо."
            : selfSet(task)
              ? "Постановщик и исполнитель — один человек: задача ставится сама и сразу идёт в бэклог."
              : "Исполнитель и проверяющий — один человек: сдача принимается сама, задача уходит в готовые."}
        </div>)}

      <div style={S.lbl}>функция, которую выполняет задача</div>
      <FuncCard func={func} entities={entities} traitName={traitName}/>

      <div className="flex flex-wrap gap-2" style={{marginBottom:8}}>
        <div style={{flex:"1 1 170px"}}>
          <div style={S.lbl}>начать</div>
          <input type="datetime-local" style={S.inp} value={task.start||""}
            aria-label="начать"
            onChange={e=>{
              const start=e.target.value||null;
              // Сдвинули начало — срок едет за ним, пока его не назначили
              // руками: иначе он остался бы в прошлом относительно старта.
              upMany(task.endBy==="hand"&&task.end?{start}
                :{start,end:defaultEnd(func,start),endBy:"auto"});
            }}/>
        </div>
        <div style={{flex:"1 1 170px"}}>
          <div style={S.lbl}>закончить</div>
          <input type="datetime-local" style={S.inp} value={task.end||""}
            aria-label="закончить"
            onChange={e=>upMany({end:e.target.value||null,endBy:"hand"})}/>
          <div style={{fontSize:10,color:C.muted,marginTop:3,lineHeight:1.4}}>
            По умолчанию — верхняя граница одного выполнения; можно менять.
            В расчёт всё равно идёт то, сколько ушло на самом деле.
          </div>
        </div>
      </div>

      <div style={S.lbl}>предупредить</div>
      <select style={{...S.inp,marginBottom:4}}
        value={task.warn==null?"":String(task.warn)}
        onChange={e=>up("warn",e.target.value===""?null:Number(e.target.value))}>
        {WARNS.map(w=>(<option key={String(w.v)} value={w.v==null?"":String(w.v)}>
          {w.name}</option>))}
      </select>
      <div style={{fontSize:10.5,color:C.muted,marginBottom:8,lineHeight:1.5}}>
        Напоминание придёт обычным сообщением от бота. Чтобы оно дошло,
        у бота должен быть начат диалог — откройте его и нажмите «Начать».
      </div>

      {/* Содержимое пишет постановщик: это его работа, а не догадка
          исполнителя и не текст, сочинённый машиной. */}
      <div style={S.lbl}>содержимое задачи — необязательно</div>
      <TxtField area value={task.body}
        placeholder="что добавить к описанию функции — если есть что"
        style={{minHeight:70,margin:"4px 0",lineHeight:1.5}}
        onCommit={v=>up("body",v)}/>
      <div style={{fontSize:10.5,color:C.muted,lineHeight:1.5,marginBottom:8}}>
        Пишет постановщик{task.setter?`: ${nameOf?nameOf(task.setter):task.setter}`:""}.
        Заполнять не обязательно: что это за работа, уже сказано описанием
        функции — здесь только то, что относится к этому выполнению.
      </div>

      {task.status==="wait"?(<>
        {!!gaps.length&&(
          <div style={{fontSize:11,color:WARN,marginBottom:8,lineHeight:1.5}}>
            Задача поставлена не до конца: не хватает {gaps.join(", ")}. Все три
            роли обязательны, и срок тоже: без него нечему сорваться и нечего
            успевать.
          </div>)}
        <div className="flex flex-wrap gap-2" style={{alignItems:"center"}}>
          {/* Недоступную кнопку видно, что она недоступна: зелёная и живая
              на вид, она предлагала бы нажать то, что не нажимается. */}
          <button style={{...btn(true,OK),opacity:why?0.45:1,
            cursor:why?"default":"pointer"}} disabled={!!why} title={why}
            onClick={()=>up("status","backlog")}>Поставить</button>
          {why
            ? <span style={{fontSize:10.5,color:WARN,lineHeight:1.5}}>{why}</span>
            : <span style={{fontSize:10.5,color:C.muted}}>
                уйдёт в бэклог исполнителю</span>}
        </div>
      </>):(
        <div style={{fontSize:11,color:C.muted,lineHeight:1.5}}>
          Задача уже поставлена — сейчас она в колонке «
          {STATUSES.find(x=>x.id===task.status)?.name||task.status}» на доске
          исполнителя. Правки отсюда видит и он.
        </div>)}

      <div style={{...S.lbl,marginTop:10}}>комментарии</div>
      <Comments task={task} onAdd={(text)=>up("comments",
        [...(task.comments||[]),{id:uid("c"),text,at:new Date().toISOString()}])}
        onDrop={(id)=>up("comments",(task.comments||[]).filter(c=>c.id!==id))}/>
    </div>);
}

/* ═══ КАРТОЧКА ЗАДАЧИ У ИСПОЛНИТЕЛЯ ═══

   Здесь работу делают, а не раздают. Поэтому: видно, что за задача, кто её
   поставил и до какого срока, видно содержимое — и можно сдать и написать
   комментарий. Ни ролей, ни сроков, ни содержимого отсюда не меняют: это
   слова постановщика, и переписывать их за него значило бы менять
   договорённость в одну сторону.

   Сдача записывает, что вышло на самом деле: сколько часов ушло и сколько
   каждого ресурса взяли и выдали. Из принятых сдач считается среднее
   арифметическое — оно и уточняет прогноз. */
export function TaskView({task,tasks=[],funcs=[],traits=[],entities=[],setTasks,
  onClose,nameOf}){
  const upMany=(patch)=>setTasks(p=>p.map(t=>t.id===task.id?{...t,...patch}:t));
  const up=(f,v)=>upMany({[f]:v});
  const [handing,setHanding]=useState(false);
  const [draftText,setDraftText]=useState("");
  const [draftFile,setDraftFile]=useState(null);
  const [fileErr,setFileErr]=useState("");
  const [fileBusy,setFileBusy]=useState(false);
  const [hours,setHours]=useState(0);
  const [qty,setQty]=useState({takes:{},gives:{}});
  const [took,setTook]=useState({});

  const func=funcs.find(f=>f.id===task.funcId)||null;
  const subs=task.submissions||[];
  const traitName=(id)=>traits.find(t=>t.id===id)?.l||"(ресурс удалён)";
  const who=(id)=>(id?(nameOf?nameOf(id):id):"не назначен");
  /* Номера единиц, которые получились из сдач. Сдача — это не «плюс одна
     штука», а появление ВЕЩИ: вот это техническое задание, вот этот макет.
     На них потом и ссылаются разделы отчёта. */
  const unitNo={};
  unitsOf({tasks:tasks.length?tasks:[task],funcs}).forEach(u=>{unitNo[u.id]=u.no;});
  const tasksAll=tasks.length?tasks:[task];

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
  const startHanding=()=>{
    if(!func) return;
    // Поля сдачи заполняем планом: чаще всего вышло близко к нему, и
    // переписать одно число проще, чем набирать все с нуля.
    const mid=(p)=>Math.round(((Number(p.lo)||0)+(Number(p.hi)||0))/2*100)/100;
    setHours(hoursOf(func));
    setQty({takes:Object.fromEntries(func.takes.map(p=>[p.trait,mid(p)])),
      gives:Object.fromEntries(func.gives.map(p=>[p.trait,mid(p)]))});
    setTook({});
    setHanding(true);
  };
  const submit=()=>{
    /* Сдал — не значит принято. Задача уходит на проверку: «Готово» ставит
       тот, кто отчёт принял. Иначе фактом в расчёте стало бы то, что
       исполнитель написал сам о себе.

       Кроме случая, когда исполнитель и проверяющий — один человек: тогда
       принимать не у кого, и задача уходит в готовые сразу. */
    upMany({submissions:[...subs,newSubmission({hours,takes:qty.takes,gives:qty.gives,
      took,text:draftText,file:draftFile})],status:selfReview(task)?"done":"review"});
    setHanding(false); setDraftText(""); setDraftFile(null); setFileErr("");
    setTook({});
  };

  const QtyRow=({kind,port})=>{
    /* У входа спрашиваем не только сколько, но и ЧТО: если у ресурса есть
       единицы с номерами, исполнитель отмечает те, которые взял. Без этого
       потом не ответить, что выросло вот из этого задания. */
    const own=kind==="takes"
      ?unitsOf({tasks:tasksAll,funcs}).filter(u=>u.trait===port.trait).reverse():[];
    const on=(id)=>(took[port.trait]||[]).includes(id);
    const flip=(id)=>setTook(p=>{
      const was=p[port.trait]||[];
      return {...p,[port.trait]:was.includes(id)
        ?was.filter(x=>x!==id):[...was,id]};
    });
    return (
      <div style={{marginBottom:6}}>
        <div className="flex flex-wrap gap-2" style={{alignItems:"center"}}>
          <span style={{fontSize:11.5,flex:"1 1 130px"}}>{traitName(port.trait)}</span>
          <span style={{fontSize:10.5,color:WARN}}>план {rangeText(port)}</span>
          <NumField value={qty[kind][port.trait]??0} style={{flex:"0 1 90px"}}
            onCommit={v=>setQty(p=>({...p,[kind]:{...p[kind],[port.trait]:Number(v)||0}}))}/>
        </div>
        {!!own.length&&(
          <div className="flex flex-wrap gap-2" style={{marginTop:4}}>
            {own.slice(0,12).map(u=>(
              <button key={u.id} style={{...btn(on(u.id),on(u.id)?ACC:null),
                fontSize:10.5,padding:"2px 6px"}}
                aria-label={`взял ${traitName(port.trait)} №${u.no}`}
                onClick={()=>flip(u.id)}>
                №{u.no} {u.title||"без названия"}</button>))}
          </div>)}
        {!!own.length&&(
          <div style={{fontSize:10,color:C.muted,marginTop:3,lineHeight:1.4}}>
            отметьте, что именно взяли, — по этому потом видно, что из чего
            выросло
          </div>)}
      </div>);
  };

  return (
    <div style={{...S.card,marginBottom:10,borderColor:ACC}}>
      <div className="flex items-center gap-2" style={{marginBottom:8}}>
        <span style={S.lbl}>задача</span>
        <span style={{flex:1}}/>
        {onClose&&<button style={btn(false)} onClick={()=>onClose()}>✕</button>}
      </div>

      <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>{task.title}</div>
      <div style={{fontSize:10.5,color:C.muted,lineHeight:1.6,marginBottom:8}}>
        поставил: {who(task.setter)} · проверяет: {who(task.reviewer)}
        {task.end?` · срок ${fmtDT(task.end)}`:" · срок не назначен"}
      </div>

      {/* Содержимое — слова постановщика ОБ ЭТОМ выполнении. Здесь они
          только читаются. Пусто — это не поломка: что это за работа,
          сказано описанием функции ниже, и добавлять к нему нечего. */}
      {!!String(task.body||"").trim()&&(<>
        <div style={S.lbl}>что нужно сделать</div>
        <div style={{background:C.panel2,border:`1px solid ${C.line}`,borderRadius:8,
          padding:9,margin:"5px 0 8px",fontSize:12,lineHeight:1.6,
          whiteSpace:"pre-wrap"}}>
          {task.body}
        </div></>)}

      <div style={S.lbl}>функция, которую выполняет задача</div>
      <FuncCard func={func} entities={entities} traitName={traitName}/>

      <div style={S.lbl}>сдача — что вышло на самом деле</div>
      <div style={{background:C.panel2,border:`1px solid ${C.line}`,borderRadius:8,
        padding:9,margin:"6px 0 8px"}}>
        {!subs.length&&<div style={{fontSize:11.5,color:C.muted,marginBottom:8}}>
          Ещё не сдавалась. «Сдать» запишет, сколько времени ушло и сколько
          ресурса реально взяли и выдали, — из принятых сдач считается среднее
          арифметическое, и оно уточняет прогноз.</div>}
        {subs.map(sb=>(
          <div key={sb.id} style={{background:C.ink,border:`1px solid ${C.line}`,
            borderRadius:6,padding:7,marginBottom:6}}>
            <div className="flex items-center gap-2">
              <span style={{fontSize:12,fontWeight:600,color:OK,flex:1}}>
                {nm(sb.hours)} ч</span>
              <span style={{fontSize:10,color:C.muted}}>{fmtDT(sb.at)}</span>
              <button style={{...btn(false),padding:"2px 6px"}}
                aria-label="убрать сдачу"
                onClick={()=>up("submissions",subs.filter(x=>x.id!==sb.id))}>✕</button>
            </div>
            <div style={{fontSize:10.5,color:C.muted,marginTop:3,lineHeight:1.5}}>
              взято: {Object.entries(sb.takes||{}).map(([id,v])=>{
                const nos=(sb.took?.[id]||[])
                  .map(uid2=>unitNo[uid2]).filter(Boolean);
                return `${traitName(id)} ${nm(v)}`
                  +(nos.length?` (№${nos.join(", №")})`:"");
              }).join(", ")||"—"}
              {" · выдано: "}
              {Object.entries(sb.gives||{}).map(([id,v])=>
                `${traitName(id)} ${nm(v)}`
                +(unitNo[`${sb.id}~${id}`]?` №${unitNo[`${sb.id}~${id}`]}`:""))
                .join(", ")||"—"}
            </div>
            {sb.text&&<div style={{fontSize:11.5,marginTop:4,lineHeight:1.5}}>{sb.text}</div>}
            {sb.file&&<div style={{fontSize:10.5,color:ACC,marginTop:4}}>
              📎 {sb.file.name} · {Math.round((sb.file.size||0)/1024)} КБ</div>}
          </div>))}

        {!handing
          ? <div className="flex flex-wrap gap-2">
              <button style={btn(true,OK)} disabled={!func} onClick={startHanding}>
                СДАТЬ</button>
              {!func&&<span style={{fontSize:10.5,color:C.muted}}>
                задача не привязана к функции — сдавать нечего</span>}
            </div>
          : <div>
              <div className="flex flex-wrap gap-2"
                style={{alignItems:"center",marginBottom:8}}>
                <span style={{fontSize:11.5,color:C.muted}}>ушло времени</span>
                <NumField value={hours} style={{flex:"0 1 90px"}}
                  onCommit={v=>setHours(Number(v)||0)}/>
                <span style={{fontSize:11.5,color:C.muted}}>ч</span>
                <span style={{fontSize:10.5,color:WARN}}>
                  план {nm(func.dur)} {func.durUnit} = {nm(hoursOf(func))} ч</span>
              </div>
              {!!func.takes.length&&<>
                <div style={S.lbl}>сколько взяли</div>
                <div style={{margin:"5px 0 8px"}}>
                  {func.takes.map(p=>(<QtyRow key={p.id} kind="takes" port={p}/>))}
                </div></>}
              {!!func.gives.length&&<>
                <div style={S.lbl}>сколько выдали</div>
                <div style={{margin:"5px 0 8px"}}>
                  {func.gives.map(p=>(<QtyRow key={p.id} kind="gives" port={p}/>))}
                </div></>}
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

      {/* Комментарии — единственное, что исполнитель здесь пишет помимо
          сдачи: спросить, уточнить, сказать, что мешает. */}
      <div style={S.lbl}>комментарии</div>
      <Comments task={task} onAdd={(text)=>up("comments",
        [...(task.comments||[]),{id:uid("c"),text,at:new Date().toISOString()}])}
        onDrop={(id)=>up("comments",(task.comments||[]).filter(c=>c.id!==id))}/>
    </div>);
}

function Comments({task,onAdd,onDrop}){
  const [text,setText]=useState("");
  const list=task.comments||[];
  return (
    <div style={{margin:"6px 0"}}>
      {!list.length&&<div style={{fontSize:11.5,color:C.muted}}>Пока нет.</div>}
      {list.map(c=>(
        <div key={c.id} style={{background:C.panel2,border:`1px solid ${C.line}`,
          borderRadius:6,padding:7,marginBottom:5}}>
          <div style={{fontSize:12,lineHeight:1.5}}>{c.text}</div>
          <div className="flex items-center gap-2" style={{marginTop:3}}>
            <span style={{fontSize:10,color:C.muted,flex:1}}>{fmtDT(c.at)}</span>
            <button style={{...btn(false),padding:"2px 6px"}}
              aria-label="убрать комментарий" onClick={()=>onDrop(c.id)}>✕</button>
          </div>
        </div>))}
      <div className="flex gap-2" style={{marginTop:6}}>
        <TxtField value={text} placeholder="написать комментарий" onCommit={setText}/>
        <button style={btn(false)} onClick={()=>{ if(text.trim()){onAdd(text.trim());
          setText("");} }}>Добавить</button>
      </div>
    </div>);
}

/* ─────── доска ───────
   Слева — функции модели: под каждой заводятся её выполнения. Справа —
   канбан по статусам. Так видно и то, что делается, и то, ЧТО именно из
   модели этим уточняется. */
export default function TasksBoard({funcs=[],entities=[],traits=[],tasks,setTasks,
  openId,setOpenId,nameOf,onTake}){
  const shown=tasks.filter(t=>t.status!=="wait");
  const open=shown.find(t=>t.id===openId)||null;
  /* Двигать задачи по доске нельзя, и стрелок здесь нет. У исполнителя два
     действия, и оба про работу: взять в работу и сдать. Всё остальное —
     следствие, а не выбор: срок прошёл — «Дедлайн», сдал — «Проверка»,
     приняли — «Готово». Стрелка «переложить» предлагала бы объявить
     работу сделанной, ничего не сделав.

     Непоставленных задач тут нет вовсе: они ждут постановщика во вкладке
     «Проверка», и на доске исполнителя им нечего делать. */
  const take=(t)=>{
    setTasks(p=>p.map(x=>x.id===t.id?{...x,taken:true,
      status:overdue(x)?"deadline":"progress"}:x));
    /* Взятая работа должна пережить закрытие окна. Модель целиком пишет
       владелец, поэтому у исполнителя для этого своя операция на сервере —
       иначе нажатие жило бы только здесь и пропадало при следующей
       загрузке. */
    onTake?.(t);
  };
  // Сдача — не кнопка на карточке, а форма: сколько часов ушло и сколько
  // ресурса взяли и выдали. Поэтому «Сдать» открывает задачу.
  const hand=(t)=>setOpenId(t.id);
  const late=(t)=>overdue(t);
  return (
    <div>
      <div style={{...S.card,marginBottom:10}}>
        <div style={S.lbl}>задачи — то, что поручено</div>
        <div style={{fontSize:11.5,color:C.muted,marginTop:6,lineHeight:1.6}}>
          Задачи заводятся из применённых целей и ставятся во вкладке
          «Проверка»: работа, не следующая ни из какой цели, — это работа, о
          которой никто не спросил, зачем она. Здесь её делают: берут,
          сдают и спрашивают в комментариях.
        </div>
      </div>

      {open&&(
        <TaskView task={open} tasks={tasks} funcs={funcs} traits={traits}
          entities={entities}
          nameOf={nameOf} setTasks={setTasks} onClose={()=>setOpenId(null)}/>)}

      <div className="flex gap-2" style={{overflowX:"auto",alignItems:"flex-start"}}>
        {BOARD.map(st=>{
          const list=shown.filter(t=>t.status===st.id);
          return (
            <div key={st.id} style={{...S.card,flex:"1 0 190px",minWidth:190}}>
              <div className="flex items-center gap-2" style={{marginBottom:8}}>
                <span style={{width:8,height:8,borderRadius:2,background:st.color}}/>
                <span style={{fontSize:12,fontWeight:700,flex:1}}>{st.name}</span>
                <span style={{fontSize:10.5,color:C.muted}}>{list.length}</span>
              </div>
              {!list.length&&<div style={{fontSize:11,color:C.muted}}>пусто</div>}
              {list.map(t=>{
                const f=funcs.find(x=>x.id===t.funcId);
                return (
                  <div key={t.id} style={{background:C.panel2,
                    border:`1px solid ${t.id===openId?ACC:C.line}`,borderRadius:8,
                    padding:8,marginBottom:6,cursor:"pointer"}}
                    onClick={()=>setOpenId(t.id===openId?null:t.id)}>
                    <div style={{fontSize:12,fontWeight:600,lineHeight:1.4}}>{t.title}</div>
                    <div style={{fontSize:10.5,color:C.muted,marginTop:3,lineHeight:1.5}}>
                      {funcLabel(f,entities)}
                    </div>
                    {t.end&&<div style={{fontSize:10.5,marginTop:3,
                      color:late(t)?BAD:C.muted}}>
                      {late(t)?"просрочено · ":"до "}{fmtDT(t.end)}</div>}
                    {t.assignee!=null&&<div style={{fontSize:10.5,color:ACC,marginTop:3}}>
                      {nameOf?nameOf(t.assignee):t.assignee}</div>}
                    {/* Ровно одно действие на карточке — то, которое сейчас
                        и есть работа. Ни «назад», ни «дальше»: колонка
                        говорит, что с задачей, а не куда её положить. */}
                    <div className="flex gap-2" style={{marginTop:6}}>
                      {!isTaken(t)&&(t.status==="backlog"||t.status==="deadline")&&(
                        <button style={{...btn(true,ACC),padding:"3px 9px",fontSize:11}}
                          onClick={e=>{e.stopPropagation();take(t);}}>
                          Взять в работу</button>)}
                      {isTaken(t)&&(t.status==="progress"||t.status==="deadline")&&(
                        <button style={{...btn(true,OK),padding:"3px 9px",fontSize:11}}
                          onClick={e=>{e.stopPropagation();hand(t);}}>
                          Сдать</button>)}
                      {t.status==="review"&&(
                        <span style={{fontSize:10.5,color:C.muted}}>
                          ждёт проверяющего</span>)}
                      {t.status==="done"&&(
                        <span style={{fontSize:10.5,color:OK}}>принято</span>)}
                    </div>
                  </div>);
              })}
            </div>);
        })}
      </div>
    </div>);
}
