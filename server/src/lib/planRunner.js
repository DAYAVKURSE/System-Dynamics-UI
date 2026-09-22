/* ════════════════════════════════════════════════════════════════
   РЕЖИМ ПЛАНИРОВАНИЯ (владелец, 2026-09-22)

   «При любом запросе к боту или начале деятельности агент должен не
   просто отвечать, а планировать». Просьба → план → шаги по одному →
   сверка каждого результата с ожидаемым → при несовпадении план
   пересоставляется с новыми данными и выполнение идёт с первого
   изменённого шага → пока не получен ожидаемый результат просьбы.
   Нерешаемое — словами человеку, а не молча.

   Модель здесь спрашивают несколько раз, и каждый раз — одним разговором
   `run(prompt)` с инструментами (см. runAgent): план, каждый шаг, пересбор
   плана, итог. Между разговорами память — в самом плане: он целиком
   уходит в каждую подсказку.

   Что видит человек — `render(plan)`: «что нужно сделать», шаги с 🔵/🟢/🔴
   и номером, «действие → ожидаемый результат», в конце — ожидаемый
   результат просьбы. Сделанные шаги зачёркнуты; при пересборе шаги, не
   давшие результата, из плана уходят. Вызывающий рисует это под
   «Думаю…» (`onPlan`).

   Ответ, который не JSON-план, считается прямым ответом: модель сочла,
   что планировать нечего (или это заглушка в тесте) — и это не ошибка.
   ════════════════════════════════════════════════════════════════ */

export const MAX_STEPS = 12;
export const MAX_REPLANS = 3;
export const PENDING = "🔵";
export const DONE = "🟢";
export const FAILED = "🔴";

export const PLAN_NOTE = [
  "# Планирование",
  "Любую просьбу и любую задачу сначала ПЛАНИРУЙ, а не отвечай сразу. Пойми, что нужно сделать,",
  "и какой результат ожидается; разбей путь к нему на шаги — у каждого шага своё действие и свой",
  `ожидаемый результат. Шагов — не больше ${MAX_STEPS}. Данные для плана можно посмотреть инструментами.`,
  "Ответь ТОЛЬКО JSON без пояснений вокруг:",
  '{"request": "что нужно сделать — как ты понял просьбу", "result": "ожидаемый результат просьбы",',
  ' "steps": [{"action": "действие шага", "expect": "ожидаемый результат шага"}]}',
  "Только если просьба — простой вопрос, на который ответ уже есть в данных, ответь словами без JSON.",
].join("\n");

const str = (v, n = 400) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);

/** Зачёркивание без разметки: Telegram показывает его в любом сообщении. */
export const strike = (s) => [...String(s)].map((ch) => `${ch}̶`).join("");

/** Первый JSON-объект в тексте — или null. Модели любят оборачивать его в ```json. */
export function parseJson(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  /* Идём по скобкам с конца: последняя «}» может быть не той — берём
     самый длинный кусок, который разбирается. */
  for (let end = s.lastIndexOf("}"); end > start; end = s.lastIndexOf("}", end - 1)) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch { /* короче */ }
  }
  return null;
}

/** План из ответа модели — или null, если это не план. */
export function parsePlan(text) {
  const j = parseJson(text);
  if (!j || typeof j !== "object") return null;
  if (j.impossible) return { impossible: str(j.impossible, 1000) };
  if (!Array.isArray(j.steps)) return null;
  const steps = j.steps
    .map((s) => ({ action: str(s?.action), expect: str(s?.expect), state: "pending", result: "" }))
    .filter((s) => s.action)
    .slice(0, MAX_STEPS);
  if (!steps.length) return null;
  return { request: str(j.request, 600), result: str(j.result, 600), steps };
}

/** Итог шага: последняя JSON-строка `{ok, result}`; нет её — считаем «сделано». */
export function parseStep(text) {
  const j = parseJson(text);
  if (j && typeof j === "object" && "ok" in j) return { ok: j.ok !== false, result: str(j.result, 1000) || str(text, 1000) };
  return { ok: true, result: str(text, 1000) };
}

