import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { listScenarios, getScenario, saveScenario, deleteScenario, touchScenario }
  from "../lib/scenarioStore.js";

const router = Router();
router.use(telegramUser);

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
    const entry = await saveScenario(req.telegramUserId, req.body || {});
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
    const entry = await saveScenario(req.telegramUserId, { ...(req.body || {}), id: req.params.id });
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
