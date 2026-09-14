/* ═══════════════ ПОДПИСЬ: ПРАВИЛА ═══════════════
   Подпись здесь — не картинка, а траектория: последовательность штрихов, в
   каждом штрихе точки с координатой, временем от начала и нажимом. Картинка
   (png) тоже сохраняется, но она вторична — по ней видно только начертание.

   Почему так. Картинку рисуют мышью за секунду, срисовывают с образца и
   вставляют из буфера; траекторию — нет. В ней видно то, что подделать
   трудно и что как раз смотрит почерковедческая экспертиза: темп (где рука
   шла быстро, где останавливалась), нажим, порядок и число штрихов, паузы
   между ними. Поэтому t и p не «метаданные для красоты», а сама суть
   записи: без них файл теряет доказательную силу и остаётся рисунком.

   Второе — привязка. Сама по себе траектория ничего не говорит о том, КТО и
   ПОД ЧЕМ расписался: её можно переложить из одного документа в другой.
   Поэтому в запись входит хеш от связки «подписант + момент + хеш документа
   + штрихи»: подменили любое из четырёх — хеш перестал сходиться.

   Модуль чистый: ни React, ни DOM, ни холста. Всё, что связано с экраном,
   живёт в SignaturePad.jsx, а здесь — то, что можно проверить тестом и
   пересчитать на сервере. */

/** Пустая подпись. `w`/`h` — размер поля в точках CSS: без них штрихи
 *  невозможно масштабировать обратно, а длина в пикселях ничего не значит.
 *  `startedAt` — время первой точки (см. addPoint). */
export function newSignature() {
  return { strokes: [], w: 0, h: 0, startedAt: null };
}

const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
/* Нажим приходит от системы: у стилуса — настоящий, у пальца и мыши его нет
   вовсе, и браузер отдаёт 0 или ничего. Подставлять 0 нельзя — «нулевой
   нажим» читался бы как «перо не касалось бумаги», хотя человек рисовал
   пальцем. 0.5 — честная середина: «нажим неизвестен». */
const press = (v) => {
  const p = Number(v);
  if (!Number.isFinite(p) || p <= 0) return 0.5;
  return p > 1 ? 1 : p;
};

/**
 * Добавляет точку в штрих `strokeIndex`, возвращая НОВУЮ подпись.
 *
 * Не мутирует: подпись живёт в состоянии React, и правка на месте не вызвала
 * бы перерисовку — кнопка «Готово» так и осталась бы заблокированной, хотя
 * росчерк уже есть. Пропущенные индексы заполняются пустыми штрихами, чтобы
 * номер штриха всегда означал одно и то же — порядок движений руки.
 *
 * @param sig          подпись
 * @param strokeIndex  номер штриха (0, 1, 2 …) — одно касание = один штрих
 * @param point        {x, y, t, p}: t — мс от начала подписи, p — нажим 0..1
 */
export function addPoint(sig, strokeIndex, { x, y, t, p } = {}) {
  const base = sig && Array.isArray(sig.strokes) ? sig : newSignature();
  const i = Math.max(0, Math.trunc(num(strokeIndex)));
  const strokes = base.strokes.slice();
  while (strokes.length <= i) strokes.push([]);
  const pt = { x: num(x), y: num(y), t: num(t), p: press(p) };
  strokes[i] = strokes[i].concat([pt]);
  return {
    ...base,
    strokes,
    // Время первой точки запоминаем отдельно: по нему считается длительность,
    // и оно переживает очистку отдельных штрихов.
    startedAt: base.startedAt == null ? pt.t : base.startedAt,
  };
}

/** Сводка по траектории: сколько штрихов и точек, длина линии в пикселях,
 *  сколько времени заняла подпись и в какой прямоугольник уместилась. */
