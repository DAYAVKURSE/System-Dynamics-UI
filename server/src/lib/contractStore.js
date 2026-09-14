import crypto from "node:crypto";
import { readOrg, writeOrg, addUser } from "./orgStore.js";
import { ownReport, saveReport } from "./reportStore.js";
import {
  docxToHtml, fillDocx, htmlToDocx, insertSignature, placeholdersOf, signatureFrames,
} from "./docx.js";

/* ════════════════════════════════════════════════════════════════
   ДОГОВОРЫ · документы с версиями, соглашения, подписи

   Владелец (2026-09-14): «форма договоров как у анкет: название (или
   «такое же, как у файла»), файл, под ним поля плейсхолдеров; после
   загрузки кнопка становится названием, справа «Удалить»; нажатие на
   файл — дерево старых версий; выделенный документ — «Скачать» и
   «Сохранить изменения», под ними описание изменений, как в git; сам
   документ открывается на весь экран, листается и правится; все
   документы — Word. Плейсхолдеры — `[(ключ): описание]`; места подписи
   сторон выделены рамкой: сторона 1 — сплошной, сторона 2 — пунктирной.
   Плейсхолдеры загружаются из документа сами. Заполнять все не
   обязательно, но при выдаче договора они должны быть заполнены.
   «Пригласить участника»: заполнить пустые плейсхолдеры, сумму, даты
   начала и окончания (обязательные плейсхолдеры самого договора — без них
   он не загружается), поставить подпись, «Отправить» → выбрать человека
   из чатов или переслать его сообщение боту. Позванный при открытии
   заполняет остальное, подписывает и отправляет. Подписи — на экране
   телефона в реальном времени, хранить так, чтобы почерковедческая
   экспертиза могла сказать, чья это подпись. После подписания открывается
   интерфейс роли. Новые роли уже зарегистрированным — тоже через
   договор; интерфейс закрыт, пока не подписан, если срок старого вышел
   или роль отключена».

   ─── что где ───

   ДОКУМЕНТ (`org.docs[]`) — договор-шаблон с ИСТОРИЕЙ ВЕРСИЙ: каждая
   версия — файл .docx в хранилище отчётов, описание изменений (как
   сообщение коммита), список плейсхолдеров, найденных в тексте, и где
   стоят рамки подписей. Версии не переписываются — добавляются; удалить
   можно любую, кроме последней. `values` документа — значения
   плейсхолдеров, заполненные владельцем заранее (общие для всех выдач).

   СОГЛАШЕНИЕ (`org.agreements[]`) — выдача договора одному человеку:
   какая версия документа, какая роль, что заполнил владелец (сумма, даты
   и остальное), его подпись; затем — кому отправлено, что дописал
   человек, его подпись, готовый файл. Статус: `sent` → `signed`
   (или `revoked`). Роль действует, пока действует соглашение
   (`roleActive` в orgStore.js).

   ПОДПИСЬ — не картинка, а траектория: штрихи с временем и нажимом,
   размер поля, устройство, момент, подписант и хеш документа; хеш записи
   считает клиент (web/src/lib/signature.js), сервер сверяет его заново
   и пишет свой (`serverHash`) — так по записи видно, кто, когда и что
   подписал, и как двигалась рука. Картинка PNG — только чтобы вставить
   подпись в документ.

   Обязательные плейсхолдеры документа: `sum`, `start`, `end` — сумма и
   срок договора. Без них документ не принимается: роли нужен срок
   действия, а договору — цена.
   ════════════════════════════════════════════════════════════════ */

export class BadInput extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export const REQUIRED_KEYS = ["sum", "start", "end"];
const MAX_NOTE = 2000;
const MAX_VALUE = 2000;
const MAX_DOC_BYTES = 8 * 1024 * 1024;
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const uid = (p) => `${p}_${crypto.randomBytes(5).toString("hex")}`;
const now = () => new Date().toISOString();
const str = (v, max) => String(v ?? "").trim().slice(0, max);
const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");

