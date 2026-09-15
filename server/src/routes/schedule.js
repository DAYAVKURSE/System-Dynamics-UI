import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { readSchedule, saveSchedule } from "../lib/scheduleStore.js";
import { listReminders } from "../lib/scheduler.js";

const router = Router();
router.use(telegramUser);

router.get("/", async (req, res, next) => {
  try {
    const s = await readSchedule(req.telegramUserId);
    res.json(s ? { tasks: s.tasks?.length ?? 0, tzOffset: s.tzOffset, updatedAt: s.updatedAt }
      : { tasks: 0, tzOffset: 0, updatedAt: null });
  } catch (e) {
    next(e);
  }
});

/* Список напоминаний человека: что и когда пришлёт бот, что висит. */
router.get("/reminders", async (req, res, next) => {
  try {
    const s = await readSchedule(req.telegramUserId);
    res.json({ reminders: listReminders(s, Date.now()), tzOffset: s?.tzOffset ?? 0 });
  } catch (e) { next(e); }
});

router.put("/", async (req, res, next) => {
  try {
    const { tzOffset, tasks } = req.body || {};
    // В личном чате chat_id совпадает с id пользователя, поэтому берём его
    // из проверенной подписи, а не из тела запроса: иначе кто угодно смог бы
    // слать напоминания в чужой чат.
    const out = await saveSchedule(req.telegramUserId, {
      chatId: req.telegramUserId, tzOffset, tasks,
    });
    res.json(out);
  } catch (e) {
    if (/must be|limit/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

export default router;
