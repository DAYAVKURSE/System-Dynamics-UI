import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { identify, listOrg } from "../lib/orgStore.js";
import { readModel } from "../lib/workspaceStore.js";
import { snapshotOf } from "../lib/reportView.js";
import { dropShare, getShare, listShares, putShare } from "../lib/shareStore.js";

/* ════════════════════════════════════════════════════════════════
   ССЫЛКИ НА БЛОКИ КАРТЫ ОТЧЁТОВ

   Чтение — БЕЗ подписи: в этом весь смысл ссылки. Заказчик открывает её в
   любом браузере и видит, что сделано по его заданию; ключом служит сам
   токен, как и у файлов отчётов.

   Всё остальное — только владельцу: заводит ссылки, обновляет снимок и
   убирает их он. Отзыв доступа — это удаление ссылки, и оно действует
   сразу.
   ════════════════════════════════════════════════════════════════ */

const router = Router();

// Чтение по токену. Стоит ПЕРВЫМ и без telegramUser: подпись здесь только
// мешала бы — у того, кому дали ссылку, её нет и быть не должно.
router.get("/:token", async (req, res, next) => {
  try {
    const found = await getShare(req.params.token);
    if (!found) return res.status(404).json({ error: "not found" });
    res.json(found);
  } catch (e) { next(e); }
});

router.use(telegramUser);

const ownerOnly = async (req, res, next) => {
  try {
    const me = await identify(req.telegramUserId, req.telegramProfile || {}, { claim: false });
    if (!me.isOwner) return res.status(403).json({ error: "only the owner can do this" });
    req.me = me;
    return next();
  } catch (e) { return next(e); }
};

router.get("/", ownerOnly, async (_req, res, next) => {
  try { res.json({ shares: await listShares() }); } catch (e) { next(e); }
});

/**
 * Завести ссылку на блок или обновить её снимок.
 *
 * Снимок собирается ЗДЕСЬ, из общей модели, а не принимается от клиента:
 * принятый от клиента снимок означал бы, что наружу уходит то, что прислал
 * браузер, а не то, что и правда есть в модели.
 */
router.post("/", ownerOnly, async (req, res, next) => {
  try {
    const node = String(req.body?.node || "");
    if (!node) return res.status(400).json({ error: "node is required" });
    const model = await readModel();
    // Имена людей — из организации: в снимке человек должен быть назван, а
    // не обозначен номером.
    const org = await listOrg().catch(() => ({ users: [] }));
    const snapshot = snapshotOf({ ...model, people: org.users || [] }, node);
    if (!snapshot) return res.status(404).json({ error: "no such block" });
    const saved = await putShare({ node, name: snapshot.block.name,
      by: req.me.id, snapshot });
    res.status(201).json(saved);
  } catch (e) { next(e); }
});

router.delete("/:token", ownerOnly, async (req, res, next) => {
  try {
    const gone = await dropShare(req.params.token);
    if (!gone) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
