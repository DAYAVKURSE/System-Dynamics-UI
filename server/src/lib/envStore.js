import fs from "node:fs";
import path from "node:path";

/* ════════════════════════════════════════════════════════════════
   НАСТРОЙКИ, КОТОРЫЕ ВЛАДЕЛЕЦ ЗАДАЁТ С ТЕЛЕФОНА

   У владельца нет компьютера: ни SSH, ни правки файлов на сервере. Всё,
   что он должен уметь настроить, настраивается из чата с ботом, а сервер
   кладёт значение в тот же .env, откуда читает всё остальное.

   Пишем по одной строке, не переписывая файл целиком: рядом лежат токен
   бота и секрет TURN — потерять их значило бы сломать всё сразу.
   Права 0600: в этом файле секреты.

   Деплой такие значения сохраняет — он читает прежний .env с сервера и
   переносит их в новый (см. .github/workflows/ci-cd.yml). Иначе настройка
   с телефона жила бы до первого обновления.
   ════════════════════════════════════════════════════════════════ */

export const envFile = () => process.env.ENV_FILE || path.join(process.cwd(), ".env");

/**
 * Дописывает или заменяет одну строку в .env, не трогая остальные.
 * Возвращает новое содержимое файла.
 */
export function putEnvValue(name, value, file = envFile()) {
  let body = "";
  try { body = fs.readFileSync(file, "utf8"); } catch { /* файла ещё нет */ }
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  const next = re.test(body)
    ? body.replace(re, line)
    : `${body}${body && !body.endsWith("\n") ? "\n" : ""}${line}\n`;
  // Через временный файл и переименование. Обычная запись сначала обрезает
  // файл, и тот, кто читает его в этот момент (деплой переносит из него
  // прежние значения), увидел бы половину секрета. Переименование атомарно:
  // читатель видит либо прежний файл, либо новый целиком.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, next, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* не в нашей власти — не беда */ }
  return next;
}

/** Значение из .env, если оно там есть. */
export function readEnvValue(name, file = envFile()) {
  try {
    const m = fs.readFileSync(file, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
    return m ? m[1].trim() : "";
  } catch { return ""; }
}

/**
 * Меняет настройку и в файле, и в живом процессе: ссылки на звонок
 * собираются из process.env на каждый вызов, поэтому новое имя действует
 * сразу, без перезапуска.
 */
export function setSetting(name, value, file = envFile()) {
  putEnvValue(name, value, file);
  process.env[name] = value;
  return value;
}
