import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/* ════════════════════════════════════════════════════════════════
   ВСТРЕЧИ И ЗВОНКИ

   Встреча — это время, текст и комната. Комната живёт в памяти: через неё
   двое собеседников обмениваются описаниями соединения (SDP) и сетевыми
   кандидатами (ICE), после чего видео и звук идут напрямую между ними и
   через сервер уже не проходят. Поэтому хранить сигналы дольше звонка не
   нужно — и не стоит: в них адреса участников.

   Транспорт сигналов — обычный HTTP с длинным опросом, а не вебсокет.
   Причина приземлённая: nginx на сервере проксирует без заголовков
   Upgrade, а его конфиг дописан certbot и переписывается только при смене
   домена. Сигналов за звонок десяток, длинного опроса на них хватает с
   запасом, а менять живой конфиг ради этого — риск без выгоды.
   ════════════════════════════════════════════════════════════════ */

const MAX_MEETINGS = 500;
const SIGNAL_TTL_MS = 10 * 60 * 1000;   // сигналы живут только на время созвона
const MAX_SIGNALS = 2000;               // на комнату: сетка на 20 человек шлёт много ICE
export const MAX_PEERS = 20;

function baseDir() {
  return process.env.CALLS_DIR
    ? path.resolve(process.env.CALLS_DIR)
    : path.resolve(process.cwd(), "data", "calls");
}
const file = () => path.join(baseDir(), "meetings.json");

