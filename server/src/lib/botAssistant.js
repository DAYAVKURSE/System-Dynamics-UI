/* ════════════════════════════════════════════════════════════════
   ПОМОЩНИК В ЧАТЕ БОТА

   Бот перестаёт быть «только для владельца»: любой позванный пишет ему
   словами и получает ответ по своим данным. Что человек видит в
   приложении, то помощник и знает, — граница та же (см.
   assistantContext.js), проверяется при каждом обращении.

   Здесь нет разбора команд и пересылок: их bot.js разбирает раньше. Сюда
   попадает то, что осталось, — обычный текст и документы, — и на всё
   прочее модуль отвечает null: «это не мне».

   «запомни: …» кладёт текст в память, документ без открытого шага сдачи —
   тоже в память (открытый шаг сдачи перехватывает botTasks.js раньше).
   Байты документа даёт `deps.tg.getFile`; если его нет — запоминается
   имя и подпись, и об этом говорится прямо.

   Ответа модели здесь НЕ ждут. Бот разбирает обновления по одному, и
   пока он ждал бы модель (секунды, а при зависшем провайдере минуты),
   кнопки и файлы всех остальных лежали бы у Telegram. Поэтому сразу
   уходит «Думаю…», а ответ — потом, отдельным сообщением: отдельным, а не
   правкой «Думаю…», потому что правку Telegram не показывает уведомлением,
   и человек, отложивший телефон, ответа бы не заметил.
   ════════════════════════════════════════════════════════════════ */

const REMEMBER = /^запомни\s*[:\-—]\s*/iu;
const MAX_QUESTION = 4000;

const isCommand = (text) => /^\//.test(text);
const isForward = (msg) => Boolean(msg.forward_from || msg.forward_sender_name || msg.forward_origin
  || msg.forward_date);

const short = (s, n = 60) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/* Telegram принимает 4096 знаков на сообщение, а ответ модели этого не
   знает. Длинный ответ уходит несколькими сообщениями, по абзацам, —
   иначе Telegram отвечал бы «message is too long», и человек не видел бы
   ничего. */
export const TG_MESSAGE_LIMIT = 4000;
export function splitMessage(text, limit = TG_MESSAGE_LIMIT) {
  const out = [];
  let rest = String(text || "");
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit / 2) cut = limit;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * @param msg   сообщение Telegram
 * @param from  кто пишет
 * @param deps  { assistant: { ask(userId, question) → Promise<string>, memory }, send, tg? }
 *              либо те же поля на верхнем уровне
 * @returns null, если сообщение не для помощника. На вопрос —
 *          { answered: "queued", done }: done — обещание, что ответ или
 *          ошибка уже ушли в чат; бот его не ждёт, тесты — ждут.
 */
export async function onAssistantMessage(msg, from, deps = {}) {
  if (!msg || !from) return null;
  const a = deps.assistant || deps;
  const { ask, memory } = a;
  const send = deps.send || a.send;
  if (!send) return null;
  const userId = String(from.id);
  const text = String(msg.text || "").trim();
  const doc = msg.document || null;

  if (isForward(msg)) return null;
  if (text && isCommand(text)) return null;
  if (!text && !doc) return null;

  /* ─── «запомни: …» ─── */
  if (text && REMEMBER.test(text)) {
    const body = text.replace(REMEMBER, "").trim();
    if (!body) {
      await send(from.id, "Что запомнить? Напишите: запомни: <текст>");
      return { remembered: null };
    }
    if (!memory?.addMemory) {
      await send(from.id, "Память помощника здесь не подключена.");
      return { error: "no memory" };
    }
    try {
      const item = await memory.addMemory(userId, { text: body });
      await send(from.id, `Запомнил: «${short(item.title)}». Посмотреть и удалить можно в Инструментах → Помощник.`);
      return { remembered: item.id };
    } catch (e) {
      await send(from.id, `Не запомнил: ${e.message}`);
      return { error: e.message };
    }
  }

  /* ─── документ → в память ─── */
  if (doc) {
    if (!memory?.addMemory) {
      await send(from.id, "Память помощника здесь не подключена.");
      return { error: "no memory" };
    }
    const caption = String(msg.caption || "").trim();
    const name = doc.file_name || "файл";
    try {
      let item;
      const getFile = deps.tg?.getFile;
      if (getFile) {
        const got = await getFile(doc.file_id);
        item = await memory.addMemory(userId, {
          title: caption ? short(caption, 200) : "",
          text: caption,
          file: { name: got?.name || name, type: got?.type || doc.mime_type, bytes: got?.bytes },
        });
        await send(from.id, `Положил в память файл «${item.file?.name || name}»${caption ? " с подписью" : ""}.`);
      } else {
        // Скачать файл нечем: запоминаем то, что есть, и говорим об этом.
        item = await memory.addMemory(userId, {
          title: caption ? short(caption, 200) : name,
          text: caption ? `${caption}\n(файл «${name}» прислан в чат, но его содержимое бот сохранить не может)`
            : `Файл «${name}» прислан в чат, но его содержимое бот сохранить не может.`,
        });
        await send(from.id, `Запомнил название файла «${name}»${caption ? " и подпись" : ""}. Сам файл сохранить не могу — положите его в память через Инструменты → Помощник.`);
      }
      return { remembered: item.id };
    } catch (e) {
      await send(from.id, `Не запомнил: ${e.message}`);
      return { error: e.message };
    }
  }

  /* ─── обычный текст → вопрос ─── */
  if (!ask) {
    await send(from.id, "Помощник здесь не подключён.");
    return { error: "no ask" };
  }
  await send(from.id, "Думаю…");
  const done = (async () => {
    try {
      const answer = await ask(userId, text.slice(0, MAX_QUESTION));
      const parts = splitMessage(String(answer || "").trim() || "Ответ пуст.");
      for (const part of parts) {
        // eslint-disable-next-line no-await-in-loop
        await send(from.id, part);
      }
      return { answered: true, parts: parts.length };
    } catch (e) {
      // Ошибка — словами: «не настроен», «OpenAI ответил 401», «не ответил
      // за 90 секунд». Молчание было бы хуже любой из них.
      await send(from.id, e.message || "Помощник не ответил.");
      return { error: e.message };
    }
  })().catch((e) => {
    // Не ушло даже слово об ошибке (Telegram не отвечает) — остаётся
    // журнал; необработанным отказом это стать не должно.
    (deps.log || ((m) => console.warn(`[bot] ${m}`)))(`ответ помощника не отправлен: ${e.message}`);
    return { error: e.message };
  });
  return { answered: "queued", done };
}
