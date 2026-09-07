import { describe, expect, it } from "vitest";
import { BLOCK_H, BLOCK_W, CELL, COLS, ZOOM_MAX, ZOOM_MIN, addArrow, addNote, addPoint, addQa,
  blocksOf, derivedKeys, dropBlock, dropPoint, edgePoint, emptySpace, filesOf, fitView,
  keyOf, moveBlock, movePoint, newNote, normalizeSpace, parseKey, pathFrom, pathOf, placeNew,
  posOf, routeOf, toWorld, updateNote, zoomView } from "../lib/space.js";

const TASKS = [
  { id: "t1", title: "Сбор заявок", status: "progress", assignee: "2" },
  { id: "t2", title: "Непоставленная", status: "wait" },
];
const FILES = [{ id: "f1", name: "макет.pdf", type: "application/pdf", url: "/api/reports/u/f1", from: "task", taskId: "t1" }];
const MEMORY = [{ id: "m1", title: "Регламент", text: "Как мы сдаём работу" }];
const MODEL = { tasks: TASKS, files: FILES, memory: MEMORY };

describe("normalizeSpace — чужая запись достраивается, а не отвергается", () => {
  it("из пустоты — пустое пространство с видом по умолчанию", () => {
    expect(normalizeSpace(null)).toEqual({ notes: [], pos: {}, qa: {}, hidden: [], arrows: [],
      view: { x: 0, y: 0, zoom: 1 } });
    expect(normalizeSpace("мусор")).toEqual(emptySpace());
  });

  it("заметка получает все поля, id сохраняется", () => {
    const s = normalizeSpace({ notes: [{ id: "n1", title: 5 }, { x: "12", y: null }] });
    expect(s.notes[0]).toEqual({ id: "n1", x: 0, y: 0, title: "5", text: "", file: null, qa: [] });
    expect(s.notes[1].x).toBe(12);
    expect(s.notes[1].id).toBeTruthy();
  });

  it("битые стрелки выбрасываются: без концов или из блока в него же", () => {
    const s = normalizeSpace({ arrows: [
      { id: "a1", from: "note:n1", to: "task:t1", points: [{ x: "3", y: 4 }, "мусор"] },
      { id: "a2", from: "note:n1" },
      { id: "a3", from: "task:t1", to: "task:t1" },
    ] });
    expect(s.arrows.map((a) => a.id)).toEqual(["a1"]);
    // Точка-мусор выбрасывается, а не превращается в точку в начале координат.
    expect(s.arrows[0].points).toEqual([{ x: 3, y: 4 }]);
    expect(s.arrows[0].at).toBeNull();
  });

  it("null и мусор внутри списков не роняют достройку — сломанный элемент выбрасывается", () => {
    /* Запись лежит файлом на сервере, и правили её не только мы: null в
       списке доезжает до достройки, а параметр по умолчанию `= {}` на
       null не срабатывает. Падение здесь роняло загрузку модели. */
    expect(normalizeSpace({ notes: [null, 7, { id: "n1" }] }).notes.map((n) => n.id)).toEqual(["n1"]);
    expect(normalizeSpace({ arrows: [null, { id: "a1", from: "note:n1", to: "task:t1", points: [null, { x: 1 }] }] })
      .arrows[0].points).toEqual([{ x: 1, y: 0 }]);
    expect(normalizeSpace({ notes: [{ id: "n1", qa: [null, { q: "?" }] }] }).notes[0].qa)
      .toEqual([{ q: "?", a: "", at: "" }]);
    expect(normalizeSpace({ qa: { k: [null] }, pos: null, hidden: null, view: null }))
      .toEqual(emptySpace());
    expect(normalizeSpace({ arrows: [{ from: "a", to: "b", points: null, at: 5 }] }).arrows[0])
      .toMatchObject({ points: [], at: null });
  });

  it("положения, ответы и скрытые — только осмысленные", () => {
    const s = normalizeSpace({
      pos: { "task:t1": { x: 1, y: 2 }, "file:f1": "нет" },
      qa: { "task:t1": [{ q: "что?", a: "то" }, {}], "file:f1": [] },
      hidden: ["memory:m1", "memory:m1", 7, ""],
      view: { x: "10", zoom: 99 },
    });
    expect(s.pos).toEqual({ "task:t1": { x: 1, y: 2 } });
    expect(s.qa).toEqual({ "task:t1": [{ q: "что?", a: "то", at: "" }] });
    expect(s.hidden).toEqual(["memory:m1", "7"]);
    expect(s.view).toEqual({ x: 10, y: 0, zoom: ZOOM_MAX });
    expect(normalizeSpace({ view: { zoom: 0 } }).view.zoom).toBe(1);
    expect(normalizeSpace({ view: { zoom: 0.01 } }).view.zoom).toBe(ZOOM_MIN);
  });

  it("достройка достроенного ничего не меняет", () => {
    const s = normalizeSpace({ notes: [{ id: "n1", title: "а" }], arrows: [{ id: "a1", from: "note:n1", to: "task:t1" }] });
    expect(normalizeSpace(s)).toEqual(s);
  });
});

