/* ════════════════════════════════════════════════════════════════
   ОЦЕНКИ БЕЗ ИМЕНИ: сбор и отложенная публикация

   Оценка — часть работы, а не отношение к человеку. Прежде оценка стояла
   рядом с решением проверяющего и показывалась сразу, с именем. Оценка с
   именем читается как «он меня не любит», и ставить её честно нельзя:
   ставящий думает не о работе, а о том, что скажет оценённый. Поэтому:

   · оценка публикуется БЕЗ АВТОРА;
   · публикуется она только тогда, когда автора нельзя вычислить: у
     человека по этому виду оценок должно быть не меньше двух от РАЗНЫХ
     людей — среди опубликованных и ожидающих вместе. Одна-единственная
     оценка от одного проверяющего анонимной не бывает;
   · за одну попытку публикуется не больше ОДНОЙ оценки: две сразу говорят
     «вот эти двое», одна — только «кто-то из них».

   Два вида оценок, и правила у них одинаковые:

   · за ВЫПОЛНЕНИЕ — из решения проверяющего (`reviews[]`): про
     исполнителя, ставит проверяющий;
   · за ПОСТАНОВКУ — из сдачи (`submissions[].setterRating`): про
     постановщика, ставит исполнитель.

   Кому что видно: свои оценки и свой рейтинг человек не видит — рейтинг
   существует, чтобы ЕМУ поручали, а не чтобы он на себя смотрел. Видит он
   комментарии, адресованные ему (скрытые — сразу, публичные — когда
   опубликованы), чужие рейтинги и чужие публичные комментарии.

   ─── скрытость одна на отметку и слова ───

   `hidden` у оценки относится и к отметке, и к словам. Скрытую отметку
   видит только автор — но в СРЕДНИЕ она входит наравне с публичной:
   средняя и так без имени, а выкинуть из неё скрытые значило бы сделать
   рейтинг зависимым от того, что человек решил не показывать. Скрытые
   слова — автор и адресат (`commentsFor`), никому больше и никогда.
   Публичную оценку после публикации видят все (как в v1.1).

   ─── что хранится ───

   Только реестр опубликованного: `model.published` — список
   идентификаторов `${taskId}~${kind}~${by}`. Всё остальное — сами оценки,
   средние, число оценок — СЧИТАЕТСЯ из задач при каждом вопросе: хранить
   средние значило бы завести вторую правду, которая разойдётся с первой
   при первой же правке задачи. Реестр же хранить необходимо: «опубликовано
   ли» — это то, что случилось, а из модели этого не вывести.
   ════════════════════════════════════════════════════════════════ */

export const RATING_KINDS = ["work", "setup"];

/** Один идентификатор на оценку: задача, вид и автор. */
export const ratingId = (taskId, kind, by) => `${taskId}~${kind}~${by}`;

/* Оценка вне шкалы — не оценка; отсутствие оценки — тоже ответ (человек
   мог оставить одни слова). */
/* Шкала десятибалльная — та же, что в приложении (`MARK_MAX` в
   `web/src/lib/workers.js`): разойдись они, сервер отбрасывал бы оценки,
   которые интерфейс дал поставить. */
export const MARK_MAX = 10;
const markOf = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= MARK_MAX ? n : null;
};
const str = (v) => (v == null ? null : String(v));

/**
 * Все оценки модели — как они есть, с автором. Наружу это не отдаётся:
 * автор нужен только для правила «от двух разных людей».
 *
 * Оценка — это отметка или слова, или и то и другое: одни слова без
 * отметки тоже говорят о работе, и прятать их от публикации незачем.
 * Оценка самому себе не считается: постановщик, равный исполнителю, не
 * оценивает свою же постановку, а проверяющий, равный исполнителю, не
 * ставит решения вовсе.
 *
 * На одну задачу, вид и автора — одна оценка, последняя: вернул, потом
 * принял — считается приём.
 */
export function collectRatings(model = {}) {
  const out = new Map();
  (model.tasks || []).forEach((task) => {
    const assignee = str(task.assignee);
    const setter = str(task.setter);
    (task.reviews || []).forEach((rv) => {
      if (!rv || !rv.accept || assignee == null) return;
      const by = str(rv.by);
      if (by == null || by === assignee) return;
      const mark = markOf(rv.mark);
      const comment = String(rv.comment || "").trim();
      if (mark == null && !comment) return;
      const id = ratingId(task.id, "work", by);
      out.set(id, { id, taskId: task.id, kind: "work", subject: assignee, by,
        mark, comment, hidden: !!rv.hidden, at: rv.at || null });
    });
    (task.submissions || []).forEach((sb) => {
      const r = sb?.setterRating;
      if (!r || typeof r !== "object" || setter == null || assignee == null) return;
      if (setter === assignee) return;
      const mark = markOf(r.mark);
      const comment = String(r.comment || "").trim();
      if (mark == null && !comment) return;
      const id = ratingId(task.id, "setup", assignee);
      out.set(id, { id, taskId: task.id, kind: "setup", subject: setter, by: assignee,
        mark, comment, hidden: !!r.hidden, at: sb.at || null });
    });
  });
  return [...out.values()];
}

