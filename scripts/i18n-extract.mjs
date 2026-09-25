/* Собирает ключи перевода из web/src и server/src: русский текст в JSX,
   строки-атрибуты и все строковые литералы с кириллицей (их подбирает tx
   на лету), шаблоны — в виде «…{0}…». Пишет scripts/i18n-keys.json и добавляет
   недостающие ключи во все locales/*.json пустыми (пустое =
   «перевода нет, остаётся русский»); ключи, которых в коде больше нет,
   остаются в конце файла.
   Запуск из корня: node scripts/i18n-extract.mjs */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(new URL("../web/package.json", import.meta.url));
const { parse } = require("@babel/parser");
const traverseMod = require("@babel/traverse");
const traverse = traverseMod.default || traverseMod;

const ROOT = new URL("../", import.meta.url).pathname;
const TREES = ["web/src", "server/src"];
const CYR = /[\u0400-\u04FF]/;
const SKIP_ATTR = new Set(["value", "defaultValue", "id", "key", "className", "style", "href", "src",
  "type", "name", "role", "rel", "target", "download", "htmlFor", "lang", "dir", "inputMode", "autoComplete"]);
const keys = new Set();

function jsxText(raw) {
  if (!raw.includes("\n")) return raw;
  return raw.split(/\r?\n/).map((l, i, arr) => {
    let s = l;
    if (i !== 0) s = s.replace(/^[ \t]+/, "");
    if (i !== arr.length - 1) s = s.replace(/[ \t]+$/, "");
    return s;
  }).filter((l) => l.trim() !== "").join(" ");
}
const add = (k) => { if (k && CYR.test(k) && k.trim()) keys.add(k); };

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(test|i18n|node_modules)$/.test(e.name)) walk(p); continue; }
    if (!/\.(jsx?|mjs)$/.test(e.name) || /\.test\./.test(e.name)) continue;
    const code = fs.readFileSync(p, "utf8");
    let ast;
    try { ast = parse(code, { sourceType: "module", plugins: ["jsx"] }); }
    catch (err) { console.error(`${p}: ${err.message}`); continue; }
    traverse(ast, {
      JSXText({ node }) { add(jsxText(node.value)); },
      JSXAttribute({ node }) {
        const name = node.name && node.name.name;
        if (typeof name !== "string" || SKIP_ATTR.has(name) || name.startsWith("data-") || name.startsWith("on")) return;
        if (node.value && node.value.type === "StringLiteral") add(node.value.value);
      },
      StringLiteral({ node, parent }) {
        if (parent.type === "JSXAttribute" || parent.type === "ImportDeclaration") return;
        if (parent.type === "ObjectProperty" && parent.key === node) return;
        add(node.value);
      },
      TemplateLiteral({ node }) {
        if (!node.quasis.some((q) => CYR.test(q.value.cooked || ""))) return;
        add(node.quasis.map((q, i) => (i < node.expressions.length
          ? `${q.value.cooked}{${i}}` : q.value.cooked)).join(""));
      },
    });
  }
}
TREES.forEach((t) => walk(path.join(ROOT, t)));
const list = [...keys].sort((a, b) => a.localeCompare(b, "ru"));
const out = path.join(ROOT, "locales");
fs.writeFileSync(path.join(ROOT, "scripts", "i18n-keys.json"), `${JSON.stringify(list, null, 1)}\n`);
// Языки — файлы в locales/: каждый получает недостающие ключи пустыми.
const langs = fs.readdirSync(out).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
for (const lang of langs) {
  const file = path.join(out, `${lang}.json`);
  const dict = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  let added = 0;
  list.forEach((k) => { if (!(k in dict)) { dict[k] = ""; added += 1; } });
  const ordered = Object.fromEntries(list.map((k) => [k, dict[k]])
    .concat(Object.entries(dict).filter(([k]) => !keys.has(k))));
  fs.writeFileSync(file, `${JSON.stringify(ordered, null, 1)}\n`);
  const empty = Object.values(ordered).filter((v) => !v).length;
  console.log(`${lang}: ключей ${list.length}, добавлено ${added}, без перевода ${empty}`);
}
