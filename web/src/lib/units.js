/* ════════════════════════════════════════════════════════════════
   ЕДИНИЦЫ РЕСУРСА · то, что и правда получилось, — со своим номером

   У ресурса есть количество: «технических заданий — 4». Но работают не с
   количеством, а с определённым заданием: вот это пришло от того
   заказчика, вот к нему относится вот этот дизайн. Число на это ответить
   не может — оно говорит, сколько всего, и молчит о том, что именно.

   Поэтому у каждой единицы есть НОМЕР. Он не заводится руками и не хранится
   вторым списком: единица рождается сдачей задачи. Приняли сдачу, где
   функция выдала «техническое задание», — появилось задание №3, и у него
   есть автор, дата, текст и приложенный файл. Второго места, где то же
   самое пришлось бы описывать заново, нет: переписанное разошлось бы с
   тем, что было на самом деле.

   ─── зачем номер нужен расчёту ───

   Функция не берёт одну и ту же единицу дважды. Если она её РАСХОДУЕТ —
   единицы больше нет ни у кого. Если не расходует — единица остаётся и
   достаётся другим функциям, но эта уже отработала по ней: прочитанную
   заявку не читают второй раз. Считать это можно только поединично, и
   номер — то, чем единицы различаются.

   ─── зачем номер нужен отчётам ───

   В раздел проекта кладут не «результаты функции вообще», а определённый
   результат: это техническое задание, этот дизайн к нему. Ссылка на
   раздел — это ссылка на конкретные вещи по их номерам.

   ─── откуда что взялось ───

   У сдачи есть не только «сколько взяли», но и КАКИЕ единицы взяли
   (`took`). Без этого родословную не построить: количества говорят, что
   израсходована одна заявка, и молчат о том, чья. А спрашивают именно об
   этом — «покажи весь отчёт вот по этому техническому заданию»: что из
   него выросло, кто это делал и чем кончилось.

   Записывать родословную ЗАДНИМ ЧИСЛОМ нельзя ничем: по количествам и
   датам она только угадывается, а угаданная родословная хуже отсутствующей
   — она выглядит знанием. Поэтому единицы называет исполнитель при сдаче,
   и сказанного может не быть: у старых сдач `took` пуст, и отчёт по
   единице честно говорит, что связь не записана.
   ════════════════════════════════════════════════════════════════ */

import { portSpends } from "./funcs.js";

const num = (v) => Number(v) || 0;

/* ═══ МАТЕРИАЛЫ · единицы, которые завели руками ═══

   Не всё рождается сдачей: договор пришёл от заказчика, макет прислали
   письмом, ключи выдали при регистрации. Такое кладут в «Материалы» на
   вкладке отчётов — и это ВТОРОЙ, и последний, источник единиц. Ресурс
   не имеет отдельного поля «есть сейчас»: сколько его есть — столько
   единиц в материалах и в принятых сдачах, минус то, что израсходовано
   (`stockOf`). Число, которое вводят руками, разошлось бы с вещами в
   первый же день: «есть 5», а скачать — три.

   Единица — что-то ОДНО: файл, текст или поле с уникальным кодом. Файл
   и текст — вещь, которую можно показать; код — вещь, которую можно
   назвать, когда показать нечего (ключ, номер, талон). Смешивать их в
   одной единице незачем: у неё либо есть содержимое, либо есть код.

   Хранится записью `{id, trait, kind, file|text|code, at, by}` — ОДНА
   запись на ОДНУ единицу. «Количество 10» в окне загрузки — десять
   единиц, и десять записей: у каждой свой номер, а у кода — свой код.
   Пять договоров одним файлом — это пять договоров, и на каждый можно
   сослаться отдельно; одна запись «×5» этого не даёт. Поле `qty` у
   записи читается (так завели образец и старые записи), но форма его
   больше не пишет. */

export const MATERIAL_KINDS = [
  { id: "file", name: "файл" },
  { id: "text", name: "текст" },
  { id: "code", name: "уникальное поле" },
];

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без 0/O, 1/I — их путают

/**
 * Уникальный код единицы: восемь знаков, читаемых вслух.
 *
 * Случайность — из `crypto`, где она есть; повтор с уже занятыми кодами
 * исключён перебором, а не верой в вероятность.
 */