/* Файл приезжает JSON-ом: base64 или data:-ссылка. */
export const bytesOf = (data) => {
  const raw = String(data || "");
  return Buffer.from(raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw, "base64");
};
const isDocx = (name, type) => /\.docx$/i.test(String(name || "")) || String(type || "") === DOCX_TYPE;

/* ─────── очередь правок: одна на процесс, как у модели ─────── */
let chain = Promise.resolve();
function withOrg(job) {
  const run = async () => job(await readOrg());
  const next = chain.then(run, run);
  chain = next.then(() => {}, () => {});
  return next;
}

const findDoc = (org, id) => {
  const doc = (org.docs || []).find((d) => d.id === String(id));
  if (!doc) throw new BadInput("Договор не найден", 404);
  return doc;
};
const lastVersion = (doc) => (doc.versions || [])[doc.versions.length - 1] || null;
const versionOf = (doc, vid) => (doc.versions || []).find((v) => v.id === String(vid)) || lastVersion(doc);
export const cleanValues = (v) => {
  const out = {};
  if (v && typeof v === "object") {
    Object.entries(v).forEach(([k, x]) => { const key = str(k, 80); if (key) out[key] = str(x, MAX_VALUE); });
  }
  return out;
};

/* ─────── версия из байтов: проверка и запись ─────── */

async function versionFrom(by, { name, type, bytes, note }) {
  if (!bytes || !bytes.length) throw new BadInput("Файл пустой");
  if (bytes.length > MAX_DOC_BYTES) throw new BadInput("Файл больше 8 МБ", 413);
  if (!isDocx(name, type)) throw new BadInput("Договор должен быть в формате Word (.docx)");
  let placeholders;
  try { placeholders = await placeholdersOf(bytes); }
  catch { throw new BadInput("Файл не читается как документ Word"); }
  const keys = new Set(placeholders.map((p) => p.key));
  const missing = REQUIRED_KEYS.filter((k) => !keys.has(k));
  if (missing.length) {
    throw new BadInput(`В договоре нет обязательных плейсхолдеров: ${missing.map((k) => `[(${k}): …]`).join(", ")} — сумма и срок действия нужны каждому договору`);
  }
  const frames = await signatureFrames(bytes);
  const file = await saveReport(by, { name, type: DOCX_TYPE, bytes, kind: "doc" });
  return {
    id: uid("v"), at: now(), by: String(by), note: str(note, MAX_NOTE),
    file: { id: file.id, name: file.name, url: file.url, size: bytes.length },
    placeholders, frames, hash: sha(bytes),
  };
}

const bytesOfVersion = async (doc, ver) => {
  const r = ver?.file?.id ? await ownReport(doc.by, ver.file.id) : null;
  if (!r?.bytes) throw new BadInput("Файл версии не найден на диске", 404);
  return r.bytes;
};

/* ─────── документы ─────── */

export function addDoc(by, { name, file, note } = {}) {
  return withOrg(async (org) => {
    if (!file?.data) throw new BadInput("Приложите файл договора");
    const title = str(name, 200) || str(file.name, 200).replace(/\.docx$/i, "");
    if (!title) throw new BadInput("У договора должно быть название");
    const ver = await versionFrom(by, { name: str(file.name, 200) || `${title}.docx`, type: file.type,
      bytes: bytesOf(file.data), note: note || "первая версия" });
    const doc = { id: uid("doc"), name: title, at: now(), by: String(by), values: {}, versions: [ver] };
    org.docs = [...(org.docs || []), doc];
    await writeOrg(org);
    return doc;
  });
}

/** Новая версия: из файла или из правленного в браузере HTML. */
export function addVersion(by, docId, { file, html, note } = {}) {
  return withOrg(async (org) => {
    const doc = findDoc(org, docId);
    let ver;
    if (file?.data) {
      ver = await versionFrom(by, { name: str(file.name, 200) || `${doc.name}.docx`, type: file.type,
        bytes: bytesOf(file.data), note });
    } else if (typeof html === "string" && html.trim()) {
      const base = await bytesOfVersion(doc, lastVersion(doc));
      const bytes = await htmlToDocx(html, { base });
      ver = await versionFrom(by, { name: `${doc.name}.docx`, type: DOCX_TYPE, bytes,
        note: note || "правка в приложении" });
    } else throw new BadInput("Нужен файл или правленный текст");
    doc.versions = [...doc.versions, ver];
    await writeOrg(org);
    return doc;
  });
}

