import React, { useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, durText, nm, NumField, Arrow } from "./ui.jsx";
import { DUE_IN, DUE_ON, RATES, WEEK, actionsOf, budgetHours, copyGoal, newGoal,
  checkGoal, exprText, exprsOf, goalState, goalText, planGoal, plannable, rateOf }
  from "../lib/goals.js";
import ExprField from "./ExprField.jsx";
import Modal from "./Modal.jsx";
import { DUR_UNITS } from "../lib/funcs.js";
import { doerNamed, newTask, nowLocal, runTitle } from "./TasksBoard.jsx";

const num = (v) => Number(v) || 0;

/* ════════════════════════════════════════════════════════════════
   ЦЕЛИ — В ПРОГНОЗЕ, А НЕ В РЕСУРСЕ

   Раньше цель была полем ресурса: «сколько нужно». Одно число. Но цель,
   которую ставит человек, звучит иначе: «хочу выйти на одного клиента в
   неделю через месяц, тратя час в день». Здесь три вещи, которых у числа
   не было, — темп, срок и цена, — и без них цель не проверяема: непонятно,
   что считать выполнением и во что оно обходится.

   ─── что показывает форма ───

   Ровно то, что человек задал, и ровно то, что из этого следует по модели:

   · сколько ресурса это требует в месяц;
   · сколько выполнений каких функций и сколько человеко-часов;
   · влезает ли это в названный бюджет времени — и если нет, чего не хватает;
   · успевает ли первый результат к сроку;
   · держится ли темп вообще: цикл длиннее периода означает, что «раз в
     неделю» не выйдет, сколько ни старайся;
   · во что цель обходится по другим ресурсам — названное человеком рядом с
     посчитанным по модели.

   Расхождение между «я думал» и «выходит» и есть главное, ради чего это
   считается. Показывать одно вместо другого нельзя: первое — намерение,
   второе — следствие модели, и путать их значит терять и то и другое.

   ─── три состояния цели ───

   Цель проходит их по порядку, и порядок этот не украшение, а сама суть
   работы с целью:

   1. **Задана** — поля заполнены, но что из этого выйдет, ещё не считали.
      Кнопка внизу говорит «Спрогнозировать».
   2. **Спрогнозирована** — показано всё: последовательность действий,
      сроки, цена, что прибавится и что убавится. Кнопка меняется на
      «Применить цель». Меняете любое поле — прогноз устарел, и кнопка
      возвращается к «Спрогнозировать»: считать по одним числам, а
      применять другие нельзя.
   3. **Применена** — задачи заведены, цель попала в графики.

   Прежде расчёт шёл сам, при каждом наборе цифры, и «Применить» стояло
   рядом всегда. Разницы между «прикинул» и «решил» не было: человек
   применял то, во что ещё не всмотрелся.
   ════════════════════════════════════════════════════════════════ */

/**
 * Форма — подкарточка одного смыслового блока цели: подпись и то, что к
 * ней относится, в одной рамке.
 *
 * Раскрытая цель шла сплошной лентой: «что должно быть», срок, график и
 * следствия различались только отступом, и где кончается один вопрос и
 * начинается другой, приходилось угадывать (владелец, 2026-09-13). Та же
 * подкарточка, что у функций и ресурсов актива, — чтобы вопрос «где я»
 * решался одинаково везде.
 */