async function readAll() {
  try {
    const parsed = JSON.parse(await fs.readFile(file(), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(list) {
  await fs.mkdir(baseDir(), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(list, null, 2), "utf8");
}

/* ─────── встречи ─────── */

export async function createMeeting({ title, at, text, by }) {
  const clean = String(title || "").trim().slice(0, 200);
  if (!clean) throw new Error("title is required");
  const list = await readAll();
  if (list.length >= MAX_MEETINGS) list.splice(0, list.length - MAX_MEETINGS + 1);
  const meeting = {
    // Короткий и неугадываемый: ссылка на встречу и есть право войти
    // в комнату, как и у файлов отчётов.
    id: crypto.randomBytes(9).toString("base64url"),
    title: clean,
    at: String(at || "").slice(0, 40),
    text: String(text || "").slice(0, 2000),
    by: by == null ? null : String(by),
    createdAt: new Date().toISOString(),
  };
  list.push(meeting);
  await writeAll(list);
  return meeting;
}

export async function getMeeting(id) {
  return (await readAll()).find((m) => m.id === id) || null;
}

export async function listMeetings(by) {
  const list = await readAll();
  const mine = by == null ? list : list.filter((m) => m.by === String(by));
  return mine.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
}

export async function deleteMeeting(id, by) {
  const list = await readAll();
  const i = list.findIndex((m) => m.id === id);
  // Удаляет только тот, кто создал: ссылка даёт войти, но не распоряжаться.
  if (i === -1 || (by != null && list[i].by !== String(by))) return false;
  list.splice(i, 1);
  await writeAll(list);
  rooms.delete(id);
  return true;
}

/* ─────── сигналы созвона (только в памяти) ─────── */

const rooms = new Map();   // id встречи → { seq, items: [{n, from, to, data, at}] }

const room = (id) => {
  if (!rooms.has(id)) rooms.set(id, { seq: 0, items: [] });
  return rooms.get(id);
};

const sweep = (r, now = Date.now()) => {
  r.items = r.items.filter((s) => now - s.at < SIGNAL_TTL_MS);
  if (r.items.length > MAX_SIGNALS) r.items.splice(0, r.items.length - MAX_SIGNALS);
};

/** Кладёт сигнал в комнату. `to` пустой — сигнал всем, кроме отправителя. */
export function putSignal(meetingId, { from, to = null, data }, now = Date.now()) {
  const r = room(meetingId);
  sweep(r, now);
  r.seq += 1;
  r.items.push({ n: r.seq, from: String(from), to: to == null ? null : String(to),
    data, at: now });
  return r.seq;
}

/** Забирает сигналы после `since`, адресованные этому участнику. */
export function takeSignals(meetingId, me, since = 0, now = Date.now()) {
  const r = room(meetingId);
  sweep(r, now);
  const mine = r.items.filter((s) => s.n > Number(since || 0)
    && s.from !== String(me)
    && (s.to == null || s.to === String(me)));
  return { seq: r.seq, signals: mine.map(({ n, from, data }) => ({ n, from, data })) };
}

/** Кто сейчас в комнате — по тем, от кого недавно приходили сигналы. */
export function peersIn(meetingId, now = Date.now(), windowMs = 60000) {
  const r = rooms.get(meetingId);
  if (!r) return [];
  return [...new Set(r.items.filter((s) => now - s.at < windowMs).map((s) => s.from))];
}

export function resetRooms() { rooms.clear(); }

/* ─────── разбор инлайн-запроса ─────── */

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг",
  "сен", "окт", "ноя", "дек"];

/**
 * Разбирает «завтра 15:00 обсудить прогноз» на время и текст.
 * Время понимается настолько, насколько это можно сделать без часового
 * пояса собеседника: час и минуты обязательны, день — словом или числом.
 * Что не разобралось — остаётся текстом, а не выбрасывается.
 */
export function parseMeeting(query, now = new Date()) {
  const raw = String(query || "").trim();
  if (!raw) return { at: "", atText: "", title: "", text: "", day: null, time: "", ok: false };

  let rest = raw;
  let day = null;      // сдвиг в днях от сегодня
  let dayText = "";

  // Границу слова через \b здесь ставить нельзя: в JS она определена по
  // латинице, и «завтра» в начале строки границей не считается — слово
  // просто не находится. Поэтому границы заданы явно, по буквам и цифрам.
  const B = "(?<![\\p{L}\\d])";
  const E = "(?![\\p{L}\\d])";
  const w = (body, flags = "iu") => new RegExp(B + body + E, flags);

  // Возвращает false — значит не подошло, и кусок остаётся в строке:
  // «15.30» не должно съедаться как дата тридцатого месяца.
  const take = (re, fn) => {
    const m = rest.match(re);
    if (!m || fn(m) === false) return false;
    rest = (rest.slice(0, m.index) + rest.slice(m.index + m[0].length)).trim();
    return true;
  };

  take(w("сегодня"), () => { day = 0; dayText = "сегодня"; })
    || take(w("завтра"), () => { day = 1; dayText = "завтра"; })
    || take(w("послезавтра"), () => { day = 2; dayText = "послезавтра"; })
    || take(w("(\\d{1,2})[.\\/](\\d{1,2})"), (m) => {
      const d = Number(m[1]), mo = Number(m[2]);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
      const when = new Date(now.getFullYear(), mo - 1, d);
      day = Math.round((when - new Date(now.getFullYear(), now.getMonth(), now.getDate()))
        / 86400000);
      dayText = `${d} ${MONTHS[mo - 1]}`;
      return true;
    });

  let time = "";
  take(w("(\\d{1,2})[:.](\\d{2})"), (m) => {
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 && mi > 59) { time = "23:59"; return true; }
    time = `${String(Math.min(23, h)).padStart(2, "0")}:${String(Math.min(59, mi)).padStart(2, "0")}`;
    return true;
  }) || take(w("в\\s+(\\d{1,2})\\s*(?:ч|часов|часа)?"), (m) => {
    time = `${String(Math.min(23, Number(m[1]))).padStart(2, "0")}:00`;
    return true;
  });

  const title = rest.replace(/\s+/g, " ").trim();
  const atText = [dayText, time].filter(Boolean).join(" ");
  return {
    at: atText,
    atText,
    day, time,
    title: title || "Созвон",
    text: title,
    // «Разобрали» — значит нашли время. Без него встреча всё равно
    // создаётся: договориться «созвонимся, как освободишься» — тоже встреча.
    ok: Boolean(time),
  };
}