export function render(plan, { title = "" } = {}) {
  const lines = [];
  if (title) lines.push(title);
  lines.push(`Что нужно сделать: ${plan.request || "—"}`);
  plan.steps.forEach((s, i) => {
    const mark = s.state === "done" ? DONE : s.state === "failed" ? FAILED : PENDING;
    const text = `${s.action} → ${s.expect || "—"}`;
    lines.push(`${mark} ${i + 1}. ${s.state === "done" ? strike(text) : text}`);
  });
  lines.push(`Ожидаемый результат: ${plan.result || "—"}`);
  return lines.join("\n");
}

const planText = (plan) => plan.steps.map((s, i) => {
  const mark = s.state === "done" ? "сделан" : s.state === "failed" ? "НЕ ДАЛ ожидаемого" : "ещё не сделан";
  return `${i + 1}. ${s.action} → ожидалось: ${s.expect || "—"} [${mark}${s.result ? `: ${s.result}` : ""}]`;
}).join("\n");

const head = (plan) => `Просьба (как понята): ${plan.request}\nОжидаемый результат просьбы: ${plan.result}\nПлан:\n${planText(plan)}`;

const stepPrompt = (plan, i) => [
  head(plan), "",
  `Сейчас выполни шаг ${i + 1}: ${plan.steps[i].action}`,
  `Ожидаемый результат шага: ${plan.steps[i].expect || "—"}`,
  "Сделай его инструментами или рассуждением. Что получилось, сверь с ожидаемым.",
  'В самом конце ответа — отдельной последней строкой JSON: {"ok": true, "result": "что получилось"}.',
  'Если результат НЕ совпал с ожидаемым: {"ok": false, "result": "что получилось на самом деле и почему"}.',
].join("\n");

const replanPrompt = (plan, i, why) => [
  head(plan), "",
  `Шаг ${i + 1} не дал ожидаемого результата: ${why || "—"}`,
  "Пересоставь план с учётом этого. Сделанные шаги оставь как есть — теми же словами и в том же порядке;",
  "шаг, не давший результата, и всё после него замени новыми шагами (или убери, если они больше не нужны).",
  'Ответь ТОЛЬКО JSON: {"request": "...", "result": "...", "steps": [{"action": "...", "expect": "..."}]}.',
  'Если просьбу выполнить нельзя, ответь ТОЛЬКО JSON: {"impossible": "почему"}.',
].join("\n");

const finalPrompt = (plan) => [
  head(plan), "",
  "Все шаги выполнены. Проверь, достигнут ли ожидаемый результат просьбы.",
  "Если да — ответь человеку словами: что сделано и каков итог, коротко, без JSON.",
  'Если нет — ответь ТОЛЬКО JSON: {"notDone": "чего не хватает"}.',
].join("\n");

export const UNSOLVED_LEAD = "Не справился, нужна ваша помощь:";
export const CANCELLED = "Отменено";
export const CONFIRMED_RESULT = "подтверждено человеком и применено";
export const REFUSED_RESULT = "человек отказал — изменение не сделано";
export const WAITING_RESULT = "ждёт подтверждения человека";

/**
 * Прогнать просьбу через план.
 * `run(prompt)` — один разговор модели с инструментами, возвращает текст.
 * `onPlan(text)` — план словами при каждом изменении.
 * `stopWhen(text)` — ответ, на котором план обрывается: изменение ждёт
 * подтверждения человека кнопками (ASKED_TEXT в runAgent) — дальше идти
 * нельзя, шаги опирались бы на несделанное. Такой ответ и есть ответ
 * человеку; возвращается `{stopped: true, plan, at}`.
 * `resume: {plan, at, outcome}` — ПРОДОЛЖЕНИЕ ПОСЛЕ КНОПКИ (владелец,
 * 2026-09-22: «после выполнения первого действия агент перестаёт
 * выполнять план»): «applied» — шаг `at` сделан, дальше следующий;
 * «refused» — шаг не дал результата, план пересобирается с него. Нового
 * планирования при этом нет.
 * Возвращает `{planned, answer, plan, unsolved, stopped?, at?}`.
 */
