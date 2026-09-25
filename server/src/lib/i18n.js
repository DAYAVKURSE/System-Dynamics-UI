import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ════════════════════════════════════════════════════════════════
   ЯЗЫК СООБЩЕНИЙ БОТА (владелец, 2026-09-21; файлы-языки — 2026-09-25)

   Словари — `locales/*.json` в корне репозитория, одни на приложение и
   сервер: «русская строка → перевод». ФАЙЛ — ЭТО ЯЗЫК, имя файла — его
   название (владелец, 2026-09-25): `English.json` → «English». Список
   языков читается с диска, ничего вписывать не нужно. Русский —
   исходный, файла у него нет.

   Исходные тексты бота остаются в коде по-русски; переводится
   ИСХОДЯЩЕЕ — в telegram.js каждое сообщение и подписи кнопок проходят
   через `trFor(chatId, …)`: построчно, точным совпадением или по шаблону
   с «{n}» (текст, собранный с именами и числами, подбирается регулярным
   выражением по ключу).

   Язык человека — из анкеты (`lang` в orgStore.setProfile); хранится и
   здесь, в `langs.json` рядом с identity.json (ORG_DIR): чат с ботом
   идёт без хранилища, а анкета живёт в хранилище.
   ════════════════════════════════════════════════════════════════ */
const here = path.dirname(fileURLToPath(import.meta.url));
export const RU = "Русский";
const localesDir = () => process.env.LOCALES_DIR || path.resolve(here, "../../../locales");
/* Коды до того, как языком стал файл: записаны в анкетах и langs.json. */
const OLD = { ru: RU, en: "English", zh: "中文" };
/* Список языков — с диска, не чаще раза в несколько секунд: новый файл
   виден без перезапуска, а каждое сообщение бота диск не дёргает. */
let listed = { at: 0, names: [] };
export function languages() {
  if (Date.now() - listed.at > 5000) {
    let names = [];
    try {
      names = fs.readdirSync(localesDir()).filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5)).sort((a, b) => a.localeCompare(b));
    } catch { names = []; }
    listed = { at: Date.now(), names };
  }
  return [RU, ...listed.names];
}
export const langOf = (v) => {
  const k = OLD[String(v)] || String(v || "");
  return languages().includes(k) ? k : RU;
};
const CYR = /[\u0400-\u04FF]/;

const dicts = new Map();   // lang → {dict, templates}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function load(lang) {
  if (lang === RU) return null;
  if (dicts.has(lang)) return dicts.get(lang);
  let dict = {};
  try { dict = JSON.parse(fs.readFileSync(path.join(localesDir(), `${lang}.json`), "utf8")); } catch { dict = {}; }
  const templates = Object.entries(dict)
    .filter(([k, v]) => v && /\{\d+\}/.test(k))
    .map(([k, v]) => ({
      re: new RegExp(`^${escapeRe(k).replace(/\\\{(\d+)\\\}/g, "(.+?)")}$`, "s"),
      order: [...k.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1])),
      value: v,
    }))
    .sort((a, b) => b.re.source.length - a.re.source.length);
  /* Куски для склейки текста, собранного из нескольких строк (см. web/src/i18n/t.js). */
  const pieces = Object.entries(dict)
    .filter(([k, v]) => v && !k.includes("\n"))
    .map(([k, v]) => {
      const tpl = /\{\d+\}/.test(k);
      if (tpl && /\{\d+\}$/.test(k)) return null;
      return { k, v, re: tpl ? new RegExp(`^${escapeRe(k).replace(/\\\{(\d+)\\\}/g, "(.+?)")}`) : null,
        order: tpl ? [...k.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1])) : null };
    })
    .filter(Boolean)
    .sort((a, b) => b.k.length - a.k.length);
  const out = { dict, templates, pieces, cache: new Map() };
  dicts.set(lang, out);
  return out;
}
/** Сбросить словари (тесты; после правки файлов). */
export const resetDicts = () => { dicts.clear(); listed = { at: 0, names: [] }; };

const fill = (s, args) => String(s).replace(/\{(\d+)\}/g, (_, i) => (args[Number(i)] == null ? "" : String(args[Number(i)])));
const trLine = (d, line) => {
  if (!CYR.test(line)) return line;
  const hit = d.dict[line];
  if (hit) return hit;
  if (d.cache.has(line)) return d.cache.get(line);
  let out = line;
  for (const tpl of d.templates) {
    const m = tpl.re.exec(line);
    if (!m) continue;
    const args = [];
    tpl.order.forEach((n, i) => { args[n] = m[i + 1]; });
    out = fill(tpl.value, args);
    break;
  }
  if (out === line) out = glue(line, d.pieces);
  if (d.cache.size < 5000) d.cache.set(line, out);
  return out;
};
function glue(s, list) {
  let out = "";
  let i = 0;
  let hit = false;
  while (i < s.length) {
    const rest = s.slice(i);
    let best = null;
    for (const p of list) {
      if (!p.re) { if (rest.startsWith(p.k)) { best = { len: p.k.length, text: p.v }; break; } continue; }
      const m = p.re.exec(rest);
      if (m) { const args = []; p.order.forEach((n, j) => { args[n] = m[j + 1]; }); best = { len: m[0].length, text: fill(p.v, args) }; break; }
    }
    if (best && best.len > 0) { out += best.text; i += best.len; hit = true; continue; }
    const j = rest.indexOf(" ", 1);
    const end = j === -1 ? rest.length : j;
    out += rest.slice(0, end);
    i += end;
  }
  return hit ? out : s;
}
/** Перевод текста на язык: построчно, точно или по шаблону. */
export function tr(lang, text) {
  const d = load(langOf(lang));
  if (!d || typeof text !== "string" || !CYR.test(text)) return text;
  return text.split("\n").map((line) => trLine(d, line)).join("\n");
}
/** Клавиатура — подписи кнопок; сами данные (callback_data, url) не трогаются. */
export function trKeyboard(lang, keyboard) {
  if (!keyboard || typeof keyboard !== "object" || langOf(lang) === RU) return keyboard;
  const rows = (list) => list.map((row) => row.map((b) => (b && typeof b === "object" && typeof b.text === "string"
    ? { ...b, text: tr(lang, b.text) } : b)));
  const out = { ...keyboard };
  if (Array.isArray(out.inline_keyboard)) out.inline_keyboard = rows(out.inline_keyboard);
  if (Array.isArray(out.keyboard)) out.keyboard = rows(out.keyboard);
  return out;
}

/* ─── чей язык ─── */
const baseDir = () => (process.env.ORG_DIR ? path.resolve(process.env.ORG_DIR) : path.resolve(process.cwd(), "data", "org"));
const file = () => path.join(baseDir(), "langs.json");
let langs = null;
let langsFile = "";
function readLangs() {
  if (langs && langsFile === file()) return langs;
  langsFile = file();
  try { langs = JSON.parse(fs.readFileSync(langsFile, "utf8")) || {}; } catch { langs = {}; }
  return langs;
}
export function userLang(userId) { return langOf(readLangs()[String(userId)]); }
export async function setUserLang(userId, lang) {
  const map = readLangs();
  const next = langOf(lang);
  if (next === RU) delete map[String(userId)]; else map[String(userId)] = next;
  await fs.promises.mkdir(baseDir(), { recursive: true });
  await fs.promises.writeFile(file(), JSON.stringify(map, null, 2), "utf8");
  return next;
}
/** Исходящее человеку — на его языке. */
export const trFor = (chatId, text) => tr(userLang(chatId), text);
export const trKeyboardFor = (chatId, keyboard) => trKeyboard(userLang(chatId), keyboard);
