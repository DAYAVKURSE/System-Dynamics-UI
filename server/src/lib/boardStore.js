import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { BOARD_COLORS, MEMBER_COLORS, pickColor } from "./boardColors.js";

/* ════════════════════════════════════════════════════════════════
   БРЕЙНШТОРМ-ДОСКИ (владелец, 2026-09-25)

   «Добавь еще один миниап, такой же, как со звонками. Только это должна
   быть доска для брейншторма… все участники могли открыть и видели одно
   и то же на ней. Когда кто-то что-то пишет, что-то добавляет, неважно,
   любое действие должно отображаться у всех одинаково.»

   Доска — тема, участники и стикеры. Живёт В ПАМЯТИ, на диск ложится
   отложенной записью: стикер правится на каждое нажатие клавиши (веб шлёт
   текст раз в ~250 мс), и писать на каждую правку весь файл незачем.
   Запись атомарная — через временный файл и переименование: читатель,
   попавший на середину записи, не получит обрезанный JSON.

   «Одинаково у всех» держится на двух вещах:
   · `rev` — номер состояния доски, растёт на КАЖДОЕ изменение;
   · длинный опрос (`waitBoard`): тот, кто уже видел `rev`, ждёт, пока он
     сдвинется, и будится сразу, как только доска изменилась, — без
     таймерного опроса диска. Транспорт — HTTP, а не вебсокет, по той же
     причине, что у звонков: nginx на сервере проксирует без Upgrade (см.
     lib/callStore.js).

   Файл один на все хранилища: у доски есть поле `storage`, как у встречи
   есть автор. Id доски неугадываемый — он же приглашение, как у звонков.

   Здесь нет ничего про организацию и права: кто вправе заводить доски и
   кто «зарегистрирован» — решают маршруты (routes/boards.js), им нужна
   организация хранилища доски. Стор только хранит и отвечает за правила
   самой доски: кто автор стикера, кто создатель, кто заблокирован.
   ════════════════════════════════════════════════════════════════ */

/* Пределы — ПО ХРАНИЛИЩУ, а не на всех: у каждого человека Telegram своё
   хранилище, и доски одного не должны вытеснять доски другого. Настоящие
   доски не вытесняются никогда — на пределе новая просто не заводится. */
export const MAX_BOARDS_PER_STORAGE = 200;
/* Черновики инлайна: на каждое нажатие клавиши в инлайн-запросе — свой
   (см. lib/bot.js), поэтому им — предел на создателя. СРОКА у них нет:
   отправленную в чат ссылку могут открыть и через месяц, а узнать, что
   черновик ушёл в чат, бот может только при включённом отзыве инлайна
   (`sent`). На пределе вытесняются только его же неотправленные: сперва
   промежуточные — чьё имя есть начало имени более нового его черновика
   («Ито» по дороге к «Итоги»), потом самые старые. */
export const MAX_DRAFTS_PER_CREATOR = 1000;
/* Страховка на весь файл: при ней новая доска не заводится — чужие не трогаются. */
export const MAX_BOARDS_TOTAL = 20000;
export const MAX_STICKERS = 500;
export const NAME_MAX = 120;
export const TEXT_MAX = 2000;
const WRITE_DELAY_MS = 250;
const RETRY_MS = 5000;
const MAIN = "main";

/** Отказ со статусом: маршрут отдаёт его как есть (и `extra` — в тело). */
export class BoardError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function baseDir() {
  return process.env.BOARDS_DIR
    ? path.resolve(process.env.BOARDS_DIR)
    : path.resolve(process.cwd(), "data", "boards");
}
const file = () => path.join(baseDir(), "boards.json");

/* ─────── память и диск ─────── */

let boards = null;          // массив досок; null — ещё не прочитан
let loading = null;         // идущее чтение — чтобы два запроса не читали дважды
let generation = 0;         // сброс (тесты) делает прежнее чтение недействительным
let timer = null;
let dirty = false;
let writing = Promise.resolve();
const waiters = new Map();  // id доски → Set(разбудить)

const nowIso = () => new Date().toISOString();
const str = (v) => (v == null ? "" : String(v));

/* Запись с диска — в том виде, в каком её ждёт остальной код: чужой или
   прежний файл не должен ронять доску на `undefined.length`. */
