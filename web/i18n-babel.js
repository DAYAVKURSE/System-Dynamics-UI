/* ════════════════════════════════════════════════════════════════
   СБОРКА ОБОРАЧИВАЕТ ТЕКСТ В JSX ПЕРЕВОДОМ (владелец, 2026-09-21)

   Плагин Babel для @vitejs/plugin-react. Ничего не переводит сам —
   подставляет вызовы `t`/`tx` из src/i18n/t.js:

   · текст между тегами с кириллицей        → {__t("текст")}
   · строка-атрибут с кириллицей            → __t("строка")
     (кроме служебных: value, id, key, className, style, href, src, type,
     name, data-*, on*)
   · выражение между тегами                 → {__tx(выражение)}
     (строка — переводится по словарю, всё прочее проходит как есть)
   · выражение в атрибутах подписей         → __tx(выражение)
     (title, placeholder, aria-label, label, alt, hint, caption)
   · шаблон `...${x}...` с кириллицей в JSX → __t("...{0}...", [x])

   Ключ — сам русский текст, поэтому на русском всё остаётся как было,
   и тесты, ищущие по русским подписям, не меняются.
   ════════════════════════════════════════════════════════════════ */
const CYR = /[Ѐ-ӿ]/;
const SKIP_ATTR = new Set(["value", "defaultValue", "id", "key", "className", "style", "href", "src",
  "type", "name", "role", "rel", "target", "download", "htmlFor", "lang", "dir", "inputMode", "autoComplete"]);
const TEXT_ATTR = new Set(["title", "placeholder", "aria-label", "label", "alt", "hint", "caption",
  "aria-description", "aria-placeholder", "text", "note", "empty", "question", "heading", "subtitle"]);
const T_IMPORT = "/src/i18n/t.js";

/** Как React сводит текст между тегами: строки обрезаются, пустые — вон,
 *  соседние склеиваются пробелом; в одной строке пробелы по краям живут. */
function jsxText(raw) {
  if (!raw.includes("\n")) return raw;
  const lines = raw.split(/\r?\n/).map((l, i, arr) => {
    let s = l;
    if (i !== 0) s = s.replace(/^[ \t]+/, "");
    if (i !== arr.length - 1) s = s.replace(/[ \t]+$/, "");
    return s;
  }).filter((l) => l.trim() !== "");
  return lines.join(" ");
}

export default function i18nBabel({ types: t }) {
  const ensureImport = (state) => {
    if (state.__i18n) return;
    state.__i18n = true;
    const decl = t.importDeclaration([
      t.importSpecifier(t.identifier("__t"), t.identifier("t")),
      t.importSpecifier(t.identifier("__tx"), t.identifier("tx")),
    ], t.stringLiteral(T_IMPORT));
    state.file.path.unshiftContainer("body", decl);
  };
  const callT = (key, args) => t.callExpression(t.identifier("__t"),
    args ? [t.stringLiteral(key), t.arrayExpression(args)] : [t.stringLiteral(key)]);
  const callTx = (expr) => t.callExpression(t.identifier("__tx"), [expr]);
  const isWrapped = (n) => t.isCallExpression(n) && t.isIdentifier(n.callee)
    && (n.callee.name === "__t" || n.callee.name === "__tx");
  /* Шаблон с кириллицей → ключ с {n} и список подстановок. */
  const templateKey = (node) => {
    const key = node.quasis.map((q, i) => (i < node.expressions.length
      ? `${q.value.cooked}{${i}}` : q.value.cooked)).join("");
    return { key, args: node.expressions };
  };
  /* Внутри выражения — по ветвям условий и логики: строки и шаблоны с
     кириллицей оборачиваются статически, остальное остаётся под __tx. */
  const wrapStatic = (node) => {
    if (t.isStringLiteral(node)) return CYR.test(node.value) ? callT(node.value) : node;
    if (t.isTemplateLiteral(node)) {
      if (!node.quasis.some((q) => CYR.test(q.value.cooked || ""))) return node;
      const { key, args } = templateKey(node);
      return callT(key, args);
    }
    if (t.isConditionalExpression(node)) {
      node.consequent = wrapStatic(node.consequent);
      node.alternate = wrapStatic(node.alternate);
      return node;
    }
    if (t.isLogicalExpression(node)) { node.right = wrapStatic(node.right); return node; }
    if (t.isParenthesizedExpression(node)) { node.expression = wrapStatic(node.expression); return node; }
    return node;
  };
  const isStatic = (node) => t.isStringLiteral(node) || t.isTemplateLiteral(node)
    || (t.isConditionalExpression(node) && isStatic(node.consequent) && isStatic(node.alternate));

  return {
    name: "sd-i18n",
    visitor: {
      Program: {
        exit(path, state) {
          if (state.filename && /[\\/]src[\\/]i18n[\\/]/.test(state.filename)) return;
        },
      },
      JSXText(path, state) {
        if (/[\\/]i18n[\\/]/.test(state.filename || "")) return;
        const raw = path.node.value;
        if (!CYR.test(raw)) return;
        const text = jsxText(raw);
        if (!text.trim()) return;
        ensureImport(state);
        path.replaceWith(t.jsxExpressionContainer(callT(text)));
      },
      JSXExpressionContainer(path, state) {
        if (/[\\/]i18n[\\/]/.test(state.filename || "")) return;
        const expr = path.node.expression;
        if (t.isJSXEmptyExpression(expr) || isWrapped(expr)) return;
        const parent = path.parent;
        if (t.isJSXAttribute(parent)) {
          const name = parent.name && parent.name.name;
          if (typeof name !== "string" || !TEXT_ATTR.has(name)) return;
          ensureImport(state);
          path.node.expression = isStatic(expr) ? wrapStatic(expr) : callTx(wrapStatic(expr));
          return;
        }
        if (!t.isJSXElement(parent) && !t.isJSXFragment(parent)) return;
        ensureImport(state);
        path.node.expression = isStatic(expr) ? wrapStatic(expr) : callTx(wrapStatic(expr));
      },
      JSXAttribute(path, state) {
        if (/[\\/]i18n[\\/]/.test(state.filename || "")) return;
        const name = path.node.name && path.node.name.name;
        if (typeof name !== "string" || SKIP_ATTR.has(name) || name.startsWith("data-") || name.startsWith("on")) return;
        const v = path.node.value;
        if (!t.isStringLiteral(v) || !CYR.test(v.value)) return;
        ensureImport(state);
        path.node.value = t.jsxExpressionContainer(callT(v.value));
      },
    },
  };
}
