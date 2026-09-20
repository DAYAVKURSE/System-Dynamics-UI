import { describe, expect, it } from "vitest";
import { diffHtml, diffLines, diffText, linesOf } from "../lib/docdiff.js";

/* Разница между версиями документа — по абзацам, как в git. */
describe("разница версий", () => {
  it("абзацы из HTML: теги сняты, сущности раскрыты, пустые выброшены", () => {
    expect(linesOf("<p>Первый <b>жирный</b></p><p></p><table><tr><td>ячейка &amp; ещё</td></tr></table>"))
      .toEqual(["Первый жирный", "ячейка & ещё"]);
    expect(linesOf("<p>строка<br>вторая</p>")).toEqual(["строка вторая"]);
  });
  it("добавленное и убранное — по наибольшей общей подпоследовательности", () => {
    const d = diffLines(["а", "б", "в"], ["а", "в", "г"]);
    expect(d).toEqual({ added: ["г"], removed: ["б"] });
    expect(diffLines([], ["x"])).toEqual({ added: ["x"], removed: [] });
    expect(diffLines(["x"], ["x"])).toEqual({ added: [], removed: [] });
  });
  it("замена абзаца — одно убрано, одно добавлено; подпись «+N −M»", () => {
    const d = diffHtml("<p>п. 1</p><p>п. 2 старый</p>", "<p>п. 1</p><p>п. 2 новый</p>");
    expect(d).toEqual({ added: ["п. 2 новый"], removed: ["п. 2 старый"] });
    expect(diffText(d)).toBe("+1 −1");
    expect(diffText({ added: [], removed: [] })).toBe("без изменений");
  });
});

import { changeForms, diffWords, pairChanges, similar } from "../lib/docdiff.js";

describe("изменения по словам (владелец, 2026-09-15)", () => {
  it("добавленное слово — одна зелёная форма с предложением и выделенным словом", () => {
    const forms = changeForms(["Первое предложение. Второе предложение тут. Третье."],
      ["Первое предложение. Второе новое предложение тут. Третье."]);
    expect(forms).toHaveLength(1);
    expect(forms[0].sign).toBe("+");
    expect(forms[0].parts.map((p) => p.text).join(" ")).toBe("Второе новое предложение тут.");
    expect(forms[0].parts.filter((p) => p.hl).map((p) => p.text)).toEqual(["новое"]);
  });
  /* ЗАМЕНА — ЖЁЛТАЯ ФОРМА (владелец, 2026-09-20): «если текст добавлен —
     зелёная, убран — красная, заменён — жёлтая». Слова, вставшие на место
     старых, — одна правка одного места, и в форме видно и было, и стало. */
  it("замена слова — одна жёлтая форма: старые слова и новые рядом", () => {
    const forms = changeForms(["Срок — три дня. Цена договорная."], ["Срок — пять дней. Цена договорная."]);
    expect(forms.map((f) => f.sign)).toEqual(["±"]);
    expect(forms[0].parts.filter((p) => p.t === "del").map((p) => p.text)).toEqual(["три", "дня."]);
    expect(forms[0].parts.filter((p) => p.t === "add").map((p) => p.text)).toEqual(["пять", "дней."]);
    // Цела и неизменная часть предложения — иначе правку не к чему отнести.
    expect(forms[0].parts.filter((p) => !p.hl).map((p) => p.text)).toEqual(["Срок", "—"]);
  });

  it("добавление и удаление порознь — по своей форме; убранный абзац — красная целиком", () => {
    /* Добавили в начале, убрали в конце: места разные, и форм две. */
    const forms = changeForms(["бета гамма дельта"], ["новое бета гамма"]);
    expect(forms.map((f) => f.sign)).toEqual(["+", "-"]);
    expect(forms[0].parts.filter((p) => p.hl).map((p) => p.text)).toEqual(["новое"]);
    expect(forms[1].parts.filter((p) => p.hl).map((p) => p.text)).toEqual(["дельта"]);
    const gone = changeForms(["Пункт первый.", "Пункт второй."], ["Пункт первый."]);
    expect(gone).toEqual([{ sign: "-",
      parts: [{ text: "Пункт", hl: true, t: "del" }, { text: "второй.", hl: true, t: "del" }] }]);
  });

  it("«±N» в подписи — только когда есть замены", () => {
    expect(diffText({ added: ["a"], removed: ["b"], changed: [{ from: "x", to: "y" }] })).toBe("+1 ±1 −1");
    expect(diffText({ added: ["a"], removed: [], changed: [] })).toBe("+1 −0");
    expect(diffText({ added: [], removed: [], changed: [{ from: "x", to: "y" }] })).toBe("+0 ±1 −0");
  });
  it("похожесть — не меньше половины общих слов; по словам — LCS", () => {
    expect(similar("один два три четыре", "один два три пять")).toBe(true);
    expect(similar("один два", "три четыре пять шесть")).toBe(false);
    expect(diffWords("а б в", "а в г").map((x) => `${x.t}:${x.w}`)).toEqual(["same:а", "del:б", "same:в", "add:г"]);
  });
});

/* Пары «было → стало» для построчных сравнений (схема, техпроцесс). */
describe("пары замен", () => {
  it("похожие строки становятся парой, непохожие остаются порознь", () => {
    const d = pairChanges(["цена за метр сто рублей", "совсем чужая строка"],
      ["цена за метр двести рублей", "ничего общего тут нет"]);
    expect(d.changed).toEqual([{ from: "цена за метр сто рублей", to: "цена за метр двести рублей" }]);
    expect(d.removed).toEqual(["совсем чужая строка"]);
    expect(d.added).toEqual(["ничего общего тут нет"]);
  });

  it("одно добавленное не уходит в две пары", () => {
    const d = pairChanges(["цена сто рублей", "цена двести рублей"], ["цена триста рублей"]);
    expect(d.changed).toHaveLength(1);
    expect(d.removed).toHaveLength(1);
    expect(d.added).toEqual([]);
  });
});
