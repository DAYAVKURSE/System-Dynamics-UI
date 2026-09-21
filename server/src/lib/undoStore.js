import fs from "node:fs/promises";
import path from "node:path";

/* ════════════════════════════════════════════════════════════════
   ОТКАТ ИЗМЕНЕНИЯ, СДЕЛАННОГО ПОМОЩНИКОМ (владелец, 2026-09-21)

   «При нажатии „Подтвердить" эта кнопка должна меняться на „Отменить
   изменения". Даже если я нажму на неё в дальнейшем, неважно, через какое
   время, ассистент должен откатить ровно те изменения, которые внёс, и
   вернуть значения, которые были до внесения изменений».

   «Неважно, через какое время» — значит пережить и перезапуск сервера, и
   деплой. Поэтому откаты лежат файлом, а не в памяти процесса, как
   отложенные подтверждения: у тех срок — час и разговор, у этих срока нет
   вовсе.

   Что хранится — не «действие», а СНИМОК РАЗНИЦЫ: какие записи модели
   изменились и какими они были до. Не вся модель: она весит мегабайты, и
   возврат её целиком отменил бы заодно всё, что человек сделал руками
   после. И не «обратное действие»: обратного у «принять работу» не
   существует, а прежнее значение существует всегда.

   Список ограничен: это память о недавнем, а не архив. Вытесняются самые
   старые — у свежего изменения откат нужнее.
   ════════════════════════════════════════════════════════════════ */

export const MAX_UNDO = 200;

function baseDir() {
  return process.env.UNDO_DIR
    ? path.resolve(process.env.UNDO_DIR)
    : path.resolve(process.cwd(), "data", "undo");
}
const file = () => path.join(baseDir(), "undo.json");

async function readAll() {
  try {
    const parsed = JSON.parse(await fs.readFile(file(), "utf8"));
    return Array.isArray(parsed.undo) ? parsed.undo : [];
  } catch { return []; }
}

async function writeAll(list) {
  await fs.mkdir(baseDir(), { recursive: true });
  const tmp = `${file()}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify({ undo: list }), "utf8");
    await fs.rename(tmp, file());
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  return list;
}

/* Очередь правок — одна на процесс, как у модели: две кнопки, нажатые в
   одну секунду, не должны затирать друг друга. */
let chain = Promise.resolve();
function withUndo(job) {
  const run = async () => job(await readAll());
  const next = chain.then(run, run);
  chain = next.then(() => {}, () => {});
  return next;
}

/** Запомнить, что откатывать. Запись с тем же id заменяется. */
export async function addUndo(rec) {
  return withUndo(async (list) => {
    const next = [...list.filter((x) => x.id !== rec.id), { ...rec, at: rec.at || new Date().toISOString() }];
    await writeAll(next.slice(-MAX_UNDO));
    return rec;
  });
}

/** Что откатит эта кнопка — не трогая запись. */
export async function undoById(id) {
  return (await readAll()).find((x) => x.id === String(id)) || null;
}

/** Забрать запись: откатывают один раз, второе нажатие откатывать нечего. */
export async function takeUndo(id) {
  return withUndo(async (list) => {
    const rec = list.find((x) => x.id === String(id));
    if (!rec) return null;
    await writeAll(list.filter((x) => x.id !== String(id)));
    return rec;
  });
}

/** Для тестов: начать с чистого листа. */
export async function resetUndo() {
  await fs.rm(baseDir(), { recursive: true, force: true }).catch(() => {});
}
