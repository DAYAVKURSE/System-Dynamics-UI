import { Router } from "express";
import crypto from "node:crypto";
import { telegramUser } from "../middleware/telegramUser.js";
import { boardUser } from "../middleware/boardUser.js";
import { avatarOf, envOwner, grantFor, identify, isVirtualId, readOrg } from "../lib/orgStore.js";
import { MAIN, inStorage } from "../lib/storages.js";
import { PLAN_TABS } from "../lib/plans.js";
import { getReport } from "../lib/reportStore.js";
import * as boards from "../lib/boardStore.js";

/* ════════════════════════════════════════════════════════════════
   БРЕЙНШТОРМ-ДОСКИ · маршруты (владелец, 2026-09-25)

   Два входа, как у звонков (routes/calls.js), и путать их нельзя.

   СПИСОК И СОЗДАНИЕ — из основного приложения, вкладка «Брейншторм»:
   обычная подпись Telegram, хранилище из X-Storage, код плана. «Права на
   создание имеют те, у кого есть права на открытие этой вкладки» —
   владелец хранилища или роль с вкладкой `brainstorm`, и план её
   открывает.

   САМА ДОСКА — любой, у кого есть ссылка: её отправили в общий чат, и
   открыть её должен каждый участник чата. Id неугадываемый и есть
   приглашение. Но только подписанный Telegram (middleware/boardUser.js):
   блокировку и удаление по номеру, который браузер завёл себе сам, не
   удержать. На этом пути НЕТ identify() с назначением владельца —
   организация читается напрямую.

   Всё, что доска запрещает, запрещает сервер: заблокированный и
   удалённый не проходят ни на одном маршруте доски (включая ожидание
   изменений), чужой стикер не правится, участниками управляет только
   создатель. Кнопки в интерфейсе — лишь отражение этого.
   ════════════════════════════════════════════════════════════════ */

const router = Router();

const WAIT_DEFAULT_MS = 20000;
const WAIT_MAX_MS = 25000;

const fail = (res, e, next) => (e instanceof boards.BoardError
  ? res.status(e.status).json({ error: e.message, ...e.extra })
  : next(e));

/* ─────── кто вправе: вкладка «Брейншторм» ─────── */

const planTabs = (code) => (Array.isArray(code.tabs) ? code.tabs
  : (PLAN_TABS[code.plan] || PLAN_TABS.free));

/**
 * Открыта ли человеку вкладка «Брейншторм» в текущем хранилище — то же
 * правило, что рисует вкладку в приложении: план (если сервис кодов
 * включён), потом владелец или роль. На чужой странице (X-Act-As) — как
 * в «кто я» (routes/org.js): по коду доступа — только то, что открыли;
 * владелец — как сама страница; остальным там только анкета.
 */
async function brainstormRights(req) {
  if (req.code && !planTabs(req.code).includes("brainstorm")) return { ok: false, me: null };
  const me = await identify(req.telegramUserId, req.telegramProfile || {}, { claim: false });
  let ok = Boolean(me.isOwner || (me.tabs || []).includes("brainstorm"));
  if (ok && req.actingAs) {
    const grant = await grantFor(req.telegramRealId, req.actingAs);
    ok = grant ? (grant.tabs || []).includes("brainstorm")
      : String((await readOrg()).ownerId || "") === String(req.telegramRealId || "");
  }
  return { ok, me };
}

/* ─────── люди хранилища доски ─────── */

const orgOf = (storage) => inStorage(storage || MAIN, () => readOrg());

/** Запись человека в организации по его Telegram-id: своя страница или
 *  страница виртуального, к которой привязан его Telegram. */
const recordOf = (org, tg) => (org.users || []).find((u) => !u.agent
  && (String(u.id) === String(tg) || String(u.tg || "") === String(tg))) || null;

/**
 * Кого вписать в участники доски: «все участники, которые имеют доступ к
 * сценарию и этой вкладке» — люди хранилища с правом на `brainstorm`,
 * владелец хранилища всегда. Id участника — Telegram-id (к нему приходит
 * подпись с доски); виртуальных без Telegram и агентов пропускаем — войти
 * на доску им нечем. identify() — без назначения владельца.
 */