describe("заметки", () => {
  it("новая заметка пуста: название пишет человек", () => {
    const n = newNote(10, 20);
    expect(n).toMatchObject({ x: 10, y: 20, title: "", text: "", file: null, qa: [] });
    expect(n.id).toBeTruthy();
    expect(newNote().id).not.toBe(n.id);
  });

  it("добавляется, правится и двигается по своему id", () => {
    let s = addNote(emptySpace(), newNote(1, 1));
    const id = s.notes[0].id;
    s = updateNote(s, id, { title: "Идея" });
    s = moveBlock(s, keyOf("note", id), { x: 50, y: 60 });
    expect(s.notes[0]).toMatchObject({ title: "Идея", x: 50, y: 60 });
    expect(posOf(s, keyOf("note", id))).toEqual({ x: 50, y: 60 });
  });

  it("ключ блока разбирается обратно", () => {
    expect(parseKey("task:tk:1")).toEqual({ kind: "task", id: "tk:1" });
    expect(parseKey("")).toEqual({ kind: "", id: "" });
  });
});

describe("производные блоки и автораскладка", () => {
  it("ключи — задачи без непоставленных, файлы, память", () => {
    expect(derivedKeys(MODEL)).toEqual(["task:t1", "file:f1", "memory:m1"]);
  });

  it("новые блоки ложатся сеткой, не наезжая на занятые клетки", () => {
    const s0 = { ...emptySpace(), notes: [{ ...newNote(0, 0), id: "n1" }] };
    const s = placeNew(s0, derivedKeys(MODEL));
    // Клетка (0,0) занята заметкой — первая задача уходит в следующую.
    expect(s.pos["task:t1"]).toEqual({ x: CELL.w, y: 0 });
    expect(s.pos["file:f1"]).toEqual({ x: 2 * CELL.w, y: 0 });
    expect(s.pos["memory:m1"]).toEqual({ x: 3 * CELL.w, y: 0 });
    // Второй ряд — когда колонки кончились.
    const more = placeNew(s, ["task:x"]);
    expect(more.pos["task:x"]).toEqual({ x: 0, y: CELL.h });
    expect(COLS).toBe(4);
  });

  it("класть нечего — та же запись, чтобы не писать пустую правку", () => {
    const s = placeNew(emptySpace(), derivedKeys(MODEL));
    expect(placeNew(s, derivedKeys(MODEL))).toBe(s);
    const hidden = { ...emptySpace(), hidden: ["task:t1"] };
    expect(placeNew(hidden, ["task:t1"])).toBe(hidden);
  });

  it("blocksOf собирает все виды с положением и содержимым из модели", () => {
    const s = addNote(emptySpace(), { ...newNote(5, 5), id: "n1", title: "Идея" });
    const bs = blocksOf(s, MODEL);
    expect(bs.map((b) => b.key)).toEqual(["note:n1", "task:t1", "file:f1", "memory:m1"]);
    expect(bs[1]).toMatchObject({ kind: "task", task: TASKS[0], x: CELL.w, y: 0, qa: [] });
    expect(bs[2].file.name).toBe("макет.pdf");
    expect(bs[3].item.title).toBe("Регламент");
    // Спрятанный с пространства производный блок не показывается.
    expect(blocksOf(dropBlock(s, "task:t1"), MODEL).map((b) => b.key))
      .toEqual(["note:n1", "file:f1", "memory:m1"]);
  });
});

