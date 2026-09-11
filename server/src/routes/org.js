import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import {
  addRole, addUser, identify, listOrg, openRoles, registerUser, removeRole, removeUser,
  setProfile, setRoleContract, setRoleTabs, setUserRole, setUserRoles, TABS,
} from "../lib/orgStore.js";
import { MAX_REPORT_BYTES, saveReport } from "../lib/reportStore.js";

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

/* Своя анкета — единственное, что человек меняет о себе сам, поэтому
   маршрут стоит ДО проверки на владельца: чинить свою анкету через
   владельца значило бы просить его пересказывать твои же слова. */
router.put("/me/profile", async (req, res, next) => {
  try {
    const me = await identify(req.telegramUserId, req.telegramProfile || {});
    if (!me.known) return res.status(403).json({ error: "you are not invited yet" });
    const saved = await setProfile(me.id, req.body || {});
    if (!saved) return res.status(404).json({ error: "not found" });
    res.json({ profile: saved });
  } catch (e) { next(e); }
});

/* ─────── регистрация ───────

   Участником человек становится сам: выбирает роль, читает её договор и
   присылает подписанный экземпляр. Акцепт — сам договор, а не чужое
   нажатие: поэтому маршруты стоят ДО проверки на владельца.

   Список ролей открыт всем вошедшим, но в нём только названия и
   договоры: список организации незваному не показывают — в неё
   вступают, а не заглядывают.

   Подписанный экземпляр приходит СЮДА, а не в общее хранилище файлов:
   то заперто для участников (см. `routes/reports.js`), и открывать его
   ради регистрации значило бы раздать диск всем, у кого есть Telegram.
   Здесь же файл принимается только вместе с существующей ролью и только
   в свой каталог. */
router.get("/roles", async (_req, res, next) => {
  try { res.json({ roles: await openRoles() }); } catch (e) { next(e); }
});

const MAX_CONTRACT_BYTES = Math.min(MAX_REPORT_BYTES, 8 * 1024 * 1024);

router.post("/register", async (req, res, next) => {
  try {
    const { roleId, file } = req.body || {};
    let saved = null;
    if (file && file.data) {
      /* Файл приезжает строкой base64 (или data:-ссылкой): тело здесь
         JSON, и байтам в нём иначе не проехать. */
      const raw = String(file.data);
      const bytes = Buffer.from(raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw,
        "base64");
      if (!bytes.length) return res.status(400).json({ error: "empty file" });
      if (bytes.length > MAX_CONTRACT_BYTES) {
        return res.status(413).json({ error: "file too large" });
      }
      saved = await saveReport(req.telegramUserId, {
        name: file.name, type: file.type, bytes, kind: "contract" });
    }
    const user = await registerUser(req.telegramUserId, req.telegramProfile || {},
      { roleId, file: saved });
    const me = await identify(req.telegramUserId, req.telegramProfile || {});
    res.json({ me, user: { id: user.id, roles: user.roles } });
  } catch (e) {
    if (/unknown role/.test(e.message)) return res.status(404).json({ error: e.message });
    if (/contract is required/.test(e.message)) {
      return res.status(400).json({ error: "Договор не приложен: без подписанного экземпляра роль не выдаётся." });
    }
    return next(e);
  }
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

/* Ролей у человека может быть несколько: он и дизайнер, и проверяющий.
   Должностей больше нет — это был тот же вопрос «кто он здесь», заданный
   вторым списком. Владелец раздаёт роли здесь, сам человек — договором. */
router.put("/users/:id/roles", async (req, res, next) => {
  try {
    const user = await setUserRoles(req.params.id, req.body?.roles);
    if (!user) return res.status(404).json({ error: "not found" });
    res.json(user);
  } catch (e) {
    if (/unknown role/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

/* Договор роли — шаблон: что человек подписывает, вступая в неё. Кладёт
   владелец, читает всякий, кто регистрируется. Пусто — снять договор:
   роль без него выдаётся без акцепта, и это видно в списке. */
router.put("/roles/:id/contract", async (req, res, next) => {
  try {
    const role = await setRoleContract(req.params.id, req.body?.contract ?? null);
    if (!role) return res.status(404).json({ error: "not found" });
    res.json(role);
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