const publishedSet = (model) => new Set((model?.published || []).map(String));

/**
 * Одна попытка публикации: не больше одной оценки за вызов.
 *
 * Публикуется самая ранняя из ожидающих, у которой по человеку и виду
 * набралось не меньше двух авторов — считая и уже опубликованные, и
 * ожидающие. Порядок по времени, а не случайный: иначе две попытки подряд
 * давали бы разный результат на одной и той же модели.
 *
 * Пишет в `model.published` и говорит, изменилась ли модель: кто вызвал,
 * тот и решает, записывать ли её на диск.
 */
export function publishStep(model = {}) {
  const all = collectRatings(model);
  const done = publishedSet(model);
  const pending = all.filter((r) => !done.has(r.id))
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))
      || a.id.localeCompare(b.id));
  const authors = (r) => new Set(all
    .filter((x) => x.subject === r.subject && x.kind === r.kind).map((x) => x.by));
  const next = pending.find((r) => authors(r).size >= 2);
  if (!next) return { published: null, changed: false };
  model.published = [...(model.published || []), next.id];
  return { published: next, changed: true };
}

/* Опубликованная оценка — без автора, без задачи и без времени: любое из
   трёх называет автора не хуже имени. Скрытая здесь остаётся со своей
   отметкой — из этого списка считаются средние; наружу отдельные оценки
   не уходят (`viewRatingsFor` отдаёт только средние и публичные слова). */
const anonymous = (r) => ({ kind: r.kind, subject: r.subject, mark: r.mark,
  comment: r.comment, hidden: r.hidden });

/**
 * Опубликованные оценки — те, что можно показывать. Только они и идут в
 * рейтинг; в порядке публикации, а не по времени оценки.
 */
export function publishedRatings(model = {}, { subject } = {}) {
  const order = (model.published || []).map(String);
  const rank = new Map(order.map((id, i) => [id, i]));
  return collectRatings(model)
    .filter((r) => rank.has(r.id))
    .filter((r) => subject == null || r.subject === String(subject))
    .sort((a, b) => rank.get(a.id) - rank.get(b.id))
    .map(anonymous);
}

const avg = (list) => (list.length
  ? list.reduce((s, v) => s + v, 0) / list.length : null);
const stat = (rows) => {
  const marks = rows.map((r) => r.mark).filter((m) => m != null);
  return { mark: avg(marks), count: marks.length };
};

/**
 * Рейтинг человека — только из опубликованного, скрытые отметки — тоже.
 *
 * `mark`/`count` — за выполнение: это и есть рейтинг, по которому
 * выбирают, кому поручить. `setup` — за постановку, отдельно: как человек
 * ставит задачи, к тому, как он их делает, не прибавляется. `null` —
 * «оценок нет», а не ноль. Скрытая отметка считается наравне с публичной:
 * скрытость прячет её от глаз, а не из рейтинга.
 */
export function statsFor(model = {}, subject) {
  const rows = publishedRatings(model, { subject });
  return { ...stat(rows.filter((r) => r.kind === "work")),
    setup: stat(rows.filter((r) => r.kind === "setup")) };
}

/**
 * Какие слова этому человеку показывать.
 *
 * `mine` — адресованные ему: скрытые про него (сразу — их для него и
 * писали) и опубликованные публичные про него. `others` — чужие
 * опубликованные публичные, по людям. Своих слов автор здесь не видит:
 * это ответ на вопрос «что мне сказали», а не «что я сказал».
 */
export function commentsFor(model = {}, { viewer } = {}) {
  const me = str(viewer);
  const done = publishedSet(model);
  const mine = [];
  const others = {};
  collectRatings(model).forEach((r) => {
    if (!r.comment || r.by === me) return;
    const published = done.has(r.id);
    if (r.subject === me) {
      if (r.hidden || published) mine.push({ kind: r.kind, text: r.comment, hidden: r.hidden });
    } else if (published && !r.hidden) {
      (others[r.subject] = others[r.subject] || []).push({ kind: r.kind, text: r.comment });
    }
  });
  return { mine, others };
}

/**
 * Ответ на «покажи рейтинги» для одного человека.
 *
 * Про себя — только слова, без единой цифры: свой рейтинг человек не
 * видит. Про остальных — средняя, число оценок и публичные слова; ни в
 * одном поле нет автора.
 */
export function viewRatingsFor(model = {}, viewerId) {
  const me = str(viewerId);
  const { mine, others: words } = commentsFor(model, { viewer: me });
  const subjects = new Set(publishedRatings(model).map((r) => r.subject));
  Object.keys(words).forEach((id) => subjects.add(id));
  subjects.delete(me);
  const others = {};
  subjects.forEach((id) => {
    others[id] = { ...statsFor(model, id), comments: words[id] || [] };
  });
  return { mine: { comments: mine }, others };
}