describe("удаление блока", () => {
  const base = () => {
    let s = addNote(emptySpace(), { ...newNote(0, 0), id: "n1" });
    s = placeNew(s, derivedKeys(MODEL));
    s = addArrow(s, "note:n1", "task:t1", { x: CELL.w + 10, y: 10 });
    s = addArrow(s, "task:t1", "file:f1");
    s = addQa(s, "task:t1", { q: "?", a: "!" });
    return s;
  };

  it("заметка удаляется совсем вместе со стрелками", () => {
    const s = dropBlock(base(), "note:n1");
    expect(s.notes).toEqual([]);
    expect(s.arrows.map((a) => a.from)).toEqual(["task:t1"]);
    expect(s.hidden).toEqual([]);
  });

  it("производный блок только прячется: положение и ответы уходят, задача — нет", () => {
    const s = dropBlock(base(), "task:t1");
    expect(s.hidden).toEqual(["task:t1"]);
    expect(s.pos["task:t1"]).toBeUndefined();
    expect(s.qa["task:t1"]).toBeUndefined();
    expect(s.arrows).toEqual([]);
    expect(dropBlock(s, "task:t1").hidden).toEqual(["task:t1"]);
  });
});

describe("вопросы помощнику записываются в блок", () => {
  it("у заметки — в неё, у производного — рядом с положением", () => {
    let s = addNote(emptySpace(), { ...newNote(0, 0), id: "n1" });
    s = addQa(s, "note:n1", { q: "зачем?", a: "затем", at: "2026-09-07T10:00:00Z" });
    s = addQa(s, "task:t1", { q: "когда?", a: "завтра" });
    s = addQa(s, "task:t1", { q: "кто?", a: "Иван" });
    expect(s.notes[0].qa).toEqual([{ q: "зачем?", a: "затем", at: "2026-09-07T10:00:00Z" }]);
    expect(s.qa["task:t1"].map((x) => x.q)).toEqual(["когда?", "кто?"]);
  });
});

describe("стрелки", () => {
  const two = () => placeNew(emptySpace(), ["task:t1", "file:f1"]);

  it("точка касания хранится смещением внутри второго блока", () => {
    const s = addArrow(two(), "task:t1", "file:f1", { x: CELL.w + 30, y: 40 }, [{ x: 100, y: 200 }]);
    expect(s.arrows).toHaveLength(1);
    expect(s.arrows[0]).toMatchObject({ from: "task:t1", to: "file:f1", at: { dx: 30, dy: 40 },
      points: [{ x: 100, y: 200 }] });
  });

  it("без касания или в себя стрелки нет", () => {
    const s = two();
    expect(addArrow(s, "task:t1", "task:t1", { x: 0, y: 0 })).toBe(s);
    expect(addArrow(s, "", "file:f1")).toBe(s);
    expect(addArrow(s, "task:t1", "file:f1").arrows[0].at).toBeNull();
  });

  it("точки добавляются, двигаются и снимаются", () => {
    let s = addArrow(two(), "task:t1", "file:f1");
    const id = s.arrows[0].id;
    s = addPoint(s, id, { x: 10, y: 10 });
    s = addPoint(s, id, { x: 20, y: 20 });
    s = movePoint(s, id, 0, { x: 15, y: 16 });
    expect(s.arrows[0].points).toEqual([{ x: 15, y: 16 }, { x: 20, y: 20 }]);
    s = dropPoint(s, id, 0);
    expect(s.arrows[0].points).toEqual([{ x: 20, y: 20 }]);
    expect(dropPoint(s, "нет такой", 0)).toEqual(s);
  });
});