function Form({ title, children, style }) {
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.line}`,
      borderRadius: "var(--radius-sm)", padding: "var(--space-8)", marginTop: "var(--space-8)", ...style }}>
      {title && <div style={{ ...S.lbl, marginBottom: "var(--space-4)" }}>{title}</div>}
      {children}
    </div>);
}

const Fig = ({ label, value, color, hint }) => (
  <div style={{ flex: "1 1 130px", background: C.panel2, border: `1px solid ${C.line}`,
    borderRadius: "var(--radius-sm)", padding: "var(--space-8) var(--space-8)" }}>
    <div style={{ fontSize: "var(--fs-title)", fontWeight: 700, color: color || C.text }}>{value}</div>
    <div style={{ fontSize: "var(--fs-hint)", color: C.muted, lineHeight: 1.4 }}>{label}</div>
    {hint && <div style={{ fontSize: "var(--fs-hint)", color: C.muted, lineHeight: 1.4 }}>{hint}</div>}
  </div>
);

/* ════════════════════════════════════════════════════════════════
   УСЛОВИЯ ЦЕЛИ · их может быть несколько

   Одним условием можно сказать только «не меньше» ИЛИ «не больше».
   Диапазон — это два условия сразу: «> 10» и «< 50». Поэтому здесь
   список, а между условиями «И»: цель достигнута, когда держатся все.

   «От чего зависит» — это ссылка внутри условия: «> @Заявки*0,5» значит
   «не меньше половины заявок». Ссылка живёт по идентификатору, а
   показывается именем, поэтому переименование ресурса её не рвёт.

   План считает по нижней границе — самому большому из «=» и «>»: по
   меньшему он остановился бы раньше, чем цель достигнута. Верхняя
   граница план не двигает, а проверяется: произвести «меньше» нельзя.
   ════════════════════════════════════════════════════════════════ */
function Conds({ goal, traits, traitName, st, up }) {
  /* Для правки список берётся КАК ЗАПИСАН, вместе с пустыми строками:
     пустая строка — это только что добавленное условие, которое человек
     ещё не набрал. Считается при этом только заполненное (`exprsOf`) —
     пустое условие ничего не требует и ничего не запрещает. */
  const raw = Array.isArray(goal.exprs) ? goal.exprs : exprsOf(goal);
  const shown = raw.length ? raw : [""];
  const set = (i, v) => up({ exprs: shown.map((e, k) => (k === i ? v : e)) });
  const add = () => up({ exprs: [...shown, ""] });
  const drop = (i) => up({ exprs: shown.filter((_, k) => k !== i) });
  return (
    <div style={{ flex: "1 1 100%", minWidth: 0 }}>
      {/* «Операции», не «условия» (владелец, 2026-09-15): здесь считают —
          числа, ссылки, действия и процент от значения. */}
      <div style={S.lbl}>сколько — операции (между ними «и»)</div>
      {shown.map((e, i) => {
        const mine = st.list.find((x) => x.expr === e);
        return (
          <div key={i} className="flex items-start gap-2" style={{ marginTop: "var(--space-4)" }}>
            {i > 0 && (
              <span style={{ fontSize: "var(--fs-hint)", color: C.muted, padding: "var(--space-8) 0" }}>и</span>)}
            <ExprField value={e} traits={traits} style={{ flex: 1, minWidth: 0 }}
              aria-label={i ? `операция ${i + 1}` : "сколько ресурса"}
              onCommit={(v) => set(i, v)} />
            {shown.length > 1 && (
              <button style={{ ...btn(true, BAD), paddingTop: "calc(var(--btn-py) + var(--text-nudge))", paddingBottom: "calc(var(--btn-py) - var(--text-nudge))", paddingLeft: "var(--space-8)", paddingRight: "var(--space-8)" }}
                aria-label={`убрать операцию ${i + 1}`}
                onClick={() => drop(i)}>✕</button>)}
            {mine && mine.met != null && !mine.error && (
              <span style={{ fontSize: "var(--fs-hint)", padding: "var(--space-8) 0",
                color: mine.met ? OK : WARN }}>{mine.met ? "✓" : "✗"}</span>)}
          </div>);
      })}
      <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-4)", alignItems: "center" }}>
        <button style={{ ...btn(false), paddingTop: "calc(var(--btn-py) + var(--text-nudge))", paddingBottom: "calc(var(--btn-py) - var(--text-nudge))", paddingLeft: "var(--space-8)", paddingRight: "var(--space-8)" }}
          onClick={add}>+ операция</button>
        <span style={{ fontSize: "var(--fs-hint)", color: C.muted }}>
          {st.target != null && st.cap != null
            ? `диапазон: от ${nm(st.target)} до ${nm(st.cap)}`
            : "вторая операция задаёт диапазон: «> 10» и «< 50»; процент — «> 20% @ресурс»"}</span>
      </div>
      {st.conflict && (
        <div style={{ fontSize: "var(--fs-hint)", color: BAD, marginTop: "var(--space-4)" }}>{st.conflict}</div>)}
    </div>);
}

/* `w` — узкое поле на заданную ширину: число и единица срока стоят в одну
   строку с кнопками (владелец: «поля слишком длинные»), а не тянутся на
   всю ширину. */
const Row = ({ label, children, wide, w }) => (
  <div style={{ flex: wide ? "1 1 100%" : w ? `1 1 ${w}px` : "1 1 130px",
    minWidth: 0, maxWidth: w ? w * 1.6 : undefined }}>
    <div style={S.lbl}>{label}</div>
    {children}
  </div>
);

/**
 * Показатель: сколько есть против того, сколько нужно.
 *
 * У разовой цели это уровень — до него дорастают, и полоса показывает,
 * насколько доросли. У цели с темпом уровня нет: там мерка — сколько
 * требуется в месяц, и сравнивать её с остатком на складе бессмысленно.
 * Поэтому у темпа полосы нет, а есть требование — иначе полоса врала бы.
 */
function Gauge({ goal, traits, traitName }) {
  const t = traits.find((x) => x.id === goal.trait);
  const have = Number(t?.have) || 0;
  /* «Сколько» — условие: число для мерки берётся из него, со ссылками на
     другие ресурсы. У «<» и «!» числа-цели нет — есть выполнено или нет. */
  const st = goalState(goal, { traits });
  const want = Number(st.target) || 0;
  const rate = rateOf(goal.rate);
  const part = want > 0 ? Math.min(1, have / want) : 0;
  if (st.error || st.target == null) {
    return (
      <div className="flex items-center gap-2" style={{ fontSize: "var(--fs-hint)", marginTop: "var(--space-4)" }}>
        <span style={{ flex: 1, minWidth: 0, color: C.muted }}>
          {traitName(goal.trait)}{t?.unit ? `, ${t.unit}` : ""} · сейчас {nm(have)}</span>
        <span style={{ color: st.error || st.conflict ? BAD : st.met ? OK : WARN }}>
          {st.error || st.conflict
            || `${exprsOf(goal).map((e) => exprText(e, traitName)).join(" и ")}`
              + ` · ${st.met ? "выполнено" : "не выполнено"}`}</span>
      </div>);
  }
  return (
    <div style={{ marginTop: "var(--space-4)" }}>
      <div className="flex items-center gap-2" style={{ fontSize: "var(--fs-hint)" }}>
        <span style={{ flex: 1, minWidth: 0, color: C.muted }}>
          {traitName(goal.trait)}{t?.unit ? `, ${t.unit}` : ""}</span>
        {rate.hours ? (
          <span style={{ color: ACC }}>нужно {nm(want)} {rate.name}</span>
        ) : (
          <span style={{ color: part >= 1 ? OK : WARN }}>
            {nm(have)} из {nm(want)}{part >= 1 ? " · взято" : ""}</span>)}
      </div>
      {!rate.hours && (
        <div style={{ height: 5, borderRadius: "var(--radius-sm)", background: C.line, marginTop: "var(--space-4)" }}>
          <div style={{ width: `${Math.round(part * 100)}%`, height: "100%",
            borderRadius: "var(--radius-sm)", background: part >= 1 ? OK : ACC }} />
        </div>)}
    </div>);
}

const sel = { ...S.inp, padding: "var(--space-4) var(--space-8)", fontSize: "var(--fs-hint)" };
const hoursText = (h) => `${nm(Math.round(h * 10) / 10)} ч`;

/** Одна цель: чем она задана и что из неё следует. */
/* Отпечаток цели: по нему видно, изменилась ли она с тех пор, как её
   считали. Сравниваем именно поля намерения, а не всю запись: отметка о
   применении и порядок в списке к расчёту отношения не имеют. */
const stamp = (g) => JSON.stringify([g.trait, g.expr, g.exprs, g.rate, g.dueKind, g.dueIn,
  g.dueUnit, g.dueOn, g.days, g.hours, g.hoursPer,
  (g.costs || []).map((c) => [c.trait, c.qty])]);

function Goal({ goal, traits, model, runsOf, onSet, onDel, onApply, onRecall, open, onToggle }) {
  const traitName = (id) => traits.find((t) => t.id === id)?.l || "ресурс не выбран";
  const ready = checkGoal(goal, traits);
  /* План считается только у цели-числа («=», «>»): «<» и «!» — условие,
     которое проверяется, а не достигается работой. */
  const canPlan = ready && plannable(goal, model);
  /* На чём построен показанный прогноз. Пусто — не считали; не совпадает с
     нынешним отпечатком — считали, но с тех пор цель поправили. */
  const [shown, setShown] = useState(null);
  const [naming, setNaming] = useState(false);
  const [recall, setRecall] = useState(false);
  const fresh = shown != null && shown === stamp(goal);
  const plan = canPlan && fresh ? planGoal(model, goal, { runsOf }) : null;
  const up = (patch) => { setShown(null); onSet(goal.id, patch); };
  /* Ограничен ли бюджет времени — это и есть «часов больше нуля». Второй
     записи о том же в цели нет: она рано или поздно разошлась бы с числом.
     А набранное число помнится, чтобы флажок можно было снять и вернуть,
     не набирая его заново. */
  const capped = num(goal.hours) > 0;
  const [lastHours, setLastHours] = useState(() => num(goal.hours) || 1);
  const rate = rateOf(goal.rate);
  const unit = traits.find((t) => t.id === goal.trait)?.unit || "";

  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: "var(--radius-sm)",
      padding: "var(--space-8)", marginBottom: "var(--space-4)" }}>
      {/* Заголовок — имя цели, если его дали, иначе сама цель словами.
          Имя правится двойным нажатием (владелец, 2026-09-19). */}
      {/* Шапка сворачивает форму одним нажатием (владелец, 2026-09-21);
          поля и кнопки в ней — свои. */}
      <div className="flex items-center gap-2" style={{ cursor: "pointer" }}
        onClick={(e) => { if (e.detail > 1 || e.target.closest("input,button,a,select,textarea")) return; onToggle(); }}>
        <Arrow open={open} label={`${open ? "свернуть" : "развернуть"} цель`}
          onClick={(e) => { e.stopPropagation(); onToggle(); }} />
        {naming ? (
          <input autoFocus aria-label="название цели" defaultValue={goal.name || ""}
            placeholder={ready ? goalText(goal, traitName) : "название цели"}
            style={{ ...S.inp, flex: 1, fontSize: "var(--fs-body)", fontWeight: 600, padding: "0 var(--space-4)" }}
            onBlur={(e) => { onSet(goal.id, { name: e.target.value.trim() }); setNaming(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setNaming(false); }} />
        ) : (
          <span data-goal-name="" title="двойное нажатие — переименовать"
            onDoubleClick={() => setNaming(true)}
            style={{ flex: 1, fontSize: "var(--fs-body)", fontWeight: 600, minWidth: 0, cursor: "text",
              whiteSpace: "normal", overflowWrap: "anywhere" }}>
            {goal.name || (ready ? goalText(goal, traitName) : "цель не задана: выберите ресурс и условие")}
            {goal.appliedAt && (
              <span style={{ color: OK, fontWeight: 400, fontSize: "var(--fs-hint)" }}> · применена</span>)}
          </span>)}
        {/* «Отозвать» — рядом с «удалить» (владелец, 2026-09-20): у
            непринятой цели отзывать нечего, и кнопка не нажимается. */}
        <button style={{ ...btn(false), paddingTop: "calc(var(--btn-py) + var(--text-nudge))", paddingBottom: "calc(var(--btn-py) - var(--text-nudge))", paddingLeft: "var(--space-4)", paddingRight: "var(--space-4)",
          opacity: goal.appliedAt ? 1 : 0.5 }} aria-label="отозвать цель"
          disabled={!goal.appliedAt} onClick={() => setRecall(true)}>отозвать</button>
        <button style={{ ...btn(true, BAD), paddingTop: "calc(var(--btn-py) + var(--text-nudge))", paddingBottom: "calc(var(--btn-py) - var(--text-nudge))", paddingLeft: "var(--space-4)", paddingRight: "var(--space-4)" }} aria-label="удалить цель"
          onClick={() => onDel(goal.id)}>удалить</button>
      </div>
      {/* Отзыв спрашивает об одном: стирать ли сделанное. «Нет» убирает
          дальнейший прогноз и невыполненные задачи, «Да» — всё, что цель
          завела, и от неё остаётся заполненная форма. */}
      {recall && (
        <Modal title="Удалить созданную деятельность" onClose={() => setRecall(false)}>
          <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-4)" }}>
            <button type="button" style={btn(true, BAD)}
              aria-label="удалить созданную деятельность"
              onClick={() => { setRecall(false); onRecall(goal.id, true); }}>Да</button>
            <button type="button" style={btn(true, OK)}
              aria-label="оставить созданную деятельность"
              onClick={() => { setRecall(false); onRecall(goal.id, false); }}>Нет</button>
          </div>
        </Modal>)}
      {/* ─── ПОКАЗАТЕЛЬ ───
          Цель — это не только намерение, но и мерка: сколько ресурса есть
          сейчас против того, сколько нужно. Видно и в свёрнутом виде: ради
          этой цифры цель и ставили. */}
      {goal.name && ready && (
        <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginTop: 0 }}>{goalText(goal, traitName)}</div>)}
      {ready && <Gauge goal={goal} traits={traits} traitName={traitName} />}

      {open && (<>

      {/* ─── ЧТО ─── */}
      <Form title="что должно быть">
      <div className="flex flex-wrap gap-2">
        <Row label="ресурс">
          <select style={sel} value={goal.trait} aria-label="ресурс цели"
            onChange={(e) => up({ trait: e.target.value })}>
            <option value="">— выберите —</option>
            {traits.map((t) => (<option key={t.id} value={t.id}>{t.l}</option>))}
          </select>
        </Row>
        <Conds goal={goal} traits={traits} traitName={traitName}
          st={goalState(goal, { traits })} up={up} />
        <Row label="как часто">
          <select style={sel} value={goal.rate} aria-label="темп цели"
            onChange={(e) => up({ rate: e.target.value })}>
            {RATES.map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}
          </select>
        </Row>
      </div>
      </Form>

      {/* ─── КОГДА ─── */}
      <Form title="к какому сроку">
      {/* Одной строкой: кнопки, и рядом либо «сколько» с единицей, либо дата
          (владелец, 2026-09-13). Без переноса — иначе на телефоне поля
          уезжали вниз и растягивались на всю ширину. */}
      <div className="flex gap-2" style={{ alignItems: "flex-end",
        flexWrap: "nowrap" }}>
        <div className="flex gap-2" style={{ flex: "0 0 auto" }}>
          <button style={{ ...btn(goal.dueKind === DUE_IN), paddingTop: "calc(var(--btn-py) + var(--text-nudge))", paddingBottom: "calc(var(--btn-py) - var(--text-nudge))", paddingLeft: "var(--space-8)", paddingRight: "var(--space-8)" }}
            onClick={() => up({ dueKind: DUE_IN })}>через</button>
          <button style={{ ...btn(goal.dueKind === DUE_ON), paddingTop: "calc(var(--btn-py) + var(--text-nudge))", paddingBottom: "calc(var(--btn-py) - var(--text-nudge))", paddingLeft: "var(--space-8)", paddingRight: "var(--space-8)" }}
            onClick={() => up({ dueKind: DUE_ON })}>к дате</button>
        </div>
        {goal.dueKind === DUE_IN ? (<>
          <Row label="сколько" w={64}>
            <NumField value={goal.dueIn} aria-label="через сколько"
              onCommit={(v) => up({ dueIn: v ?? 0 })} />
          </Row>
          <Row label="единица" w={72}>
            <select style={sel} value={goal.dueUnit} aria-label="единица срока"
              onChange={(e) => up({ dueUnit: e.target.value })}>
              {Object.keys(DUR_UNITS).map((u) => (<option key={u} value={u}>{u}</option>))}
            </select>
          </Row>
        </>) : (
          <Row label="дата" w={150}>
            <input type="date" style={sel} value={goal.dueOn || ""} aria-label="дата цели"
              onChange={(e) => up({ dueOn: e.target.value })} />
          </Row>)}
      </div>
      </Form>

      {/* ─── ВРЕМЯ НА ДОСТИЖЕНИЕ ───

          Раздел назывался «какой ценой» и спрашивал две разные вещи сразу:
          сколько времени человек готов тратить и во сколько других ресурсов
          это обойдётся. Второе он называл наугад, а модель тут же считала
          настоящее — и рядом стояли два ответа на один вопрос. Осталось
          только время: его человек и правда решает сам. Что цель съест по
          другим ресурсам, считается и показано ниже, в «цене по ресурсам». */}
      <Form title="в график работ">
      {/* ─── бюджет времени: сперва «ограничивать ли», потом «сколько» ───

          Ноль в поле времени означал «не ограничиваем», и это приходилось
          знать: пустое поле читается как «забыл заполнить», а не как
          решение. Флажок говорит то же самое словами и заодно гасит всё,
          что от бюджета зависит.

          Второго поля «ограничивать ли» в записи цели НЕТ: бюджет — это
          `hours`, и ноль в нём и есть «не ограничен». Отдельный признак
          рядом с числом рано или поздно разошёлся бы с ним, и стало бы
          непонятно, какой записи верить. Набранное число не теряется: пока
          форма открыта, оно помнится и возвращается при включении. */}
      <label className="flex items-center gap-2"
        style={{ fontSize: "var(--fs-hint)", cursor: "pointer" }}>
        <input type="checkbox" checked={capped} aria-label="учитывать график"
          style={{ accentColor: ACC }}
          onChange={(e) => {
            if (e.target.checked) up({ hours: lastHours });
            else { setLastHours(num(goal.hours) || lastHours); up({ hours: 0 }); }
          }} />
        <span>учитывать график</span>
        <span style={{ color: C.muted, fontSize: "var(--fs-hint)" }}>
          {capped ? "" : "— считаем без ограничения по времени"}</span>
      </label>
      {/* Без галочки поля НЕ пропадают, а гаснут — как дни недели ниже
          (владелец, 2026-09-13): видно, что здесь настраивается, и набранное
          число остаётся на месте. Показывается запомненное `lastHours`:
          в записи при снятой галочке стоит ноль, а ноль в поле читался бы
          как «забыли заполнить». */}
      <div style={{ ...S.lbl, marginTop: "var(--space-8)", opacity: capped ? 1 : 0.5 }}>рабочее время</div>
      <div style={{ opacity: capped ? 1 : 0.5 }}>
        <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-4)" }}>
          <Row label="сколько">
            <NumField value={capped ? goal.hours : lastHours} aria-label="сколько времени"
              disabled={!capped}
              onCommit={(v) => up({ hours: v ?? 0 })} />
          </Row>
          {/* Единица У ЧИСЛА. Без неё «2 в день» не читается вовсе: два
              часа или два дня — разные вещи, а поле молча считало часы.
              Мера та же, что у сроков функций: день это 24 часа. */}
          <Row label="единица">
            <select style={sel} value={goal.hoursUnit || "ч"}
              aria-label="единица времени" disabled={!capped}
              onChange={(e) => up({ hoursUnit: e.target.value })}>
              {Object.keys(DUR_UNITS).map((u) => (
                <option key={u} value={u}>{u}</option>))}
            </select>
          </Row>
          <Row label="за период">
            <select style={sel} value={goal.hoursPer} aria-label="период времени"
              disabled={!capped}
              onChange={(e) => up({ hoursPer: e.target.value })}>
              {RATES.filter((r) => r.hours).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>))}
            </select>
          </Row>
        </div>
        {/* Сколько это выходит в месяц — тем самым числом, с которым прогноз
            и сравнивает работу. Иначе «2 дн в неделю» и «работы 130 ч в
            месяц» человеку приходится сводить в уме. */}
        {capped && (
          <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginTop: "var(--space-4)",
            lineHeight: 1.5 }}>
            {budgetHours(goal) == null
              ? "Число нулевое — выходит, ограничения нет."
              : `Это ${hoursText(budgetHours(goal))} в месяц — с этим числом и`
                + " сравнивается посчитанная работа. Часами, потому что работа"
                + " по модели считается в них же."}
          </div>)}
      </div>

      {/* ─── ДНИ НЕДЕЛИ ───

          Дни стоят ЗДЕСЬ, под самим временем, потому что только его они и
          трогают: «час в день» по будням — это пять часов в неделю, а не
          семь (`budgetHours` в lib/goals.js). Отдельным блоком выше они
          назывались «по каким дням идёт работа» и читались как расписание
          задач, которым не являются, — а без заданного бюджета не делали
          ровно ничего. Поэтому без флажка они и не нажимаются. */}
      <div style={{ ...S.lbl, marginTop: "var(--space-8)", opacity: capped ? 1 : 0.5 }}>рабочие дни</div>
      <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-4)",
        opacity: capped ? 1 : 0.5 }}>
        {WEEK.map((d) => {
          const on = (goal.days || []).includes(d.id);
          return (
            <button key={d.id} aria-label={`день ${d.short}`} disabled={!capped}
              style={{ ...btn(on && capped), paddingTop: "calc(var(--btn-py) + var(--text-nudge))", paddingBottom: "calc(var(--btn-py) - var(--text-nudge))", paddingLeft: "var(--space-8)", paddingRight: "var(--space-8)",
                cursor: capped ? "pointer" : "default" }}
              onClick={() => up({ days: on ? goal.days.filter((x) => x !== d.id)
                : [...(goal.days || []), d.id] })}>{d.short}</button>);
        })}
      </div>
      <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginTop: "var(--space-4)", lineHeight: 1.5 }}>
        {!capped
          ? "График не учитывается — время и дни в расчёт не идут."
          : goal.days?.length
            ? `${goal.days.length} дн в неделю — по ним и считается бюджет времени.`
            : "Ничего не выбрано — значит все семь дней."}
      </div>
      </Form>

      {/* ─── ЧТО ИЗ ЭТОГО СЛЕДУЕТ ─── */}
      {plan && <Verdict plan={plan} unit={unit} traits={traits} />}
      {plan && (
        <Actions plan={plan} />)}
      <Apply goal={goal} plan={plan} ready={canPlan} fresh={fresh}
        condition={ready && !canPlan}
        onPredict={() => setShown(stamp(goal))}
        onApply={() => onApply(goal, plan)} />
      </>)}
    </div>);
}

/** Что модель отвечает на цель: цифры, а не «похоже, получится». */
function Verdict({ plan, unit, traits }) {
  const nameOf = (id) => traits.find((t) => t.id === id)?.l || id;
  const both = (a, b, f) => (Math.round(a) === Math.round(b) ? f(a) : `${f(a)} – ${f(b)}`);
  if (!plan.ok) {
    return (
      <div style={{ fontSize: "var(--fs-hint)", color: BAD, marginTop: "var(--space-8)", lineHeight: 1.6 }}>
        {plan.missing.length
          ? `Цель недостижима: ресурс «${nameOf(plan.missing[0])}» не выдаёт ни одна функция.`
          : plan.looped
            ? "Цепочка замкнулась сама на себя: ресурс нужен, чтобы получить этот же ресурс."
            : "Ни одна функция не выдаёт этот ресурс — производить его нечем."}
      </div>);
  }
  const budgetName = plan.rate.hours ? "в месяц" : "за весь срок";
  return (<Form title="что из этого следует">
    <div className="flex flex-wrap gap-2">
      {plan.perMonth != null && (
        <Fig label={`${unit || "ед."} в месяц по этому темпу`}
          value={nm(Math.round(plan.perMonth * 10) / 10)} />)}
      <Fig label={`работы ${budgetName}`} color={WARN}
        value={both(plan.lo.workHours, plan.hi.workHours, durText)} />
      {/* Названное время стоит РЯДОМ с посчитанной работой: ради этого
          сравнения его и спрашивают, а порознь человек сводит их в уме. */}
      {plan.budget != null && (
        <Fig label={`времени на это есть ${budgetName}`}
          color={plan.fits ? OK : BAD} value={hoursText(plan.budget)} />)}
      <Fig label="выполнений функций"
        value={both(plan.lo.runs, plan.hi.runs, (v) => nm(Math.round(v)))} />
      <Fig label="самая длинная цепочка" color={ACC} value={durText(plan.readyHours)} />
    </div>

    {plan.oneSided && (
      <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginTop: "var(--space-4)", lineHeight: 1.5 }}>
        Это по {plan.sureOk ? "нижней" : "верхней"} границе вилок: по
        {plan.sureOk ? " верхней" : " нижней"} цель не достигается вовсе.
        Называть два числа, когда модель даёт одно, нельзя.
      </div>)}

    {plan.budget != null && (
      <div style={{ fontSize: "var(--fs-hint)", marginTop: "var(--space-8)", lineHeight: 1.6,
        color: plan.fits ? OK : plan.fitsSure ? WARN : BAD }}>
        {plan.fits
          ? `Влезает в бюджет: нужно ${hoursText(plan.work.hi)} ${budgetName}, а есть ${hoursText(plan.budget)}.`
          : plan.fitsSure
            ? `Влезает не наверняка: по осторожной оценке нужно ${hoursText(plan.work.lo)}, по щедрой — ${hoursText(plan.work.hi)}, а есть ${hoursText(plan.budget)} ${budgetName}.`
            : `Не влезает: нужно ${hoursText(plan.work.lo)} ${budgetName}, а названо ${hoursText(plan.budget)}. Не хватает ${hoursText(plan.work.lo - plan.budget)}.`}
      </div>)}

    {plan.due != null && (
      <div style={{ fontSize: "var(--fs-hint)", marginTop: "var(--space-4)", lineHeight: 1.6,
        color: plan.ready ? OK : BAD }}>
        {plan.ready
          ? `Успевает: первый результат через ${durText(plan.readyHours)}, а срок через ${durText(plan.due)}.`
          : `Не успевает: первый результат через ${durText(plan.readyHours)}, а срок через ${durText(plan.due)}.`}
        {plan.dueOn && (
          <span style={{ color: C.muted }}>
            {" "}Срок — {plan.dueOn.toLocaleDateString("ru-RU")}.</span>)}
      </div>)}

    {plan.cycle != null && (
      <div style={{ fontSize: "var(--fs-hint)", marginTop: "var(--space-4)", lineHeight: 1.6,
        color: plan.cycle ? OK : BAD }}>
        {plan.cycle
          ? `Темп держится: один круг занимает ${durText(plan.readyHours)}, а период — ${plan.rate.name}.`
          : `Темп не держится: один круг занимает ${durText(plan.readyHours)} — это дольше, чем «${plan.rate.name}». Сколько ни старайся, результат не успеет созреть.`}
      </div>)}

    <Effect plan={plan} traits={traits} />
    <Schedule plan={plan} />

    {(plan.costs.length > 0 || plan.extra.length > 0) && (<>
      {/* Здесь числа месячные (или «за весь срок» у разовой цели), а в
          «прибавится/убавится» — за один круг. Разные меры в одной форме
          обязаны быть подписаны, иначе их сложат в уме и получат чушь. */}
      <div style={{ ...S.lbl, marginTop: "var(--space-8)" }}>цена по ресурсам · {budgetName}</div>
      {plan.costs.map((c) => {
        const off = c.qty > 0 && Math.abs(c.real - c.qty) / c.qty > 0.05;
        return (
          <div key={c.id} className="flex items-center gap-2"
            style={{ fontSize: "var(--fs-hint)", padding: "var(--space-4) 0", borderTop: `1px solid ${C.line}` }}>
            <span style={{ flex: 1, minWidth: 0 }}>{c.name}</span>
            <span style={{ color: C.muted }}>назвали {nm(c.qty)}</span>
            <span style={{ color: off ? WARN : OK }}>
              по модели {nm(Math.round(c.real * 10) / 10)}</span>
          </div>);
      })}
      {plan.extra.map((c) => (
        <div key={c.trait} className="flex items-center gap-2"
          style={{ fontSize: "var(--fs-hint)", padding: "var(--space-4) 0", borderTop: `1px solid ${C.line}` }}>
          <span style={{ flex: 1, minWidth: 0 }}>{c.name}</span>
          <span style={{ color: WARN }}>уйдёт ещё {nm(Math.round(c.real * 10) / 10)}</span>
        </div>))}
    </>)}
  </Form>);
}

/**
 * «Применить цель» — граница между прикидкой и решением.
 *
 * До нажатия цель считается, но ни на что не влияет: её крутят, смотрят,
 * что выйдет, и меняют. После — заводятся задачи, и цель начинает
 * показываться на графиках. Без этой границы каждая правка числа молча
 * меняла бы доску задач, и попробовать «а что если» было бы негде.
 *
 * Применить второй раз можно: план мог измениться вместе с моделью. Задачи
 * прежнего применения при этом не трогаются — они уже могли уйти в работу,
 * и стирать чужую работу перерасчётом нельзя.
 */
/**
 * Две кнопки на одном месте: сперва посчитать, потом решить.
 *
 * Пока цель не посчитана, применять нечего — и кнопка об этом прямо
 * говорит. Как только цель поправили, прогноз устарел, и кнопка снова
 * зовёт считать: применять числа, которых человек не видел, нельзя.
 */
function Apply({ goal, plan, ready, fresh, condition, onPredict, onApply }) {
  const n = (plan?.schedule || []).length;
  const can = plan && plan.ok && n > 0;
  return (
    <div style={{ marginTop: "var(--space-12)", borderTop: `1px solid ${C.line}`, paddingTop: "var(--space-8)" }}>
      {!fresh || !plan ? (<>
        <button style={{ ...btn(true, ACC), width: "100%", padding: "var(--space-8) var(--space-8)", fontWeight: 700 }}
          disabled={!ready} onClick={onPredict}>Спрогнозировать</button>
        {/* Что делает кнопка — сказано один раз. Строки «цель поправили,
            посчитайте заново» здесь нет: кнопка и так зовёт считать, и
            повторять это словами значит объяснять очевидное. */}
        <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginTop: "var(--space-4)", lineHeight: 1.5 }}>
          {condition
            ? "Это условие, а не цель-число: «<» и «!» проверяются по остатку, план по ним не считается."
            : !ready
              ? "Сначала выберите ресурс, условие и срок."
              : "Посчитает, что придётся сделать и во что обойдётся. Ничего не меняет."}
        </div>
      </>) : (<>
        <button style={{ ...btn(true, OK), width: "100%", padding: "var(--space-8) var(--space-8)", fontWeight: 700 }}
          disabled={!can} onClick={onApply}>
          {goal.appliedAt ? "Повторить отдельной целью" : "Применить цель"}
        </button>
        <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginTop: "var(--space-4)", lineHeight: 1.5 }}>
          {!can
            ? "Применять нечего: по этой модели цель не достигается."
            : goal.appliedAt
              ? `Цель применена ${new Date(goal.appliedAt).toLocaleString("ru-RU")}. Повтор заведёт ОТДЕЛЬНУЮ цель со своими ${n} задачами — два применения это два разных решения, и в списке они стоят двумя строками.`
              : `Заведёт ${n} задач в «Ожидает постановки» и включит цель в графики. Один круг работы: следующий заводится, когда этот закрыт.`}
        </div>
      </>)}
    </div>);
}
/* Считали ли эту цель хоть раз: от этого зависит, что написать под кнопкой
   — «посчитает» или «цель поправили». */

/**
 * Последовательность действий плана: что за чем и сколько раз.
 */
function Actions({ plan }) {
  const rows = actionsOf(plan);
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: "var(--space-8)" }}>
      <div style={S.lbl}>последовательность действий</div>
      {rows.map((st) => (
        <div key={st.func} className="flex items-center gap-2"
          style={{ fontSize: "var(--fs-hint)", padding: "var(--space-4) 0", borderTop: `1px solid ${C.line}` }}>
          <span style={{ color: ACC, minWidth: 16 }}>{st.no}.</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            {st.name || "без названия"}
          </span>
          <span style={{ color: WARN, whiteSpace: "nowrap" }}>
            ×{nm(Math.round(st.runs * 10) / 10)}</span>
          <span style={{ color: C.muted, whiteSpace: "nowrap" }}>
            {st.startHours > 0 ? `с ${durText(st.startHours)}` : "сразу"}</span>
        </div>))}
    </div>);
}

const dt = (d) => d.toLocaleString("ru-RU",
  { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Что план сделает с ресурсами: чего прибавится, чего убавится.
 *
 * Две колонки, а не одна таблица со знаками: «прибавится» и «убавится» —
 * разные новости, и человек читает их по-разному. Чистое изменение, а не
 * приход и расход по отдельности: ресурс, который функция и производит, и
 * потребляет, двумя строками только пугал бы числами, гасящими друг друга.
 */
function Effect({ plan, traits }) {
  const rows = Object.entries(plan.effect || {})
    .map(([id, v]) => ({ id, v, name: traits.find((t) => t.id === id)?.l || id }))
    .filter((r) => Math.abs(r.v) > 1e-9)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  if (!rows.length) return null;
  const up = rows.filter((r) => r.v > 0);
  const down = rows.filter((r) => r.v < 0);
  const col = (title, list, color, sign) => (
    <div style={{ flex: "1 1 150px", minWidth: 0 }}>
      <div style={S.lbl}>{title}</div>
      {!list.length && <div style={{ fontSize: "var(--fs-hint)", color: C.muted }}>ничего</div>}
      {list.map((r) => (
        <div key={r.id} className="flex items-center gap-2"
          style={{ fontSize: "var(--fs-hint)", padding: "0 0" }}>
          <span style={{ flex: 1, minWidth: 0 }}>{r.name}</span>
          <span style={{ color }}>{sign}{nm(Math.round(Math.abs(r.v) * 10) / 10)}</span>
        </div>))}
    </div>);
  return (
    <div style={{ marginTop: "var(--space-8)" }}>
      <div className="flex flex-wrap gap-2">
        {col("прибавится", up, OK, "+")}
        {col("убавится", down, WARN, "−")}
      </div>
      <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginTop: "var(--space-4)", lineHeight: 1.5 }}>
        За один круг работы: чистое изменение ресурса.
      </div>
    </div>);
}

/**
 * Во что цель превратится на доске задач — до того, как её применили.
 *
 * Показываем начало каждого выполнения, а не одно «будет N задач»: когда
 * именно придётся работать, и есть половина ответа на вопрос «потяну ли».
 * Длинный список подрезан: важны первые сроки и общее число.
 */
function Schedule({ plan }) {
  const rows = plan.schedule || [];
  if (!rows.length) return null;
  const shown = rows.slice(0, 6);
  return (
    <div style={{ marginTop: "var(--space-8)" }}>
      <div style={S.lbl}>какие задачи и когда заведутся · {rows.length}</div>
      {shown.map((r, i) => (
        <div key={`${r.func}-${r.no}`} className="flex items-center gap-2"
          style={{ fontSize: "var(--fs-hint)", padding: "var(--space-4) 0",
            borderTop: i ? `1px solid ${C.line}` : "none" }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            {r.name || "без названия"}
            {r.of > 1 && <span style={{ color: C.muted }}> · {r.no} из {r.of}</span>}
          </span>
          <span style={{ color: ACC, whiteSpace: "nowrap" }}>{dt(r.start)}</span>
        </div>))}
      {rows.length > shown.length && (
        <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginTop: "var(--space-4)" }}>
          …и ещё {rows.length - shown.length}; последняя — {dt(rows[rows.length - 1].start)}.
        </div>)}
    </div>);
}

/**
 * Список целей. Живёт в «Прогнозе»: цель — это вопрос к будущему модели, а
 * не свойство ресурса.
 */
export default function GoalsPanel({ goals, setGoals, traits, model, runsOf, onTasks,
  onDropGoal, onRecallGoal }) {
  const [open, setOpen] = useState(null);
  /* Функции, которым не назвали должность: по ним задачи не завелись. */
  const [noPost, setNoPost] = useState([]);
  const set = (id, patch) => setGoals((p) => p.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  /* Удаление цели — это не только строка из списка. Цель влияла на прогноз
     (её выполнения шли в расчёт) и завела работу; уходит цель — уходит и
     то, и другое, иначе в модели остались бы числа и задачи, которых уже
     никто не просил. Прогноз пересчитывается сам: он считается по
     применённым целям, и стоит убрать одну — он считается заново без неё. */
  const del = (id) => { onDropGoal?.(id); setGoals((p) => p.filter((g) => g.id !== id)); setOpen(null); };

  /* ─────── отзыв цели ───────

     Отозвать — не удалить: цель остаётся заполненной формой, которую
     можно применить снова. Уходит решение: цель больше не применена, и
     дальнейшего прогноза по ней нет — он считается по применённым.

     «Нет» убирает только невыполненную работу: сделанное — это то, что
     правда произошло, и стирать его значило бы переписать прошлое.
     «Да» убирает всё, что цель завела, вместе с результатами. */
  const recall = (id, all) => {
    onRecallGoal?.(id, all);
    set(id, { appliedAt: null });
  };

  /* ─────── цель применяется ОДИН раз ───────

     Прежде «Применить заново» дописывало ещё столько же задач к той же
     цели. Это было неправильно: два применения — это два разных решения с
     разными сроками и разными результатами, и в списке целей они должны
     стоять двумя строками. Одной строкой они сливались в неразличимую
     кучу задач, а спросить «что дала вот эта цель» стало нельзя ни про
     одну из них.

     Поэтому повторное применение заводит НОВУЮ цель — копию, со своим
     сроком применения и своей работой. Прежняя остаётся как была. */
  const apply = (goal, plan) => {
    const fresh = goal.appliedAt ? copyGoal(goal) : goal;
    /* Функция без названной должности задачи НЕ заводит (владелец,
       2026-09-19): «если должность не указана, то сама задача не должна
       быть создана». Поручать работу некому, и задача, которую всё равно
       никто не возьмёт, — не работа, а строка в списке. Кого не завели —
       сказано словами, молча пропускать нельзя. */
    const funcs = model?.funcs || [];
    const named = (id) => doerNamed(funcs.find((f) => f.id === id));
    const rows = plan.schedule || [];
    setNoPost([...new Set(rows.filter((r) => !named(r.func))
      .map((r) => funcs.find((f) => f.id === r.func)?.name || "без названия"))]);
    /* Номер выполнения считает `scheduleOf`, а называет его `runTitle`:
       четыре выполнения одной функции — четыре разные задачи. */
    const tasks = rows.filter((r) => named(r.func)).map((r) => ({
      /* Описание задачи из техпроцесса едет с ней сразу (владелец,
         2026-09-20): постановщик увидит его в «Описании задачи» и правит,
         если надо, а не переписывает с нуля. */
      ...newTask({ funcId: r.func, title: runTitle(r),
        body: String(funcs.find((f) => f.id === r.func)?.body || ""),
        start: nowLocal(r.start), end: nowLocal(r.end) }),
      goalId: fresh.id,
    }));
    onTasks?.(tasks);
    const at = new Date().toISOString();
    if (fresh === goal) { set(goal.id, { appliedAt: at }); return; }
    // Копия встаёт сразу за прежней: рядом видно, что это повтор, а не
    // случайно похожая цель, заведённая когда-то отдельно.
    setGoals((p) => {
      const i = p.findIndex((g) => g.id === goal.id);
      const next = [...p];
      next.splice(i < 0 ? p.length : i + 1, 0, { ...fresh, appliedAt: at });
      return next;
    });
    setOpen(fresh.id);
  };
  const add = () => {
    const g = newGoal(traits[0]?.id || "");
    setGoals((p) => [...p, g]);
    setOpen(g.id);
  };
  return (
    <div style={{ ...S.card, marginBottom: "var(--space-8)" }}>
      <div className="flex items-center gap-2" style={{ marginBottom: "var(--space-4)" }}>
        <span style={S.lbl}>цели</span>
        <span style={{ flex: 1 }} />
        <button style={btn(false)} onClick={add} disabled={!traits.length}>+ цель</button>
      </div>
      {!goals.length && (
        <div style={{ color: C.muted }}>
          {traits.length ? "Целей пока нет." : "Сначала заведите ресурсы — цель ставится по ресурсу."}
        </div>)}
      {!!noPost.length && (
        <div style={{ fontSize: "var(--fs-hint)", color: WARN, marginBottom: "var(--space-8)", lineHeight: 1.5 }}>
          Без должности задачи не заводятся: {noPost.join(", ")} — назовите
          «Кто:» у функции.
        </div>)}
      {goals.map((g) => (
        <Goal key={g.id} goal={g} traits={traits} model={model} runsOf={runsOf}
          onSet={set} onDel={del} onApply={apply} onRecall={recall}
          open={open === g.id} onToggle={() => setOpen(open === g.id ? null : g.id)} />))}
    </div>);
}