function normalize(b) {
  if (!b || typeof b !== "object" || !b.id) return null;
  return {
    id: str(b.id),
    name: str(b.name).slice(0, NAME_MAX),
    storage: str(b.storage) || MAIN,
    by: str(b.by),
    byName: str(b.byName),
    color: str(b.color) || BOARD_COLORS[0],
    draft: b.draft === true,
    ...(b.draft === true && b.sent === true ? { sent: true } : {}),
    createdAt: str(b.createdAt) || nowIso(),
    rev: Number.isFinite(Number(b.rev)) ? Number(b.rev) : 1,
    members: (Array.isArray(b.members) ? b.members : []).filter((m) => m && m.id != null)
      .map((m) => ({ id: str(m.id), name: str(m.name), color: str(m.color) || MEMBER_COLORS[0],
        joinedAt: m.joinedAt ? str(m.joinedAt) : null, blocked: m.blocked === true })),
    removed: (Array.isArray(b.removed) ? b.removed : []).map(str).filter(Boolean),
    stickers: (Array.isArray(b.stickers) ? b.stickers : []).filter((s) => s && s.id != null)
      .map((s) => ({ id: str(s.id), by: str(s.by), text: str(s.text).slice(0, TEXT_MAX),
        createdAt: str(s.createdAt) || nowIso(), updatedAt: str(s.updatedAt || s.createdAt) || nowIso() })),
  };
}

async function readFile() {
  let raw;
  try {
    raw = await fs.readFile(file(), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalize).filter(Boolean) : [];
  } catch {
    /* Файл не разобрался. Начать с пустого списка и молча записать его
       поверх значило бы стереть все доски одной правкой. Испорченный файл
       откладывается рядом — его можно разобрать руками. */
    const aside = `${file()}.broken-${Date.now()}`;
    await fs.rename(file(), aside).catch(() => {});
    console.error(`[boards] ${file()} не разобрался — отложен в ${aside}`);
    return [];
  }
}

async function load() {
  if (boards) return boards;
  if (!loading) {
    const g = generation;
    loading = readFile().then((list) => {
      if (g === generation && !boards) boards = list;
      return boards || list;
    }).finally(() => { if (g === generation) loading = null; });
  }
  await loading;
  if (!boards) return load();
  return boards;
}

/** Записать на диск сейчас, не дожидаясь отложенной записи. */
export function flushBoards() {
  if (timer) { clearTimeout(timer); timer = null; }
  const run = writing.then(async () => {
    if (!dirty || !boards) return;
    dirty = false;
    // Снимок — синхронно, в момент записи: всё, что изменится после,
    // уйдёт следующей записью.
    const data = JSON.stringify(boards);
    try {
      await fs.mkdir(baseDir(), { recursive: true });
      const tmp = `${file()}.${process.pid}.tmp`;
      await fs.writeFile(tmp, data, "utf8");
      await fs.rename(tmp, file());
    } catch (e) {
      dirty = true;
      throw e;
    }
  });
  writing = run.catch(() => {});
  return run;
}

function persist(delay = WRITE_DELAY_MS) {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushBoards().catch((e) => {
      // Диск не принял — доска в памяти цела; пробуем позже, а не на
      // каждой следующей правке.
      console.error(`[boards] запись не удалась: ${e.message}`);
      persist(RETRY_MS);
    });
  }, delay);
  timer.unref?.();
}

/** Сбросить память (тесты): следующее обращение прочитает диск заново. */
export function resetBoards() {
  if (timer) { clearTimeout(timer); timer = null; }
  generation += 1;
  boards = null;
  loading = null;
  dirty = false;
  const all = [...waiters.values()];
  waiters.clear();
  all.forEach((set) => set.forEach((wake) => wake()));
}

/* ─────── ожидание изменений ─────── */

function wake(id) {
  const set = waiters.get(id);
  if (!set) return;
  waiters.delete(id);
  set.forEach((fn) => fn());
}

/** Всякое изменение доски: номер состояния вперёд, запись, разбудить ждущих. */
function touch(b) {
  b.rev += 1;
  persist();
  wake(b.id);
}

/**
 * Ждать, пока `rev` доски уйдёт от `rev` (или доска исчезнет), но не
 * дольше `ms`. Отмена по `signal` — клиент ушёл, ждать больше некого.
 * Всегда разрешается, никогда не отвергается: что именно изменилось,
 * решает тот, кто ждал, перечитав доску.
 */