describe("путь стрелки", () => {
  const A = { key: "a", x: 0, y: 0, w: 100, h: 50 };
  const B = { key: "b", x: 300, y: 0, w: 100, h: 50 };

  it("выход из границы: отрезок из центра наружу режется по прямоугольнику", () => {
    expect(edgePoint({ x: 0, y: 0, w: 100, h: 50 }, { x: 50, y: 25 }, { x: 250, y: 25 }))
      .toEqual({ x: 100, y: 25 });
    expect(edgePoint({ x: 0, y: 0, w: 100, h: 50 }, { x: 50, y: 25 }, { x: 50, y: -100 }))
      .toEqual({ x: 50, y: 0 });
    // Вторая точка тоже внутри — остаётся она.
    expect(edgePoint({ x: 0, y: 0, w: 100, h: 50 }, { x: 50, y: 25 }, { x: 60, y: 25 }))
      .toEqual({ x: 60, y: 25 });
  });

  it("без точек — прямая от границы до границы", () => {
    const d = pathOf({ from: "a", to: "b", points: [], at: null }, [A, B]);
    expect(d).toBe("M 100 25 L 300 25");
  });

  it("точка касания на втором блоке — стрелка входит там, где ткнули", () => {
    const r = routeOf({ from: "a", to: "b", points: [], at: { dx: 50, dy: 40 } }, [A, B]);
    // Целится в (350,40), входит в левую грань блока B.
    expect(r[r.length - 1].x).toBe(300);
    expect(r[r.length - 1].y).toBeGreaterThan(25);
    expect(r[r.length - 1].y).toBeLessThan(40);
  });

  it("на точке перегиба угол скруглён кривой, между точками — прямые", () => {
    const d = pathOf({ from: "a", to: "b", points: [{ x: 200, y: 200 }], at: null }, [A, B]);
    expect(d.startsWith("M ")).toBe(true);
    // Из A выходит через нижнюю грань, в B входит через нижнюю (y = 50).
    expect(d).toMatch(/^M [\d.]+ 50 L [\d.]+ [\d.]+ Q 200 200 [\d.]+ [\d.]+ L [\d.]+ 50$/);
    // Кривая одна — на единственной точке.
    expect(d.match(/Q/g)).toHaveLength(1);
  });

  it("радиус не больше половины короткого отрезка — дуги не наезжают", () => {
    const d = pathFrom([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 100, y: 10 }]);
    expect(d).toBe("M 0 0 L 5 0 Q 10 0 10 5 L 10 5 Q 10 10 15 10 L 100 10");
  });

  it("нет блока — нет пути; размеры по умолчанию, если не измерены", () => {
    expect(pathOf({ from: "a", to: "x", points: [] }, [A, B])).toBe("");
    const d = pathOf({ from: "a", to: "b", points: [] }, [{ key: "a", x: 0, y: 0 }, { key: "b", x: 500, y: 0 }]);
    expect(d).toBe(`M ${BLOCK_W} ${BLOCK_H / 2} L 500 ${BLOCK_H / 2}`);
  });
});

describe("вид: сдвиг и масштаб", () => {
  it("масштаб вокруг точки оставляет её на месте", () => {
    const v = { x: 10, y: 20, zoom: 1 };
    const around = { x: 100, y: 100 };
    const w = toWorld(v, around);
    const v2 = zoomView(v, 2, around);
    expect(v2.zoom).toBe(2);
    expect(toWorld(v2, around)).toEqual(w);
    expect(zoomView(v, 1000, around).zoom).toBe(ZOOM_MAX);
    expect(zoomView(v, 0.0001, around).zoom).toBe(ZOOM_MIN);
  });

  it("«по размеру» показывает все блоки и не увеличивает мелкое", () => {
    const blocks = [{ key: "a", x: 0, y: 0, w: 100, h: 100 }, { key: "b", x: 1900, y: 0, w: 100, h: 100 }];
    const v = fitView(blocks, { width: 1000, height: 500 }, 0);
    expect(v.zoom).toBeCloseTo(0.5);
    expect(v.x).toBeCloseTo(0);
    expect(fitView([{ key: "a", x: 0, y: 0, w: 10, h: 10 }], { width: 1000, height: 500 }).zoom).toBe(1);
    expect(fitView([], { width: 1000, height: 500 })).toEqual({ x: 24, y: 24, zoom: 1 });
  });
});

describe("filesOf — файлы собираются из сдач и разделов отчёта", () => {
  it("результаты по ресурсам, отчёт о работе и файл раздела; без повторов", () => {
    const tasks = [{ id: "t1", submissions: [
      { id: "s1", files: { tr1: { id: "r1", name: "макет.pdf", type: "application/pdf", url: "/u/r1" } },
        file: { name: "отчёт.txt", type: "text/plain", data: "data:text/plain;base64,eA==" } },
      { id: "s2", files: { tr1: { id: "r1", name: "макет.pdf", url: "/u/r1" } }, file: null },
    ] }];
    const reports = [{ id: "rp1", file: { id: "tz", name: "ТЗ.docx", url: "/u/tz" } }, { id: "rp2", file: null }];
    const out = filesOf({ tasks, reports });
    expect(out).toEqual([
      { id: "r1", name: "макет.pdf", type: "application/pdf", url: "/u/r1", from: "task", taskId: "t1" },
      { id: "s1~report", name: "отчёт.txt", type: "text/plain", url: "data:text/plain;base64,eA==", from: "task", taskId: "t1" },
      { id: "tz", name: "ТЗ.docx", type: "", url: "/u/tz", from: "report" },
    ]);
    expect(filesOf()).toEqual([]);
  });
});
