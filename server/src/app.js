import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import scenariosRouter from "./routes/scenarios.js";
import scheduleRouter from "./routes/schedule.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  // scenarios: false означает, что серверное хранилище выключено (нет
  // TELEGRAM_BOT_TOKEN — значит, нечем проверить подпись, и открывать API
  // всем подряд нельзя). Фронтенд по этому флагу уходит в облако Telegram.
  app.get("/api/health", (_req, res) =>
    res.json({
      ok: true,
      scenarios: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      // Напоминания шлёт бот, поэтому без токена планировщик бесполезен.
      reminders: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    }),
  );
  app.use("/api/scenarios", scenariosRouter);
  app.use("/api/schedule", scheduleRouter);

  // Собранный фронтенд (web build) кладётся сюда шагом деплоя — см. docs/DEPLOYMENT.md.
  // Локально в dev-режиме этой папки обычно нет: фронтенд поднимается отдельно
  // через `vite`, который проксирует /api на этот сервер (см. web/vite.config.js).
  const staticDir = process.env.STATIC_DIR || path.join(__dirname, "..", "public");
  const indexHtml = path.join(staticDir, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(indexHtml));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}
