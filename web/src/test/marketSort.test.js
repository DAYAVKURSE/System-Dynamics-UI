import { describe, expect, it } from "vitest";
import {
  activeCount, emptyFilter, filterItems, resQty, resourcesIn, sortItems,
} from "../lib/marketSort.js";

/* Владелец, 2026-09-21: сортировка по дате, рейтингу, выполненным
   работам и ресурсам; фильтры по статусу, автоприёму и ресурсам с
   диапазонами, взятыми из найденного. */
const FACES = { 1: { status: "ready", rating: 8, done: 5 }, 2: { status: "off", rating: null, done: 9 },
  3: { status: "ready", rating: 9.5, done: 0 } };
const faceOf = (id) => FACES[id] || {};
const ITEMS = [
  { id: "a", by: "1", at: "2026-09-01T10:00:00Z", auto: true,
    takes: [{ name: "макет", qty: 2 }], gives: [{ name: "страница", qty: 3 }] },
  { id: "b", by: "2", at: "2026-09-03T10:00:00Z",
    takes: [{ name: "макет", qty: 1 }], gives: [] },
  { id: "c", by: "3", at: "2026-09-02T10:00:00Z", auto: false,
    takes: [], gives: [{ name: "страница", qty: null }] },
];

describe("что из найденного попадает в фильтр", () => {
  it("ресурсы — из всех найденных записей, с их от и до", () => {
    expect(resourcesIn(ITEMS)).toEqual([
      { name: "макет", min: 1, max: 2, count: 2 },
      { name: "страница", min: 3, max: 3, count: 2 },
    ]);
    expect(resourcesIn([])).toEqual([]);
  });
  it("у заказа ресурсы — то, что он даёт", () => {
    expect(resourcesIn([{ resources: [{ name: "договор", qty: 4 }] }]))
      .toEqual([{ name: "договор", min: 4, max: 4, count: 1 }]);
  });
});

describe("сортировка", () => {
  const ids = (list) => list.map((x) => x.id);
  it("пустой ключ — как пришло", () => {
    expect(ids(sortItems(ITEMS, ""))).toEqual(["a", "b", "c"]);
  });
  it("по дате — новое сверху", () => {
    expect(ids(sortItems(ITEMS, "date"))).toEqual(["b", "c", "a"]);
  });
  it("по рейтингу и по работам — у автора; без рейтинга — в конец", () => {
    expect(ids(sortItems(ITEMS, "rating", { faceOf }))).toEqual(["c", "a", "b"]);
    expect(ids(sortItems(ITEMS, "done", { faceOf }))).toEqual(["b", "a", "c"]);
  });
  it("по ресурсам — по выбранным в фильтре, а без выбора — по всем", () => {
    expect(resQty(ITEMS[0])).toBe(5);
    expect(resQty(ITEMS[0], ["макет"])).toBe(2);
    expect(resQty(ITEMS[2], ["страница"])).toBe(1);   // без числа — считается за один
    expect(ids(sortItems(ITEMS, "res", { picked: ["макет"] }))).toEqual(["a", "b", "c"]);
    expect(ids(sortItems(ITEMS, "res"))).toEqual(["a", "b", "c"]);
  });
});

describe("фильтры", () => {
  const ids = (list) => list.map((x) => x.id);
  it("пустой фильтр ничего не отсекает", () => {
    expect(ids(filterItems(ITEMS, emptyFilter(), { faceOf }))).toEqual(["a", "b", "c"]);
    expect(activeCount(emptyFilter())).toBe(0);
  });
  it("«на рабочем месте» — по статусу автора сейчас", () => {
    expect(ids(filterItems(ITEMS, { ...emptyFilter(), ready: true }, { faceOf }))).toEqual(["a", "c"]);
  });
  it("«принимает автоматически» — отметка услуги, у заказа — его услуги", () => {
    expect(ids(filterItems(ITEMS, { ...emptyFilter(), auto: true }, { faceOf }))).toEqual(["a"]);
    const orders = [{ id: "o1", by: "1", serviceId: "a", resources: [] }, { id: "o2", by: "1", resources: [] }];
    expect(ids(filterItems(orders, { ...emptyFilter(), auto: true }, { faceOf, services: ITEMS })))
      .toEqual(["o1"]);
  });
  it("ресурс — есть в записи и количество в диапазоне; без числа — проходит", () => {
    const f = (min, max) => ({ ...emptyFilter(), res: { макет: { min, max } } });
    expect(ids(filterItems(ITEMS, f("", ""), { faceOf }))).toEqual(["a", "b"]);
    expect(ids(filterItems(ITEMS, f(2, ""), { faceOf }))).toEqual(["a"]);
    expect(ids(filterItems(ITEMS, f("", 1), { faceOf }))).toEqual(["b"]);
    const p = { ...emptyFilter(), res: { страница: { min: 5, max: "" } } };
    expect(ids(filterItems(ITEMS, p, { faceOf }))).toEqual(["c"]);   // у c числа нет
    expect(activeCount(p)).toBe(1);
  });
});
