/* ═══════════ РАЗНИЦА ВЕРСИЙ СХЕМЫ ═══════════
   Версии сценария сравниваются так же, как версии техпроцесса: что
   добавилось — в зелёной форме, что убралось — в красной. Сравниваем не
   JSON целиком, а строки-описания сущностей: перестановка полей или
   пересчитанное число не должны выглядеть правкой, а переименованный актив
   должен.

   Изменение сущности даёт пару строк — старую в «убрано», новую в
   «добавлено»: так видно, что именно поменялось, не рисуя третий цвет. */
import { diffLines } from "./docdiff.js";

const txt = (v) => String(v ?? "").trim();
const nm = (v) => (v == null || v === "" ? "" : String(v));

function portLine(p, traitName) {
  const qty = p.lo === p.hi ? nm(p.lo) : `${nm(p.lo)}–${nm(p.hi)}`;
  return `${traitName(p.trait)}${qty ? ` ${qty}` : ""}`;
}

/** Схема словами: по строке на сущность. */
export function docLines(doc = {}) {
  const traits = doc.traits || [];
  const entities = doc.entities || [];
  const traitName = (id) => traits.find((t) => t.id === id)?.l || "ресурс";
  const assetName = (id) => entities.find((e) => e.id === id)?.name || "актив";
  const out = [];
  entities.forEach((e) => out.push(`актив: ${txt(e.name)}`));
  traits.forEach((t) => out.push(`ресурс: ${txt(t.l)} — ${assetName(t.e)}`));
  (doc.funcs || []).forEach((f) => {
    const takes = (f.takes || []).map((p) => portLine(p, traitName)).join(", ") || "ничего";
    const gives = (f.gives || []).map((p) => portLine(p, traitName)).join(", ") || "ничего";
    const chain = f.chain?.name ? `${f.chain.name} · ` : "";
    out.push(`функция: ${chain}${txt(f.name)} — ${assetName(f.e)}: берёт ${takes}, выдаёт ${gives}`);
  });
  (doc.goals || []).forEach((g) => out.push(`цель: ${txt(g.name || g.title)} — ${nm(g.value ?? g.qty ?? "")}`));
  (doc.factors || []).forEach((x) => out.push(`фактор: ${txt(x.name)} — ${assetName(x.e)}`));
  (doc.procs || []).forEach((p) => {
    out.push(`процесс: ${txt(p.name) || "без названия"} — ${txt(p.status)}`);
    txt(p.text).split("\n").map((l) => l.trim()).filter(Boolean)
      .forEach((l) => out.push(`процесс «${txt(p.name) || "без названия"}»: ${l}`));
  });
  return out;
}

/** Что добавилось и что убралось между версиями схемы. */
export function diffDocs(a = {}, b = {}) {
  return diffLines(docLines(a), docLines(b));
}
