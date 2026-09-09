import { identify, readOrg } from "./orgStore.js";
import { readModel, viewFor } from "./workspaceStore.js";
import { listReports } from "./reportStore.js";
import { listMeetings, listTranscripts } from "./callStore.js";
import { listMemory } from "./memoryStore.js";
import { chatsFor } from "./chatStore.js";
import { INTERRUPTED, NO_MODEL, isStalePending } from "./transcribe.js";

/* ════════════════════════════════════════════════════════════════
   ЧТО ПОМОЩНИК ЗНАЕТ ПРО СПРАШИВАЮЩЕГО

   Помощник — не новый источник правды, а второй способ спросить ту же
   модель словами. Своей границы видимости у него нет: он знает ровно то,
   что человеку и так показывает приложение. Поэтому контекст собирается
   теми же функциями, что и экраны: `viewFor` даёт задачи, `listReports` —
   файлы, `listMeetings` — встречи, `listMemory` — память. Владельцу —
   модель целиком, потому что он и так видит её целиком.

   Два раздела приходят не с экранов, а из того, что человек и так видит
   в Telegram: чаты групп, где он состоит вместе с ботом (`chatsFor`,
   членство проверяется у Telegram на каждый вопрос), и расшифровки его
   же записей звонков (`listTranscripts`). Чужой чат сюда не попадает
   именно потому, что проверка — при обращении, а не при записи.

   Собирается ЗАНОВО на каждый вопрос, а не один раз при старте: роль
   человека могут сменить между двумя вопросами, и ответ на второй должен
   это знать.

   Про других людей — ничего. Имена рядом с задачей — только те, что
   человек и так видит на её карточке (кто поставил, кто проверяет). Своих
   оценок человек не видит нигде (см. C4), и здесь их тоже нет.

   Прогноз и план здесь НЕ считаются: движок живёт в браузере
   (`web/src/lib/plan.js`), а сервер отдаёт то, что записано в модели, —
   и говорит об этом в самом контексте, чтобы модель не выдавала запись
   за расчёт.
   ════════════════════════════════════════════════════════════════ */

export const MAX_CONTEXT_CHARS = 60000;
export const TRUNCATED_NOTE = "[список обрезан: контекст больше 60 000 знаков, конец не поместился]";

const STATUS_WORDS = {
  wait: "ожидает постановки", backlog: "ожидает", deferred: "отложено",
  deadline: "дедлайн", progress: "в работе", review: "на проверке", done: "готово",
};
const RATE_WORDS = { once: "разово", day: "в день", week: "в неделю", month: "в месяц" };
const PER_WORDS = { day: "в день", week: "в неделю", month: "в месяц" };

