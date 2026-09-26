/* ════════════════════════════════════════════════════════════════
   КОНЦЕПТЫ · блоки с деревом (владелец, 2026-09-26)

   «В ней должны быть блоки с древовидной структурой, соединяющей их. В
   каждом блоке может быть включена одна доска брейншторма… В каждом блоке
   слева должна быть таблица, а справа добавляться технологический
   процесс.»

   Блок — часть документа модели (`concepts`), как и процессы: они живут
   вместе, сохраняются, отменяются и уезжают в сценарии вместе.
     { id, name, parent: id блока | null, boardId: id доски | null }
   Процесс знает свой блок полем `blockId` (lib/process.js хранит лишние
   поля как есть).

   Процессы, у которых блока нет (заведены до «Концептов» или
   помощником), получают каждый свой блок с тем же названием — «блок на
   каждый» (владелец, 2026-09-26). Так ни один процесс не теряется.
   ════════════════════════════════════════════════════════════════ */
import { procLabel } from "./process.js";

let seq = 0;
export const newBlockId = () => `cb${Date.now().toString(36)}${(seq++).toString(36)}`;

const str = (v) => (v == null ? "" : String(v));

/** Блоки в том виде, в каком их ждёт остальной код; битые — вон, петли — разорваны. */
export function normalizeConcepts(list) {
  const src = (Array.isArray(list) ? list : []).filter((b) => b && b.id != null);
  const ids = new Set(src.map((b) => str(b.id)));
  const out = src.map((b) => ({
    id: str(b.id),
    name: str(b.name).slice(0, 200),
    parent: b.parent != null && ids.has(str(b.parent)) && str(b.parent) !== str(b.id) ? str(b.parent) : null,
    boardId: b.boardId ? str(b.boardId) : null,
  }));
  // Петля (A в B, B в A) — у первого на петле родитель снимается.
  const byId = new Map(out.map((b) => [b.id, b]));
  out.forEach((b) => {
    const seen = new Set([b.id]);
    let p = b.parent;
    while (p) {
      if (seen.has(p)) { b.parent = null; break; }
      seen.add(p);
      p = byId.get(p)?.parent || null;
    }
  });
  return out;
}

/**
 * Документ, где у каждого процесса есть блок: процессу без блока (или с
 * блоком, которого больше нет) — свой новый блок с его названием.
 * Возвращает тот же объект, если чинить нечего.
 */
export function withProcBlocks(doc) {
  const concepts = normalizeConcepts(doc?.concepts);
  const procs = Array.isArray(doc?.procs) ? doc.procs : [];
  const have = new Set(concepts.map((b) => b.id));
  let changed = concepts.length !== (doc?.concepts || []).length;
  const added = [];
  const fixed = procs.map((p) => {
    if (p && p.blockId && have.has(String(p.blockId))) return p;
    changed = true;
    const b = { id: newBlockId(), name: procLabel(p), parent: null, boardId: null };
    added.push(b);
    return { ...p, blockId: b.id };
  });
  if (!changed && !added.length) return doc;
  return { ...doc, concepts: [...concepts, ...added], procs: fixed };
}

/** Дети блока — в порядке записи. */
export const childrenOf = (concepts, id) => concepts.filter((b) => (b.parent || null) === (id || null));

/** Доски, у чьих блоков есть техпроцесс: их стикеры «подходит» — «применена». */
export function appliedBoards(concepts, procs) {
  const withProc = new Set((procs || []).map((p) => p && p.blockId).filter(Boolean).map(String));
  return new Set(concepts.filter((b) => b.boardId && withProc.has(b.id)).map((b) => b.boardId));
}

/** Удалить блок: дети встают на его место (к его родителю). Процессы блока трогает вызывающий. */
export function dropBlock(concepts, id) {
  const gone = concepts.find((b) => b.id === id);
  if (!gone) return concepts;
  return concepts.filter((b) => b.id !== id)
    .map((b) => (b.parent === id ? { ...b, parent: gone.parent || null } : b));
}