export async function holdersOf(storage) {
  return inStorage(storage || MAIN, async () => {
    const org = await readOrg();
    const ownerId = String((storage === MAIN || !storage ? envOwner() : null) || org.ownerId || "");
    const out = [];
    const seen = new Set();
    const put = (id, name) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({ id, name: String(name || "") });
    };
    for (const u of org.users || []) {
      if (u.agent) continue;
      const tg = u.tg ? String(u.tg) : (isVirtualId(u.id) ? "" : String(u.id));
      if (!tg) continue;
      if (String(u.id) === ownerId) { put(tg, u.name); continue; }
      const me = await identify(String(u.id), {}, { claim: false });
      if (me.isOwner || (me.tabs || []).includes("brainstorm")) put(tg, u.name);
    }
    // Владелец, которого ещё нет в списке людей (задан переменной и не входил).
    if (ownerId && !(org.users || []).some((u) => String(u.id) === ownerId)) put(ownerId, "");
    return out;
  });
}

/* ─────── картинка участника: какую можно отдать ───────
   Одно правило и для вида доски (есть ли ссылка на картинку), и для
   маршрута, который её отдаёт: ссылка на то, что маршрут не отдаст, —
   это пустой кружок вместо двух букв.

   Картинка человека в организации бывает трёх видов, и только их доска
   отдаёт:
   · data:-URL — своя, загруженная без сервера: байтами, и только растровая
     (её пишет сам человек, и text/html или SVG со скриптом с нашего адреса
     отдавать нельзя);
   · ссылка на свой файл на этом сервере (/api/reports/<scope>/<id>) — так
     приложение хранит загруженную картинку, когда сервер есть: байтами из
     хранилища файлов, тоже только растровая;
   · картинка из Telegram — переадресацией, но только та, что пришла в
     подписи Telegram (`photo`), и только на адрес Telegram. Произвольную
     https-ссылку из анкеты доска не отдаёт: иначе её адрес стал бы
     переадресацией с нашего домена куда угодно, а <img> каждого, кто
     смотрит на доску, — запросом туда. */
const RASTER = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;
const REPORT_LINK = /^\/api\/reports\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/;
const TELEGRAM_HOST = /^(t\.me|([a-z0-9-]+\.)*telegram\.org|([a-z0-9-]+\.)*telegram-cdn\.org)$/i;

/** Что отдать вместо картинки человека `u`: `{ pic, … }` или null — отдавать нечего. */
function avatarSource(u) {
  const pic = u ? String(avatarOf(u).avatar || "") : "";
  if (!pic) return null;
  const data = /^data:([^,]*),(.*)$/s.exec(pic);
  if (data) {
    const meta = data[1].split(";").map((x) => x.trim());
    const type = meta[0].toLowerCase();
    return RASTER.test(type) ? { pic, data: { type, base64: meta.includes("base64"), body: data[2] } } : null;
  }
  const report = REPORT_LINK.exec(pic);
  if (report) return { pic, report: { scope: report[1], id: report[2] } };
  if (pic === String(u.photo || "")) {
    try {
      const url = new URL(pic);
      if (url.protocol === "https:" && !url.username && !url.password && TELEGRAM_HOST.test(url.hostname)) {
        return { pic, redirect: url.href };
      }
    } catch { /* не адрес */ }
  }
  return null;
}

/* ─────── вид доски ─────── */

const picVersion = (pic) => crypto.createHash("sha1").update(pic).digest("hex").slice(0, 8);
const avatarUrl = (boardId, uid, pic) =>
  `/api/boards/${encodeURIComponent(boardId)}/avatar/${encodeURIComponent(uid)}?v=${picVersion(pic)}`;

/**
 * Доска глазами участника `me`. Синхронно, по живому объекту стора: всё,
 * что в ответе, — одно состояние с одним `rev`.
 *
 * «Зарегистрирован» — есть запись в организации хранилища доски: у него
 * имя оттуда и картинка (если есть). Незарегистрированный — имя из
 * Telegram и две буквы на цвете участника (картинку рисует веб).
 */
