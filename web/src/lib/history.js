/* ═══════════════ ИСТОРИЯ ПРАВОК (undo/redo) ═══════════════
   Модель редактируется прямо на месте: удаление актива уносит его ресурсы,
   входящие стрелки и условия, а удаление классификации переселяет ресурсы.
   Подтверждений эти операции не спрашивают, поэтому нужен способ вернуть
   всё назад одним движением.

   Хук наблюдает за документом модели (шесть массивов состояния, собранных в
   один объект) и сам записывает шаг, когда документ изменился. Так не нужно
   оборачивать в «команду» каждую из десятков точек правки — а значит, ни одна
   из них не окажется забытой при следующей фиче. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const HISTORY_LIMIT = 50;

/* Структурное сравнение: документ модели — обычный JSON (он же уезжает в
   сценарий на диске), поэтому глубокое сравнение здесь и корректно, и дёшево.
   Нужно оно затем, что правка «поставили то же самое значение» создаёт новые
   объекты, и без сравнения история заполнялась бы пустыми шагами. */
export function sameDoc(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => sameDoc(v, b[i]));
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    Object.prototype.hasOwnProperty.call(b, k) && sameDoc(a[k], b[k]));
}

const editable = (el) => !!el && (el.isContentEditable
  || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/**
 * @param doc      объект модели; должен быть мемоизирован, иначе каждый рендер
 *                 будет выглядеть как правка.
 * @param restore  применяет снимок обратно в состояние компонента.
 */
export function useHistory(doc, restore, { limit = HISTORY_LIMIT } = {}) {
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const last = useRef(doc);      // документ, уже учтённый историей
  const applying = useRef(false); // сама отмена/возврат шагом не считается
  const holdDepth = useRef(0);    // идёт жест (перетаскивание) — шаг ещё не закрыт
  const holdBase = useRef(null);  // документ до начала жеста

  useEffect(() => {
    if (doc === last.current) return;
    const prev = last.current;
    last.current = doc;
    if (applying.current) { applying.current = false; return; }
    if (sameDoc(prev, doc)) return;
    if (holdDepth.current > 0) {
      if (holdBase.current == null) holdBase.current = prev;
      return;
    }
    setPast((p) => [...p, prev].slice(-limit));
    setFuture([]);
  }, [doc, limit]);

  /* Перетаскивание актива по схеме — десятки промежуточных состояний за
     секунду. Каждое из них в истории сделало бы отмену бесполезной, поэтому
     жест берётся в скобки hold/release и попадает в историю одним шагом. */
  const hold = useCallback(() => {
    if (holdDepth.current++ === 0) holdBase.current = last.current;
  }, []);

  const release = useCallback(() => {
    if (holdDepth.current === 0) return;
    holdDepth.current = 0;
    const prev = holdBase.current;
    holdBase.current = null;
    // Эффект для последнего движения ещё не успел отработать, поэтому берём
    // документ текущего рендера — он уже итоговый.
    last.current = doc;
    if (prev == null || sameDoc(prev, doc)) return;
    setPast((p) => [...p, prev].slice(-limit));
    setFuture([]);
  }, [doc, limit]);

  const undo = useCallback(() => {
    if (!past.length) return;
    const prev = past[past.length - 1];
    applying.current = true;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [doc, ...f].slice(0, limit));
    restore(prev);
  }, [past, doc, restore, limit]);

  const redo = useCallback(() => {
    if (!future.length) return;
    const next = future[0];
    applying.current = true;
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, doc].slice(-limit));
    restore(next);
  }, [future, doc, restore, limit]);

  const reset = useCallback(() => { setPast([]); setFuture([]); }, []);

  /* Ctrl/⌘+Z и Ctrl/⌘+Shift+Z. В поле ввода не вмешиваемся: там эти же
     сочетания отменяют набранный текст средствами браузера. */
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = (e.key || "").toLowerCase();
      if (k !== "z" && k !== "y") return;
      if (editable(e.target)) return;
      e.preventDefault();
      if (k === "y" || e.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return useMemo(() => ({
    undo, redo, reset, hold, release,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    depth: past.length,
  }), [undo, redo, reset, hold, release, past.length, future.length]);
}
