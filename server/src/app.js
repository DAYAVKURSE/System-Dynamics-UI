import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import scenariosRouter from "./routes/scenarios.js";
import scheduleRouter from "./routes/schedule.js";
import reportsRouter from "./routes/reports.js";
import orgRouter from "./routes/org.js";
import workspaceRouter from "./routes/workspace.js";
import callsRouter from "./routes/calls.js";
import bridgeRouter from "./routes/bridge.js";

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
      // Файлы отчётов — то же хранилище на диске, что и сценарии: без
      // проверки подписи открывать загрузку всем подряд нельзя.
      reports: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      // Роли и общая модель держатся на подписи Telegram: без токена
      // отличить владельца от кого угодно нечем.
      org: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      // Звонки: сигналинг и ретрансляция медиа через этот же сервер.
      calls: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      // Мост включён, только когда задан общий секрет с воркером.
      bridge: Boolean(process.env.BRIDGE_TOKEN),
    }),
  );
  app.use("/api/scenarios", scenariosRouter);
  app.use("/api/schedule", scheduleRouter);
  // Файлы отчётов: сырые байты, поэтому свой парсер тела внутри маршрута.
  app.use("/api/reports", reportsRouter);
  // Люди, роли и общая модель: см. lib/orgStore.js и lib/workspaceStore.js.
  app.use("/api/org", orgRouter);
  app.use("/api/workspace", workspaceRouter);
  app.use("/api/calls", callsRouter);
  // Мост к Claude Code: очередь для воркера на машине владельца.
  app.use("/api/bridge", bridgeRouter);

  // Собранный фронтенд (web build) кладётся сюда шагом деплоя — см. docs/DEPLOYMENT.md.
  // Локально в dev-режиме этой папки обычно нет: фронтенд поднимается отдельно
  // через `vite`, который проксирует /api на этот сервер (см. web/vite.config.js).
  const staticDir = process.env.STATIC_DIR || path.join(__dirname, "..", "public");
  const indexHtml = path.join(staticDir, "index.html");
  // Звонок — отдельная страница с собственным входом (web/call.html): она
  // открывается как самостоятельное мини-приложение, без вкладок модели.
  const callHtml = path.join(staticDir, "call.html");
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(staticDir));
    if (fs.existsSync(callHtml)) {
      app.get(["/call", "/call/"], (_req, res) => res.sendFile(callHtml));
    }
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(indexHtml));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}
