/* ════════════════════════════════════════════════════════════════
   БОТ · приглашение людей

   Владелец пересылает боту сообщение от человека — бот показывает роли
   кнопками, владелец выбирает или заводит новую. Всё остальное бот
   отклоняет: приглашать может только владелец, и это единственное, что
   он вообще умеет принимать.

   Про пересылку есть важная тонкость Telegram: `forward_from` приходит
   только если у человека не закрыт перенос в настройках приватности.
   Закрыт — приходит одно `forward_sender_name`, без id, и позвать по нему
   некого. Это не наша поломка, и молчать о ней нельзя: бот объясняет, что
   делать (попросить человека написать боту /id или прислать его номер).

   Вся логика — чистая функция `handleUpdate`: она получает обновление и
   зависимости (хранилище, отправку) аргументами, поэтому проверяется
   тестами, а не перепиской с живым ботом.
   ════════════════════════════════════════════════════════════════ */

// Роль, выбранная кнопкой: короткий префикс, чтобы влезть в 64 байта
// callback_data, которые разрешает Telegram.
const PICK = "r:";
const NEWROLE = "newrole";

const nameOf = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(" ")
  || u?.username || String(u?.id || "");

/** Ожидание ответа на «как назвать роль»: кого зовём, пока имя не пришло. */
const pending = new Map();

export function resetPending() { pending.clear(); }

const HELP = [
  "Я умею одно: добавлять людей в модель.",
  "",
  "Перешлите мне сообщение от человека, которого хотите добавить, —",
  "я предложу выбрать роль.",
  "",
  "Если пересылка не сработает (у человека закрыт перенос в настройках",
  "приватности), попросите его прислать мне /id и пришлите этот номер",
  "сообщением вида: id 123456789 Имя",
].join("\n");

const rolesKeyboard = (roles) => ({
  inline_keyboard: [
    ...roles.map((r) => [{ text: r.name, callback_data: PICK + r.id }]),
    [{ text: "+ новая роль", callback_data: NEWROLE }],
  ],
});

/**
 * @param update  объект обновления Telegram
 * @param deps    { org, send, answer } — хранилище и две отправки
 */
export async function handleUpdate(update, deps) {
  const { org, send, answer } = deps;
  const msg = update?.message;
  const cb = update?.callback_query;
  const from = msg?.from || cb?.from;
  if (!from) return { ignored: "no sender" };

  const me = await org.identify(String(from.id), { name: nameOf(from), username: from.username });
  if (!me.isOwner) {
    // Чужим не отвечаем содержательно: бот не должен рассказывать
    // постороннему, что у него вообще есть роли и люди.
    if (msg) await send(from.id, "Этот бот отвечает только владельцу модели.");
    if (cb) await answer(cb.id, "Только владелец");
    return { ignored: "not owner" };
  }

  if (cb) return onCallback(cb, from, deps);
  return onMessage(msg, from, deps);
}

async function onMessage(msg, from, { org, send }) {
  const text = String(msg.text || "").trim();

  // 1. Пересланное сообщение — основной путь.
  const fwd = msg.forward_from;
  if (fwd) {
    const roles = (await org.listOrg()).roles;
    pending.set(String(from.id), { id: String(fwd.id), name: nameOf(fwd),
      username: fwd.username || "", awaiting: "role" });
    await send(from.id, `Кого добавляем: ${nameOf(fwd)} (id ${fwd.id}).\nВыберите роль:`,
      rolesKeyboard(roles));
    return { asked: String(fwd.id) };
  }
  if (msg.forward_sender_name || msg.forward_origin?.type === "hidden_user") {
    await send(from.id, [
      `У «${msg.forward_sender_name || msg.forward_origin?.sender_user_name}» закрыт`,
      "перенос сообщений, поэтому Telegram не сообщает его id — добавить по",
      "такой пересылке нельзя.",
      "",
      "Попросите человека открыть бота и отправить /id, а потом пришлите мне:",
      "id 123456789 Имя",
    ].join("\n"));
    return { blocked: "hidden" };
  }

  // 2. Ожидаем имя новой роли.
  const wait = pending.get(String(from.id));
  if (wait?.awaiting === "roleName" && text) {
    try {
      const role = await org.addRole({ name: text });
      await org.addUser({ id: wait.id, name: wait.name, username: wait.username,
        roleId: role.id, addedBy: from.id });
      pending.delete(String(from.id));
      await send(from.id, `Готово: ${wait.name} — «${role.name}».`);
      return { added: wait.id, role: role.id };
    } catch (e) {
      await send(from.id, `Не вышло: ${e.message}. Пришлите другое название.`);
      return { error: e.message };
    }
  }

  // 3. Запасной путь: «id 123 Имя» — когда пересылка не сработала.
  const byId = text.match(/^id\s+(\d{3,20})\s*(.*)$/i);
  if (byId) {
    const roles = (await org.listOrg()).roles;
    pending.set(String(from.id), { id: byId[1], name: byId[2].trim() || byId[1],
      username: "", awaiting: "role" });
    await send(from.id, `Кого добавляем: ${byId[2].trim() || byId[1]} (id ${byId[1]}).\nВыберите роль:`,
      rolesKeyboard(roles));
    return { asked: byId[1] };
  }

  // 4. Свой номер — чтобы было что переслать владельцу.
  if (/^\/id\b/.test(text)) {
    await send(from.id, `Ваш id: ${from.id}`);
    return { told: String(from.id) };
  }

  await send(from.id, HELP);
  return { helped: true };
}

async function onCallback(cb, from, { org, send, answer }) {
  const data = String(cb.data || "");
  const wait = pending.get(String(from.id));
  if (!wait) {
    await answer(cb.id, "Не помню, кого добавляем — перешлите сообщение заново");
    return { stale: true };
  }

  if (data === NEWROLE) {
    pending.set(String(from.id), { ...wait, awaiting: "roleName" });
    await answer(cb.id, "");
    await send(from.id, "Как назвать роль? Пришлите название одним сообщением.");
    return { asking: "roleName" };
  }

  if (data.startsWith(PICK)) {
    const roleId = data.slice(PICK.length);
    try {
      await org.addUser({ id: wait.id, name: wait.name, username: wait.username,
        roleId, addedBy: from.id });
      const role = (await org.listOrg()).roles.find((r) => r.id === roleId);
      pending.delete(String(from.id));
      await answer(cb.id, "Добавлен");
      await send(from.id, `Готово: ${wait.name} — «${role?.name || roleId}».`);
      return { added: wait.id, role: roleId };
    } catch (e) {
      await answer(cb.id, "Не вышло");
      await send(from.id, `Не вышло: ${e.message}`);
      return { error: e.message };
    }
  }

  await answer(cb.id, "");
  return { ignored: "unknown callback" };
}