export async function waitBoard(id, rev, ms, signal) {
  await load();
  return new Promise((resolve) => {
    const b = find(id);
    if (!b || b.rev !== Number(rev) || signal?.aborted) return resolve();
    let set = waiters.get(b.id);
    if (!set) { set = new Set(); waiters.set(b.id, set); }
    let t = null;
    const done = () => {
      if (t) clearTimeout(t);
      set.delete(done);
      if (!set.size && waiters.get(b.id) === set) waiters.delete(b.id);
      signal?.removeEventListener?.("abort", done);
      resolve();
    };
    t = setTimeout(done, Math.max(0, Number(ms) || 0));
    set.add(done);
    signal?.addEventListener?.("abort", done, { once: true });
  });
}

/** Сколько сейчас ждущих у доски — для тестов: ожидание снимается. */
export const waitingOn = (id) => waiters.get(String(id))?.size || 0;

/* ─────── доски ─────── */

const find = (id) => (boards || []).find((b) => b.id === String(id)) || null;
const newId = () => {
  for (;;) {
    // 12 знаков base64url: короткий и неугадываемый — ссылка и есть приглашение.
    const id = crypto.randomBytes(9).toString("base64url");
    if (!find(id)) return id;
  }
};
const cleanName = (v) => str(v).replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();

/* Цвет доски — первый, не занятый ДРУГИМИ досками того же хранилища.
   Черновики не в счёт: их никто не видел, и держать за ними цвет — значит
   красить видимые доски всё дальше по палитре из-за брошенного набора. */
function boardColorFor(storage, id) {
  const taken = (boards || []).filter((b) => b.storage === storage && !b.draft && b.id !== id)
    .map((b) => b.color);
  return pickColor(BOARD_COLORS, taken, id);
}

function newMember(b, id, name, joinedAt) {
  return { id: String(id), name: str(name).slice(0, 120),
    color: pickColor(MEMBER_COLORS, b.members.map((m) => m.color), id),
    joinedAt, blocked: false };
}

/** Сводка для списков — без стикеров и участников. */
export const summary = (b) => ({ id: b.id, name: b.name, color: b.color, by: b.by, byName: b.byName,
  stickers: b.stickers.length, createdAt: b.createdAt });

const byAge = (x, y) => x.createdAt.localeCompare(y.createdAt);

function evict(victims) {
  if (!victims.length) return;
  const gone = new Set(victims);
  boards = boards.filter((b) => !gone.has(b));
  victims.forEach((b) => wake(b.id));
  persist();
}

/**
 * Место под новую доску — только за счёт своего: черновики вытесняются
 * лишь того же создателя в том же хранилище, настоящие доски — никогда.
 * На пределе — отказ словами, а не молча стёртая чужая доска.
 */
function makeRoom(storage, by, draft, name = "") {
  const real = boards.filter((b) => b.storage === storage && !b.draft).length;
  if (real >= MAX_BOARDS_PER_STORAGE) {
    throw new BoardError(400, `В хранилище уже ${MAX_BOARDS_PER_STORAGE} досок.`);
  }
  if (draft) {
    const mine = boards.filter((b) => b.draft && !b.sent && b.storage === storage && b.by === by)
      .sort(byAge);
    const over = mine.length - MAX_DRAFTS_PER_CREATOR + 1;
    if (over > 0) {
      // Имя, которое заводится сейчас, — тоже «более новое»: «Ито» уходит,
      // когда набрано «Итоги».
      const later = (d, n) => n.length > d.name.length && n.startsWith(d.name);
      const passing = (d) => later(d, name) || mine.some((x) => x !== d
        && x.createdAt >= d.createdAt && later(d, x.name));
      const order = [...mine.filter(passing), ...mine.filter((d) => !passing(d))];
      evict(order.slice(0, over));
    }
  }
  if (boards.length >= MAX_BOARDS_TOTAL) throw new BoardError(400, "Места для новых досок нет.");
}

/**
 * Доски хранилища — новые сверху. Черновики (набранные инлайн-запросом и
 * ни разу не открытые) не видны нигде, кроме как по прямому id.
 */
export async function listBoards({ storage = null, drafts = false } = {}) {
  await load();
  return boards
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => (storage == null || b.storage === String(storage)) && (drafts || !b.draft))
    .sort((x, y) => y.b.createdAt.localeCompare(x.b.createdAt) || y.i - x.i)
    .map(({ b }) => summary(b));
}

/** Доска целиком (живой объект стора) — только для чтения. */
export async function getBoard(id) {
  await load();
  return find(id);
}

/**
 * Завести доску. Создатель — сразу участник (владелец: управлять
 * участниками может только он, значит, и в участниках он есть всегда).
 */
