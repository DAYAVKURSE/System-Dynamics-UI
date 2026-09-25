import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import scenariosRouter from "./routes/scenarios.js";
import scheduleRouter from "./routes/schedule.js";
import reportsRouter from "./routes/reports.js";
import orgRouter from "./routes/org.js";
import workspaceRouter from "./routes/workspace.js";
import sharesRouter from "./routes/shares.js";
import callsRouter from "./routes/calls.js";
import boardsRouter from "./routes/boards.js";
import assistantRouter from "./routes/assistant.js";
import marketRouter from "./routes/market.js";
import issuesRouter from "./routes/issues.js";
import { callLinkEnv, callLinkFor } from "./lib/links.js";
import * as codes from "./lib/codes.js";
import { recordOfUid } from "./lib/identityStore.js";
import { verifyInitData } from "./lib/telegramAuth.js";
import { createInvoiceLink } from "./lib/telegram.js";
import { finishLogin } from "./lib/mcpOauth.js";
import { setMcpAuth } from "./lib/assistantSettings.js";

/* Кто прислал запрос — по подписи Telegram, без обязательности: нет
   подписи или она негодна — просто «никто». */
function tgOf(req) {
  const initData = req.header("X-Telegram-Init-Data") || "";
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!initData || !token) return null;
  const r = verifyInitData(initData, token);
  if (!r.ok) return null;
  const u = r.user || {};
  return { id: String(r.userId), username: String(u.username || ""),
    name: [u.first_name, u.last_name].filter(Boolean).join(" ") };
}

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
  // 4 МБ: снимок экрана к сообщению об ошибке (PNG в base64) — до 2 МБ байт.
  app.use(express.json({ limit: "4mb" }));

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
      // Ссылки на блоки карты отчётов: заводит их владелец, а он есть
      // только там, где есть подпись.
      shares: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      // Звонки: сигналинг и ретрансляция медиа через этот же сервер.
      calls: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      // Помощник: настройки, вопросы и память держатся на подписи Telegram.
      assistant: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      // Рынок услуг: заказы и отклики — зарегистрированным, а их различает подпись.
      market: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      // Сервис кодов: регистрация с ключом и планом (codes/). Включён —
      // без токена сервис хранилища не отвечает.
      codes: codes.enabled(),
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
    /* Сервис кодов стоит рядом, на localhost (codes/), и наружу его
     выводит этот сервер: так nginx и HTTPS остаются одни на всех, а
     приложение ходит на тот же адрес, что и за всем остальным. Подписи
     Telegram здесь нет нарочно: ключ получают ДО того, как есть кем
     войти, и с любого аккаунта. */
  app.all("/api/codes/*", async (req, res) => {
    const path = req.path.replace(/^\/api\/codes/, "");
    /* Кто регистрируется — из подписи Telegram, если она есть: по ней
       админ-панель узнаёт человека по имени, а инвойс за звёзды уходит
       в его чат. Подделать нельзя — подпись проверяется. */
    const body = { ...(req.body || {}) };
    const who = tgOf(req);
    /* Telegram — ТОЛЬКО из подписи: присланный в теле не в счёт, иначе
       ключ, выданный на чужой @username, открывался бы кем угодно. */
    delete body.tg;
    if (who && (path === "/register" || path === "/token" || path === "/plan")) body.tg = who;
    /* Ключ, сохранённый на устройстве до того, как ключи разложили по
       аккаунтам (владелец, 2026-09-22: с другого аккаунта того же
       телефона открывалось всё): его забирает только тот Telegram, к
       чьей записи он привязан. Введённый вручную ключ — как прежде, с
       любого Telegram. */
    const adopt = path === "/token" && body.adopt === true;
    delete body.adopt;
    if (adopt) {
      if (!who) return res.status(409).json({ error: "ключ другого аккаунта", foreign: true });
      const peek = await codes.proxy("POST", "/token", { key: body.key });
      if (peek.status >= 400) return res.status(peek.status).json(peek.body);
      const rec = await recordOfUid(peek.body.uid);
      if (rec && rec !== who.id) return res.status(409).json({ error: "ключ другого аккаунта", foreign: true });
    }
    const out = await codes.proxy(req.method, path, body);
    /* Оплата звёздами: инвойс выписывает ОСНОВНОЙ бот — у него токен.
       Ссылку открывает мини-приложение. */
    const pay = out.body?.payment;
    if (out.status < 400 && pay && pay.method === "stars" && pay.status === "pending") {
      try {
        out.body.payment.invoiceLink = await createInvoiceLink({ title: `План ${pay.planName}`,
          description: `${pay.planName} на ${pay.days} дн.`, payload: pay.id, amount: pay.amount });
      } catch (e) { out.body.payment.invoiceError = e.message; }
    }
    res.status(out.status).json(out.body);
  });
  /* Возврат со страницы входа MCP-сервера (lib/mcpOauth.js): без подписи
     Telegram — сюда приходит браузер по ссылке от сервера авторизации,
     а кто входил, помнит ожидание по `state`. */
  app.get("/api/assistant/mcp/oauth/callback", async (req, res) => {
    const page = (title, text) => res.set("Content-Type", "text/html; charset=utf-8").send(
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>`
      + `<style>body{margin:0;background:#0b0f14;color:#e8edf2;font:15px/1.5 -apple-system,Inter,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;text-align:center}</style></head>`
      + `<body><div><h1 style="font-size:17px">${title}</h1><p>${text}</p></div><script>setTimeout(function(){try{window.close()}catch(e){}},1500)</script></body></html>`);
    try {
      if (req.query.error) return page("Вход не выполнен", String(req.query.error_description || req.query.error).slice(0, 300));
      const r = await finishLogin(String(req.query.state || ""), String(req.query.code || ""));
      setMcpAuth(r.userId, r.mcpId, r.auth);
      return page("Вход выполнен", "Вернитесь в приложение и нажмите «Опросить» ещё раз.");
    } catch (e) {
      return page("Вход не выполнен", String(e?.message || e).slice(0, 300));
    }
  });
  /* Панель подписок админ-бота: страница и API (см. lib/codes.js). */
  app.get(["/admin", "/admin/"], async (_req, res) => {
    const html = await codes.adminPage();
    if (!html) return res.status(404).send("панель не настроена");
    res.set("Content-Type", "text/html; charset=utf-8").set("Cache-Control", "no-store").send(html);
  });
  app.all("/api/admin/*", async (req, res) => {
    const path = req.path.replace(/^\/api\/admin/, "");
    const out = await codes.adminProxy(req.method, path, req.body, req.header("X-Admin-Init-Data"));
    res.status(out.status).json(out.body);
  });

app.use("/api/scenarios", scenariosRouter);
  app.use("/api/schedule", scheduleRouter);
  // Файлы отчётов: сырые байты, поэтому свой парсер тела внутри маршрута.
  app.use("/api/reports", reportsRouter);
  // Люди, роли и общая модель: см. lib/orgStore.js и lib/workspaceStore.js.
  app.use("/api/org", orgRouter);
  app.use("/api/workspace", workspaceRouter);
  /* Ссылки на блоки карты отчётов. Чтение по токену — без подписи: тому,
     кому показывают сделанное, аккаунт заводить незачем (см.
     lib/shareStore.js). */
  app.use("/api/shares", sharesRouter);
  app.use("/api/calls", callsRouter);
  /* Брейншторм-доски (владелец, 2026-09-25): список и создание — из
     вкладки «Брейншторм», сама доска — любому со ссылкой по подписи
     Telegram (см. routes/boards.js). */
  app.use("/api/boards", boardsRouter);
  /* Помощник: настройки (ключ ставит владелец, наружу не уходит), вопрос в
     два шага и память. Только позванным. Файл памяти — сырые байты, поэтому
     свой парсер тела внутри маршрута (см. routes/assistant.js). */
  app.use("/api/assistant", assistantRouter);
  /* Рынок услуг: заказы, услуги, отклики и сделки — всем зарегистрированным
     (см. lib/marketStore.js). */
  app.use("/api/market", marketRouter);
  /* Сообщения об ошибках: пишет любой позванный кнопкой в шапке, читает и
     удаляет тот, кому открыта вкладка «issues» (см. lib/issuesStore.js). */
  app.use("/api/issues", issuesRouter);

  // Собранный фронтенд (web build) кладётся сюда шагом деплоя — см. docs/DEPLOYMENT.md.
  // Локально в dev-режиме этой папки обычно нет: фронтенд поднимается отдельно
  // через `vite`, который проксирует /api на этот сервер (см. web/vite.config.js).
  const staticDir = process.env.STATIC_DIR || path.join(__dirname, "..", "public");
  const indexHtml = path.join(staticDir, "index.html");
  // Звонок — отдельная страница с собственным входом (web/call.html): она
  // открывается как самостоятельное мини-приложение, без вкладок модели.
  const callHtml = path.join(staticDir, "call.html");
  /* Брейншторм-доска — тоже самостоятельная страница (web/board.html):
     мини-приложение на весь экран, без вкладок модели. */
  const boardHtml = path.join(staticDir, "board.html");
  /* Политика конфиденциальности (web/public/privacy.html) — самостоятельная
     страница на трёх языках; её адрес указывается в настройках бота
     (владелец, 2026-09-22). */
  const privacyHtml = path.join(staticDir, "privacy.html");
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
    // Как и у звонка — и всё, что под /board: ссылка бывает с хвостом.
    if (fs.existsSync(boardHtml)) app.get(/^\/board(\/.*)?$/, page(boardHtml));
    if (fs.existsSync(privacyHtml)) app.get(/^\/privacy\/?$/, page(privacyHtml));
    app.get(/^(?!\/api\/).*/, page(indexHtml));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}
