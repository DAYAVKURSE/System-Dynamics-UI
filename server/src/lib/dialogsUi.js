import {
  deleteDialog, listDialogs, pageOf, readDialog, setBanned, titleOf,
} from "./dialogStore.js";

/* ════════════════════════════════════════════════════════════════
   «/dialogs» — ДИАЛОГИ БОТА (владелец, 2026-09-22)

   Одна и та же картина у основного бота (ассистент) и у ботов агентов:
   сообщение со списком собеседников кнопками и «закрыть»; нажатие на
   собеседника — его переписка страницами и кнопки «забанить», «удалить»,
   «назад», «закрыть». Всё правится в ОДНОМ сообщении.

   Кто может смотреть — решает вызывающий: только владелец сценария, в
   котором работает бот; остальным — ничего.
   ════════════════════════════════════════════════════════════════ */

export const DL = "dl:";
export const isDialogsAction = (data) => String(data || "").startsWith(DL);
export const CLOSED_TEXT = "Диалоги закрыты";
export const EMPTY_TEXT = "Диалогов пока нет";
export const LIST_TEXT = "Диалоги:";

const closeBtn = () => ({ text: "закрыть", callback_data: `${DL}x` });

export function listView(dialogs) {
  if (!dialogs.length) return { text: EMPTY_TEXT, keyboard: { inline_keyboard: [[closeBtn()]] } };
  const rows = dialogs.slice(0, 50).map((d) => [{
    text: `${d.banned ? "⛔ " : ""}${titleOf(d)} · ${d.count}`,
    callback_data: `${DL}o:${d.chatId}:0`,
  }]);
  rows.push([closeBtn()]);
  return { text: LIST_TEXT, keyboard: { inline_keyboard: rows } };
}

const when = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

export function dialogView(d, page = 0, { botName = "бот" } = {}) {
  const { items, page: p, pages } = pageOf(d.messages, page);
  const lines = [`${d.banned ? "⛔ " : ""}${titleOf(d)}${d.username && d.name ? ` (@${d.username})` : ""}`, ""];
  if (!items.length) lines.push("(переписки нет)");
  items.forEach((m) => lines.push(`${when(m.at)} ${m.from === "bot" ? botName : "человек"}: ${m.text}`));
  if (pages > 1) lines.push("", `страница ${p + 1} из ${pages}`);
  const rows = [];
  if (pages > 1) {
    rows.push([
      ...(p > 0 ? [{ text: "‹", callback_data: `${DL}o:${d.chatId}:${p - 1}` }] : []),
      ...(p < pages - 1 ? [{ text: "›", callback_data: `${DL}o:${d.chatId}:${p + 1}` }] : []),
    ]);
  }
  rows.push([
    { text: d.banned ? "разбанить" : "забанить", callback_data: `${DL}b:${d.chatId}:${p}` },
    { text: "удалить", callback_data: `${DL}d:${d.chatId}` },
  ]);
  rows.push([{ text: "назад", callback_data: `${DL}l` }, closeBtn()]);
  return { text: lines.join("\n").slice(0, 4000), keyboard: { inline_keyboard: rows } };
}

/** Прислать список диалогов бота с ключом `key` в чат. */
export async function openDialogs({ key, chatId, send }) {
  const v = listView(await listDialogs(key));
  return send(chatId, v.text, v.keyboard);
}

/**
 * Нажатие под сообщением диалогов. Возвращает, что сделано.
 * `edit(chatId, messageId, text, keyboard)` правит то же сообщение.
 */
export async function onDialogsButton(cb, { key, edit, answer, botName = "бот" }) {
  const data = String(cb?.data || "");
  const chatId = cb?.message?.chat?.id;
  const messageId = cb?.message?.message_id;
  const put = async (v) => { if (chatId != null && messageId != null) await edit(chatId, messageId, v.text, v.keyboard); };
  const done = async (what, note = "") => { if (answer) await answer(cb.id, note); return what; };
  const parts = data.slice(DL.length).split(":");
  const [op, id, page] = parts;
  if (op === "x") { await put({ text: CLOSED_TEXT, keyboard: null }); return done({ closed: true }); }
  if (op === "l") { await put(listView(await listDialogs(key))); return done({ listed: true }); }
  if (op === "o") {
    const d = await readDialog(key, id);
    if (!d) { await put(listView(await listDialogs(key))); return done({ listed: true }, "Диалога уже нет"); }
    await put(dialogView(d, Number(page) || 0, { botName }));
    return done({ opened: d.chatId, page: Number(page) || 0 });
  }
  if (op === "b") {
    const d = await readDialog(key, id);
    if (!d) { await put(listView(await listDialogs(key))); return done({ listed: true }, "Диалога уже нет"); }
    await setBanned(key, id, !d.banned);
    await put(dialogView(await readDialog(key, id), Number(page) || 0, { botName }));
    return done({ banned: !d.banned, chatId: d.chatId }, d.banned ? "Разбанен" : "Забанен: бот ему больше не отвечает");
  }
  if (op === "d") {
    await deleteDialog(key, id);
    await put(listView(await listDialogs(key)));
    return done({ deleted: String(id) }, "Диалог удалён");
  }
  return done({ ignored: "unknown" });
}