function viewOf(b, org, me) {
  const counts = new Map();
  b.stickers.forEach((s) => counts.set(s.by, (counts.get(s.by) || 0) + 1));
  const members = b.members.map((m) => {
    const u = recordOf(org, m.id);
    const src = avatarSource(u);
    return {
      id: m.id,
      name: (u && u.name) || m.name || "",
      color: m.color,
      avatar: src ? avatarUrl(b.id, m.id, src.pic) : null,
      registered: Boolean(u),
      blocked: Boolean(m.blocked),
      stickers: counts.get(m.id) || 0,
    };
  });
  const creator = members.find((m) => m.id === b.by);
  return {
    id: b.id, name: b.name, color: b.color, by: b.by,
    byName: (creator && creator.name) || b.byName || "",
    createdAt: b.createdAt, rev: b.rev,
    me: String(me), isCreator: b.by === String(me),
    members,
    stickers: b.stickers
      .map((s, i) => ({ s, i }))
      .sort((x, y) => x.s.createdAt.localeCompare(y.s.createdAt) || x.i - y.i)
      .map(({ s }) => ({ id: s.id, by: s.by, text: s.text, createdAt: s.createdAt, updatedAt: s.updatedAt })),
  };
}

/** Вид — после проверки доступа: пока читалась организация, могли заблокировать. */
async function viewFor(id, me) {
  const b0 = await boards.getBoard(id);
  if (!b0) throw new boards.BoardError(404, "Доски нет.");
  const org = await orgOf(b0.storage);
  const b = await boards.checkBoard(id, me);
  return viewOf(b, org, me);
}

/* ─────── основное приложение: список и создание ─────── */

router.get("/", telegramUser, boardUser, async (req, res, next) => {
  try {
    const { ok } = await brainstormRights(req);
    if (!ok) return res.status(403).json({ error: "Нет доступа к брейншторму." });
    const storage = req.storage || MAIN;
    // Люди с доступом появляются в участниках каждой доски хранилища,
    // даже если её ещё не открывали: их роль могла появиться позже доски.
    const people = await holdersOf(storage);
    for (const b of await boards.listBoards({ storage })) await boards.enrollMembers(b.id, people);
    return res.json({ boards: await boards.listBoards({ storage }), canCreate: true });
  } catch (e) { return fail(res, e, next); }
});

router.post("/", telegramUser, boardUser, async (req, res, next) => {
  try {
    const { ok, me } = await brainstormRights(req);
    if (!ok) return res.status(403).json({ error: "У вас нет прав на создание досок." });
    const storage = req.storage || MAIN;
    /* Создатель — по Telegram-id из подписи: с ним он придёт на доску
       (там подпись — единственное имя), и по нему доска узнаёт, кто
       управляет участниками. */
    const b = await boards.createBoard({
      name: req.body?.name, storage, by: req.boardUserId,
      byName: (!req.actingAs && me?.name) || req.boardUserName,
    });
    await boards.enrollMembers(b.id, await holdersOf(storage));
    return res.status(201).json({ board: boards.summary(b) });
  } catch (e) { return fail(res, e, next); }
});

/* ─────── картинка участника ───────
   Без подписи: <img> заголовков не шлёт. Отдаётся только картинка
   ЗАРЕГИСТРИРОВАННОГО участника этой доски — ровно та, что стоит в
   приложении, и только в тех видах, что разобраны выше (avatarSource). */
router.get("/:id/avatar/:uid", async (req, res, next) => {
  try {
    const none = () => res.status(404).json({ error: "Картинки нет." });
    const b = await boards.getBoard(req.params.id);
    const uid = String(req.params.uid);
    if (!b || !b.members.some((m) => m.id === uid)) return none();
    const src = avatarSource(recordOf(await orgOf(b.storage), uid));
    if (!src) return none();
    const bytesOf = (type, bytes) => {
      res.set("Cache-Control", "private, max-age=300");
      res.set("X-Content-Type-Options", "nosniff");
      res.type(type);
      return res.send(bytes);
    };
    if (src.data) {
      let bytes;
      try {
        bytes = src.data.base64 ? Buffer.from(src.data.body, "base64")
          : Buffer.from(decodeURIComponent(src.data.body), "latin1");
      } catch { return none(); }
      return bytesOf(src.data.type, bytes);
    }
    if (src.report) {
      const file = await getReport(src.report.scope, src.report.id);
      const type = String(file?.type || "").split(";")[0].trim().toLowerCase();
      if (!file || !RASTER.test(type)) return none();
      return bytesOf(type, file.bytes);
    }
    res.set("Cache-Control", "private, max-age=300");
    return res.redirect(302, src.redirect);
  } catch (e) { return next(e); }
});

