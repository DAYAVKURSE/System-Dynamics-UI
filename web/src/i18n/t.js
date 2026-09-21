/* ════════════════════════════════════════════════════════════════
   ЯЗЫК ПРИЛОЖЕНИЯ (владелец, 2026-09-21)

   Исходный текст интерфейса — русский, и он же ключ: словари
   `locales/en.json` и `locales/zh.json` в корне репозитория — это
   «русская строка → перевод», одни и для приложения, и для бота. Новый
   язык — ещё один такой файл и строка в LANGS здесь и в
   `server/src/lib/i18n.js`; строки в код вписывать не нужно: сборка
   (web/i18n-babel.js) сама оборачивает текст в JSX вызовом `t`, а
   `scripts/i18n-extract.mjs` в корне собирает ключи из приложения и
   сервера.

   Строки с подстановками хранятся с «{0}», «{1}»: шаблон в JSX
   (`Осталось ${n} дн.`) превращается в `t("Осталось {0} дн.", [n])`, а
   строка, собранная в коде заранее, подбирается по тем же шаблонам
   регулярным выражением. Чего в словаре нет — остаётся по-русски.

   Язык живёт в localStorage (`sd_lang`) и в анкете на сервере: смена —
   перезагрузка страницы, чтобы всё переключилось разом.
   ════════════════════════════════════════════════════════════════ */
/* Словари — одни на приложение и сервер: `locales/` в корне репозитория. */
import en from "../../../locales/en.json";
import zh from "../../../locales/zh.json";

export const LANGS = [
  ["ru", "Русский"],
  ["en", "English"],
  ["zh", "中文"],
];
const DICTS = { en, zh };
const KEY = "sd_lang";
const CYR = /[Ѐ-ӿ]/;

const read = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
export const langOf = (v) => (LANGS.some(([k]) => k === v) ? v : "ru");
let lang = langOf(read());
export const currentLang = () => lang;
/** Сменить язык: запомнить и перезагрузить страницу (вне теста). */
export function setLang(next, { reload = true } = {}) {
  lang = langOf(next);
  try { localStorage.setItem(KEY, lang); } catch { /* приватный режим */ }
  cache.clear();
  templates = null; pieces = null;
  if (reload && typeof window !== "undefined" && typeof window.location?.reload === "function"
    && import.meta.env?.MODE !== "test") window.location.reload();
}
/** С сервера пришёл язык анкеты — берём его, если здесь другой. */
export function syncLang(fromServer) {
  const next = langOf(fromServer);
  if (!fromServer || next === lang) return false;
  setLang(next);
  return true;
}

const cache = new Map();
let templates = null;   // [{re, value}] — ключи с {n}
let pieces = null;      // куски для склейки: ключи без переводов строк, длинные первыми
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compileTemplates = (dict) => Object.entries(dict)
  .filter(([k, v]) => v && /\{\d+\}/.test(k))
  .map(([k, v]) => ({
    re: new RegExp(`^${escapeRe(k).replace(/\\\{(\d+)\\\}/g, "(.+?)")}$`, "s"),
    order: [...k.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1])),
    value: v,
  }))
  .sort((a, b) => b.re.source.length - a.re.source.length);

const fill = (s, args) => String(s).replace(/\{(\d+)\}/g, (_, i) => {
  const v = args?.[Number(i)];
  return v == null ? "" : String(v);
});

/* ─── склейка из кусков ───
   Длинный текст в коде часто собран из нескольких строк («…» + «…»), и
   ключ — каждая из них. Строка, которая целиком не нашлась, режется
   жадно: с текущего места ищется самый длинный ключ, что здесь стоит
   (или шаблон с «{n}», у которого после подстановки есть буквы — иначе
   не понять, где кончается подстановка), переводится, и так до конца;
   что не нашлось — до следующего пробела как есть. */
const compilePieces = (dict) => Object.entries(dict)
  .filter(([k, v]) => v && !k.includes("\n"))
  .map(([k, v]) => {
    const tpl = /\{\d+\}/.test(k);
    if (tpl && /\{\d+\}$/.test(k)) return null;
    return { k, v, re: tpl ? new RegExp(`^${escapeRe(k).replace(/\\\{(\d+)\\\}/g, "(.+?)")}`) : null,
      order: tpl ? [...k.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1])) : null };
  })
  .filter(Boolean)
  .sort((a, b) => b.k.length - a.k.length);
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

/**
 * Перевод строки-ключа. `args` — подстановки для «{0}», «{1}»…
 * Нет перевода — русский ключ (с подстановками).
 */
export function t(key, args) {
  const k = String(key ?? "");
  if (lang === "ru") return args ? fill(k, args) : k;
  const dict = DICTS[lang] || {};
  const hit = dict[k];
  if (hit) return args ? fill(hit, args) : hit;
  if (args) return fill(k, args);
  return tx(k);
}

/** Перевод строки, собранной в коде: точное совпадение или шаблон с «{n}». */
export function tx(value) {
  if (lang === "ru" || typeof value !== "string" || !CYR.test(value)) return value;
  const dict = DICTS[lang] || {};
  const hit = dict[value];
  if (hit) return hit;
  if (cache.has(value)) return cache.get(value);
  if (!templates) templates = compileTemplates(dict);
  let out = value;
  /* Многострочное — построчно: сообщения склеены из строк, и каждая
     строка — свой ключ. */
  if (value.includes("\n")) {
    out = value.split("\n").map((line) => tx(line)).join("\n");
  } else {
    for (const tpl of templates) {
      const m = tpl.re.exec(value);
      if (!m) continue;
      const args = [];
      tpl.order.forEach((n, i) => { args[n] = m[i + 1]; });
      out = fill(tpl.value, args);
      break;
    }
    if (out === value) {
      if (!pieces) pieces = compilePieces(dict);
      out = glue(value, pieces);
    }
  }
  if (cache.size < 5000) cache.set(value, out);
  return out;
}
