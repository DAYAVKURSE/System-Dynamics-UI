import fs from "node:fs";
import path from "node:path";

/* ════════════════════════════════════════════════════════════════
   АДМИН-БОТ · отдельный бот владельца (владелец, 2026-09-21)

   Открывает панель (admin.html) кнопкой и присылает владельцу
   уведомление о каждой оплате. Токен — ADMIN_BOT_TOKEN: из окружения
   или из .env рядом (его туда кладёт основной бот командой /adminbot),
   поэтому файл перечитывается, пока токена нет. Публичный адрес и id
   владельца — оттуда же.
   ════════════════════════════════════════════════════════════════ */
const envFiles = () => [process.env.ENV_FILE, path.resolve(".env"), path.resolve("..", ".env"),
  path.resolve("..", "server", ".env")].filter(Boolean);
export function readEnv(name) {
  if (process.env[name]) return String(process.env[name]).trim();
  for (const f of envFiles()) {
    try {
      const m = fs.readFileSync(f, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
      if (m && m[1].trim()) return m[1].trim();
    } catch { /* нет файла — смотрим дальше */ }
  }
  return "";
}
export const adminToken = () => readEnv("ADMIN_BOT_TOKEN");
/* Владелец — СТРОГО из OWNER_TELEGRAM_ID (секрет Actions → .env):
   админ-бот узнаёт заданный Telegram-id, а не «первого вошедшего»
   (владелец, 2026-09-21). */
export const ownerId = () => readEnv("OWNER_TELEGRAM_ID");
export const publicUrl = () => readEnv("PUBLIC_URL").replace(/\/+$/, "");

const api = async (token, method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.description || `Telegram ответил ${r.status}`);
  return j.result;
};

const panelUrl = () => (publicUrl() ? `${publicUrl()}/admin/` : "");
const panelKeyboard = () => (panelUrl()
  ? { inline_keyboard: [[{ text: "Открыть панель", web_app: { url: panelUrl() } }]] } : null);

/** Уведомление владельцу: кто и сколько заплатил. */
export async function notifyOwner(text) {
  const token = adminToken(); const owner = ownerId();
  if (!token || !owner) return false;
  await api(token, "sendMessage", { chat_id: owner, text, ...(panelKeyboard() ? { reply_markup: panelKeyboard() } : {}) });
  return true;
}
export const paidText = (p, u) => {
  const who = u?.tg?.username ? `@${u.tg.username}` : (u?.tg?.name || u?.tg?.id || p.uid);
  return `Оплата: ${who} — ${p.amount} ${p.currency} (${p.planName}, ${p.days} дн.)`;
};

/** Опрос обновлений: /start — кнопка панели; остальным — кто это. */
export function startAdminBot({ log = console.log } = {}) {
  let offset = 0;
  let menuSet = "";
  const loop = async () => {
    for (;;) {
      const token = adminToken();
      if (!token) { await new Promise((r) => setTimeout(r, 60000)); continue; }
      try {
        if (menuSet !== token && panelUrl()) {
          await api(token, "setChatMenuButton", { menu_button: { type: "web_app", text: "Панель", web_app: { url: panelUrl() } } });
          menuSet = token;
          log(`[admin-bot] кнопка панели: ${panelUrl()}`);
        }
        const updates = await api(token, "getUpdates", { timeout: 25, offset, allowed_updates: ["message"] });
        for (const u of updates) {
          offset = u.update_id + 1;
          const msg = u.message;
          if (!msg?.from || msg.chat?.type !== "private") continue;
          const owner = ownerId();
          if (String(msg.from.id) !== String(owner)) {
            await api(token, "sendMessage", { chat_id: msg.chat.id, text: "Это бот владельца." });
            continue;
          }
          await api(token, "sendMessage", { chat_id: msg.chat.id,
            text: panelUrl() ? "Панель подписок:" : "PUBLIC_URL не задан — панель открыть нечем.",
            ...(panelKeyboard() ? { reply_markup: panelKeyboard() } : {}) });
        }
      } catch (e) {
        log(`[admin-bot] ${e.message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  loop();
}
