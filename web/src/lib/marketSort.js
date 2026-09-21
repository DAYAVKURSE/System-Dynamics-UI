/* ════════════════════════════════════════════════════════════════
   РЫНОК · СОРТИРОВКА И ФИЛЬТРЫ (владелец, 2026-09-21)

   «Под поиском полоска, под которой будут кнопки сортировки и
   фильтрации. Сортировка — по дате, рейтингу, количеству выполненных
   работ, количеству ресурсов (которые выставляются в фильтрах). Фильтры —
   по статусам „на рабочем месте“, „принимает заказ автоматически“ и
   количеству ресурсов: ресурсы выбираются из списка чекбоксами, и для
   каждого — диапазон. В фильтры они попадают из списка всех заказов или
   услуг, которые были найдены в этом поиске».

   Здесь только счёт над уже загруженными записями: ни сети, ни экрана.
   Рейтинг и число выполненных работ у автора считает сервер (faces).
   ════════════════════════════════════════════════════════════════ */

/* Сортировка — выпадающим списком с направлением (владелец, 2026-09-21:
   «непонятно, как происходит сортировка по дате: нет выбора от старого к
   новому или от нового к старому»). Ключ — «поле:направление». */
export const SORTS = [
  ["", "без сортировки"],
  ["date:desc", "по дате: сначала новые"],
  ["date:asc", "по дате: сначала старые"],
  ["price:desc", "по стоимости: сначала дороже"],
  ["price:asc", "по стоимости: сначала дешевле"],
  ["rating:desc", "по рейтингу: сначала выше"],
  ["rating:asc", "по рейтингу: сначала ниже"],
  ["done:desc", "по выполненным работам: сначала больше"],
  ["done:asc", "по выполненным работам: сначала меньше"],
  ["res:desc", "по ресурсам: сначала больше"],
  ["res:asc", "по ресурсам: сначала меньше"],
];

/** Пустой фильтр: ничего не отсечено. */
export const emptyFilter = () => ({ ready: false, auto: false, res: {} });

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Ресурсы записи: у заказа — что даёт, у услуги — что берёт и что выдаёт. */
export const rowsOfItem = (item = {}) => (Array.isArray(item.resources) ? item.resources
  : [...(item.takes || []), ...(item.gives || [])]);

/**
 * Какие ресурсы вообще встречаются в найденном — из них и выбирают.
 * У каждого — от и до по всем записям, чтобы диапазон было от чего
 * отсчитывать.
 */
export function resourcesIn(items = []) {
  const by = new Map();
  items.forEach((it) => rowsOfItem(it).forEach((r) => {
    const name = String(r?.name || "").trim();
    if (!name) return;
    const q = num(r.qty);
    const cur = by.get(name) || { name, min: null, max: null, count: 0 };
    cur.count += 1;
    if (q != null) {
      cur.min = cur.min == null ? q : Math.min(cur.min, q);
      cur.max = cur.max == null ? q : Math.max(cur.max, q);
    }
    by.set(name, cur);
  }));
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/** Сколько ресурсов у записи: выбранных в фильтре, а без выбора — всех. */
export function resQty(item = {}, picked = []) {
  const want = new Set((picked || []).map((n) => String(n).trim()).filter(Boolean));
  return rowsOfItem(item).reduce((s, r) => {
    const name = String(r?.name || "").trim();
    if (want.size && !want.has(name)) return s;
    const q = num(r?.qty);
    return s + (q == null ? 1 : q);
  }, 0);
}

const stamp = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : 0; };

/**
 * Порядок. Пустой ключ — как пришло (поиск и «новое сверху» уже сделали
 * своё). Дата — новое сверху; рейтинг и работы — у автора, из faces;
 * ресурсы — по числу выбранных в фильтре. Чего нет (рейтинга ещё нет) —
 * в конец.
 */
export function sortItems(items = [], key = "", { faceOf = () => ({}), picked = [] } = {}) {
  if (!key) return [...items];
  const [field, dirRaw] = String(key).split(":");
  // Прежний ключ без направления («date») читается как «сначала больше/новее».
  const dir = dirRaw === "asc" ? 1 : -1;
  const val = (it) => {
    if (field === "date") return stamp(it.at);
    if (field === "price") return num(it.price);
    if (field === "rating") return num(faceOf(it.by)?.rating);
    if (field === "done") return num(faceOf(it.by)?.done) ?? 0;
    if (field === "res") return resQty(it, picked);
    return 0;
  };
  return [...items]
    .map((it, i) => ({ it, i, v: val(it) }))
    .sort((a, b) => {
      // Чего нет (рейтинга ещё нет, цены не назвали) — в конец при любом направлении.
      if (a.v == null && b.v == null) return a.i - b.i;
      if (a.v == null) return 1;
      if (b.v == null) return -1;
      return (a.v - b.v) * dir || a.i - b.i;
    })
    .map((x) => x.it);
}

/** Имена ресурсов, отмеченных в фильтре. */
export const pickedRes = (flt = {}) => Object.keys(flt.res || {});

/** Сколько условий включено — для подписи на кнопке. */
export const activeCount = (flt = {}) => (flt.ready ? 1 : 0) + (flt.auto ? 1 : 0)
  + pickedRes(flt).length;

/**
 * Отбор. «На рабочем месте» — статус автора сейчас, считает сервер.
 * «Принимает автоматически» — у услуги её отметка, у заказа — отметка
 * выбранной им услуги. Ресурс — есть в записи и количество в диапазоне;
 * без количества в записи диапазон не проверяется.
 */
export function filterItems(items = [], flt = emptyFilter(),
  { faceOf = () => ({}), services = [] } = {}) {
  const res = flt.res || {};
  const names = Object.keys(res);
  return items.filter((it) => {
    if (flt.ready && faceOf(it.by)?.status !== "ready") return false;
    if (flt.auto) {
      const auto = it.auto === true
        || (it.serviceId != null && services.find((s) => s.id === it.serviceId)?.auto === true);
      if (!auto) return false;
    }
    for (const name of names) {
      const rows = rowsOfItem(it).filter((r) => String(r?.name || "").trim() === name);
      if (!rows.length) return false;
      const { min, max } = res[name] || {};
      const lo = num(min);
      const hi = num(max);
      const ok = rows.some((r) => {
        const q = num(r?.qty);
        if (q == null) return true;
        return (lo == null || q >= lo) && (hi == null || q <= hi);
      });
      if (!ok) return false;
    }
    return true;
  });
}
