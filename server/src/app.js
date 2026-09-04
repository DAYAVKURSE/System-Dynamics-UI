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
import { callLinkEnv, callLinkFor } from "./lib/links.js";
import bridgeRouter from "./routes/bridge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* Кто и как открывал страницу звонка.

   Нужно ради вопроса, на который иначе нечем ответить: доходит ли Telegram
   до нашей страницы. Если мини-приложение показывает пустой экран, причин
   ровно две — либо страница не открылась у нас, либо Telegram её и не
   запрашивал (в @BotFather у приложения другой адрес). Одного счётчика для
   этого мало: и мини-приложение, и прямая ссылка ведут на один и тот же
   /call, и в сумме они неразличимы. Поэтому запоминаем последние открытия
   с адресом: мини-приложение приходит БЕЗ «?call=…» (id встречи Telegram
   кладёт во фрагмент, который на сервер не отправляется), прямая ссылка —
   с ним.

   Живёт в памяти и хранит восемь последних: это отладочный сигнал, а не
   статистика, и переживать перезапуск ему незачем. */
const callPage = { hits: 0, lastAt: null, recent: [], views: [] };
const RECENT_HITS = 8;
const RECENT_VIEWS = 6;

/* Что Telegram сказал самой странице.

   Счётчик выше отвечает на вопрос «дошли ли до нас», а этот — на вопрос
   «в каком окне нас открыли». Со стороны сервера высоту окна не видно
   вовсе: и половина, и весь экран — один и тот же запрос. А спорить о ней
   вслепую бессмысленно: у Telegram есть три разных «полных экрана»
   (развёрнутый лист, fullsize и fullscreen из Bot API 8.0), и лечатся они
   по-разному. Поэтому страница один раз рассказывает, что ей сообщил SDK,
   и это видно в /api/health.

   Здесь нарочно нет ничего про человека: ни id, ни имени, ни initData —
   только размеры окна, платформа и версия. Отладка не должна превращаться
   в слежку. Поля перечислены поимённо и обрезаны: снаружи этот адрес
   открыт, и складывать в память что попало нельзя. */
const VIEW_FLAGS = ["when", "expanded", "fullscreen", "stable", "height", "innerHeight",
  "screenHeight", "ratio", "safeBottom", "contentBottom", "platform", "version", "start"];

function noteCallView(body) {
  const v = {};
  for (const k of VIEW_FLAGS) {
    const raw = body?.[k];
    if (raw === undefined || raw === null) continue;
    v[k] = typeof raw === "number" ? Math.round(raw)
      : typeof raw === "boolean" ? raw
        : String(raw).slice(0, 40);
  }
  v.at = new Date().toISOString();
  callPage.views.unshift(v);
  callPage.views.length = Math.min(callPage.views.length, RECENT_VIEWS);
}

function noteCallHit(req) {
  callPage.hits += 1;
  callPage.lastAt = new Date().toISOString();
  callPage.recent.unshift({
    at: callPage.lastAt,
    // ИМЕНА параметров, без значений. Различить мини-приложение и прямую
    // ссылку нужно, а вот id встречи здесь быть не должно: этот адрес
    // открыт наружу, а по id в комнату входит кто угодно — на то она и
    // рассчитана на гостей. Раньше строка запроса писалась целиком, и id
    // утекали всякому, кто открыл /api/health.
    query: [...new URLSearchParams(String(req.originalUrl || "").split("?")[1] || "").keys()]
      .join(",").slice(0, 80),
    // Чем открыли — по первым знакам: этого хватает, чтобы отличить
    // мини-приложение от встроенного браузера, и не превращает отладку в
    // слежку.
    client: String(req.header("user-agent") || "").slice(0, 80),
  });
  callPage.recent.length = Math.min(callPage.recent.length, RECENT_HITS);
}

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
      // Кто и как открывал страницу звонка — см. выше.
      callPage: { ...callPage, recent: [...callPage.recent], views: [...callPage.views] },
      // Какую ссылку бот кладёт в приглашение ПРЯМО СЕЙЧАС. Настроек три
      // (отдельное приложение, главное, просто страница), и ветка молча
      // меняется от того, что лежит в .env, — а по чату этого не видно.
      // Здесь нет ничего тайного: имя бота и имя приложения и так стоят в
      // каждой отправленной ссылке, а id встречи заменён на «ID».
      callLink: callLinkFor(callLinkEnv(process.env, process.env.BOT_NAME || ""), "ID"),
    }),
  );

  /* Страница рассказывает, в каком окне её открыли. Без подписи нарочно:
     в комнату звонка входят и гости, у которых initData нет вовсе, а
     смысл этого адреса — увидеть окно ИМЕННО в тот момент, когда всё
     остальное непонятно. Записать сюда можно только перечисленные поля,
     обрезанные по длине, и хранится их шесть штук в памяти. */
  app.post("/api/call-view", (req, res) => {
    noteCallView(req.body);
    res.json({ ok: true });
  });
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
  /* Кеширование раздаётся двумя разными правилами, и это важнее, чем кажется.

     Имя файла сборки несёт хеш содержимого (`main-DL949TAp.js`): изменилось
     содержимое — изменилось имя. Такой файл можно кешировать навсегда.

     А вот HTML имени не меняет никогда, и именно он говорит, какие бандлы
     грузить. Закешированный HTML — это закешированное ПРИЛОЖЕНИЕ: выкат
     проходит, файлы на сервере новые, а человек продолжает открывать
     старое и не понимает, почему ничего не изменилось. Telegram WebView на
     телефоне держит страницу особенно цепко, и `max-age=0` его не
     останавливает — он не обязан перепроверять, он обязан лишь не считать
     ответ свежим. Поэтому HTML отдаётся с `no-store`: не хранить вовсе. */
  const noStore = (res) => {
    res.setHeader("Cache-Control", "no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  };
  const page = (file) => (req, res) => { noStore(res); res.sendFile(file); };

  if (fs.existsSync(indexHtml)) {
    app.use(express.static(staticDir, {
      // index.html через express.static не отдаём: у него своё правило ниже.
      index: false,
      setHeaders: (res, file) => {
        if (file.endsWith(".html")) noStore(res);
        else if (/\/assets\//.test(file)) {
          // Имя с хешем: содержимое по этому адресу больше не изменится.
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }));
    if (fs.existsSync(callHtml)) {
      // И всё, что под /call: ссылка из приглашения бывает с хвостом, а
      // открыться по ней должно окно звонка, а не приложение модели.
      app.get(/^\/call(\/.*)?$/, (req, res) => {
        noteCallHit(req);
        noStore(res);
        res.sendFile(callHtml);
      });
    }
    app.get(/^(?!\/api\/).*/, page(indexHtml));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}