export function updateDoc(docId, { name, values } = {}) {
  return withOrg(async (org) => {
    const doc = findDoc(org, docId);
    if (name !== undefined) {
      const t = str(name, 200);
      if (!t) throw new BadInput("У договора должно быть название");
      doc.name = t;
    }
    if (values !== undefined) doc.values = { ...(doc.values || {}), ...cleanValues(values) };
    await writeOrg(org);
    return doc;
  });
}

export function removeDoc(docId) {
  return withOrg(async (org) => {
    const doc = findDoc(org, docId);
    org.docs = org.docs.filter((d) => d !== doc);
    org.roles.forEach((r) => { if (r.doc === doc.id) r.doc = null; });
    await writeOrg(org);
    return { ok: true };
  });
}

export function removeVersion(docId, vid) {
  return withOrg(async (org) => {
    const doc = findDoc(org, docId);
    if (doc.versions.length <= 1) throw new BadInput("Единственную версию удалить нельзя — удалите договор");
    const ver = doc.versions.find((v) => v.id === String(vid));
    if (!ver) throw new BadInput("Версия не найдена", 404);
    if (ver === lastVersion(doc)) throw new BadInput("Последнюю версию удалить нельзя — она и есть договор");
    doc.versions = doc.versions.filter((v) => v !== ver);
    await writeOrg(org);
    return doc;
  });
}

export async function docHtml(docId, vid) {
  const org = await readOrg();
  const doc = findDoc(org, docId);
  const ver = versionOf(doc, vid);
  return { html: await docxToHtml(await bytesOfVersion(doc, ver)), version: ver };
}

export function setRoleDoc(roleId, docId) {
  return withOrg(async (org) => {
    const role = org.roles.find((r) => r.id === String(roleId));
    if (!role) throw new BadInput("Роль не найдена", 404);
    if (docId) findDoc(org, docId);
    role.doc = docId ? String(docId) : null;
    await writeOrg(org);
    return role;
  });
}

/* ─────── подписи ─────── */

const MIN_POINTS = 12;
/* Запись подписи с клиента: штрихи с временем и нажимом, размер поля,
   PNG, устройство, хеш. Сервер не верит хешу на слово — считает свой по
   тем же полям и пишет рядом (`serverHash`), плюс момент получения. */
export function cleanSignature(sig, { by, docHash } = {}) {
  if (!sig || typeof sig !== "object") throw new BadInput("Нужна подпись");
  const strokes = Array.isArray(sig.strokes) ? sig.strokes : [];
  const points = strokes.reduce((n, st) => n + (Array.isArray(st) ? st.length : 0), 0);
  if (strokes.length < 1 || points < MIN_POINTS) throw new BadInput("Подпись слишком короткая — распишитесь, как на бумаге");
  const png = String(sig.png || "");
  if (!/^data:image\/png;base64,/.test(png)) throw new BadInput("Подпись без изображения — поставьте её заново");
  const clean = strokes.map((st) => st.map((pt) => ({
    x: Number(pt.x) || 0, y: Number(pt.y) || 0, t: Number(pt.t) || 0,
    p: pt.p == null ? 0.5 : Number(pt.p) || 0 })));
  const at = str(sig.at, 40) || now();
  return {
    by: String(by), at, receivedAt: now(), docHash: str(docHash || sig.docHash, 128),
    w: Number(sig.w) || 0, h: Number(sig.h) || 0, ua: str(sig.ua, 300),
    stats: sig.stats && typeof sig.stats === "object" ? sig.stats : null,
    strokes: clean, png, hash: str(sig.hash, 128),
    serverHash: sha(JSON.stringify({ by: String(by), at, docHash: str(docHash || sig.docHash, 128), strokes: clean })),
  };
}
const pngBytes = (sig) => Buffer.from(String(sig.png).replace(/^data:image\/png;base64,/, ""), "base64");

/* ─────── соглашения ─────── */