export function signatureStats(sig) {
  const strokes = (sig && Array.isArray(sig.strokes) ? sig.strokes : [])
    .filter((s) => Array.isArray(s) && s.length > 0);
  let points = 0, length = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let tMin = Infinity, tMax = -Infinity;
  strokes.forEach((s) => {
    s.forEach((pt, k) => {
      points += 1;
      if (pt.x < x0) x0 = pt.x; if (pt.x > x1) x1 = pt.x;
      if (pt.y < y0) y0 = pt.y; if (pt.y > y1) y1 = pt.y;
      if (pt.t < tMin) tMin = pt.t; if (pt.t > tMax) tMax = pt.t;
      // Длину считаем ВНУТРИ штриха: перелёт руки между штрихами — это не
      // линия на бумаге, и приписывать его к длине росчерка нельзя.
      if (k > 0) {
        const prev = s[k - 1];
        length += Math.hypot(pt.x - prev.x, pt.y - prev.y);
      }
    });
  });
  const has = points > 0;
  return {
    strokes: strokes.length,
    points,
    length: has ? Math.round(length * 100) / 100 : 0,
    durationMs: has && tMax > tMin ? tMax - tMin : 0,
    bbox: has ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 },
  };
}

/* Пороги «росчерк, а не точка». Подпись не оценивают на похожесть — это не
   наше дело, — но отличить подпись от случайного тычка по экрану обязаны:
   иначе документ окажется подписан пылинкой на стекле, а спорить потом
   будут о нём. */
export const MIN_POINTS = 12;      // меньше — это не линия, а щелчок
export const MIN_MS = 300;         // рука не успевает расписаться быстрее
export const MIN_LEN_ONE = 120;    // один штрих должен быть хотя бы длинным

/** Достаточно ли написанного, чтобы считать это подписью. */
export function isEnough(sig) {
  const s = signatureStats(sig);
  // Два штриха и больше — уже осмысленное движение (инициалы, росчерк).
  // Один — только если он длинный: короткая чёрточка подписью не бывает.
  const shape = s.strokes >= 2 || (s.strokes === 1 && s.length >= MIN_LEN_ONE);
  return shape && s.points >= MIN_POINTS && s.durationMs >= MIN_MS;
}

const hex = (buf) => Array.from(new Uint8Array(buf))
  .map((b) => b.toString(16).padStart(2, "0")).join("");

/** SHA-256 в hex через веб-криптографию браузера. Своей реализации хеша нет
 *  нарочно: собственный код здесь — это лишний повод не доверять записи. */
export async function sha256Hex(text) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error("Нет crypto.subtle: подпись без хеша не сохраняем");
  return hex(await subtle.digest("SHA-256", new TextEncoder().encode(String(text))));
}

/**
 * Запись подписи для сервера.
 *
 * Хеш считается от `{by, at, docHash, strokes}` — именно в этом порядке
 * ключей и именно от этих четырёх полей. Порядок важен: JSON.stringify
 * пишет ключи как их перечислили, и перестановка дала бы другой хеш при тех
 * же данных — проверка на сервере перестала бы сходиться. Картинка, ua и
 * сводка в хеш НЕ входят: png пересжимается, строка браузера меняется от
 * обновления, а stats считается по штрихам и проверяется пересчётом.
 *
 * @param sig   подпись (траектория)
 * @param meta  { by — кто подписывает, docHash — хеш подписываемого
 *              документа, png — dataURL картинки, ua — navigator.userAgent }
 */
export async function signatureRecord(sig, { by, docHash, png, ua } = {}) {
  const base = sig && Array.isArray(sig.strokes) ? sig : newSignature();
  const at = new Date().toISOString();
  // Копия штрихов, а не ссылка: запись уходит на сервер и в файл, и её
  // содержимое не должно меняться следом за полем подписи на экране.
  const strokes = base.strokes.map((s) => s.map((p) => ({ x: p.x, y: p.y, t: p.t, p: p.p })));
  const hash = await sha256Hex(JSON.stringify({ by, at, docHash, strokes }));
  return {
    by, at, docHash, strokes,
    w: num(base.w), h: num(base.h),
    png: png || "", ua: ua || "",
    stats: signatureStats(base),
    hash,
  };
}