export async function createBoard({ name, storage = MAIN, by, byName = "", draft = false } = {}) {
  const clean = cleanName(name);
  if (!clean) throw new BoardError(400, "Название доски не может быть пустым.");
  if (by == null || by === "") throw new BoardError(400, "Не указан создатель доски.");
  await load();
  const st = str(storage) || MAIN;
  makeRoom(st, String(by), draft === true, clean);
  const id = newId();
  const b = {
    id, name: clean, storage: st, by: String(by), byName: str(byName).slice(0, 120),
    color: boardColorFor(st, id), draft: draft === true, createdAt: nowIso(), rev: 1,
    members: [], removed: [], stickers: [],
  };
  b.members.push(newMember(b, by, byName, null));
  boards.push(b);
  persist();
  return b;
}

/**
 * Черновик этого создателя с ровно таким именем — для инлайна: набрал ту
 * же фразу ещё раз — та же доска, а не вторая с тем же именем.
 *
 * Только ТОЧНОЕ имя, и черновики не переименовываются вовсе: пока человек
 * дописывает фразу, любой из промежуточных пунктов выдачи мог уже уйти в
 * чат, и переименование подменило бы доску под отправленной ссылкой.
 */
export async function findDraft({ storage = MAIN, by, name } = {}) {
  await load();
  const clean = cleanName(name);
  if (!clean || by == null) return null;
  const st = str(storage) || MAIN;
  return boards.filter((b) => b.draft && b.storage === st && b.by === String(by) && b.name === clean)
    .sort(byAge).pop() || null;
}

/**
 * Черновик отправлен в чат (бот узнал это из `chosen_inline_result`, если
 * в @BotFather включён отзыв инлайна). Доской он по-прежнему станет при
 * первом открытии — но сроком и пределом черновиков его уже не вытеснить:
 * его ссылка у людей.
 */
export async function markDraftSent(id) {
  await load();
  const b = find(id);
  if (!b || !b.draft || b.sent) return false;
  b.sent = true;
  persist();
  return true;
}

/* ─────── кто на доске ─────── */

/** Пускать ли человека: удалённого и заблокированного — нет. */
function gate(b, uid) {
  const id = String(uid);
  if (b.removed.includes(id)) throw new BoardError(403, "Вас удалили с доски.", { removed: true });
  if (b.members.some((m) => m.id === id && m.blocked)) {
    throw new BoardError(403, "Вы были заблокированы.", { blocked: true });
  }
}

function must(id) {
  const b = find(id);
  if (!b) throw new BoardError(404, "Доски нет.");
  return b;
}

/** Проверить доступ без изменений (после ожидания — блок мог случиться). */
export async function checkBoard(id, uid) {
  await load();
  const b = must(id);
  gate(b, uid);
  return b;
}

/**
 * Войти на доску: каждый запрос с доски начинается с этого.
 *
 * · удалённый и заблокированный — отказ (403 с `removed`/`blocked`);
 * · ещё не участник — вписывается, с цветом и временем входа;
 * · вписанный заранее (`joinedAt: null`) — отмечается пришедшим;
 * · имя из подписи Telegram обновляется: человек мог его сменить;
 * · черновик становится доской — это первое открытие ссылки из инлайна.
 *
 * `published: true` — доска только что перестала быть черновиком:
 * маршрут вписывает в неё людей хранилища с доступом.
 */
export async function enterBoard(id, { id: uid, name = "" } = {}) {
  await load();
  const b = must(id);
  const me = String(uid);
  gate(b, me);
  let changed = false;
  let published = false;
  if (b.draft) {
    b.draft = false;
    delete b.sent;
    b.color = boardColorFor(b.storage, b.id);
    published = true;
    changed = true;
  }
  const m = b.members.find((x) => x.id === me);
  const clean = str(name).slice(0, 120);
  if (!m) {
    b.members.push(newMember(b, me, clean, nowIso()));
    changed = true;
  } else {
    if (!m.joinedAt) { m.joinedAt = nowIso(); changed = true; }
    /* Новое имя — без нового `rev` и без побудки ждущих: оно доедет со
       следующим настоящим изменением. Иначе два окна одного человека с
       разными подписями (старая вкладка до переименования в Telegram и
       свежее мини-приложение) переписывали бы имя друг за другом на
       каждом опросе и будили бы друг друга — и всех на доске — без конца. */
    if (clean && m.name !== clean) { m.name = clean; persist(); }
  }
  if (changed) touch(b);
  return { board: b, published };
}