export async function runPlanned({ question, run, onPlan = null, signal = null,
  maxReplans = MAX_REPLANS, title = "", stopWhen = null, resume = null }) {
  const show = async (plan) => {
    if (!onPlan) return;
    try { await onPlan(render(plan, { title })); } catch { /* статус не показался */ }
  };
  const halt = () => { if (signal?.aborted) throw new Error(CANCELLED); };
  const stopped = (text) => Boolean(stopWhen && stopWhen(String(text || "")));

  let plan;
  let i = 0;
  let refused = -1;
  if (resume?.plan?.steps?.length) {
    plan = { ...resume.plan, steps: resume.plan.steps.map((st) => ({ ...st })) };
    const at = Math.min(Math.max(0, Number(resume.at) || 0), plan.steps.length - 1);
    const step = plan.steps[at];
    if (resume.outcome === "refused") {
      step.state = "failed"; step.result = REFUSED_RESULT;
      i = at; refused = at;
    } else {
      step.state = "done"; step.result = CONFIRMED_RESULT;
      i = at + 1;
    }
    await show(plan);
  } else {
    const first = await run(question);
    plan = parsePlan(first);
    if (!plan || stopped(first)) return { planned: false, answer: first, plan: null, unsolved: false };
    if (plan.impossible) {
      return { planned: true, answer: `${UNSOLVED_LEAD} ${plan.impossible}`, plan: null, unsolved: true };
    }
    await show(plan);
  }

  let replans = 0;
  const unsolved = (why) => ({ planned: true, plan, unsolved: true,
    answer: `${UNSOLVED_LEAD} ${why}\n\n${render(plan)}` });
  /* Пересбор: сделанные шаги, совпавшие словами, остаются сделанными;
     выполнение идёт с первого изменённого. Шаг, не давший результата,
     из плана уходит вместе с тем, что после него. */
  const replan = async (at, why) => {
    replans += 1;
    if (replans > maxReplans) return unsolved(why);
    const next = parsePlan(await run(replanPrompt(plan, at, why)));
    if (!next) return unsolved(why);
    if (next.impossible) return { planned: true, plan, unsolved: true, answer: `${UNSOLVED_LEAD} ${next.impossible}` };
    let from = 0;
    while (from < at && from < next.steps.length
      && next.steps[from].action === plan.steps[from].action) {
      next.steps[from] = { ...plan.steps[from] };
      from += 1;
    }
    plan.request = next.request || plan.request;
    plan.result = next.result || plan.result;
    plan.steps = next.steps;
    i = from;
    await show(plan);
    return null;
  };
  /* Шаги по одному до конца плана; null — все сделаны, иначе — чем всё кончилось. */
  const walk = async () => {
    while (i < plan.steps.length) {
      halt();
      const step = plan.steps[i];
      const raw = await run(stepPrompt(plan, i));
      if (stopped(raw)) {
        step.result = WAITING_RESULT;
        return { planned: true, answer: String(raw).trim(), plan, unsolved: false, stopped: true, at: i };
      }
      const out = parseStep(raw);
      step.result = out.result;
      if (out.ok) {
        step.state = "done";
        await show(plan);
        i += 1;
        continue;
      }
      step.state = "failed";
      await show(plan);
      const stop = await replan(i, out.result);
      if (stop) return stop;
    }
    return null;
  };

  if (refused >= 0) {
    const stop = await replan(refused, REFUSED_RESULT);
    if (stop) return stop;
  }
  const end = await walk();
  if (end) return end;
  halt();
  for (;;) {
    const text = await run(finalPrompt(plan));
    const j = parseJson(text);
    if (!(j && typeof j === "object" && j.notDone)) {
      return { planned: true, answer: String(text || "").trim(), plan, unsolved: false };
    }
    const stop = await replan(plan.steps.length, str(j.notDone, 1000));
    if (stop) return stop;
    const again = await walk();
    if (again) return again;
  }
}
