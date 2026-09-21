import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { avatarOf, identify, listOrg } from "../lib/orgStore.js";
import { aliasOf } from "../lib/alias.js";
import { BadInput, addIssue, fixedText, listIssues, markFixed, markSeen, removeIssue, unreadCount }
  from "../lib/issuesStore.js";
import { readSchedule } from "../lib/scheduleStore.js";
import { sendMessage } from "../lib/telegram.js";

/* ════════════════════════════════════════════════════════════════
   СООБЩЕНИЯ ОБ ОШИБКАХ · маршруты (владелец, 2026-09-21)

   Написать может ЛЮБОЙ позванный: кнопка со значком стоит в шапке у всех,
   и ошибку замечает тот, кто работает, а не тот, кто чинит.

   Читать и удалять — тот, кому открыта вкладка «issues»: по умолчанию
   владелец, а кому ещё — решает роль, как и со всеми вкладками. Список
   чужих жалоб — не то, что показывают каждому вошедшему.

   Имена здесь не хранятся: хранилище знает один id, а кто есть кто —
   спрашивается у организации в момент ответа. Незнакомый автор
   представляется двумя словами, как и на рынке: приложение не выдаёт
   людей, которых смотрящий не видел.
   ════════════════════════════════════════════════════════════════ */

const router = Router();
router.use(telegramUser);
router.use(async (req, res, next) => {
  try {
    req.me = await identify(req.telegramUserId, req.telegramProfile || {}, { claim: false });
    if (!req.me.known) return res.status(403).json({ error: "not invited" });
    return next();
  } catch (e) { return next(e); }
});

const fail = (res, e, next) => (e instanceof BadInput
  ? res.status(e.status).json({ error: e.message }) : next(e));

/* Право читать — по вкладке, а не по должности, и правило то же, что в
   интерфейсе (`tabShown` в web/src/identity.js): роль, назвавшая
   внутренние вкладки, открывает ровно их; роль, назвавшая только
   «Инструменты», открывает их целиком. Разойдись эти два правила — и
   человек видел бы вкладку, на которой сервер отвечает отказом. */
const mayRead = (me) => {
  if (me.isOwner) return true;
  const tabs = me.tabs || [];
  const inner = tabs.filter((t) => String(t).startsWith("tools:"));
  return inner.length ? inner.includes("tools:issues") : tabs.includes("tools");
};
/* Удаление — право «rw»: «r» на вкладке значит смотреть, и выключенная
   кнопка запретом не является. */
const mayWrite = (me) => mayRead(me)
  && (me.isOwner || ((me.access || {})["tools:issues"] || (me.access || {}).tools) !== "r");

router.post("/", async (req, res, next) => {
  try {
    return res.status(201).json(await addIssue(req.me.id, req.body?.text));
  } catch (e) { return fail(res, e, next); }
});

router.get("/", async (req, res, next) => {
  try {
    if (!mayRead(req.me)) return res.status(403).json({ error: "not yours" });
    const org = await listOrg();
    const by = new Map((org.users || []).map((u) => [String(u.id), u]));
    const list = (await listIssues()).map((x) => {
      const u = by.get(String(x.by));
      return u
        ? { ...x, name: u.name, ...avatarOf(u) }
        : { ...x, name: aliasOf(x.by), avatar: "", avatarOwn: false, avatarOff: false };
    });
    return res.json({ issues: list });
  } catch (e) { return fail(res, e, next); }
});

/* Сколько не прочитано — для красного кружка на кнопке вкладки. */
router.get("/unread", async (req, res, next) => {
  try {
    if (!mayRead(req.me)) return res.json({ unread: 0 });
    return res.json({ unread: await unreadCount() });
  } catch (e) { return fail(res, e, next); }
});
/* Список открыли — всё прочитано. */
router.post("/seen", async (req, res, next) => {
  try {
    if (!mayRead(req.me)) return res.status(403).json({ error: "not yours" });
    await markSeen();
    return res.json({ ok: true });
  } catch (e) { return fail(res, e, next); }
});
/* «Исправлено»: отправителю — сообщение в бот с его же текстом. */
router.post("/:id/fixed", async (req, res, next) => {
  try {
    if (!mayWrite(req.me)) return res.status(403).json({ error: "not yours" });
    const issue = await markFixed(req.params.id);
    if (!issue) return res.status(404).json({ error: "not found" });
    let told = false;
    if (process.env.TELEGRAM_BOT_TOKEN) {
      const chat = (await readSchedule(issue.by).catch(() => null))?.chatId || issue.by;
      try { await sendMessage(chat, fixedText(issue)); told = true; }
      catch (e) { console.error(`[issues] не сказал автору: ${e.message}`); }
    }
    return res.json({ issue, told });
  } catch (e) { return fail(res, e, next); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    if (!mayWrite(req.me)) return res.status(403).json({ error: "not yours" });
    if (!(await removeIssue(req.params.id))) {
      return res.status(404).json({ error: "not found" });
    }
    return res.status(204).end();
  } catch (e) { return fail(res, e, next); }
});

export default router;