export function newCode(taken = new Set()) {
  const bytes = new Uint8Array(8);
  for (let tries = 0; tries < 100; tries += 1) {
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
    const code = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    if (!taken.has(code)) return code;
  }
  return `${Date.now().toString(36).toUpperCase()}`;
}

export const materialKind = (m) => (["file", "text", "code"].includes(m?.kind) ? m.kind : "text");

/**
 * Записи материалов для одной загрузки: по записи на каждую единицу.
 *
 * Файл или текст у всех N одинаковый — вещь одна и та же, — а номера
 * разные; у кода к тому же свой код в каждой записи.
 */
export function newMaterials({ trait, qty = 1, kind = "text", file = null, text = "",
  by = null, at = new Date().toISOString(), existing = [], codes = [] } = {}) {
  const n = Math.max(1, Math.floor(num(qty)) || 1);
  const k = materialKind({ kind });
  const stamp = Date.now().toString(36);
  const base = { trait, kind: k, at, by, qty: 1, file: null, text: "", code: "",
    ...(k === "file" ? { file: file || null } : {}),
    ...(k === "text" ? { text: String(text || "") } : {}) };
  if (k === "code") {
    const taken = new Set(existing.map((m) => m.code).filter(Boolean));
    /* Коды, которые человек уже видел в окне (`codes`), и ложатся в
       запись: показать один код, а сохранить другой — обман. Занятый или
       пустой заменяется новым. */
    return Array.from({ length: n }, (_, i) => {
      const code = codes[i] && !taken.has(codes[i]) ? codes[i] : newCode(taken);
      taken.add(code);
      return { ...base, id: `m${stamp}${i.toString(36)}`, code };
    });
  }
  return Array.from({ length: n }, (_, i) => ({ ...base, id: `m${stamp}${i.toString(36)}` }));
}

/** Чужая запись — к нынешнему виду, без переноса чисел. */
export const normalizeMaterials = (list) => (Array.isArray(list) ? list : [])
  .filter((m) => m && typeof m === "object" && m.trait)
  .map((m) => ({
    ...m,
    id: m.id ?? `m${Math.random().toString(36).slice(2, 10)}`,
    kind: materialKind(m),
    qty: Math.max(1, Math.floor(num(m.qty)) || 1),
    at: m.at || null,
    by: m.by ?? null,
  }));

/** Одна сдача задачи — последняя: по ней и судят о выполнении. */
const lastSub = (t) => {
  const s = t?.submissions || [];
  return s.length ? s[s.length - 1] : null;
};

/**
 * Все единицы ресурсов, которые получились из сдач.
 *
 * Одна строка — один ресурс одной сдачи: сколько его вышло, кто сделал,
 * когда и что приложил. Принятые и непринятые различены: непринятая сдача
 * — это заявление исполнителя, а не результат, но прятать то, что человек
 * уже сдал, незачем.
 *
 * Номер (`no`) — порядковый внутри своего ресурса, от старых к новым: он
 * должен читаться вслух («задание №3»), а не быть строкой из букв.
 */