const findAgreement = (org, id) => {
  const a = (org.agreements || []).find((x) => x.id === String(id));
  if (!a) throw new BadInput("Соглашение не найдено", 404);
  return a;
};
const parseDay = (v) => {
  const s = str(v, 40);
  if (!s) return null;
  return Number.isFinite(Date.parse(s)) ? s : undefined;
};
const publicAgreement = (a) => {
  // Штрихи подписей наружу не уходят: списку они не нужны, а весят много.
  const sig = (s) => (s ? { by: s.by, at: s.at, hash: s.hash, serverHash: s.serverHash } : null);
  return { ...a, sign1: sig(a.sign1), sign2: sig(a.sign2), token: undefined };
};

/**
 * Владелец выдаёт договор: заполняет, что может (плейсхолдеры можно
 * оставить пустыми — их дозаполнит человек), сумму и даты (обязательно),
 * подписывает — и получает ссылку, которую отправит человеку.
 */
export function createAgreement(by, { docId, roleId, values, sum, start, end, sign1 } = {}) {
  return withOrg(async (org) => {
    const doc = findDoc(org, docId);
    const ver = lastVersion(doc);
    const role = org.roles.find((r) => r.id === String(roleId));
    if (!role) throw new BadInput("Роль не найдена", 404);
    const money = str(sum, 80);
    if (!money) throw new BadInput("Назовите сумму договора");
    const s = parseDay(start), e = parseDay(end);
    if (!s || !e) throw new BadInput("Нужны даты начала и окончания действия договора");
    if (Date.parse(e) < Date.parse(s)) throw new BadInput("Окончание раньше начала");
    const sig = cleanSignature(sign1, { by, docHash: ver.hash });
    const a = {
      id: uid("agr"), docId: doc.id, versionId: ver.id, roleId: role.id,
      by: String(by), at: now(), values: cleanValues(values), sum: money, start: s, end: e,
      sign1: sig, token: crypto.randomBytes(12).toString("base64url"),
      to: null, userValues: {}, sign2: null, signedAt: null, file: null, status: "sent",
    };
    org.agreements = [...(org.agreements || []), a];
    await writeOrg(org);
    return { ...publicAgreement(a), token: a.token };
  });
}

/** Ссылка приглашения: человек открывает бота с ней — и договор его. */
export const inviteLink = (token, botName = process.env.BOT_NAME || "") =>
  (botName ? `https://t.me/${botName}?start=agr_${token}` : `agr_${token}`);

/**
 * Человек пришёл по ссылке (бот, `/start agr_<token>`) — соглашение
 * привязывается к нему, он становится позванным с приготовленной ролью.
 */
export function claimAgreement(token, { id, name, username } = {}) {
  return withOrg(async (org) => {
    const a = (org.agreements || []).find((x) => x.token === String(token || ""));
    if (!a) throw new BadInput("Ссылка не открывает договор: его отозвали или ссылка неверна", 404);
    if (a.status !== "sent") throw new BadInput("Этот договор уже подписан");
    if (a.to && String(a.to.id) !== String(id)) throw new BadInput("Этот договор отправлен другому человеку", 403);
    a.to = { id: String(id), name: String(name || id), username: String(username || "") };
    await writeOrg(org);
    await addUser({ id, name, username, roleId: a.roleId, addedBy: a.by });
    return publicAgreement(a);
  });
}

/**
 * Владелец добавил человека по пересылке — если для этой роли ждёт
 * неотправленное никому соглашение, оно его: так работает «в крайнем
 * случае переслать сообщение этого пользователя в бот».
 */
export function bindLatestAgreement(userId, roleId, profile = {}) {
  return withOrg(async (org) => {
    const list = (org.agreements || []).filter((a) => a.status === "sent" && a.roleId === String(roleId) && !a.to);
    const a = list[list.length - 1];
    if (!a) return null;
    a.to = { id: String(userId), name: String(profile.name || userId), username: String(profile.username || "") };
    await writeOrg(org);
    return publicAgreement(a);
  });
}

