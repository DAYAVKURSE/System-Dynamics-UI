/* ════════════════════════════════════════════════════════════════
   ОБУЧЕНИЕ ЭМБЕДДЕРА · node tools/train-embedder.mjs

   Учит матрицу из `web/src/lib/embedder.js` и записывает её в
   `web/src/lib/embedderWeights.js`. Запускается руками, а не при сборке:
   веса — часть кода, и меняться они должны тогда, когда мы этого хотим,
   а не на каждом деплое. Генератор случайных чисел засеян, поэтому
   повторный запуск даёт те же веса — иначе файл менялся бы сам собой.

   ЧЕМУ УЧИМ. Три вида пар, и каждый отвечает за своё:

   1. ОДНО ПОНЯТИЕ. «разработка» и «программирование» значат для поиска
      одно и то же — косинус должен стремиться к 1. Общих букв у них нет,
      и без этого поиск по смыслу невозможен в принципе.
   2. ХВОСТЫ. «монтаж» и «монтажник», «тест» и «тестировщик» — то же
      слово с хвостом. Пар таких сотни, и хвост в них каждый раз разный
      по корню: единственный способ угодить всем — свести веса кусков
      хвоста почти к нулю. Тогда ЛЮБОЕ слово с таким хвостом значит то
      же, что корень, включая те, которых в обучении не было.
   3. РАЗНОЕ. Слова из разных понятий — косинус к нулю. Без них сеть
      свалила бы всё в одну точку: там любые два слова похожи.

   Веса тянутся назад к начальным (`PULL`): незнакомое слово должно
   вести себя так же, как до обучения, — по общим кускам. Без этой тяги
   сеть переучивалась бы на словарь и теряла бы всё остальное.
   ════════════════════════════════════════════════════════════════ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GROUPS, stem, words } from "../web/src/lib/semanticGroups.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "web", "src", "lib", "embedderWeights.js");

const DIM = 16;
const BUCKETS = 4096;
const EPOCHS = 60;
const LR = 0.25;
const PULL = 0.02;      // тяга к начальным весам
const NEG_PER_POS = 2;

/* ─── генератор с зерном: повторный запуск даёт тот же файл ─── */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const rand = rng(20260920);
const gauss = () => {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};

function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const features = (word) => {
  const w = `·${word}·`;
  const out = [`#${word}`];
  for (let i = 0; i + 3 <= w.length; i += 1) out.push(w.slice(i, i + 3));
  return out;
};
const rowsOf = (word) => features(word).map((f) => (hash(f) % BUCKETS) * DIM);

/* ─── матрица ─── */
const W = new Float32Array(BUCKETS * DIM);
for (let i = 0; i < W.length; i += 1) W[i] = gauss() * (1 / Math.sqrt(DIM));
const W0 = Float32Array.from(W);

const sumOf = (rows) => {
  const v = new Float32Array(DIM);
  for (const r of rows) for (let i = 0; i < DIM; i += 1) v[i] += W[r + i];
  return v;
};
const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1e-9;

/* ─── обучающие пары ─── */

/* Падежные и смысловые хвосты. Первые не меняют слово, вторые меняют его
   роль («монтаж» → «монтажник»), но для поиска значат то же: человек,
   который ищет монтажника, ищет монтаж. */
const CASE_TAILS = ["а", "ы", "и", "у", "е", "ом", "ам", "ах", "ов", "ями"];
const ROLE_TAILS = ["ник", "ника", "щик", "щика", "чик", "чика", "ист", "иста",
  "ер", "ера", "тель", "теля", "ировщик", "ирование", "ация", "ка", "ки",
  "ный", "ная", "ское", "ский"];

const pos = [];
const neg = [];
const ids = Object.keys(GROUPS);
const vocab = new Set();

ids.forEach((id) => {
  const list = [...new Set(GROUPS[id])];
  list.forEach((w) => vocab.add(w));
  // 1 · одно понятие
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) pos.push([list[i], list[j], 1]);
  }
  // 2 · хвосты: корень и корень с хвостом — одно и то же
  list.forEach((root) => {
    [...CASE_TAILS, ...ROLE_TAILS].forEach((t) => {
      const w = root + t;
      vocab.add(w);
      pos.push([root, w, 1]);
    });
  });
});

/* 3 · разные понятия. Пар всего меньше, чем положительных, иначе сеть
   училась бы главным образом отталкивать. */
const flat = ids.flatMap((id) => GROUPS[id].map((w) => [id, w]));
for (let k = 0; k < pos.length * NEG_PER_POS; k += 1) {
  const a = flat[Math.floor(rand() * flat.length)];
  const b = flat[Math.floor(rand() * flat.length)];
  if (a[0] === b[0]) continue;
  neg.push([a[1], b[1], 0]);
}

