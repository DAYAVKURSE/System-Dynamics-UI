import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { identify } from "../lib/orgStore.js";
import { listScenarios, getScenario, saveScenario, deleteScenario, touchScenario, listVersions, getVersion }
  from "../lib/scenarioStore.js";

const router = Router();
router.use(telegramUser);

/* Автор версии — имя из анкеты (владелец, 2026-09-22): версия сценария,
   как коммит, подписана тем, кто сохранил. Само имя клиент не присылает —
   подпись должна быть той, что знает сервер. */
async function authorOf(req) {
  try {
    const me = await identify(req.telegramUserId, req.telegramProfile || {}, { claim: false });
    return me?.name || req.telegramProfile?.name || "";
  } catch { return req.telegramProfile?.name || ""; }
}

router.get("/", async (req, res, next) => {
  try {
    res.json(await listScenarios(req.telegramUserId));
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const scenario = await getScenario(req.telegramUserId, req.params.id);
    if (!scenario) return res.status(404).json({ error: "not found" });
    res.json(scenario);
  } catch (e) {
    next(e);
  }
});

/* Отметка «эту схему открывали». Живёт рядом со сценарием, а не в браузере:
   память о последней открытой схеме должна переживать и чистку WebView, и
   переход на другое устройство. */
/* Версии сценария: список и снимок (владелец, 2026-09-19). */
router.get("/:id/versions", async (req, res, next) => {
  try {
    const list = await listVersions(req.telegramUserId, req.params.id);
    if (!list) return res.status(404).json({ error: "not found" });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

router.get("/:id/versions/:v", async (req, res, next) => {
  try {
    const one = await getVersion(req.telegramUserId, req.params.id, req.params.v);
    if (!one) return res.status(404).json({ error: "not found" });
    res.json(one);
  } catch (e) {
    next(e);
  }
});

router.post("/:id/open", async (req, res, next) => {
  try {
    const entry = await touchScenario(req.telegramUserId, req.params.id);
    if (!entry) return res.status(404).json({ error: "not found" });
    res.json(entry);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const entry = await saveScenario(req.telegramUserId, { ...(req.body || {}), by: await authorOf(req) });
    res.status(201).json(entry);
  } catch (e) {
    if (e.message.includes("required") || e.message.includes("most") || e.message.includes("limit")) {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const entry = await saveScenario(req.telegramUserId, { ...(req.body || {}), id: req.params.id, by: await authorOf(req) });
    res.json(entry);
  } catch (e) {
    if (e.message.includes("required") || e.message.includes("most") || e.message.includes("limit")) {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const ok = await deleteScenario(req.telegramUserId, req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
