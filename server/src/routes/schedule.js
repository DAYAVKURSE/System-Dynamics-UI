import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { dropNote, readSchedule, saveNotes, saveSchedule } from "../lib/scheduleStore.js";
import { listReminders, syncNotes } from "../lib/scheduler.js";
import { scheduleFor } from "../lib/scheduleTasks.js";

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

/* Список напоминаний человека: по форме на каждое — что за задача, чем
   она занята и ушло ли напоминание.

   Записи заводятся здесь же, а не только в проходе планировщика: человек
   открывает список сразу после того, как задача появилась, и пустой
   список в этот момент читался бы как «напоминаний не будет». */
router.get("/reminders", async (req, res, next) => {
  try {
    /* Задачи — из МОДЕЛИ (владелец, 2026-09-20): прежде список строился
       только по расписанию из браузера, и пока доску не открыли, он был
       пуст — «взял задачу в работу, ничего не появилось». */
    const saved = await readSchedule(req.telegramUserId);
    const s = await scheduleFor(req.telegramUserId, saved);
    const synced = syncNotes(s, Date.now());
    if (synced.changed) await saveNotes(req.telegramUserId, synced.notes);
    s.notes = synced.notes;
    res.json({ reminders: listReminders(s, Date.now()), tzOffset: s.tzOffset });
  } catch (e) { next(e); }
});

/* Убрать напоминание из списка. Только своё: расписание у каждого своё,
   и чужого в этом маршруте не достать — id берётся из подписи. */
router.delete("/reminders/:id", async (req, res, next) => {
  try {
    const ok = await dropNote(req.telegramUserId, req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    return res.status(204).end();
  } catch (e) { return next(e); }
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