const str = (v) => (v == null ? "" : String(v)).trim();
// Пусто — это пусто, а не ноль: «количество не названо» и «есть 0» —
// разные ответы, и путать их значило бы врать про модель.
const num = (v) => (v === null || v === undefined || v === "" ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Вилка «lo–hi» словами; одно число — без тире. */
const range = (lo, hi) => {
  const a = num(lo), b = num(hi);
  if (a == null && b == null) return "не названо";
  if (b == null || a === b) return String(a ?? b);
  return `${a}–${b}`;
};

/* Дата — как записана, только короче: «2026-09-07T15:00» читается и
   человеком, и моделью, а пересчёт в часовой пояс без знания пояса был
   бы выдумкой. */
const when = (iso) => {
  const s = str(iso);
  if (!s) return "";
  return s.replace("T", " ").replace(/(\d{2}:\d{2}):\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/, "$1");
};

const namesOf = (org) => {
  const map = new Map((org?.users || []).map((u) => [String(u.id), u.name || String(u.id)]));
  return (id) => (id == null || id === "" ? "не назначен" : (map.get(String(id)) || `id ${id}`));
};

/* ─────── модель (только владельцу) ─────── */

export function describeModel(model = {}) {
  const traits = model.traits || [];
  const kinds = new Map((model.kinds || []).map((k) => [k.id, k.name]));
  const entities = model.entities || [];
  const entName = (id) => entities.find((e) => e.id === id)?.name || "актив без названия";
  const traitName = (id) => {
    const t = traits.find((x) => x.id === id);
    return t ? (t.l || "ресурс без названия") : "ресурс не выбран";
  };
  const port = (p) => {
    const t = traits.find((x) => x.id === p.trait);
    const unit = t?.unit ? ` ${t.unit}` : "";
    return `${traitName(p.trait)} ${range(p.lo, p.hi)}${unit}`;
  };
  const out = ["## Модель: активы, их ресурсы и функции",
    "Числа ниже — как записаны в модели (план, вилки «от–до»). Прогноз и план по целям здесь не посчитаны."];

  if (!entities.length) out.push("Активов в модели нет.");
  entities.forEach((e) => {
    out.push(`\nАктив «${e.name || "без названия"}»`);
    const own = traits.filter((t) => t.e === e.id);
    out.push(own.length
      ? `  ресурсы: ${own.map((t) => {
        const have = num(t.have);
        /* Классификаций у ресурса бывает несколько (`ks`); прежняя запись
           с одним `k` читается как список из одного. Назвать помощнику одну
           из трёх значило бы рассказать про вещь неправду. */
        const named = (Array.isArray(t.ks) ? t.ks : (t.k ? [t.k] : []))
          .map((id) => kinds.get(id)).filter(Boolean);
        const kind = named.length ? ` (${named.join(", ")})` : "";
        return `${t.l || "без названия"}${kind} — ${have == null ? "количество не названо" : `есть ${have}${t.unit ? ` ${t.unit}` : ""}`}`;
      }).join("; ")}`
      : "  ресурсы: не заведены");
    const fns = (model.funcs || []).filter((f) => f.e === e.id);
    if (!fns.length) { out.push("  функции: не заведены"); return; }
    out.push("  функции:");
    fns.forEach((f) => {
      const kind = f.kind === "factor" ? " (фактор: происходит само, без людей)" : "";
      const takes = (f.takes || []).length ? `берёт ${f.takes.map(port).join(", ")}` : "ничего не берёт";
      const gives = (f.gives || []).length
        ? `даёт ${f.gives.map((p) => {
          const t = traits.find((x) => x.id === p.trait);
          const to = t && t.e && t.e !== e.id ? ` → в актив «${entName(t.e)}»` : "";
          return port(p) + to;
        }).join(", ")}`
        : "ничего не даёт";
      const dur = `время одного выполнения ${range(f.dur, f.durHi)} ${f.durUnit || "ч"}`;
      const every = num(f.every) ? `; повтор раз в ${range(f.every, f.everyHi)} ${f.everyUnit || "ч"}` : "; идёт непрерывно";
      out.push(`    «${f.name || "без названия"}»${kind}: ${takes}; ${gives}; ${dur}${every}`);
      if (str(f.about)) out.push(`      описание: ${str(f.about)}`);
    });
  });

  const goals = model.goals || [];
  out.push("\n## Цели");
  if (!goals.length) out.push("Целей не поставлено.");
  goals.forEach((g) => {
    const due = g.dueKind === "on"
      ? (str(g.dueOn) ? `к ${when(g.dueOn)}` : "срок не назван")
      : (num(g.dueIn) ? `через ${g.dueIn} ${g.dueUnit || "мес"}` : "срок не назван");
    const budget = num(g.hours)
      ? `; готовы тратить ${g.hours} ${g.hoursUnit || "ч"} ${PER_WORDS[g.hoursPer] || ""}`.trimEnd()
      : "; бюджет времени не задан";
    out.push(`- ${traitName(g.trait)}: ${num(g.qty) ?? "сколько — не названо"} ${RATE_WORDS[g.rate] || ""}, ${due}${budget}; ${g.appliedAt ? `применена ${when(g.appliedAt)}` : "ещё не применена (черновик)"}`);
  });

  const reports = model.reports || [];
  out.push("\n## Отчёты (карта проектов)");
  if (!reports.length) out.push("Проектов и разделов нет.");
  const pathOf = (n) => {
    const chain = [];
    let cur = n;
    for (let i = 0; cur && i < 20; i += 1) {
      chain.unshift(cur.name || "без названия");
      cur = reports.find((x) => x.id === cur.parent);
    }
    return chain.join(" › ");
  };
  reports.forEach((n) => {
    const what = n.trait ? `ресурс «${traitName(n.trait)}»` : "ресурс не выбран";
    const units = (n.units || []).length ? `, единицы: ${n.units.join(", ")}` : "";
    out.push(`- ${pathOf(n)}: ${what}${units}${n.file ? `, файл «${n.file.name || "без имени"}»` : ""}`);
  });
  return out.join("\n");
}

/* ─────── задачи (у каждого свои; у владельца — все, как на доске) ─────── */

export function describeTasks(tasks = [], { funcs = [], nameOf = (id) => String(id), me = "" } = {}) {
  const out = ["## Задачи"];
  if (!tasks.length) { out.push("Задач нет."); return out.join("\n"); }
  const role = (t) => [
    String(t.setter || "") === me ? "вы ставите" : null,
    String(t.assignee || "") === me ? "вы исполняете" : null,
    String(t.reviewer || "") === me ? "вы проверяете" : null,
  ].filter(Boolean).join(", ");
  tasks.forEach((t) => {
    const f = funcs.find((x) => x.id === t.funcId);
    const line = [`- «${t.title || "без названия"}»`];
    if (f) line.push(`(функция «${f.name || "без названия"}»)`);
    line.push(`— ${STATUS_WORDS[t.status] || str(t.status) || "статус не назван"}`);
    line.push(`; срок ${t.end ? when(t.end) : "не назначен"}`);
    if (t.start) line.push(`; начало ${when(t.start)}`);
    if (t.deferredAt) line.push(`; отложена ${when(t.deferredAt)}`);
    const mine = role(t);
    if (mine) line.push(`; ${mine}`);
    line.push(`; поставил: ${nameOf(t.setter)}; исполнитель: ${nameOf(t.assignee)}; проверяет: ${nameOf(t.reviewer)}`);
    out.push(line.join(" ").replace(/\s+;/g, ";"));
    if (str(t.body)) out.push(`  содержимое: ${str(t.body).slice(0, 1000)}`);
    (t.submissions || []).forEach((s) => {
      // Оценки постановки (setterRating) здесь нет намеренно: свои оценки
      // человек не видит, а чужие публикуются без автора отдельно (C4).
      const files = Object.values(s.files || {}).map((fr) => fr?.name).filter(Boolean);
      out.push(`  сдача ${when(s.at)}: ${num(s.hours) ?? "часы не названы"} ч${str(s.text) ? `; «${str(s.text).slice(0, 500)}»` : ""}${s.file?.name ? `; файл «${s.file.name}»` : ""}${files.length ? `; выданы файлы: ${files.join(", ")}` : ""}`);
    });
    (t.reviews || []).forEach((r) => {
      // Решение видно всем, кто видит задачу; оценка — нет (C4). Скрытый
      // комментарий — только адресату (исполнителю) и автору.
      const canRead = !r.hidden || String(r.by) === me || String(t.assignee || "") === me;
      out.push(`  решение проверяющего ${when(r.at)}: ${r.accept ? "принято" : "возвращено на доработку"}${canRead && str(r.comment) ? ` — «${str(r.comment).slice(0, 500)}»` : ""}`);
    });
    (t.comments || []).forEach((c) => {
      const canRead = !c.hidden || String(c.by) === me || String(c.to || "") === me;
      if (!canRead) return;
      out.push(`  комментарий ${when(c.at)} от ${nameOf(c.by)}${c.hidden ? " (скрытый, только вам)" : ""}: «${str(c.text).slice(0, 500)}»`);
    });
  });
  return out.join("\n");
}

/* ─────── файлы, встречи, память ─────── */

const kb = (n) => (n >= 1024 * 1024 ? `${Math.round(n / 1024 / 1024)} МБ` : `${Math.max(1, Math.round((n || 0) / 1024))} КБ`);

export function describeFiles(files = []) {
  const out = ["## Файлы отчётов"];
  if (!files.length) { out.push("Файлов нет."); return out.join("\n"); }
  files.forEach((f) => out.push(`- «${f.name}» (${f.type}, ${kb(f.size)}${f.kind === "call" ? ", запись созвона" : ""}), загружен ${when(f.savedAt)}`));
  return out.join("\n");
}

export function describeMeetings(meetings = []) {
  const out = ["## Встречи"];
  if (!meetings.length) { out.push("Встреч нет."); return out.join("\n"); }
  meetings.forEach((m) => out.push(`- «${m.title}»${m.at ? `, ${m.at}` : ", время не названо"}${str(m.text) ? `: ${str(m.text).slice(0, 500)}` : ""} (заведена ${when(m.createdAt)})`));
  // Содержание звонка — не здесь: оно есть только у тех встреч, что
  // записали и расшифровали, и живёт в разделе «Записи звонков».
  out.push("Здесь только название, время и текст приглашения; о чём говорили — в разделе «Записи звонков».");
  return out.join("\n");
}

/* ─────── записи звонков с расшифровками ─────── */

/** Сколько знаков расшифровок уходит в контекст — новые записи важнее. */
export const TRANSCRIPT_CONTEXT_CHARS = 20000;

/**
 * Записи звонков — по одной строке на файл, с текстом, если он есть.
 * Чего нет — сказано, ПОЧЕМУ нет: модель не выбрана, ещё идёт, не
 * удалось. Молчание на месте текста читалось бы как «разговора не было».
 */
export function describeRecordings(recordings = [], transcripts = [], limit = TRANSCRIPT_CONTEXT_CHARS,
  now = Date.now()) {
  const out = ["## Записи звонков"];
  if (!recordings.length) { out.push("Записей звонков нет."); return out.join("\n"); }
  const byFile = new Map(transcripts.map((t) => [t.fileId, t]));
  let left = limit;
  recordings.forEach((f) => {
    const t = byFile.get(f.id);
    const head = `- «${f.name}», сохранена ${when(f.savedAt)}`;
    if (!t) { out.push(`${head}: ${NO_MODEL}.`); return; }
    if (t.status === "pending") {
      /* «Идёт» дольше, чем провайдеру вообще дают ответить, — не идёт:
         сервер перезапускали, и писать «идёт» значило бы обещать текст,
         которого не будет. При старте сервер такие перезапускает сам
         (lib/transcribe.js, resumeTranscripts); выбор модели заново — тоже. */
      out.push(isStalePending(t, now)
        ? `${head}: ${INTERRUPTED} (начата ${when(t.at)}) — сервер повторит её при запуске, а если текста так и нет, выберите модель расшифровки заново.`
        : `${head}: расшифровка ещё идёт (модель ${t.model || "не названа"}, начата ${when(t.at)}).`);
      return;
    }
    if (t.status !== "done") { out.push(`${head}: расшифровка не удалась — ${t.error || "причина не названа"}.`); return; }
    const text = str(t.text);
    if (left <= 0) { out.push(`${head}: расшифровка есть, но не поместилась в контекст (предел ${limit} знаков на записи).`); return; }
    const shown = text.length > left ? `${text.slice(0, left)} […расшифровка обрезана: не поместилась в контекст]` : text;
    left -= text.length;
    out.push(`${head}, расшифровка (${t.model || "модель не названа"}):`);
    out.push(`  «${shown}»`);
  });
  return out.join("\n");
}

/* ─────── чаты групп ─────── */

/**
 * Чаты, где человек состоит вместе с ботом. Сообщения — как сказаны, с
 * временем и именем: помощнику отвечать «что решили в чате про X», а не
 * пересказывать. Сколько не поместилось — числом.
 */
export function describeChats(chats = []) {
  const out = ["## Чаты (группы, где состоите вы и бот)"];
  if (!chats.length) {
    out.push("Чатов нет: бот не состоит ни в одной группе вместе с вами, или сообщений при нём там ещё не было.");
    return out.join("\n");
  }
  chats.forEach((c) => {
    const title = c.title || `чат ${c.chatId}`;
    const shown = c.dropped
      ? ` (показаны последние ${c.messages.length} из ${c.total} сообщений)`
      : ` (${c.total} сообщений)`;
    out.push(`### «${title}»${shown}`);
    c.messages.forEach((m) => {
      out.push(`- ${when(m.at)} ${m.from?.name || "неизвестно"}${m.edited ? " (исправлено)" : ""}: ${str(m.text)}`);
    });
  });
  return out.join("\n");
}

export function describeMemory(items = []) {
  const out = ["## Память помощника (то, что человек положил сам)"];
  if (!items.length) { out.push("Память пуста."); return out.join("\n"); }
  items.forEach((m) => {
    out.push(`### ${m.title}${m.file ? ` (файл «${m.file.name}»)` : ""}`);
    out.push(m.text || (m.file ? "Текста нет: файл не текстовый, помощник видит только его имя." : "Текста нет."));
  });
  return out.join("\n");
}

/** Обрезает до предела и говорит об этом последней строкой. */
export function fit(text, limit = MAX_CONTEXT_CHARS) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - TRUNCATED_NOTE.length - 1)}\n${TRUNCATED_NOTE}`;
}

/**
 * Контекст для одного вопроса одного человека. Всё — только своё; чего
 * у человека нет, названо словами, чтобы модель не додумывала.
 *
 * `isMember` — проверка членства в чате (по умолчанию Bot API,
 * см. chatStore.js); подменяется в тестах, потому что Telegram там нет.
 */
export async function contextFor(userId, { isMember } = {}) {
  const id = String(userId);
  // claim: false — вопрос помощнику не должен делать первого спросившего
  // владельцем модели.
  const me = await identify(id, {}, { claim: false });
  if (!me.known) throw new Error("Вас ещё не звали в модель");

  const [model, org, files, meetings, memory, transcripts, chats] = await Promise.all([
    readModel(), readOrg(), listReports(id), listMeetings(id), listMemory(id),
    listTranscripts(id), chatsFor(id, isMember ? { isMember } : {}),
  ]);
  const view = viewFor(model, me);
  const nameOf = namesOf(org);

  const parts = [
    `Спрашивает: ${me.name || "имя не названо"}${me.isOwner ? " (владелец модели)" : me.role ? ` (роль: ${me.role.name})` : " (роль не назначена)"}.`,
    `Сегодня ${new Date().toISOString().slice(0, 10)}.`,
  ];
  if (me.isOwner) parts.push(describeModel(model));
  // Владельцу — все задачи, как на его доске; остальным — только те, где
  // они постановщик, исполнитель или проверяющий (viewFor).
  parts.push(describeTasks(view.mine || [], { funcs: view.funcs || [], nameOf, me: id }));
  // Файлы памяти лежат в том же хранилище, но показываются в своём разделе.
  parts.push(describeFiles(files.filter((f) => f.kind !== "memory")));
  parts.push(describeMeetings(meetings));
  // Записи — те же файлы, что в listReports с kind «call» (и старые, без
  // метки, — по виду файла, как на вкладке звонков).
  parts.push(describeRecordings(await listReports(id, { kind: "call" }), transcripts));
  parts.push(describeMemory(memory));
  // Чаты — последними: у них свой предел (20 000 знаков), и при общем
  // обрезании контекста первыми режутся они, а не задачи человека.
  parts.push(describeChats(chats));

  return fit(parts.join("\n\n"));
}
