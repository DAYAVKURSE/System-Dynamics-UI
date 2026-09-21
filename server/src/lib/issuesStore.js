import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/* ════════════════════════════════════════════════════════════════
   СООБЩЕНИЯ ОБ ОШИБКАХ (владелец, 2026-09-21)

   «Кнопка со значком восклицательного знака… модальное окно с просьбой
   „Напишите сообщение об ошибке" и полем ввода… вкладка „issues", где
   будут в списке показаны отправленные пользователями сообщения, и
   кнопка „Удалить" рядом с каждым».

   Значок стоит в шапке, рядом с «Отменить»: ошибку замечают ПОСРЕДИ
   работы, и уводить человека за ней на отдельную вкладку значит
   требовать, чтобы он сначала вспомнил, куда идти, а потом — что хотел
   сказать.

   Запись — это текст, кто написал и когда. Ничего больше здесь не
   придумывается: ни важности, ни статуса, ни ответа. Сообщение об ошибке
   живёт до тех пор, пока его не удалят, и удаление — единственное, что с
   ним делают.

   Один файл на сервер: список общий, как и рынок. Имён тут нет, только
   id — кто есть кто, маршрут спрашивает у организации, когда отвечает.
   ════════════════════════════════════════════════════════════════ */

export const MAX_TEXT = 4000;
export const MAX_LOG = 6000;
/* Снимок — PNG из приложения, до 2 МБ: экран телефона в 720 px весит
   сотни килобайт. */
export const MAX_SHOT_BYTES = 2 * 1024 * 1024;
/* Предел списка: файл читается целиком, и без него один настойчивый
   отправитель вырастил бы его до размеров, которые уже не открыть.
   Вытесняются самые старые — новое важнее забытого. */
export const MAX_ISSUES = 500;

export class BadInput extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function baseDir() {
  return process.env.ISSUES_DIR
    ? path.resolve(process.env.ISSUES_DIR)
    : path.resolve(process.cwd(), "data", "issues");
}
const file = () => path.join(baseDir(), "issues.json");

export async function readIssues() {
  try {
    const parsed = JSON.parse(await fs.readFile(file(), "utf8"));
    return Array.isArray(parsed.issues) ? parsed.issues : [];
  } catch { return []; }
}

async function writeIssues(list) {
  await fs.mkdir(baseDir(), { recursive: true });
  const tmp = `${file()}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify({ issues: list }), "utf8");
    await fs.rename(tmp, file());
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  return list;
}

/* Очередь правок — одна на процесс, как у рынка: два сообщения в одну
   секунду не должны затирать друг друга. */
let chain = Promise.resolve();
function withIssues(job) {
  const run = async () => job(await readIssues());
  const next = chain.then(run, run);
  chain = next.then(() => {}, () => {});
  return next;
}

/** Список — от новых к старым: свежая ошибка нужнее позавчерашней. */
export async function listIssues() {
  return (await readIssues()).slice().reverse();
}

/** Снимок разбирается из data: URL — только PNG и только до предела. */
export function shotBytes(shot) {
  const raw = String(shot || "");
  if (!raw) return null;
  const m = raw.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new BadInput("Снимок должен быть PNG");
  const bytes = Buffer.from(m[1], "base64");
  if (!bytes.length) throw new BadInput("Снимок пустой");
  if (bytes.length > MAX_SHOT_BYTES) throw new BadInput("Снимок экрана слишком большой");
  return bytes;
}
const shotFile = (issue) => path.join(baseDir(), `${issue.id}-${issue.shotKey}.png`);

/** Новое сообщение. Пустое не принимается: жаловаться молча не на что.
 *  Вместе с текстом — лента последних действий (`log`) и снимок экрана
 *  (`shot`, data: URL PNG), если человек его отметил (владелец,
 *  2026-09-21). Снимок ложится файлом рядом с issues.json; ключ в имени
 *  файла — чтобы ссылку нельзя было угадать по id. */
export async function addIssue(byId, text, { log = "", shot = null } = {}) {
  const body = String(text ?? "").trim().slice(0, MAX_TEXT);
  if (!body) throw new BadInput("Напишите, что сломалось");
  const bytes = shotBytes(shot);
  const tape = String(log ?? "").trim().slice(0, MAX_LOG);
  return withIssues(async (list) => {
    const issue = {
      id: `is_${crypto.randomBytes(5).toString("hex")}`,
      by: String(byId),
      text: body,
      at: new Date().toISOString(),
      ...(tape ? { log: tape } : {}),
      ...(bytes ? { shotKey: crypto.randomBytes(12).toString("hex") } : {}),
    };
    if (bytes) {
      await fs.mkdir(baseDir(), { recursive: true });
      await fs.writeFile(shotFile(issue), bytes);
    }
    await writeIssues([...list, issue].slice(-MAX_ISSUES));
    return issue;
  });
}

/** Байты снимка по id и ключу из ссылки; нет — null. */
export async function readShot(id, key) {
  const issue = (await readIssues()).find((x) => x.id === String(id));
  if (!issue || !issue.shotKey || issue.shotKey !== String(key)) return null;
  try { return await fs.readFile(shotFile(issue)); } catch { return null; }
}
/** Ссылка на снимок для списка; без снимка — "". */
export const shotUrl = (issue) => (issue.shotKey ? `/api/issues/shot/${issue.id}/${issue.shotKey}.png` : "");

/** Удалить сообщение. `false` — такого нет; это не ошибка, а ответ. */
export async function removeIssue(id) {
  return withIssues(async (list) => {
    const gone = list.find((x) => x.id === String(id));
    if (!gone) return false;
    await writeIssues(list.filter((x) => x !== gone));
    if (gone.shotKey) await fs.rm(shotFile(gone), { force: true }).catch(() => {});
    return true;
  });
}

/* ─────── прочитано и исправлено (владелец, 2026-09-21) ───────
   «Прочитано» — тем, кто открыл список; счётчик непрочитанных стоит на
   кнопке вкладки красным кружком. «Исправлено» — отправителю уходит
   сообщение в бот, а у записи остаётся отметка. */
export async function unreadCount() {
  return (await readIssues()).filter((x) => !x.seenAt).length;
}
export async function markSeen() {
  return withIssues(async (list) => {
    const at = new Date().toISOString();
    let changed = false;
    list.forEach((x) => { if (!x.seenAt) { x.seenAt = at; changed = true; } });
    if (changed) await writeIssues(list);
    return changed;
  });
}
export async function markFixed(id) {
  return withIssues(async (list) => {
    const x = list.find((y) => y.id === String(id));
    if (!x) return null;
    x.fixedAt = new Date().toISOString();
    await writeIssues(list);
    return x;
  });
}
export const fixedText = (issue) => `Отправленная проблема исправлена:\n${issue.text}\nСпасибо за помощь в развитии проекта!`;
