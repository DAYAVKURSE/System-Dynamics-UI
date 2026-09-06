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
   ════════════════════════════════════════════════════════════════ */

/** Оценка — пятибалльная: меньше градаций не различает, больше не читается. */
export const MARK_MIN = 1;
export const MARK_MAX = 5;

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

/** Одна строка истории: что делал, когда, сколько заняло и как приняли. */
export function historyOf(tasks = [], funcs = [], personId) {
  const id = String(personId);
  return tasks
    .filter((t) => String(t.assignee || "") === id && (t.submissions || []).length)
    .map((t) => {
      const sb = lastSubmission(t);
      const rv = lastReview(t);
      const f = funcs.find((x) => x.id === t.funcId) || null;
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
        mark: rv && rv.accept ? num(rv.mark) || null : null,
        comment: rv?.comment || "",
        by: rv?.by || null,
        inTime: inTime(t, sb),
      };
    })
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/**
 * Итог по человеку: средняя оценка, доля «в срок», объём работы.
 *
 * `mark` — среднее по принятым работам, `onTime` — доля тех, где срок был
 * задан и соблюдён. Обе величины могут быть `null`: «ещё не оценивали» и
 * «нечего оценивать» — не то же самое, что ноль, и показывать ноль там,
 * где нет данных, значит клеветать на человека.
 */
export function statsOf(tasks = [], funcs = [], personId) {
  const rows = historyOf(tasks, funcs, personId);
  const done = rows.filter((r) => r.done);
  const timed = done.filter((r) => r.inTime !== null);
  return {
    rows,
    done: done.length,
    total: rows.length,
    returned: rows.filter((r) => !r.done).length,
    mark: avg(done.map((r) => r.mark).filter((v) => v != null)),
    marks: done.filter((r) => r.mark != null).length,
    onTime: timed.length ? timed.filter((r) => r.inTime).length / timed.length : null,
    timed: timed.length,
    hours: done.reduce((s, r) => s + r.hours, 0),
  };
}

/**
 * Порядок людей: сперва лучшие.
 *
 * «Лучший» — это оценка; при равных оценках вперёд идёт тот, кто чаще
 * укладывается в срок, а при равенстве и там — кто больше сделал. Человек
 * без единой оценки не считается ни лучшим, ни худшим: он идёт после
 * оценённых, потому что о нём просто ничего не известно.
 */
export function byRating(tasks = [], funcs = [], ids = []) {
  const stat = new Map(ids.map((id) => [id, statsOf(tasks, funcs, id)]));
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

/** Коротко о человеке — строкой: «4,6 · в срок 80% · 5 работ». */
export function shortStat(s) {
  const parts = [];
  parts.push(s.mark == null ? "без оценок" : `${Math.round(s.mark * 10) / 10}`);
  if (s.onTime != null) parts.push(`в срок ${Math.round(s.onTime * 100)}%`);
  parts.push(s.done === 1 ? "1 работа" : `${s.done} работ`);
  return parts.join(" · ");
}