const data = [...pos, ...neg];
const rowsCache = new Map();
const rowsFor = (w) => {
  let r = rowsCache.get(w);
  if (!r) { r = rowsOf(w); rowsCache.set(w, r); }
  return r;
};

/* ─── шаг обучения: косинус к цели ─── */
function step(a, b, y, lr) {
  const ra = rowsFor(a);
  const rb = rowsFor(b);
  const sa = sumOf(ra);
  const sb = sumOf(rb);
  const na = norm(sa);
  const nb = norm(sb);
  let d = 0;
  for (let i = 0; i < DIM; i += 1) d += (sa[i] / na) * (sb[i] / nb);
  const g = 2 * (d - y);
  if (!g) return (d - y) * (d - y);
  /* ∂cos/∂sa = (b̂ − cos·â)/|sa| — обычная производная косинуса. */
  const ga = new Float32Array(DIM);
  const gb = new Float32Array(DIM);
  for (let i = 0; i < DIM; i += 1) {
    const ua = sa[i] / na;
    const ub = sb[i] / nb;
    ga[i] = (g * (ub - d * ua)) / na;
    gb[i] = (g * (ua - d * ub)) / nb;
  }
  for (const r of ra) for (let i = 0; i < DIM; i += 1) W[r + i] -= lr * ga[i];
  for (const r of rb) for (let i = 0; i < DIM; i += 1) W[r + i] -= lr * gb[i];
  return (d - y) * (d - y);
}

console.log(`пар: ${pos.length} «то же» + ${neg.length} «разное», слов: ${vocab.size}`);
for (let e = 0; e < EPOCHS; e += 1) {
  // Перемешиваем: порядок пар не должен становиться частью обучения.
  for (let i = data.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [data[i], data[j]] = [data[j], data[i]];
  }
  const lr = LR * (1 - e / EPOCHS);
  let loss = 0;
  for (const [a, b, y] of data) loss += step(a, b, y, lr);
  // Тяга к началу — после эпохи, одним движением на всю матрицу.
  for (let i = 0; i < W.length; i += 1) W[i] += PULL * (W0[i] - W[i]);
  if (e % 10 === 0 || e === EPOCHS - 1) {
    console.log(`эпоха ${e + 1}: ошибка ${(loss / data.length).toFixed(4)}`);
  }
}

/* ─── запись: байты со сдвигом 128 и общий множитель ─── */
let max = 0;
for (let i = 0; i < W.length; i += 1) max = Math.max(max, Math.abs(W[i]));
const scale = max / 127;
let bin = "";
for (let i = 0; i < W.length; i += 1) {
  const q = Math.max(0, Math.min(255, Math.round(W[i] / scale) + 128));
  bin += String.fromCharCode(q);
}
const b64 = Buffer.from(bin, "binary").toString("base64");

const file = `/* СОЗДАНО: node tools/train-embedder.mjs — правится обучением, не руками.

   Веса эмбеддера (см. \`embedder.js\`): матрица ${BUCKETS}×${DIM}, байт на
   число, общий множитель \`scale\`. Обучена на парах слов из словаря
   понятий и на хвостах русских слов. */
export const MODEL = {
  dim: ${DIM},
  buckets: ${BUCKETS},
  scale: ${scale.toPrecision(9)},
  data: "${b64}",
};
`;
fs.writeFileSync(OUT, file);
console.log(`записано: ${OUT} (${Math.round(file.length / 1024)} КБ)`);

/* ─── короткая проверка на том, ради чего всё затевалось ─── */
const vec = (text) => {
  const list = words(text).map(stem);
  const v = new Float32Array(DIM);
  list.forEach((w) => {
    const s = sumOf(rowsFor(w));
    const n = norm(s);
    for (let i = 0; i < DIM; i += 1) v[i] += s[i] / n;
  });
  const n = norm(v);
  for (let i = 0; i < DIM; i += 1) v[i] /= n;
  return v;
};
const cos = (a, b) => { let s = 0; for (let i = 0; i < DIM; i += 1) s += a[i] * b[i]; return s; };
[["тестировщик", "Тест"], ["программирование", "Разработка"], ["перевозка", "Доставка грузов"],
  ["написать тексты", "Копирайтинг"], ["лого", "Дизайн логотипа"],
  ["бухгалтерия и налоги", "Доставка грузов"], ["дизайнер", "дизайнеров"],
  ["монтажник", "Монтаж"], ["Разработка", "Вёрстка лендинга"],
  ["Разработка", "Доставка грузов"]].forEach(([a, b]) => {
  console.log(`  ${a} ↔ ${b}: ${cos(vec(a), vec(b)).toFixed(3)}`);
});
