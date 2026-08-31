import React, { useState, useEffect, useMemo } from "react";
import { detectStorage, STORAGE_LABEL, listScenarios, getScenario, saveScenario,
  deleteScenario } from "../storage.js";

/* ════════════════════════════════════════════════════════════════
   СХЕМА ЖИЗНЕСПОСОБНОСТИ · v8
   Поля с локальным черновиком: значение уходит в модель по расфокусу
   или по Enter, поэтому пересчёт не дёргает ввод.
   ════════════════════════════════════════════════════════════════ */

const C={ink:"#0E1420",panel:"#161F2E",panel2:"#1D2839",line:"#2A3852",
  text:"#E6EDF7",muted:"#8FA0BC"};
const OK="#3DDC97",WARN="#FFB13D",BAD="#FF5C7A",NEU="#5A6B85",ACC="#7CE0FF";

const KIND={
  growth:{sign:"↑",name:"рост",color:"#3DDC97",dir:"up"},
  res:{sign:"◆",name:"производимый ресурс",color:"#4EA8FF",dir:"up"},
  cost:{sign:"−",name:"затраты",color:"#FFB13D",dir:"down"},
  destroy:{sign:"↓",name:"разрушение",color:"#FF5C7A",dir:"down"},
  repro:{sign:"∞",name:"воспроизводимость",color:"#C792EA",dir:"up"},
  payback:{sign:"₽",name:"окупаемость",color:"#FFD166",dir:"up"},
};
const KO=["growth","res","cost","destroy","repro","payback"];
const PER={"час":730,"день":30,"нед":4.33,"мес":1,"квартал":1/3,"год":1/12};
const NW=208,NH=112;

const nm=(n)=>!isFinite(n)?"—":
  (Math.abs(n)>=100?Math.round(n):Math.round(n*100)/100).toLocaleString("ru-RU");
const isFlow=(t)=>t.flow!=null?!!t.flow:/\//.test(t.unit||"");

const S={
  inp:{background:C.ink,border:`1px solid ${C.line}`,color:C.text,borderRadius:5,
    padding:"7px 8px",fontSize:13,width:"100%",fontFamily:"Inter, system-ui, sans-serif"},
  lbl:{color:C.muted,fontSize:10,letterSpacing:"0.09em",textTransform:"uppercase",
    fontFamily:"ui-monospace, Menlo, monospace"},
  card:{background:C.panel,border:`1px solid ${C.line}`,borderRadius:10,padding:12},
};
const btn=(on,col)=>({background:on?(col||ACC)+"22":C.panel2,
  border:`1px solid ${on?(col||ACC):C.line}`,color:on?(col||ACC):C.muted,borderRadius:6,
  padding:"6px 10px",fontSize:12,cursor:"pointer",whiteSpace:"nowrap"});

