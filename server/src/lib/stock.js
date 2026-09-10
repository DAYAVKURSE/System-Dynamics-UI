/* ════════════════════════════════════════════════════════════════
   СКОЛЬКО РЕСУРСА ЕСТЬ — по материалам и сдачам

   Зеркало `stockOf` из `web/src/lib/units.js`, повторённое здесь
   НАРОЧНО, как `heldBy` в `taskRules.js`: сервер проверяет постановку
   задачи теми же числами, что видит постановщик, и не должен ходить за
   ними в код клиента. Правило одно: ресурса есть столько, сколько единиц
   лежит в материалах и в принятых сдачах, минус то, что израсходовано
   принятыми задачами. Записанное у ресурса число `have` не читается.
   ════════════════════════════════════════════════════════════════ */

const num = (v) => Number(v) || 0;
const portSpends = (p = {}) => p.spend !== false;
const lastSub = (t) => {
  const s = t?.submissions || [];
  return s.length ? s[s.length - 1] : null;
};
const live = (t) => t.status === "done" && t.canceled !== true;

export function stockOf({ tasks = [], funcs = [], materials = [] } = {}) {
  const have = {};
  (Array.isArray(materials) ? materials : []).forEach((m) => {
    if (!m || !m.trait) return;
    have[m.trait] = (have[m.trait] || 0) + Math.max(1, Math.floor(num(m.qty)) || 1);
  });
  tasks.filter(live).forEach((t) => {
    const sb = lastSub(t);
    if (!sb) return;
    Object.entries(sb.gives || {}).forEach(([trait, v]) => {
      if (num(v) > 0) have[trait] = (have[trait] || 0) + num(v);
    });
    const f = funcs.find((x) => x.id === t.funcId);
    if (!f) return;
    Object.entries(sb.takes || {}).forEach(([trait, v]) => {
      const p = (f.takes || []).find((x) => x.trait === trait);
      if (p && portSpends(p) && num(v) > 0) have[trait] = (have[trait] || 0) - num(v);
    });
  });
  Object.keys(have).forEach((k) => { have[k] = Math.max(0, have[k]); });
  return have;
}

/** Ресурсы модели с посчитанным `have` — то, что отдают расчёту и словам. */
export function withStock(model = {}) {
  const stock = stockOf(model);
  return (model.traits || []).map((t) => ({ ...t, have: stock[t.id] || 0 }));
}