export function unitsOf({ tasks = [], funcs = [], materials = [] } = {}) {
  const rows = [];
  /* Материалы — единицы, заведённые руками (см. выше): у них нет задачи
     и сдачи, но есть номер, автор, дата и содержимое — то же, что и у
     рождённых сдачей. Приняты всегда: их не сдавали, их положили. */
  normalizeMaterials(materials).forEach((m) => {
    rows.push({
      id: m.id, trait: m.trait, qty: m.qty, took: [],
      task: null, title: "", func: null, funcName: "", sub: null,
      at: m.at || null, by: m.by ?? null,
      text: m.kind === "text" ? (m.text || "") : "",
      file: m.kind === "file" ? (m.file || null) : null,
      code: m.kind === "code" ? (m.code || "") : "",
      kind: m.kind, from: "material", accepted: true,
    });
  });
  tasks.forEach((t) => {
    /* Отменённая работа вещей не порождает: сдача по ней есть, но решение
       — «этого не делаем», и ставить её результат в один ряд с настоящими
       единицами значило бы завести вещь, которой в деле нет. */
    if (t.canceled === true) return;
    const sb = lastSub(t);
    if (!sb) return;
    const f = funcs.find((x) => x.id === t.funcId) || null;
    Object.entries(sb.gives || {}).forEach(([trait, v]) => {
      const qty = num(v);
      if (!(qty > 0)) return;
      rows.push({
        id: `${sb.id}~${trait}`,
        trait,
        qty,
        // Из каких единиц это сделано — как сказал исполнитель при сдаче.
        took: [...new Set(Object.values(sb.took || {}).flat().filter(Boolean))],
        task: t.id,
        title: t.title || "",
        func: t.funcId || null,
        funcName: f?.name || "",
        sub: sb.id,
        at: sb.at || null,
        by: t.assignee ?? null,
        text: sb.text || "",
        /* Файл ИМЕННО ЭТОЙ вещи. Прежде у всех единиц одной сдачи был один
           и тот же файл отчёта: сдача, выдавшая и макет, и смету, отдавала
           обеим один документ, и скачать сам макет было неоткуда. Теперь
           исполнитель прикладывает каждую выданную вещь отдельно
           (`gives` → `files`), а старый общий файл остаётся запасным: у
           сдач, сделанных до этого, других файлов нет. */
        file: (sb.files || {})[trait] || sb.file || null,
        code: "", kind: (sb.files || {})[trait] || sb.file ? "file" : "text",
        from: "task",
        accepted: t.status === "done",
      });
    });
  });
  rows.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  const seq = {};
  rows.forEach((r) => { seq[r.trait] = (seq[r.trait] || 0) + 1; r.no = seq[r.trait]; });
  return rows;
}

/**
 * Как единицу назвать в одну строку: код, имя файла, начало текста — или
 * название задачи, из которой она вышла. Одно правило на все списки, чтобы
 * одна и та же вещь в разных местах не звалась по-разному.
 */
export function unitLabel(u = {}) {
  if (u.from === "material") {
    if (u.code) return u.code;
    if (u.file?.name) return u.file.name;
    const t = String(u.text || "").trim();
    return t ? (t.length > 40 ? `${t.slice(0, 39)}…` : t) : "материал";
  }
  return u.title || "без названия";
}

/** Единицы одного ресурса — от новых к старым, как их и выбирают. */
export const unitsOfTrait = (model, trait) => unitsOf(model)
  .filter((u) => u.trait === trait)
  .reverse();

/** Единица по номеру — для ссылки из отчёта: ссылаются на вещь, а не на кучу. */
export const unitById = (model, id) => unitsOf(model).find((u) => u.id === id) || null;

/**
 * Сколько единиц каждого ресурса функция УЖЕ ОБРАБОТАЛА.
 *
 * Считается по принятым задачам этой функции: что записано во «взято», то
 * и обработано. Непринятая сдача не считается — она ещё не результат.
 *
 * Нужно там, где решается, можно ли за работу взяться: вход, который не
 * расходуется, второй раз этой же функции не даётся, хотя лежит на месте и
 * достаётся другим.
 */
export function doneBy(tasks = [], funcId) {
  const by = {};
  tasks.filter((t) => t.funcId === funcId && t.status === "done"
    && t.canceled !== true).forEach((t) => {
    const sb = lastSub(t);
    if (!sb) return;
    Object.entries(sb.takes || {}).forEach(([trait, v]) => {
      const q = num(v);
      if (q > 0) by[trait] = (by[trait] || 0) + q;
    });
  });
  return by;
}

/**
 * Обработанное — только по тем входам, которые не расходуются.
 *
 * У расходуемого входа считать нечего: взятое исчезло, и его нет ни у кого,
 * — это видно по самому остатку ресурса, а не по истории функции.
 */
export function heldBy(tasks = [], f) {
  if (!f) return {};
  const all = doneBy(tasks, f.id);
  const out = {};
  (f.takes || []).filter((p) => !portSpends(p)).forEach((p) => {
    if (all[p.trait] != null) out[p.trait] = all[p.trait];
  });
  return out;
}