/* ─────── ПОЛЯ С ЧЕРНОВИКОМ ─────── */
function NumField({value,onCommit,placeholder,style}){
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
function TxtField({value,onCommit,placeholder,style,area}){
  const [d,setD]=useState(value??"");
  const [f,setF]=useState(false);
  useEffect(()=>{ if(!f) setD(value??""); },[value,f]);
  const p={value:d,placeholder,style:{...S.inp,...style},onFocus:()=>setF(true),
    onChange:e=>setD(e.target.value),onBlur:()=>{setF(false);onCommit(d);}};
  return area ? <textarea {...p}/> : <input {...p}/>;
}

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
const TRAITS0=[
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
];
// условие: {trait, mode, amt}. mode "min" — «не меньше»: чем больше показатель
// относительно порога, тем сильнее эффект (линейно, без потолка). mode "max" —
// «не больше»: пока показатель не выше порога, эффект полный; выше — насыщение,
// эффект слабеет обратно пропорционально (модель 7 млрд пользователей из примера).
const Cond=(trait,mode,amt)=>({trait,mode,amt});
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

// множитель одного условия: min — линейно растёт с показателем (без потолка),
// max — насыщение: пока показатель не выше порога множитель = 1, выше — падает
// обратно пропорционально (чем сильнее превышен потолок, тем слабее эффект)
function condK(c,valueOf){
  const amt=Number(c.amt)||0;
  if(!c.trait||amt<=0) return 1;
  const v=valueOf(c.trait)??0;
  if(c.mode==="max") return v>amt?amt/v:1;
  return v/amt;
}
// общий множитель стрелки — произведение множителей всех её условий
// (если условий несколько, каждое ограничивает независимо)
function edgeK(ed,valueOf){
  if(!ed.conds||!ed.conds.length) return 1;
  return ed.conds.reduce((acc,c)=>acc*condK(c,valueOf),1);
}
/* ─────── СИМУЛЯЦИЯ ─────── */
function simulate(traits,edges,months,seedMod,giveMod){
  const seed=(t)=>Number((seedMod&&seedMod[t.id]!=null)?seedMod[t.id]:(t.have??0));
  const st={},series={};
  traits.forEach(t=>{st[t.id]=isFlow(t)?0:seed(t);series[t.id]=[];});
  for(let m=0;m<=months;m++){
    const rate={};traits.forEach(t=>rate[t.id]=0);
    for(const ed of edges){
      if(rate[ed.to]===undefined) continue;
      const g=Number((giveMod&&giveMod[ed.id]!=null)?giveMod[ed.id]:ed.gives)||0;
      // линейная пропорция по каждому условию: если 1 в месяц даёт 1, то 5 дают 5,
      // без потолка в 100% (для условий-«не меньше»)
      const k=edgeK(ed,tid=>st[tid]);
      rate[ed.to]+=Number(ed.sign)*g*(PER[ed.per]??1)*k;
    }
    traits.forEach(t=>{
      if(isFlow(t)) st[t.id]=Math.max(0,seed(t)+rate[t.id]);
      series[t.id].push(st[t.id]);
    });
    traits.forEach(t=>{if(!isFlow(t)) st[t.id]=Math.max(0,st[t.id]+rate[t.id]);});
  }
  return series;
}
const reachMonth=(s,w)=>{for(let i=0;i<(s?.length||0);i++) if(s[i]+1e-9>=w) return i; return null;};

// гипотеза/факт — свойство самой стрелки: «10 реферов приведут 10 пользователей»
// это гипотеза (поведенческое допущение), а «10% от 100 тысяч — это 10 тысяч» — факт
// (точный расчёт). Поэтому считаем модель дважды: по всем стрелкам (гипотетический
// прогноз, оптимистичный) и только по стрелкам-фактам (гарантированный прогноз).
const isFact=(e)=>e.basis==="fact";
const factEdges=(edges)=>edges.filter(isFact);
const frac=(v,w)=>(w?Math.max(0,Number(v)/Number(w)):null);
const depsOf=(edges,tid)=>{
  const seen=new Set(),arr=new Set();
  const go=(id,d)=>{if(seen.has(id)||d>6)return;seen.add(id);
    edges.filter(e=>e.to===id).forEach(ed=>{arr.add(ed.id);
      (ed.conds||[]).forEach(c=>{if(c.trait) go(c.trait,d+1);});});};
  go(tid,0);return{traits:[...seen],edges:[...arr]};
};
function adviseFor(traits,edges,g,span){
  const by=g.by??span,want=Number(g.want);
  const base=simulate(traits,edges,Math.max(span,by));
  const now=reachMonth(base[g.id],want);
  if(now!=null&&now<=by) return {now,recs:[]};
  const d=depsOf(edges,g.id),recs=[];
  const test=(sm,gm)=>reachMonth(simulate(traits,edges,by,sm,gm)[g.id],want);
  const search=(mk,cur)=>{
    let hi=Math.max(1,cur||1,Math.abs(Number(g.want))||1);
    for(let i=0;i<40&&test(...mk(hi))==null;i++) hi*=2;
    if(test(...mk(hi))==null) return null;
    let lo=cur||0;
    for(let i=0;i<16;i++){const mid=(lo+hi)/2;test(...mk(mid))!=null?hi=mid:lo=mid;}
    return hi;
  };
  d.traits.forEach(tid=>{
    const t=traits.find(x=>x.id===tid); if(!t||isFlow(t)) return;
    const cur=Number(t.have??0),v=search(x=>[{[tid]:x},null],cur);
    if(v!=null&&v>cur+1e-6) recs.push({type:"seed",tid,from:cur,to:v,
      month:test({[tid]:v},null),label:t.l,unit:t.unit,e:t.e});
  });
  d.edges.forEach(eid=>{
    const ed=edges.find(x=>x.id===eid); if(!ed) return;
    const cur=Number(ed.gives)||0,v=search(x=>[null,{[eid]:x}],cur);
    if(v!=null&&v>cur*1.001) recs.push({type:"edge",eid,from:cur,to:v,
      month:test(null,{[eid]:v}),label:ed.carrier,unit:traits.find(t=>t.id===ed.to)?.unit,
      per:ed.per,e:ed.from});
  });
  recs.sort((a,b)=>(a.month??99)-(b.month??99));
  return {now,recs:recs.slice(0,6)};
}

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

/* ─────── СТРОКА СТРЕЛКИ ─────── */
function ArrowRow({ed,traits,entities,live,onEdit,onDelete}){
  const t=traits.find(x=>x.id===ed.to); if(!t) return null;
  const en=(id)=>entities.find(e=>e.id===id);
  const conds=ed.conds||[];
  const k=edgeK(ed,tid=>live[tid]??0);
  const fact=isFact(ed);
  const setConds=(next)=>onEdit(ed.id,"conds",next);
  const updCond=(i,f,v)=>setConds(conds.map((c,ci)=>ci===i?{...c,[f]:v}:c));
  const delCond=(i)=>setConds(conds.filter((_,ci)=>ci!==i));
  const addCond=()=>setConds([...conds,{trait:"",mode:"min",amt:0}]);
  return (
    <div style={{background:C.panel2,
      border:`1px solid ${k>0?(fact?OK+"55":WARN+"55"):BAD+"55"}`,borderRadius:8,
      padding:10,marginBottom:8}}>
      <div className="flex items-center gap-2" style={{fontSize:12.5,marginBottom:8}}>
        <span style={{color:en(ed.from)?.color,fontWeight:600}}>{en(ed.from)?.name}</span>
        <span style={{color:C.muted}}>→</span>
        <span style={{color:KIND[t.k].color}}>{KIND[t.k].sign}</span>
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
      <div style={{marginBottom:7}}><div style={S.lbl}>что передаёт (движение ресурса)</div>
        <TxtField value={ed.carrier} placeholder="носитель"
          onCommit={v=>onEdit(ed.id,"carrier",v)}/></div>

      <div style={S.lbl}>условия перетекания</div>
      <div style={{margin:"5px 0 7px"}}>
        {conds.map((c,i)=>{
          const ct=traits.find(x=>x.id===c.trait);
          const kk=condK(c,tid=>live[tid]??0);
          return (
          <div key={i} style={{background:C.ink,border:`1px solid ${C.line}`,borderRadius:6,
            padding:7,marginBottom:6}}>
            <div className="flex flex-wrap gap-2" style={{alignItems:"center"}}>
              <select style={{...S.inp,flex:"2 1 150px"}} value={c.trait}
                onChange={e=>updCond(i,"trait",e.target.value)}>
                <option value="">— выбери ресурс —</option>
                {entities.map(en2=>(
                  <optgroup key={en2.id} label={en2.name}>
                    {traits.filter(x=>x.e===en2.id).map(x=>(
                      <option key={x.id} value={x.id}>{KIND[x.k].sign} {x.l}</option>))}
                  </optgroup>))}
              </select>
              <select style={{...S.inp,flex:"1 1 108px"}} value={c.mode}
                onChange={e=>updCond(i,"mode",e.target.value)}>
                <option value="min">не меньше</option>
                <option value="max">не больше</option>
              </select>
              <NumField value={c.amt} style={{flex:"0 1 76px"}}
                onCommit={v=>updCond(i,"amt",v??0)}/>
              <button onClick={()=>delCond(i)} style={{...btn(false),padding:"3px 7px"}}>✕</button>
            </div>
            {ct&&<div style={{fontSize:10.5,color:C.muted,marginTop:4}}>
              {c.mode==="min"
                ?`чем больше «${ct.l}» относительно порога, тем сильнее эффект (сейчас ${nm(live[ct.id]??0)}, это ${Math.round(kk*100)}%)`
                :`пока «${ct.l}» не выше порога — эффект полный; выше — насыщение (сейчас ${nm(live[ct.id]??0)}, эффект ${Math.round(kk*100)}%)`}
            </div>}
          </div>);})}
        <button style={btn(false)} onClick={addCond}>+ добавить условие</button>
      </div>

      <div className="flex flex-wrap gap-2" style={{marginBottom:7,alignItems:"center"}}>
        <span style={{fontSize:12,color:C.muted}}>даёт</span>
        <NumField value={ed.gives} style={{flex:"0 1 84px"}}
          onCommit={v=>onEdit(ed.id,"gives",v??0)}/>
        <span style={{fontSize:12,color:C.muted}}>{t.unit} за</span>
        <select style={{...S.inp,flex:"0 1 96px"}} value={ed.per}
          onChange={e=>onEdit(ed.id,"per",e.target.value)}>
          {Object.keys(PER).map(p=><option key={p} value={p}>{p}</option>)}</select>
        <button onClick={()=>onEdit(ed.id,"sign",ed.sign>0?-1:1)}
          style={btn(true,ed.sign>0?OK:BAD)}>{ed.sign>0?"катализирует":"купирует"}</button>
      </div>
      <div style={{fontSize:11.5,color:k>=1?OK:k>0?WARN:BAD,lineHeight:1.5,marginBottom:7}}>
        {!conds.length?`Без условий: ${nm(ed.gives)} ${t.unit} за ${ed.per}.`
          :`Все условия вместе дают множитель ${Math.round(k*100)}% — значит сейчас передаётся ${nm(ed.gives*k)} ${t.unit} за ${ed.per}.`}
      </div>
      <div><div style={S.lbl}>пояснение</div>
        <TxtField area value={ed.note} style={{minHeight:46,lineHeight:1.5}}
          onCommit={v=>onEdit(ed.id,"note",v)}/></div>
    </div>);
}

/* ─────── СХЕМА (переиспользуемая для «сейчас» и для снимка симуляции) ─────── */
function SchemeSVG({entities,traits,edges,groups,zoom,sel,pair,valuesFor,valuesForFact,
  onSelectEntity,onSelectPair}){
  const anchor=(a,b)=>{const ax=a.x+NW/2,ay=a.y+NH/2,bx=b.x+NW/2,by=b.y+NH/2;
    const dx=bx-ax,dy=by-ay;
    const s=Math.min(dx===0?1e9:NW/2/Math.abs(dx),dy===0?1e9:NH/2/Math.abs(dy));
    return [ax+dx*s,ay+dy*s];};
  const ent=(id)=>entities.find(e=>e.id===id);
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
  return (
    <div style={{overflow:"auto",WebkitOverflowScrolling:"touch"}}>
      <svg viewBox="0 0 1000 740" width={1000*zoom} height={740*zoom} style={{display:"block"}}>
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
        {entities.map(e=>{
          const ts=traits.filter(t=>t.e===e.id);
          const gs=ts.filter(t=>t.want!=null).length;
          const gv=gaugeFor(e.id);
          return (<g key={e.id} onClick={()=>onSelectEntity(e.id)} style={{cursor:"pointer"}}>
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

/* ════════════════ ГЛАВНОЕ ════════════════ */
export default function SystemModel(){
  const [entities,setEntities]=useState(ENTITIES0);
  const [traits,setTraits]=useState(TRAITS0);
  const [edges,setEdges]=useState(EDGES0);
  const [tab,setTab]=useState("goals");
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
  const [simRun,setSimRun]=useState(null); // {base, baseFact, span} — снимок после запуска
  const [simMonth,setSimMonth]=useState(0); // текущий месяц на ползунке времени

  const ent=(id)=>entities.find(e=>e.id===id);
  const trait=(id)=>traits.find(t=>t.id===id);
  const into=(tid)=>edges.filter(e=>e.to===tid);
  const upE=(id,f,v)=>setEntities(p=>p.map(e=>e.id===id?{...e,[f]:v}:e));
  const upT=(id,f,v)=>setTraits(p=>p.map(t=>t.id===id?{...t,[f]:v}:t));
  const upA=(id,f,v)=>setEdges(p=>p.map(e=>e.id===id?{...e,[f]:v}:e));
  const delA=(id)=>setEdges(p=>p.filter(e=>e.id!==id));

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
      const saved=await saveScenario({id:isUpdate?savedSel:null,name:saveName,
        data:{entities,traits,edges}});
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
      if(s.data?.entities) setEntities(s.data.entities);
      if(s.data?.traits) setTraits(s.data.traits);
      if(s.data?.edges) setEdges(s.data.edges);
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
  const baseFact=useMemo(()=>simulate(traits,factEdges(edges),span),[traits,edges,span]);
  const liveFact=useMemo(()=>{const o={};traits.forEach(t=>o[t.id]=baseFact[t.id]?.[0]??0);
    return o;},[baseFact,traits]);
  const advice=useMemo(()=>goals.map(g=>({g,...adviseFor(traits,edges,g,span)})),
    [traits,edges,span,goals.length]);

  const groups=useMemo(()=>{const g={};
    edges.forEach(ed=>{const t=traits.find(x=>x.id===ed.to);if(!t)return;
      const k=ed.from+"|"+t.e;(g[k]=g[k]||{from:ed.from,to:t.e,list:[]}).list.push(ed);});
    return Object.entries(g).map(([k,v])=>({key:k,...v}));},[edges,traits]);

  const selE=ent(sel),selT=selTrait?trait(selTrait):null;
  const pairG=pair?groups.find(g=>g.key===pair):null;

  const runSim=()=>{
    const seedMod={};
    simOv.forEach(o=>{if(o.trait) seedMod[o.trait]=Number(o.val)||0;});
    setSimRun({
      base:simulate(traits,edges,simSpan,seedMod),
      baseFact:simulate(traits,factEdges(edges),simSpan,seedMod),
      span:simSpan,
    });
    setSimMonth(0);
  };

  return (
    <div style={{background:C.ink,color:C.text,minHeight:"100%",padding:12,
      fontFamily:"Inter, 'Segoe UI', system-ui, sans-serif"}}>
      <div className="flex items-start justify-between gap-3" style={{marginBottom:10}}>
        <div><div style={S.lbl}>жизнеспособность · v8</div>
          <div style={{fontSize:19,fontWeight:700}}>Активы и движение ресурсов</div></div>
        <div className="flex items-center gap-2">
          <span style={S.lbl}>горизонт</span>
          <NumField value={horizon} style={{width:58}}
            onCommit={v=>setHorizon(Math.max(3,Math.min(120,v||24)))}/>
          <span style={{fontSize:11,color:C.muted}}>мес</span></div>
      </div>

      <div className="flex gap-2" style={{marginBottom:10,overflowX:"auto"}}>
        {[["goals","Цели"],["scheme","Схема"],["sim","Симуляция"],["json","JSON"]].map(([k,t])=>(
          <button key={k} style={btn(tab===k)} onClick={()=>setTab(k)}>{t}</button>))}
      </div>

      {/* ═══ ЦЕЛИ ═══ */}
      {tab==="goals" && (<div>
        <div style={{...S.card,marginBottom:10}}>
          <div style={S.lbl}>поставить цель</div>
          <div className="flex flex-wrap gap-2" style={{marginTop:6}}>
            <select style={{...S.inp,flex:"2 1 200px"}} value={newGoal}
              onChange={e=>setNewGoal(e.target.value)}>
              <option value="">— выбери ресурс —</option>
              {entities.map(en=>(
                <optgroup key={en.id} label={en.name}>
                  {traits.filter(t=>t.e===en.id&&t.want==null).map(t=>(
                    <option key={t.id} value={t.id}>{KIND[t.k].sign} {t.l}</option>))}
                </optgroup>))}
            </select>
            <button style={btn(true)} disabled={!newGoal} onClick={()=>{
              if(!newGoal) return;
              const t=trait(newGoal);
              upT(newGoal,"want",1); upT(newGoal,"by",horizon);
              setNewGoal(""); }}>Добавить</button>
          </div>
          <div style={{fontSize:11.5,color:C.muted,marginTop:6}}>
            Цель добавится со значением 1 — впиши нужное число прямо в карточке ниже.
          </div>
        </div>

        {!goals.length && <div style={S.card}>Целей пока нет.</div>}

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
            name:trait(id)?.l,data:base[id]||[]}));
          return (
            <div key={g.id} style={{...S.card,marginBottom:12}}>
              <div className="flex items-center gap-2" style={{marginBottom:4}}>
                <span style={{color:KIND[g.k].color,fontFamily:"ui-monospace, monospace",
                  fontWeight:700}}>{KIND[g.k].sign}</span>
                <span style={{fontSize:14,fontWeight:700,flex:1}}>{g.l}</span>
                <button style={{...btn(false),color:BAD,borderColor:"#5A2436"}}
                  onClick={()=>{upT(g.id,"want",null);upT(g.id,"by",null);}}>убрать</button>
              </div>
              <div style={{fontSize:11.5,color:C.muted,marginBottom:8}}>
                {ent(g.e)?.name} · {g.unit} · {isFlow(g)?"поток":"запас"}</div>

              <div className="flex flex-wrap gap-2" style={{marginBottom:10}}>
                <div style={{flex:"1 1 80px"}}><div style={S.lbl}>нужно</div>
                  <NumField value={g.want} onCommit={v=>upT(g.id,"want",v)}/></div>
                <div style={{flex:"1 1 80px"}}><div style={S.lbl}>к месяцу</div>
                  <NumField value={g.by} placeholder={String(span)}
                    onCommit={v=>upT(g.id,"by",v)}/></div>
                <div style={{flex:"1 1 100px"}}>
                  <div style={S.lbl}>гипотетически (все стрелки)</div>
                  <div style={{...S.inp,color:hCol,borderColor:hCol,
                    background:C.panel2,display:"flex",alignItems:"center"}}
                    title="Прогноз с учётом поведенческих допущений">{nm(hv)}</div>
                </div>
                <div style={{flex:"1 1 100px"}}>
                  <div style={S.lbl}>фактически (только факты)</div>
                  <div style={{...S.inp,color:fCol,borderColor:fCol,
                    background:C.panel2,display:"flex",alignItems:"center"}}
                    title="Прогноз только по стрелкам-фактам">{nm(fv)}</div>
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
                <Chart lines={lines} months={span} goalLine={Number(g.want)} goalMonth={now}/>
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
                  const good=dir==="flat"?null:dir===KIND[t.k].dir;
                  const col=dir==="flat"?C.muted:(good?OK:BAD);
                  const arrow=dir==="up"?"↑":dir==="down"?"↓":"→";
                  const pct=Math.abs(start)>1e-9?(delta/Math.abs(start)*100):(end!==0?100:0);
                  return (
                    <div key={tid} className="flex items-center gap-2" style={{fontSize:12,
                      padding:"5px 2px",borderBottom:`1px solid ${C.line}`}}>
                      <span style={{color:KIND[t.k].color,fontFamily:"ui-monospace, monospace"}}>
                        {KIND[t.k].sign}</span>
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
                          ?<>Завести руками <b>{nm(r.to)} {r.unit}</b> — «{r.label}»
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
                      <button style={{...btn(false),marginTop:6,color:OK,borderColor:OK+"66"}}
                        onClick={()=>r.type==="seed"
                          ?upT(r.tid,"have",Math.round(r.to*100)/100)
                          :upA(r.eid,"gives",Math.round(r.to*100)/100)}>применить</button>
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
            </div>);})}
      </div>)}

      {/* ═══ СХЕМА ═══ */}
      {tab==="scheme" && (<>
        <div style={{...S.card,padding:6,marginBottom:10}}>
          <div className="flex items-center gap-2" style={{marginBottom:4}}>
            <span style={S.lbl}>масштаб</span>
            <button style={btn(false)} onClick={()=>setZoom(z=>Math.max(.32,z-.12))}>−</button>
            <button style={btn(false)} onClick={()=>setZoom(z=>Math.min(1.6,z+.12))}>+</button>
            <span style={{fontSize:11,color:C.muted}}>тап по блоку или по стрелке</span>
          </div>
          <div style={{overflow:"auto",WebkitOverflowScrolling:"touch"}}>
            <SchemeSVG entities={entities} traits={traits} edges={edges} groups={groups}
              zoom={zoom} sel={sel} pair={pair}
              valuesFor={tid=>live[tid]??0} valuesForFact={tid=>liveFact[tid]??0}
              onSelectEntity={id=>{setSel(id);setSelTrait(null);setPair(null);}}
              onSelectPair={key=>{setPair(key);setSelTrait(null);}}/>
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
              <ArrowRow key={ed.id} ed={ed} traits={traits} entities={entities} live={live}
                onEdit={upA} onDelete={delA}/>))}
          </div>)}

        {selE && (
          <div style={{...S.card,marginBottom:10}}>
            <div className="flex items-center gap-2" style={{marginBottom:10}}>
              <span style={{width:9,height:9,borderRadius:2,background:selE.color}}/>
              <TxtField value={selE.name} style={{fontWeight:700,fontSize:14}}
                onCommit={v=>upE(selE.id,"name",v)}/></div>
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
                    <span style={{color:KIND[t.k].color,fontFamily:"ui-monospace, monospace",
                      fontWeight:700}}>{KIND[t.k].sign}</span>
                    <span style={{flex:1}}>{t.l}</span>
                    {t.want!=null&&<span style={{fontSize:9.5,color:ACC,
                      border:`1px solid ${ACC}66`,borderRadius:3,padding:"1px 4px"}}>цель</span>}
                  </div>
                  <div style={{fontSize:11,color:C.muted,marginTop:3}}>
                    {isFlow(t)?"поток":"запас"} · {t.unit}
                    <span style={{color:hCol}}> · гип. {nm(hv)}</span>
                    <span style={{color:fCol}}> · факт {nm(fv)}</span>
                  </div>
                  <div style={{height:5,borderRadius:3,background:C.ink,marginTop:5,
                    overflow:"hidden",position:"relative"}}>
                    <div style={{height:"100%",borderRadius:3,position:"absolute",
                      width:barPct+"%",background:w?WARN:"transparent"}}/>
                    <div style={{height:"100%",borderRadius:3,position:"absolute",
                      width:factPct+"%",background:w?OK:"transparent"}}/>
                  </div>
                  {w!=null&&<div style={{fontSize:9.5,color:C.muted,marginTop:2}}>
                    цель {nm(w)} {t.unit}</div>}
                </div>);})}
            </div>

            {selT&&selT.e===selE.id&&(
              <div style={{background:C.panel2,border:`1px solid ${C.line}`,borderRadius:8,
                padding:10,marginBottom:10}}>
                <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>
                  {KIND[selT.k].sign} {selT.l}</div>
                {(()=>{
                  const w=selT.want!=null?Number(selT.want):null;
                  const hv=live[selT.id]??0, fv=liveFact[selT.id]??0;
                  const hFrac=frac(hv,w), fFrac=frac(fv,w);
                  const hCol=hFrac==null?C.muted:(hFrac>=1?WARN:NEU);
                  const fCol=fFrac==null?C.muted:(fFrac>=1?OK:BAD);
                  return (<>
                <div className="flex flex-wrap gap-2" style={{marginBottom:8}}>
                  <div style={{flex:"1 1 76px"}}><div style={S.lbl}>нужно</div>
                    <NumField value={selT.want} placeholder="нет цели"
                      onCommit={v=>upT(selT.id,"want",v)}/></div>
                  <div style={{flex:"1 1 76px"}}><div style={S.lbl}>к месяцу</div>
                    <NumField value={selT.by} placeholder={String(span)}
                      onCommit={v=>upT(selT.id,"by",v)}/></div>
                  <div style={{flex:"1 1 76px"}}><div style={S.lbl}>есть сейчас (старт)</div>
                    <NumField value={selT.have} placeholder="0"
                      onCommit={v=>upT(selT.id,"have",v)}/></div>
                  <div style={{flex:"1 1 96px"}}><div style={S.lbl}>единица</div>
                    <TxtField value={selT.unit} onCommit={v=>upT(selT.id,"unit",v)}/></div>
                </div>
                <div className="flex flex-wrap gap-2" style={{marginBottom:8}}>
                  <div style={{flex:"1 1 100px"}}>
                    <div style={S.lbl}>гипотетически (все стрелки)</div>
                    <div style={{...S.inp,color:hCol,borderColor:hCol,
                      background:C.panel2,display:"flex",alignItems:"center"}}
                      title="Прогноз с учётом поведенческих допущений">{nm(hv)}</div></div>
                  <div style={{flex:"1 1 100px"}}>
                    <div style={S.lbl}>фактически (только факты)</div>
                    <div style={{...S.inp,color:fCol,borderColor:fCol,
                      background:C.panel2,display:"flex",alignItems:"center"}}
                      title="Прогноз только по стрелкам-фактам — без гипотез">{nm(fv)}</div></div>
                </div>
                <div style={{fontSize:11.5,color:C.muted,marginBottom:10}}>
                  {isFlow(selT)?"Поток: значение равно текущей скорости."
                    :"Запас: копится по месяцам."} Тип берётся из единицы — слэш делает поток.
                  {" "}«Гипотетически» считает по всем стрелкам, включая допущения о
                  поведении (жёлтое — если дотягивает до цели, серое — нет). «Фактически»
                  считает только по стрелкам, помеченным как факт — точным расчётам вроде
                  процента от известной суммы (зелёное — дотягивает, красное — нет).
                </div></>);})()}
                <div className="flex flex-wrap gap-2" style={{marginBottom:10}}>
                  {KO.map(k=>(<button key={k} style={btn(selT.k===k,KIND[k].color)}
                    onClick={()=>upT(selT.id,"k",k)}>{KIND[k].sign} {KIND[k].name}</button>))}
                </div>
                <div style={S.lbl}>что в неё приходит</div>
                <div style={{margin:"6px 0 10px"}}>
                  {!into(selT.id).length&&<div style={{fontSize:12,color:BAD}}>
                    Ни одной стрелки — эту величину никто не производит.</div>}
                  {into(selT.id).map(ed=>(
                    <ArrowRow key={ed.id} ed={ed} traits={traits} entities={entities} live={live}
                      onEdit={upA} onDelete={delA}/>))}
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
                      !(x.conds||[]).some(c=>c.trait===selT.id)));
                    setSelTrait(null);}}>Удалить ресурс</button>
              </div>)}

            <TxtField value={draft} placeholder="текст нового ресурса"
              style={{marginBottom:6}} onCommit={setDraft}/>
            <div className="flex flex-wrap gap-2">
              {KO.map(k=>(<button key={k}
                style={{...btn(false),borderColor:KIND[k].color,color:KIND[k].color}}
                onClick={()=>{if(!draft.trim())return;
                  setTraits(p=>[...p,{id:"t"+Date.now(),e:sel,k,l:draft.trim(),
                    unit:"ед./мес",have:null,want:null,by:null}]);setDraft("");}}>
                + {KIND[k].sign} {KIND[k].name}</button>))}
            </div>
          </div>)}
      </>)}

      {/* ═══ СИМУЛЯЦИЯ ═══ */}
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
                        <option key={x.id} value={x.id}>{KIND[x.k].sign} {x.l}</option>))}
                    </optgroup>))}
                </select>
                <NumField value={o.val} placeholder={t?String(t.have??0):"0"}
                  style={{flex:"0 1 90px"}}
                  onCommit={v=>setSimOv(p=>p.map((x,xi)=>xi===i?{...x,val:v??0}:x))}/>
                {t&&<span style={{fontSize:11,color:C.muted}}>{t.unit}</span>}
                <button style={{...btn(false),padding:"3px 7px"}}
                  onClick={()=>setSimOv(p=>p.filter((_,xi)=>xi!==i))}>✕</button>
              </div>);})}
            <button style={btn(false)} onClick={()=>setSimOv(p=>[...p,{trait:"",val:0}])}>
              + добавить исходное условие</button>
          </div>

          <button style={btn(true,ACC)} onClick={runSim}>▶ запустить симуляцию</button>
          {simRun&&<span style={{fontSize:11.5,color:C.muted,marginLeft:10}}>
            последний прогон: {simRun.span} мес.</span>}
        </div>

        {!simRun&&<div style={S.card}>Настрой срок и, если нужно, стартовые условия —
          затем нажми «запустить симуляцию», чтобы увидеть, что будет происходить со всеми
          ресурсами каждого актива за это время.</div>}

        {simRun&&(<>
          <div style={{...S.card,padding:6,marginBottom:10}}>
            <div className="flex items-center gap-2" style={{marginBottom:8,flexWrap:"wrap"}}>
              <span style={S.lbl}>месяц</span>
              <input type="range" min={0} max={simRun.span} step={1} value={simMonth}
                onChange={e=>setSimMonth(Number(e.target.value))}
                style={{flex:"1 1 160px",accentColor:ACC}}/>
              <span style={{fontSize:13,fontWeight:700,color:ACC,minWidth:64,textAlign:"right"}}>
                {simMonth} / {simRun.span} мес.</span>
              <button style={btn(false)} onClick={()=>setZoom(z=>Math.max(.32,z-.12))}>−</button>
              <button style={btn(false)} onClick={()=>setZoom(z=>Math.min(1.6,z+.12))}>+</button>
            </div>
            <div style={{fontSize:11,color:C.muted,marginBottom:6}}>
              Схема показывает состояние на выбранный месяц прогона — двигай ползунок,
              чтобы посмотреть, как менялись активы во времени.
            </div>
            <SchemeSVG entities={entities} traits={traits} edges={edges} groups={groups}
              zoom={zoom} sel={simEnt} pair={null}
              valuesFor={tid=>simRun.base[tid]?.[simMonth]??0}
              valuesForFact={tid=>simRun.baseFact[tid]?.[simMonth]??0}
              onSelectEntity={id=>setSimEnt(id)} onSelectPair={()=>{}}/>
          </div>

          <div className="flex flex-wrap gap-2" style={{marginBottom:10}}>
            {entities.map(en=>(<button key={en.id}
              style={{...btn(simEnt===en.id),borderColor:en.color,
                color:simEnt===en.id?C.ink:en.color,
                background:simEnt===en.id?en.color:C.panel2}}
              onClick={()=>setSimEnt(en.id)}>{en.name}</button>))}
          </div>
          {entities.filter(en=>en.id===simEnt).map(en=>(
            <div key={en.id}>
              {traits.filter(t=>t.e===en.id).map(t=>{
                const hs=simRun.base[t.id]||[], fs=simRun.baseFact[t.id]||[];
                const hEnd=hs[hs.length-1]??0, fEnd=fs[fs.length-1]??0;
                const lines=[
                  {id:"h",color:WARN,name:"гипотетически",data:hs},
                  {id:"f",color:OK,name:"фактически",data:fs},
                ];
                return (
                  <div key={t.id} style={{...S.card,marginBottom:10}}>
                    <div className="flex items-center gap-2" style={{marginBottom:4}}>
                      <span style={{color:KIND[t.k].color,fontFamily:"ui-monospace, monospace",
                        fontWeight:700}}>{KIND[t.k].sign}</span>
                      <span style={{fontSize:13,fontWeight:700,flex:1}}>{t.l}</span>
                      <span style={{fontSize:11,color:C.muted}}>
                        {isFlow(t)?"поток":"запас"} · {t.unit}</span>
                    </div>
                    <div style={{background:C.panel2,border:`1px solid ${C.line}`,borderRadius:8,
                      padding:8,marginBottom:6}}>
                      <Chart lines={lines} months={simRun.span}
                        goalLine={t.want!=null?Number(t.want):null} cursorMonth={simMonth}/>
                    </div>
                    <div className="flex flex-wrap gap-3" style={{fontSize:11}}>
                      <span style={{color:ACC}}>■ на {simMonth}-м мес.: гип. {nm(hs[simMonth]??0)}
                        {" "}· факт {nm(fs[simMonth]??0)}</span>
                      <span style={{color:WARN}}>■ гипотетически: {nm(hEnd)} к {simRun.span}-му мес.</span>
                      <span style={{color:OK}}>■ фактически: {nm(fEnd)} к {simRun.span}-му мес.</span>
                    </div>
                  </div>);})}
              {!traits.filter(t=>t.e===en.id).length&&
                <div style={S.card}>У этого актива пока нет ресурсов.</div>}
            </div>))}
        </>)}
      </div>)}

      {/* ═══ JSON ═══ */}
      {tab==="json"&&(
        <div style={S.card}>
          <div className="flex flex-wrap gap-2" style={{marginBottom:8}}>
            <button style={btn(true)} onClick={()=>{
              setJson(JSON.stringify({entities,traits,edges},null,2));setJsonMsg("Выгружено.");}}>
              Выгрузить</button>
            <button style={btn(false)} onClick={()=>{try{const d=JSON.parse(json);
              if(d.entities)setEntities(d.entities);if(d.traits)setTraits(d.traits);
              if(d.edges)setEdges(d.edges);setJsonMsg("Загружено.");}
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
