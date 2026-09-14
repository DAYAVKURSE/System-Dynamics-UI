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