/* ─────── сколько есть ───────

   Ресурс — это то, что есть, и есть его ровно столько, сколько единиц
   лежит: материалы плюс принятые сдачи, минус израсходованное. Поле
   «есть сейчас» у ресурса больше не вводят руками — оно считается отсюда,
   и число сходится с вещами, которые можно скачать. */

/** Какие единицы уже израсходованы — по номерам, которые назвали при сдаче. */
export function spentIds({ tasks = [], funcs = [] } = {}) {
  const out = new Set();
  tasks.filter((t) => t.status === "done" && t.canceled !== true).forEach((t) => {
    const sb = lastSub(t);
    const f = funcs.find((x) => x.id === t.funcId);
    if (!sb || !f) return;
    Object.entries(sb.took || {}).forEach(([trait, ids]) => {
      const p = (f.takes || []).find((x) => x.trait === trait);
      if (p && portSpends(p)) (ids || []).forEach((id) => out.add(id));
    });
  });
  return out;
}

/**
 * Остаток каждого ресурса: сумма принятых единиц минус расход.
 *
 * Расход считается количеством, а не номерами: у старых сдач взятое не
 * названо, а взято оно было. Номера (`spentIds`) — для пометки в списке,
 * количество — для числа: так число не врёт на старых записях, а список
 * не выдумывает, какая именно единица ушла.
 */
export function stockOf(model = {}) {
  const { tasks = [], funcs = [] } = model;
  const have = {};
  unitsOf(model).filter((u) => u.accepted).forEach((u) => {
    have[u.trait] = (have[u.trait] || 0) + num(u.qty);
  });
  tasks.filter((t) => t.status === "done" && t.canceled !== true).forEach((t) => {
    const sb = lastSub(t);
    const f = funcs.find((x) => x.id === t.funcId);
    if (!sb || !f) return;
    Object.entries(sb.takes || {}).forEach(([trait, v]) => {
      const p = (f.takes || []).find((x) => x.trait === trait);
      if (p && portSpends(p) && num(v) > 0) have[trait] = (have[trait] || 0) - num(v);
    });
  });
  Object.keys(have).forEach((k) => { have[k] = Math.max(0, have[k]); });
  return have;
}

/**
 * Ресурсы с посчитанным «есть» вместо записанного.
 *
 * Расчёт (`plan`, `chain`, `shortage`) читает `t.have`, и переучивать его
 * незачем: подставляем ему ресурсы, у которых `have` — остаток по
 * материалам. Записанное в модели число при этом не трогается и не
 * читается: см. «сколько есть» выше.
 */
export function withStock(model = {}) {
  const stock = stockOf(model);
  return (model.traits || []).map((t) => ({ ...t, have: stock[t.id] || 0 }));
}

/* ─────── родословная ───────

   Единица сделана из других единиц, а те — из третьих. По этой ниточке и
   отвечают на вопрос «что выросло вот из этого технического задания»:
   вперёд — потомки, назад — из чего оно само.

   Ниточка есть ровно там, где исполнитель назвал взятое при сдаче. Где не
   назвал — её нет, и достраивать её по количествам и датам нельзя: вышла
   бы догадка с видом знания. */

/** Из чего сделана эта единица — прямые предки, как их назвали при сдаче. */
export function parentsOf(units = [], id) {
  const u = units.find((x) => x.id === id);
  return (u?.took || []).map((p) => units.find((x) => x.id === p)).filter(Boolean);
}

/**
 * Всё, что выросло из этой единицы, — она сама и её потомки, до конца.
 *
 * Кольцо не зацикливает: единица, уже попавшая в ответ, второй раз не
 * разворачивается.
 */
export function descendantsOf(units = [], id) {
  if (!id) return [];
  const out = [];
  const seen = new Set();
  const walk = (cur) => {
    if (!cur || seen.has(cur)) return;
    seen.add(cur);
    const self = units.find((x) => x.id === cur);
    if (self) out.push(self);
    units.forEach((u) => { if ((u.took || []).includes(cur)) walk(u.id); });
  };
  walk(id);
  return out;
}

/** Записана ли у единицы родословная вообще — или её никто не называл. */
export const hasLineage = (units = [], id) =>
  units.some((u) => (u.took || []).includes(id))
  || ((units.find((x) => x.id === id)?.took || []).length > 0);
