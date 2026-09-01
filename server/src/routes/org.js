import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import {
  addRole, addUser, identify, listOrg, removeRole, removeUser, setRoleTabs,
  setUserRole, TABS,
} from "../lib/orgStore.js";

const router = Router();
router.use(telegramUser);

// Кто я и что мне видно. Единственный маршрут, открытый всем вошедшим:
// без него интерфейс не знает, какие вкладки рисовать.
router.get("/me", async (req, res, next) => {
  try {
    const me = await identify(req.telegramUserId, req.telegramProfile || {});
    res.json(me);
  } catch (e) { next(e); }
});

// Всё остальное — только владельцу. Проверка стоит на входе, а не в
// каждом обработчике: забыть её в одном месте проще, чем в одном.
router.use(async (req, res, next) => {
  try {
    const me = await identify(req.telegramUserId, req.telegramProfile || {});
    if (!me.isOwner) return res.status(403).json({ error: "only the owner can do this" });
    req.me = me;
    next();
  } catch (e) { next(e); }
});

router.get("/", async (_req, res, next) => {
  try { res.json({ ...(await listOrg()), tabs: TABS }); } catch (e) { next(e); }
});

router.post("/users", async (req, res, next) => {
  try {
    res.status(201).json(await addUser({ ...(req.body || {}), addedBy: req.telegramUserId }));
  } catch (e) {
    if (/required|unknown role/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

router.put("/users/:id/role", async (req, res, next) => {
  try {
    const user = await setUserRole(req.params.id, req.body?.roleId);
    if (!user) return res.status(404).json({ error: "not found" });
    res.json(user);
  } catch (e) {
    if (/unknown role/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

router.delete("/users/:id", async (req, res, next) => {
  try {
    const ok = await removeUser(req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

router.post("/roles", async (req, res, next) => {
  try { res.status(201).json(await addRole(req.body || {})); }
  catch (e) {
    if (/required|already exists/.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
});

router.put("/roles/:id/tabs", async (req, res, next) => {
  try {
    const role = await setRoleTabs(req.params.id, req.body?.tabs);
    if (!role) return res.status(404).json({ error: "not found" });
    res.json(role);
  } catch (e) { next(e); }
});

router.delete("/roles/:id", async (req, res, next) => {
  try {
    const ok = await removeRole(req.params.id);
    if (!ok) return res.status(404).json({ error: "not found or built-in" });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
