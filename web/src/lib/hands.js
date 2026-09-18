/* ════════════════════════════════════════════════════════════════
   «НЕ МЕНЯТЬ РУКУ» на схеме (владелец, 2026-09-18)

   Рука — буква у участника задачи техпроцесса («(рука A)» в «Кто:»,
   `funcs[].who[].hand`): один и тот же человек во всех задачах процесса с
   этой буквой. На схеме у каждой задачи процесса — точка-пин справа от
   блока её актива; задачи с одной рукой соединены линией со
   скруглениями, идущей справа от блоков, не задевая текст; точки на одной
   линии одного цвета. Нажатие на точку снимает руку с этой задачи,
   перетаскивание точки на другую точку — связывает.

   Правка идёт через ТЕКСТ процесса (`setHand` в lib/proc2.js): текст —
   единственный источник, функции пересобираются из него.
   ════════════════════════════════════════════════════════════════ */

import { parseText, setHand } from "./proc2.js";

const HAND_COLORS = ["#F78CB2", "#B4F78C", "#8CD4F7", "#F7D68C", "#C98CF7", "#8CF7E0", "#F7A98C"];
export const handColor = (h) => HAND_COLORS[(String(h || "A").toUpperCase().charCodeAt(0) - 65 + 7 * 26) % HAND_COLORS.length];

export const NW = 208, NH = 126;
const PIN_GAP = 15, PIN_TOP = 18, PIN_MAX = 7;

/** Рука задачи: у исполнителя, иначе у любого участника. */
export const handOfFunc = (f = {}) => {
  const who = Array.isArray(f.who) ? f.who : [];
  const w = who.find((x) => x.hand && (x.roles?.doer || x.roles?.any)) || who.find((x) => x.hand);
  return w ? String(w.hand).toUpperCase() : null;
};

const stepOf = (f) => (f.chain?.step || 0);

/** Пины: по точке на каждую задачу процесса, справа от блока её актива. */
export function pinsOf(funcs = [], entities = []) {
  const out = [];
  entities.forEach((e) => {
    const mine = funcs.filter((f) => f.e === e.id && f.proc)
      .sort((a, b) => String(a.chain?.id || a.id).localeCompare(String(b.chain?.id || b.id)) || stepOf(a) - stepOf(b));
    mine.slice(0, PIN_MAX).forEach((f, i) => out.push({ func: f.id, e: e.id, x: e.x + NW + 10, y: e.y + PIN_TOP + i * PIN_GAP,
      hand: handOfFunc(f), name: f.name || "задача", right: e.x + NW }));
  });
  return out;
}

/** Линии: задачи одного процесса с одной рукой — по порядку шагов, соседними парами. */
export function handLinks(funcs = []) {
  const groups = new Map();
  funcs.forEach((f) => {
    const h = handOfFunc(f);
    if (!h || !f.proc) return;
    const k = `${f.proc}|${h}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  });
  const out = [];
  groups.forEach((list, k) => {
    list.sort((a, b) => stepOf(a) - stepOf(b) || String(a.id).localeCompare(String(b.id)));
    for (let i = 1; i < list.length; i += 1) out.push({ a: list[i - 1].id, b: list[i].id, hand: k.split("|")[1], proc: list[0].proc });
  });
  return out;
}

/** Путь линии между двумя пинами: вправо, со скруглениями, справа от блоков. */
export function linkPath(a, b, lane = 0) {
  const r = 8;
  const X = Math.max(a.right, b.right) + 26 + lane * 9;
  if (Math.abs(a.y - b.y) < 2) {
    // Пины на одной высоте: петля вправо и обратно.
    return `M ${a.x} ${a.y} H ${X - r} Q ${X} ${a.y} ${X} ${a.y + r} V ${a.y + r} Q ${X} ${a.y + 2 * r} ${X - r} ${a.y + 2 * r} H ${b.x}`;
  }
  const down = b.y > a.y;
  const s = down ? 1 : -1;
  return `M ${a.x} ${a.y} H ${X - r} Q ${X} ${a.y} ${X} ${a.y + s * r} V ${b.y - s * r} Q ${X} ${b.y} ${X - r} ${b.y} H ${b.x}`;
}

/* ─── правка рук через текст процесса ─── */

/* Функция `${proc.id}_${row+1}_t${k}` → строки «Кто:» её задачи в тексте. */
function whoRows(proc, funcId, model) {
  const tail = String(funcId).slice(String(proc.id).length + 1);
  const m = tail.match(/^(\d+)_t(\d+)$/);
  if (!m) return [];
  const row = Number(m[1]) - 1, k = Number(m[2]) - 1;
  const { funcs } = parseText(proc.text, model, proc);
  const f = funcs.find((x) => x.row === row);
  const t = f?.tasks[k];
  if (!t) return [];
  return t.branches[0]?.who.map((w) => ({ row: w.row, hand: w.hand, doer: w.roles.doer || (!w.roles.setter && !w.roles.doer && !w.roles.checker) })) || [];
}
const usedHands = (proc, model) => {
  const set = new Set();
  parseText(proc.text, model, proc).funcs.forEach((f) => f.tasks.forEach((t) => t.branches.forEach((b) => b.who.forEach((w) => { if (w.hand) set.add(String(w.hand).toUpperCase()); }))));
  return set;
};
const freeHand = (proc, model) => {
  const used = usedHands(proc, model);
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!used.has(ch)) return ch;
  return "A";
};

/** Снять руку с задачи: новый список процессов или null, если нечего снимать. */
export function removeHand(procs = [], funcs = [], model = {}, funcId) {
  const f = funcs.find((x) => x.id === funcId);
  const proc = f && procs.find((p) => p.id === f.proc);
  if (!proc) return null;
  const rows = whoRows(proc, funcId, model).filter((w) => w.hand);
  if (!rows.length) return null;
  let text = proc.text;
  rows.forEach((w) => { text = setHand(text, w.row, null); });
  return procs.map((p) => (p.id === proc.id ? { ...p, text } : p));
}

/** Связать две задачи одной рукой (перетаскивание точки): новый список процессов или null. */
export function applyHand(procs = [], funcs = [], model = {}, fromId, toId) {
  const a = funcs.find((x) => x.id === fromId), b = funcs.find((x) => x.id === toId);
  if (!a || !b || a.id === b.id || a.proc !== b.proc) return null;
  const proc = procs.find((p) => p.id === a.proc);
  if (!proc) return null;
  const hand = handOfFunc(a) || handOfFunc(b) || freeHand(proc, model);
  let text = proc.text;
  const put = (fid) => {
    const rows = whoRows({ ...proc, text }, fid, model);
    if (!rows.length) return false;
    const target = rows.find((w) => w.hand === hand) || rows.find((w) => w.doer && !w.hand) || rows.find((w) => !w.hand) || rows[0];
    if (target.hand === hand) return true;
    text = setHand(text, target.row, hand);
    return true;
  };
  if (!put(a.id) || !put(b.id)) return null;
  if (text === proc.text) return null;
  return procs.map((p) => (p.id === proc.id ? { ...p, text } : p));
}