export function revokeAgreement(id) {
  return withOrg(async (org) => {
    const a = findAgreement(org, id);
    if (a.status === "signed") throw new BadInput("Подписанный договор не отзывается — отключите роль на «Участниках»");
    a.status = "revoked";
    await writeOrg(org);
    return publicAgreement(a);
  });
}

/** Договор глазами позванного: текст с уже заполненным и что осталось. */
export async function agreementHtml(userId, id, { asOwner = false } = {}) {
  const org = await readOrg();
  const a = findAgreement(org, id);
  if (!asOwner && String(a.to?.id || "") !== String(userId)) throw new BadInput("Это не ваш договор", 403);
  const doc = findDoc(org, a.docId);
  const ver = versionOf(doc, a.versionId);
  const values = { ...(doc.values || {}), ...(a.values || {}), ...(a.userValues || {}),
    sum: a.sum, start: a.start, end: a.end };
  const filled = await fillDocx(await bytesOfVersion(doc, ver), values);
  return { html: await docxToHtml(filled), agreement: publicAgreement(a) };
}

/**
 * Человек подписывает: дописывает свои значения, ставит подпись — и
 * договор готов: все плейсхолдеры заполнены, обе подписи в рамках,
 * файл сохранён, роль выдана и действует по сроку.
 */
export function signAgreement(userId, id, { values, sign2 } = {}) {
  return withOrg(async (org) => {
    const a = findAgreement(org, id);
    if (String(a.to?.id || "") !== String(userId)) throw new BadInput("Это не ваш договор", 403);
    if (a.status !== "sent") throw new BadInput("Договор уже подписан или отозван");
    const doc = findDoc(org, a.docId);
    const ver = versionOf(doc, a.versionId);
    a.userValues = { ...(a.userValues || {}), ...cleanValues(values) };
    const all = { ...(doc.values || {}), ...(a.values || {}), ...a.userValues,
      sum: a.sum, start: a.start, end: a.end };
    const empty = (ver.placeholders || []).filter((p) => !str(all[p.key], MAX_VALUE));
    if (empty.length) {
      throw new BadInput(`Заполните: ${empty.map((p) => p.desc || p.key).join(", ")} — договор выдаётся только заполненным`);
    }
    const sig = cleanSignature(sign2, { by: userId, docHash: ver.hash });
    let bytes = await fillDocx(await bytesOfVersion(doc, ver), all);
    bytes = await insertSignature(bytes, { party: 1, png: pngBytes(a.sign1) });
    bytes = await insertSignature(bytes, { party: 2, png: pngBytes(sig) });
    const file = await saveReport(a.by, { name: `${doc.name} — подписан.docx`, type: DOCX_TYPE, bytes, kind: "contract" });
    a.sign2 = sig;
    a.signedAt = now();
    a.status = "signed";
    a.file = { id: file.id, name: file.name, url: file.url, size: bytes.length, hash: sha(bytes) };
    // Роль — выдана; действует она по сроку соглашения (roleActive).
    const user = org.users.find((u) => u.id === String(userId));
    if (user) {
      user.roles = [...new Set([...(user.roles || []), a.roleId])];
      user.contracts = { ...(user.contracts || {}),
        [a.roleId]: { agreementId: a.id, name: file.name, url: file.url, at: a.signedAt,
          sum: a.sum, start: a.start, end: a.end } };
      if (String(user.pending || "") === a.roleId) delete user.pending;
    }
    await writeOrg(org);
    return publicAgreement(a);
  });
}

/** Владельцу — все соглашения (без штрихов), человеку — свои. */
export async function listAgreements({ userId, isOwner }) {
  const org = await readOrg();
  return (org.agreements || [])
    .filter((a) => isOwner || String(a.to?.id || "") === String(userId))
    .map(publicAgreement);
}

/** Договоры участника для списка на «Участниках»: даты и сумма. */
export const contractsOf = (org, user) => (org.agreements || [])
  .filter((a) => a.status === "signed" && String(a.to?.id || "") === String(user.id))
  .map((a) => ({ id: a.id, roleId: a.roleId, sum: a.sum, start: a.start, end: a.end,
    signedAt: a.signedAt, file: a.file, docName: (org.docs || []).find((d) => d.id === a.docId)?.name || "" }));
