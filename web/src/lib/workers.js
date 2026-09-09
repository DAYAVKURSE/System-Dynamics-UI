/* ════════════════════════════════════════════════════════════════
   ИСТОРИЯ ВОРКЕРА: что делал, в какие сроки и как это приняли

   У актива есть люди, и о каждом надо знать не «сколько задач закрыл», а
   три вещи, которые видно только по истории:

   · **в какие сроки какие функции выполняет** — что именно делал, сколько
     времени было отведено и сколько ушло на самом деле;
   · **какие оценки получил** — по каждой работе своя, с комментарием
     проверяющего: средняя без разбора отдельных оценок ничего не лечит,
     потому что непонятно, за что снизили;
   · **укладывается ли в срок** — доля работ, сданных до назначенного конца.

   ─── почему средние считаются, а не хранятся ───

   Средняя оценка и доля «в срок» выводятся из тех же задач, что лежат в
   модели. Хранить их отдельным числом значило бы завести вторую правду:
   задачу поправили, а число осталось прежним, и человек смотрит на цифру,
   которой уже ничего не соответствует.

   ─── что считается выполнением ───

   Только принятая работа: у задачи статус «готово» и есть решение
   проверяющего. Сдача, которую не приняли, — заявление исполнителя, а не
   измерение; она попадает в историю отдельной строкой «вернули», но в
   среднюю оценку и в срок не идёт.

   ─── оценки без имени ───

   Оценка идёт в рейтинг не тогда, когда её поставили, а когда её
   ОПУБЛИКОВАЛИ (`model.published`, сервер: `lib/ratings.js`). Публикуется
   она без автора и только когда автора нельзя вычислить: у человека по
   этому виду оценок не меньше двух от разных людей. Непубликованная
   оценка для рейтинга не существует — иначе анонимность держалась бы на
   том, что интерфейс её не показывает.

   Свои оценки и свой рейтинг человек не видит: рейтинг существует, чтобы
   ЕМУ поручали, а не чтобы он на себя смотрел. Правило живёт в одном
   месте — `visibleStats()`; остальное просто спрашивает у него.

   ─── скрытость одна на отметку и слова ───

   `hidden` у решения проверяющего (и у оценки постановки) относится и к
   отметке, и к словам. Скрытую отметку видит только автор, скрытые слова —
   автор и адресат. В СРЕДНИЕ скрытая отметка входит наравне с публичной:
   средняя и так без имени, и выкинуть из неё скрытые значило бы дать
   человеку править чужой рейтинг тем, что он решил не показывать. Поэтому
   `statsOf` считает по всем строкам, а `historyOf` с `viewer` и
   `visibleStats` чужую скрытую строку показывают без отметки и без слов —
   как принятую работу, о которой оценивающий ничего не сказал вслух.
   ════════════════════════════════════════════════════════════════ */

/** Оценка — пятибалльная: меньше градаций не различает, больше не читается. */
export const MARK_MIN = 1;
export const MARK_MAX = 5;

/* Два вида оценок, и слова у них свои: «за выполнение» — про исполнителя,
   от проверяющего; «за постановку» — про постановщика, от исполнителя. */
export const RATING_KINDS = [
  { id: "work", name: "за выполнение" },
  { id: "setup", name: "за постановку" },
];
export const kindName = (id) => RATING_KINDS.find((k) => k.id === id)?.name || id;

/** Идентификатор оценки в реестре опубликованного: задача, вид, автор. */
export const ratingId = (taskId, kind, by) => `${taskId}~${kind}~${by}`;
const pubSet = (published) =>
  new Set(Array.isArray(published) ? published.map(String) : []);

/* ════════════════════════════════════════════════════════════════
   РАБОЧИЙ ГРАФИК И СТАТУС

   Рейтинг отвечает на вопрос «как он работает». Прежде чем его задавать,
   спрашивают другое, и куда более простое: РАБОТАЕТ ЛИ ОН СЕЙЧАС. Ставить
   задачу тому, у кого сегодня выходной, — значит назначить срок, который
   никто не обещал; а «он вообще-то в отпуске» узнаётся уже из просрочки.

   Две вещи, и они разные:

   · **график** — постоянное: в какие дни и с какого по какой час человек
     работает. Меняется редко и говорит о том, чего ждать вообще;
   · **статус** — сиюминутное: готов ли он взять работу прямо сейчас.
     График не отменяет: можно быть в рабочий день на коротком перерыве.

   Обе — со слов самого человека, как и анкета. Догадываться о чужом
   графике по времени его сообщений значило бы выдавать наблюдение за
   договорённость.
   ════════════════════════════════════════════════════════════════ */

