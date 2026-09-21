import fs from "node:fs/promises";
import path from "node:path";

/* ════════════════════════════════════════════════════════════════
   КТО ЕСТЬ КТО · код ↔ запись

   Код (uid из сервиса кодов) — постоянное имя человека: с ним он входит
   с любого Telegram-аккаунта (владелец, 2026-09-21). Запись — то, к
   чему привязано всё его: анкета, задачи, оценки. Здесь — связь между
   ними, и больше ничего.

   Первый вход с кодом привязывает его к записи, под которой человек
   был до сих пор (для тех, кто уже здесь, — к их Telegram-id); дальше
   код ведёт к той же записи, откуда бы ни вошли. Telegram-аккаунты,
   с которых входили, помнятся — только чтобы было видно, что код один,
   а входов несколько.
   ════════════════════════════════════════════════════════════════ */
const baseDir = () => (process.env.ORG_DIR
  ? path.resolve(process.env.ORG_DIR)
  : path.resolve(process.cwd(), "data", "org"));
const file = () => path.join(baseDir(), "identity.json");

async function read() {
  try {
    const j = JSON.parse(await fs.readFile(file(), "utf8"));
    return { links: Array.isArray(j?.links) ? j.links : [] };
  } catch { return { links: [] }; }
}
async function write(data) {
  await fs.mkdir(baseDir(), { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file());
}

let q = Promise.resolve();
const serial = (fn) => { const run = q.then(fn); q = run.catch(() => {}); return run; };

/** К какой записи ведёт код. Нет связи — null. */
export async function recordOfUid(uid) {
  const { links } = await read();
  const l = links.find((x) => x.uid === String(uid));
  return l ? String(l.id) : null;
}

/**
 * Привязать код к записи, если он ещё ни к чему не привязан; вернуть
 * запись, к которой он ведёт. `tg` — с какого Telegram вошли: помнится.
 */
export async function bindUid(uid, recordId, tg = null) {
  return serial(async () => {
    const data = await read();
    let l = data.links.find((x) => x.uid === String(uid));
    let changed = false;
    if (!l) {
      l = { uid: String(uid), id: String(recordId), tg: [], linkedAt: new Date().toISOString() };
      data.links.push(l); changed = true;
    }
    const t = tg == null ? "" : String(tg);
    if (t && !(l.tg || []).includes(t)) { l.tg = [...(l.tg || []), t]; changed = true; }
    if (changed) await write(data);
    return String(l.id);
  });
}

/** Коды, привязанные к записи (обычно один). */
export async function uidsOf(recordId) {
  const { links } = await read();
  return links.filter((x) => String(x.id) === String(recordId)).map((x) => x.uid);
}
