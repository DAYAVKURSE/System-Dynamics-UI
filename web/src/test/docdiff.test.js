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

import { changeForms, diffWords, similar } from "../lib/docdiff.js";

describe("изменения по словам (владелец, 2026-09-15)", () => {
  it("добавленное слово — одна зелёная форма с предложением и выделенным словом", () => {
    const forms = changeForms(["Первое предложение. Второе предложение тут. Третье."],
      ["Первое предложение. Второе новое предложение тут. Третье."]);
    expect(forms).toHaveLength(1);
    expect(forms[0].sign).toBe("+");
    expect(forms[0].parts.map((p) => p.text).join(" ")).toBe("Второе новое предложение тут.");
    expect(forms[0].parts.filter((p) => p.hl).map((p) => p.text)).toEqual(["новое"]);
  });
  it("замена слова — зелёная и красная формы; убранный абзац — красная целиком", () => {
    const forms = changeForms(["Срок — три дня. Цена договорная."], ["Срок — пять дней. Цена договорная."]);
    expect(forms.map((f) => f.sign)).toEqual(["+", "-"]);
    expect(forms[0].parts.filter((p) => p.hl).map((p) => p.text)).toEqual(["пять", "дней."]);
    expect(forms[1].parts.filter((p) => p.hl).map((p) => p.text)).toEqual(["три", "дня."]);
    const gone = changeForms(["Пункт первый.", "Пункт второй."], ["Пункт первый."]);
    expect(gone).toEqual([{ sign: "-", parts: [{ text: "Пункт", hl: true }, { text: "второй.", hl: true }] }]);
  });
  it("похожесть — не меньше половины общих слов; по словам — LCS", () => {
    expect(similar("один два три четыре", "один два три пять")).toBe(true);
    expect(similar("один два", "три четыре пять шесть")).toBe(false);
    expect(diffWords("а б в", "а в г").map((x) => `${x.t}:${x.w}`)).toEqual(["same:а", "del:б", "same:в", "add:г"]);
  });
});