/** Чем человек занят прямо сейчас — его собственными словами. */
export const WORK_STATUSES = [
  { id: "ready", name: "готов взять задачу", free: true },
  { id: "break", name: "короткий перерыв", free: false },
  { id: "off", name: "сегодня не работаю", free: false },
  { id: "busy", name: "не готов брать задачи", free: false },
];
export const statusOf = (id) =>
  WORK_STATUSES.find((s) => s.id === id) || WORK_STATUSES[0];

/* Часы — «ЧЧ:ММ» или пусто. Пусто это ответ: «часы не названы», а не
   полночь; подставлять за человека 00:00 значило бы записать за него
   рабочую ночь. */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const workTime = (v) => (HHMM.test(String(v || "")) ? String(v) : "");

/**
 * Рабочий график человека — в том виде, в каком его показывают.
 *
 * Дни пусты — это «дни не названы», а не «все семь»: у графика, в отличие
 * от бюджета цели, нет разумного значения по умолчанию. Молча дописать
 * человеку семидневку нельзя.
 */
export const scheduleOfPerson = (p = {}) => ({
  days: Array.isArray(p.days) ? [...new Set(p.days.map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [],
  from: workTime(p.from),
  to: workTime(p.to),
  status: statusOf(p.status).id,
});

/** Задан ли график вообще: без дней и без часов говорить не о чем. */
export const hasSchedule = (sc = {}) =>
  Boolean((sc.days || []).length || sc.from || sc.to);

/**
 * График словами: «пн–пт · 09:00–18:00».
 *
 * Идущие подряд дни склеиваются в отрезок: «пн, вт, ср, чт, пт» человек
 * читает как перечисление и пересчитывает в уме, а «пн–пт» — сразу.
 */
export function scheduleText(sc = {}, week = []) {
  const order = week.map((w) => w.id);
  const on = order.filter((id) => (sc.days || []).includes(id));
  const parts = [];
  if (on.length) {
    const runs = [];
    on.forEach((id) => {
      const last = runs[runs.length - 1];
      const i = order.indexOf(id);
      if (last && order.indexOf(last[last.length - 1]) === i - 1) last.push(id);
      else runs.push([id]);
    });
    const short = (id) => week.find((w) => w.id === id)?.short || id;
    parts.push(runs.map((r) => (r.length > 2
      ? `${short(r[0])}–${short(r[r.length - 1])}`
      : r.map(short).join(", "))).join(", "));
  }
  if (sc.from && sc.to) parts.push(`${sc.from}–${sc.to}`);
  else if (sc.from) parts.push(`с ${sc.from}`);
  else if (sc.to) parts.push(`до ${sc.to}`);
  return parts.join(" · ");
}

const num = (v) => Number(v) || 0;
const time = (v) => {
  if (v == null || v === "") return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};

/** Последняя сдача — та, по которой судят о работе. */
export const lastSubmission = (t) => {
  const s = t?.submissions || [];
  return s.length ? s[s.length - 1] : null;
};

/** Последнее решение проверяющего по задаче. */
export const lastReview = (t) => {
  const r = t?.reviews || [];
  return r.length ? r[r.length - 1] : null;
};

/** Среднее арифметическое — только по тем значениям, что есть. */
export const avg = (list) => {
  const ok = list.map(Number).filter((v) => Number.isFinite(v));
  return ok.length ? ok.reduce((s, v) => s + v, 0) / ok.length : null;
};

/**
 * Уложился ли в срок.
 *
 * Сравниваем момент сдачи с назначенным концом. Нет конца — не с чем
 * сравнивать: не «уложился» и не «сорвал», а «срок не ставили». Молча
 * засчитывать такую работу в срок нельзя — доля выросла бы на пустом месте.
 */
export function inTime(task, submission) {
  const end = time(task?.end);
  const at = time(submission?.at);
  if (end == null || at == null) return null;
  return at <= end;
}

/**
 * Чужая скрытая строка глазами смотрящего: ни отметки, ни слов, ни
 * признака «скрыто» — иначе сам признак говорил бы, что оценка есть и
 * какая-то не для всех. Остаётся принятая работа без сказанного вслух.
 * Автор видит свою строку целиком; адресат (сам исполнитель) — слова, но
 * отметку не видит и без того (`visibleStats`, `self`).
 */
const strangerHidden = (row) => ({ ...row, mark: null, comment: "", hidden: false,
  pending: false, published: false });

/**
 * Одна строка истории: что делал, когда, сколько заняло и как приняли.
 *
 * Оценка в строке есть только у ОПУБЛИКОВАННОЙ (`published` — реестр из
 * модели): принятая, но не опубликованная работа — `mark: null` и
 * `pending: true`, «оценка ещё не опубликована». Слова проверяющего идут
 * как есть, вместе с признаком «скрытые»: кому их показывать, решает
 * `visibleStats()`, а не история.
 *
 * `viewer` — кто смотрит. Назван — чужие скрытые строки (не автора и не
 * самого исполнителя) отдаются без отметки и без слов (`strangerHidden`).
 * Не назван — строки как есть: так считает средние `statsOf`, в которые
 * скрытые отметки входят.
 */
export function historyOf(tasks = [], funcs = [], personId, { published, viewer } = {}) {
  const id = String(personId);
  const pub = pubSet(published);
  const me = viewer == null ? null : String(viewer);
  const stranger = (row) => me != null && me !== id
    && !(row.by != null && String(row.by) === me);
  /* Отменённая работа в историю человека не идёт: её не делали как работу,
     и ставить её в один ряд со сделанным — значит считать отменой то, чего
     не было, или заслугой то, что отменили. Сдачи по ней при этом никуда не
     деваются: они лежат в самой задаче. */
  return tasks
    .filter((t) => String(t.assignee || "") === id && (t.submissions || []).length
      && t.canceled !== true)
    .map((t) => {
      const sb = lastSubmission(t);
      const rv = lastReview(t);
      const f = funcs.find((x) => x.id === t.funcId) || null;
      const rated = !!(rv && rv.accept && (num(rv.mark) || rv.comment));
      const shown = rated && rv.by != null && pub.has(ratingId(t.id, "work", rv.by));
      return {
        task: t.id,
        title: t.title,
        func: f ? f.name : "функция удалена",
        e: f ? f.e : null,
        start: t.start || null,
        end: t.end || null,
        at: sb?.at || null,
        hours: num(sb?.hours),
        takes: sb?.takes || {},
        gives: sb?.gives || {},
        text: sb?.text || "",
        file: sb?.file || null,
        done: t.status === "done",
        mark: shown ? num(rv.mark) || null : null,
        pending: rated && !shown,
        published: shown,
        comment: rv?.comment || "",
        hidden: !!rv?.hidden,
        by: rv?.by || null,
        inTime: inTime(t, sb),
      };
    })
    .map((row) => (row.hidden && stranger(row) ? strangerHidden(row) : row))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/**
 * Оценки постановки, которые человек получил как постановщик, — только
 * опубликованные. Отдельно от оценок за выполнение: как человек ставит
 * задачи, к тому, как он их делает, не прибавляется.
 */
export function setupMarksOf(tasks = [], personId, { published } = {}) {
  const id = String(personId);
  const pub = pubSet(published);
  return tasks
    .filter((t) => String(t.setter || "") === id && t.assignee != null
      && String(t.assignee) !== id)
    .map((t) => {
      const sb = lastSubmission(t);
      const r = sb?.setterRating;
      return r && pub.has(ratingId(t.id, "setup", t.assignee)) ? num(r.mark) || null : null;
    })
    .filter((v) => v != null);
}

/**
 * Итог по человеку: средняя оценка, доля «в срок», объём работы.
 *
 * `mark` — среднее по ОПУБЛИКОВАННЫМ оценкам принятых работ, `onTime` —
 * доля тех, где срок был задан и соблюдён. Обе величины могут быть `null`:
 * «ещё не оценивали» и «нечего оценивать» — не то же самое, что ноль, и
 * показывать ноль там, где нет данных, значит клеветать на человека.
 * `setup` — то же про постановку задач.
 */
export function statsOf(tasks = [], funcs = [], personId, { published } = {}) {
  const rows = historyOf(tasks, funcs, personId, { published });
  const done = rows.filter((r) => r.done);
  const timed = done.filter((r) => r.inTime !== null);
  const setup = setupMarksOf(tasks, personId, { published });
  return {
    rows,
    done: done.length,
    total: rows.length,
    returned: rows.filter((r) => !r.done).length,
    mark: avg(done.map((r) => r.mark).filter((v) => v != null)),
    marks: done.filter((r) => r.mark != null).length,
    pending: done.filter((r) => r.pending).length,
    setup: { mark: avg(setup), marks: setup.length },
    onTime: timed.length ? timed.filter((r) => r.inTime).length / timed.length : null,
    timed: timed.length,
    hours: done.reduce((s, r) => s + r.hours, 0),
  };
}

/**
 * Что из рейтинга показывать ЭТОМУ зрителю про ЭТОГО человека.
 *
 * Единственное место, где живёт правило «свои оценки не показываются»:
 * смотрящий на себя получает `self: true`, `mark`/`marks` = null и строки
 * без оценок — рейтинг работает на того, кто поручает. Слова проверяющего
 * в строках: себе — скрытые (их для него и писали) и опубликованные
 * публичные; другим — только опубликованные публичные; автор — свои.
 *
 * Чужая скрытая строка постороннему не показывается вовсе — ни отметка,
 * ни слова, ни признак (`strangerHidden`); в средних (`mark`, `setup`)
 * она при этом есть: скрытость прячет отметку от глаз, а не из рейтинга.
 * Владелец здесь — такой же смотрящий: модель у него целиком, и правило
 * сервера (`taskViewFor`) для него повторено тут.
 */
export function visibleStats(model = {}, personId, viewerId) {
  const { tasks = [], funcs = [], published } = model;
  const self = viewerId != null && personId != null && String(viewerId) === String(personId);
  // Средние — по всем строкам, и скрытым тоже; срез по смотрящему — ниже.
  const s = statsOf(tasks, funcs, personId, { published });
  const me = viewerId == null ? null : String(viewerId);
  const rows = s.rows.map((r) => {
    const author = r.by != null && String(r.by) === me;
    if (r.hidden && !author && !self) return strangerHidden(r);
    const show = author || (self ? (r.hidden || r.published) : r.published);
    return { ...r, mark: self ? null : r.mark, comment: show ? r.comment : "" };
  });
  return self
    ? { ...s, rows, self: true, mark: null, marks: null, pending: null,
      setup: { mark: null, marks: null } }
    : { ...s, rows, self: false };
}

/**
 * Какие слова оценок кому показывать (то же правило, что на сервере в
 * `lib/ratings.js`, но по той части модели, что есть у клиента).
 *
 * `mine` — адресованные зрителю: скрытые про него — сразу, публичные —
 * когда опубликованы. `others` — чужие опубликованные публичные, по людям.
 * Ни там, ни там нет автора: комментарий к оценке анонимен, как и оценка.
 */
export function commentsFor(model = {}, { viewer } = {}) {
  const { tasks = [], published } = model;
  const pub = pubSet(published);
  const me = viewer == null ? null : String(viewer);
  const mine = [];
  const others = {};
  const put = ({ subject, by, kind, text, hidden, id }) => {
    if (!text || subject == null || by == null || String(by) === String(subject)) return;
    if (String(by) === me) return;
    const done = pub.has(id);
    if (String(subject) === me) {
      if (hidden || done) mine.push({ kind, text, hidden });
    } else if (done && !hidden) {
      (others[subject] = others[subject] || []).push({ kind, text });
    }
  };
  tasks.forEach((t) => {
    (t.reviews || []).forEach((rv) => {
      if (!rv?.accept) return;
      put({ subject: t.assignee, by: rv.by, kind: "work",
        text: String(rv.comment || "").trim(), hidden: !!rv.hidden,
        id: ratingId(t.id, "work", rv.by) });
    });
    (t.submissions || []).forEach((sb) => {
      const r = sb?.setterRating;
      if (!r) return;
      put({ subject: t.setter, by: t.assignee, kind: "setup",
        text: String(r.comment || "").trim(), hidden: !!r.hidden,
        id: ratingId(t.id, "setup", t.assignee) });
    });
  });
  return { mine, others };
}

/**
 * Порядок людей: сперва лучшие.
 *
 * «Лучший» — это оценка; при равных оценках вперёд идёт тот, кто чаще
 * укладывается в срок, а при равенстве и там — кто больше сделал. Человек
 * без единой оценки не считается ни лучшим, ни худшим: он идёт после
 * оценённых, потому что о нём просто ничего не известно.
 */
export function byRating(tasks = [], funcs = [], ids = [], { published } = {}) {
  const stat = new Map(ids.map((id) => [id, statsOf(tasks, funcs, id, { published })]));
  const key = (id) => {
    const s = stat.get(id);
    return [s.mark == null ? -1 : s.mark, s.onTime == null ? -1 : s.onTime, s.done];
  };
  return [...ids].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i += 1) if (kb[i] !== ka[i]) return kb[i] - ka[i];
    return 0;
  });
}

/**
 * Коротко о человеке — строкой: «4,6 · в срок 80% · 5 работ».
 *
 * Про себя вместо оценки — «свой рейтинг скрыт»: «без оценок» здесь было
 * бы неправдой, оценки могут быть — их просто не показывают.
 */
export function shortStat(s) {
  const parts = [];
  parts.push(s.self ? "свой рейтинг скрыт"
    : s.mark == null ? "без оценок" : `${Math.round(s.mark * 10) / 10}`);
  if (s.onTime != null) parts.push(`в срок ${Math.round(s.onTime * 100)}%`);
  parts.push(s.done === 1 ? "1 работа" : `${s.done} работ`);
  return parts.join(" · ");
}