/**
 * Вписать людей с доступом к брейншторму (`joinedAt: null`): «все
 * участники, которые имеют доступ к сценарию и этой вкладке» видны на
 * доске, даже если её ещё не открывали. Заблокированные уже в списке, а
 * удалённые не вписываются заново — решение создателя сильнее роли.
 */
export async function enrollMembers(id, people = []) {
  await load();
  const b = find(id);
  if (!b) return false;
  let changed = false;
  for (const p of people) {
    const pid = str(p?.id);
    if (!pid || b.removed.includes(pid) || b.members.some((m) => m.id === pid)) continue;
    b.members.push(newMember(b, pid, p.name, null));
    changed = true;
  }
  if (changed) touch(b);
  return changed;
}

/* ─────── стикеры ─────── */

const stickerId = (b) => {
  for (;;) {
    const id = crypto.randomBytes(6).toString("base64url");
    if (!b.stickers.some((s) => s.id === id)) return id;
  }
};

/** Новый пустой стикер — в конец: «новые стикеры должны появляться справа от предыдущих». */
export async function addSticker(id, uid) {
  await load();
  const b = must(id);
  gate(b, uid);
  if (b.stickers.length >= MAX_STICKERS) {
    throw new BoardError(400, `На доске уже ${MAX_STICKERS} стикеров.`);
  }
  const at = nowIso();
  const s = { id: stickerId(b), by: String(uid), text: "", createdAt: at, updatedAt: at };
  b.stickers.push(s);
  touch(b);
  return { board: b, sticker: s };
}

function ownSticker(b, sid, uid) {
  const s = b.stickers.find((x) => x.id === String(sid));
  if (!s) throw new BoardError(404, "Стикера нет.");
  // «Вводить и редактировать текст на стикере может только тот, кто его создал.»
  if (s.by !== String(uid)) throw new BoardError(403, "Править стикер может только его автор.");
  return s;
}

export async function setStickerText(id, sid, uid, text) {
  await load();
  const b = must(id);
  gate(b, uid);
  const s = ownSticker(b, sid, uid);
  // Без текста в запросе — отказ, а не молча стёртый стикер: очистить его
  // можно только явной пустой строкой.
  if (typeof text !== "string") throw new BoardError(400, "Нет текста стикера.");
  const t = text.slice(0, TEXT_MAX);
  if (s.text !== t) {
    s.text = t;
    s.updatedAt = nowIso();
    touch(b);
  }
  return b.rev;
}

export async function deleteSticker(id, sid, uid) {
  await load();
  const b = must(id);
  gate(b, uid);
  const s = ownSticker(b, sid, uid);
  b.stickers.splice(b.stickers.indexOf(s), 1);
  touch(b);
  return b.rev;
}

/* ─────── участники: управляет только создатель ─────── */

function asCreator(b, actor) {
  gate(b, actor);
  if (b.by !== String(actor)) {
    throw new BoardError(403, "Управлять участниками может только создатель доски.");
  }
}

/**
 * Заблокировать (или снять блок). Заблокированный остаётся в участниках,
 * и его стикеры остаются на доске — он лишь не может войти.
 */
export async function setBlocked(id, actor, uid, blocked) {
  await load();
  const b = must(id);
  asCreator(b, actor);
  const who = String(uid);
  if (who === String(actor)) {
    if (blocked) throw new BoardError(400, "Себя заблокировать нельзя.");
    return b;
  }
  const m = b.members.find((x) => x.id === who);
  if (!m) throw new BoardError(404, "Участника нет.");
  if (m.blocked !== Boolean(blocked)) {
    m.blocked = Boolean(blocked);
    touch(b);
  }
  return b;
}

/**
 * Удалить участника: из списка — вон, id — в `removed` (войти больше не
 * сможет), и ВСЕ его стикеры — с доски.
 */
export async function removeMember(id, actor, uid) {
  await load();
  const b = must(id);
  asCreator(b, actor);
  const who = String(uid);
  if (who === String(actor)) throw new BoardError(400, "Себя удалить нельзя.");
  const i = b.members.findIndex((x) => x.id === who);
  if (i === -1) throw new BoardError(404, "Участника нет.");
  b.members.splice(i, 1);
  if (!b.removed.includes(who)) b.removed.push(who);
  b.stickers = b.stickers.filter((s) => s.by !== who);
  touch(b);
  return b;
}
