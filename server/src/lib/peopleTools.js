import { contactsOf, findContact, recordDialog, titleOf } from "./dialogStore.js";
import { DEFAULT_WAIT_MS, MAX_WAIT_MS, waitReply } from "./peopleWait.js";

/* ════════════════════════════════════════════════════════════════
   ИНСТРУМЕНТЫ АГЕНТА ДЛЯ РАЗГОВОРА С ЛЮДЬМИ (владелец, 2026-09-22)

   «Агент должен помнить, кому он может писать», «может самостоятельно
   задавать вопросы людям во время работы». Кому можно — те, кто говорил
   с его ботом (диалоги), плюс участники модели через основного бота.
   Написать — `people_send`; спросить и дождаться ответа — `ask_person`.
   ════════════════════════════════════════════════════════════════ */

const WHO = { type: "string", description: "кому: имя, @username или id из people_list" };

/**
 * @param key      ключ диалогов бота агента (dialogStore.botKey)
 * @param members  участники модели [{id, name, username}] (люди, не агенты)
 * @param sendVia  { agent: (chatId, text) => …, main: (chatId, text) => … }
 * @param mainKey  ключ диалогов основного бота — чтобы записать, что бот написал участнику
 */
export function peopleToolsFor({ key, members = [], sendVia, mainKey = null, agentName = "агент" }) {
  const people = async () => {
    const contacts = (await contactsOf(key)).map((d) => ({ id: d.chatId, name: titleOf(d), via: "agent" }));
    const known = new Set(contacts.map((c) => c.id));
    const org = members.filter((m) => /^\d+$/.test(String(m.id)) && !known.has(String(m.id)))
      .map((m) => ({ id: String(m.id), name: m.name || String(m.id), username: m.username || "", via: "main" }));
    return [...contacts, ...org];
  };
  const find = async (who) => {
    const want = String(who || "").trim().toLowerCase().replace(/^@/, "");
    if (!want) return null;
    const c = await findContact(key, want);
    if (c) return { id: c.chatId, name: titleOf(c), via: "agent" };
    const m = members.find((x) => String(x.id) === want)
      || members.find((x) => String(x.username || "").toLowerCase() === want)
      || members.find((x) => String(x.name || "").toLowerCase() === want)
      || members.find((x) => String(x.name || "").toLowerCase().includes(want));
    return m && /^\d+$/.test(String(m.id)) ? { id: String(m.id), name: m.name || String(m.id), via: "main" } : null;
  };
  const send = async (p, text) => {
    const fn = sendVia?.[p.via];
    if (!fn) throw new Error(p.via === "agent" ? "у агента нет своего бота" : "основной бот недоступен");
    await fn(p.id, text);
    const k = p.via === "agent" ? key : mainKey;
    if (k) await recordDialog(k, p.id, { from: "bot", text });
  };
  const notFound = (who) => ({ ok: false, text: `Не знаю, кто такой «${who}». Список — people_list.` });

  return [
    {
      name: "people_list",
      description: "Кому агент может писать: собеседники его бота и участники модели.",
      schema: { type: "object", properties: {} },
      run: async () => {
        const list = await people();
        if (!list.length) return { ok: true, text: "Пока некому: с ботом никто не говорил, участников с чатом нет." };
        return { ok: true, text: list.map((p) => `· ${p.name}${p.username ? ` (@${p.username})` : ""} — id ${p.id}${p.via === "main" ? " (через основного бота)" : ""}`).join("\n") };
      },
    },
    {
      name: "people_send",
      description: "Написать человеку сообщение от имени агента.",
      schema: { type: "object", properties: { who: WHO, text: { type: "string", description: "текст" } }, required: ["who", "text"] },
      run: async ({ who, text }) => {
        const p = await find(who);
        if (!p) return notFound(who);
        const t = String(text || "").trim();
        if (!t) return { ok: false, text: "Текст пуст." };
        await send(p, t);
        return { ok: true, text: `Отправлено: ${p.name}.` };
      },
    },
    {
      name: "ask_person",
      description: "Спросить человека и дождаться ответа (до `minutes` минут, по умолчанию 10).",
      schema: { type: "object", properties: { who: WHO, question: { type: "string", description: "вопрос" },
        minutes: { type: "number", description: "сколько ждать, минут" } }, required: ["who", "question"] },
      run: async ({ who, question, minutes }) => {
        const p = await find(who);
        if (!p) return notFound(who);
        const q = String(question || "").trim();
        if (!q) return { ok: false, text: "Вопрос пуст." };
        await send(p, q);
        const ms = Math.min(MAX_WAIT_MS, Math.max(1, Number(minutes) || DEFAULT_WAIT_MS / 60000) * 60000);
        const k = p.via === "agent" ? key : mainKey;
        const reply = k ? await waitReply(k, p.id, ms) : null;
        if (reply == null) return { ok: false, text: `${p.name} не ответил за ${Math.round(ms / 60000)} мин.` };
        return { ok: true, text: `${p.name} ответил: ${reply}` };
      },
    },
  ];
}