/* ─────── доска: входит любой со ссылкой ─────── */

const who = (req) => ({ id: req.boardUserId, name: req.boardUserName });

/** Каждый маршрут доски начинается со входа: заблокированный и удалённый
 *  отсюда не проходят, новый — вписывается. Черновик из инлайна при первом
 *  открытии становится доской — и в ней появляются люди с доступом. */
async function enter(req) {
  const { board, published } = await boards.enterBoard(req.params.id, who(req));
  if (published) await boards.enrollMembers(board.id, await holdersOf(board.storage));
  return board;
}

/**
 * Состояние доски — длинным опросом. Без `rev` (или с отставшим) — ответ
 * сразу. С `rev`, равным текущему, — ждём изменения до `wait` мс (не
 * дольше 25 с: прокси рвут простаивающие соединения) и отвечаем тем, что
 * есть. Разбудит любое изменение доски; клиент ушёл — ожидание снимается.
 * Блок, случившийся во время ожидания, — тоже изменение: ответ будет 403.
 */
router.get("/:id", boardUser, async (req, res, next) => {
  try {
    const board = await enter(req);
    const raw = req.query.rev;
    const rev = raw == null || raw === "" ? NaN : Number(raw);
    if (Number.isFinite(rev) && rev === board.rev) {
      const w = Number(req.query.wait);
      const wait = Number.isFinite(w) && w >= 0 ? Math.min(w, WAIT_MAX_MS) : WAIT_DEFAULT_MS;
      const gone = new AbortController();
      const stop = () => gone.abort();
      res.on("close", stop);
      await boards.waitBoard(board.id, rev, wait, gone.signal);
      res.off("close", stop);
      if (gone.signal.aborted || res.writableEnded) return undefined;
    }
    return res.json({ board: await viewFor(req.params.id, req.boardUserId) });
  } catch (e) { return fail(res, e, next); }
});

router.post("/:id/stickers", boardUser, async (req, res, next) => {
  try {
    await enter(req);
    await boards.addSticker(req.params.id, req.boardUserId);
    return res.status(201).json({ board: await viewFor(req.params.id, req.boardUserId) });
  } catch (e) { return fail(res, e, next); }
});

router.patch("/:id/stickers/:sid", boardUser, async (req, res, next) => {
  try {
    await enter(req);
    const rev = await boards.setStickerText(req.params.id, req.params.sid, req.boardUserId,
      req.body?.text);
    return res.json({ rev });
  } catch (e) { return fail(res, e, next); }
});

router.delete("/:id/stickers/:sid", boardUser, async (req, res, next) => {
  try {
    await enter(req);
    const rev = await boards.deleteSticker(req.params.id, req.params.sid, req.boardUserId);
    return res.json({ rev });
  } catch (e) { return fail(res, e, next); }
});

/* ─────── участники: только создатель ─────── */

const blockRoute = (blocked) => async (req, res, next) => {
  try {
    await enter(req);
    await boards.setBlocked(req.params.id, req.boardUserId, req.params.uid, blocked);
    return res.json({ board: await viewFor(req.params.id, req.boardUserId) });
  } catch (e) { return fail(res, e, next); }
};
router.post("/:id/members/:uid/block", boardUser, blockRoute(true));
router.post("/:id/members/:uid/unblock", boardUser, blockRoute(false));

router.delete("/:id/members/:uid", boardUser, async (req, res, next) => {
  try {
    await enter(req);
    await boards.removeMember(req.params.id, req.boardUserId, req.params.uid);
    return res.json({ board: await viewFor(req.params.id, req.boardUserId) });
  } catch (e) { return fail(res, e, next); }
});

export default router;
