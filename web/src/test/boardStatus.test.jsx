import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import BoardView from "../components/BoardView.jsx";
import { boardServer, member } from "./boardServer.js";
import { appliedBoards, dropBlock, normalizeConcepts, withProcBlocks } from "../lib/concepts.js";

/* ════════════════════════════════════════════════════════════════
   СТАТУСЫ СТИКЕРОВ И БЛОКИ «КОНЦЕПТОВ» (владелец, 2026-09-26)

   «Стикеры на доске брейншторма могли помечаться четырьмя статусами: не
   подходит, на доработку, подходит, применена. На самом стикере это
   должно выглядеть как значок справа внизу. Но когда на него нажимаешь,
   должны раскрываться статусы с названиями… и там должно быть можно
   выбрать другой статус.»
   ════════════════════════════════════════════════════════════════ */

const B = (by) => ({
  id: "b1", name: "Идеи", color: "#1B2430", by, byName: "Иван", createdAt: "1", rev: 1,
  members: [member("100", "Иван", "#9BCB5A"), member("200", "Анна", "#4FB8A8")],
  stickers: [
    { id: "a", by: "200", text: "мысль Анны", status: null, createdAt: "1", updatedAt: "1" },
    { id: "b", by: "100", text: "моя мысль", status: "rework", createdAt: "2", updatedAt: "2" },
  ],
});
let srv;
afterEach(() => { vi.restoreAllMocks(); });

describe("значок статуса на стикере", () => {
  beforeEach(() => { srv = boardServer(B("100"), { me: "100" }); global.fetch = srv.fetch; });

  it("справа внизу у каждого стикера; нажатие раскрывает четыре статуса с названиями", async () => {
    render(<BoardView boardId="b1" />);
    const sticker = (await screen.findByText("мысль Анны")).closest("[data-sticker]");
    const badge = within(sticker).getByRole("button", { name: "статус: без статуса" });
    // Последний элемент стикера — строка со значком, прижатым вправо.
    expect(badge.parentElement.style.justifyContent).toBe("flex-end");
    expect(badge.parentElement).toBe(sticker.lastElementChild);
    fireEvent.click(badge);
    const menu = screen.getByRole("menu", { name: "статус стикера" });
    expect(within(menu).getAllByRole("menuitemradio").map((b) => b.textContent))
      .toEqual(["Не подходит", "На доработку", "Подходит", "Применена"]);
    const mine = (await screen.findByText("моя мысль")).closest("[data-sticker]");
    expect(within(mine).getByRole("button", { name: "статус: На доработку" })).toBeInTheDocument();
  });

  it("создатель доски выбирает статус — он уходит на сервер и виден у всех; тот же ещё раз — снять", async () => {
    render(<BoardView boardId="b1" />);
    const sticker = (await screen.findByText("мысль Анны")).closest("[data-sticker]");
    fireEvent.click(within(sticker).getByRole("button", { name: "статус: без статуса" }));
    fireEvent.click(within(screen.getByRole("menu", { name: "статус стикера" })).getByRole("menuitemradio", { name: "Подходит" }));
    await waitFor(() => expect(within(sticker).getByRole("button", { name: "статус: Подходит" })).toBeInTheDocument());
    expect(srv.calls.find((c) => c.path === "/api/boards/b1/stickers/a/status")).toMatchObject({
      method: "POST", body: { status: "fit" } });
    expect(screen.queryByRole("menu", { name: "статус стикера" })).toBeNull();
    fireEvent.click(within(sticker).getByRole("button", { name: "статус: Подходит" }));
    fireEvent.click(within(screen.getByRole("menu", { name: "статус стикера" })).getByRole("menuitemradio", { name: "Подходит" }));
    await waitFor(() => expect(within(sticker).getByRole("button", { name: "статус: без статуса" })).toBeInTheDocument());
  });
});

describe("не создатель", () => {
  beforeEach(() => { srv = boardServer(B("200"), { me: "100" }); global.fetch = srv.fetch; });
  it("видит статусы, но выбрать не может", async () => {
    render(<BoardView boardId="b1" />);
    const sticker = (await screen.findByText("моя мысль")).closest("[data-sticker]");
    fireEvent.click(within(sticker).getByRole("button", { name: "статус: На доработку" }));
    const items = within(screen.getByRole("menu", { name: "статус стикера" })).getAllByRole("menuitemradio");
    items.forEach((b) => expect(b).toBeDisabled());
    expect(items[1]).toHaveAttribute("aria-checked", "true");
  });
});

describe("блоки «Концептов»", () => {
  it("процесс без блока получает свой блок с тем же названием; с блоком — не трогается", () => {
    const doc = { procs: [{ id: "p1", name: "Продажи", text: "" }, { id: "p2", name: "", text: "Задача: склад" },
      { id: "p3", name: "Есть", blockId: "k1", text: "" }], concepts: [{ id: "k1", name: "Блок" }] };
    const out = withProcBlocks(doc);
    expect(out.concepts.map((b) => b.name)).toEqual(["Блок", "Продажи", "склад"]);
    expect(out.procs[0].blockId).toBe(out.concepts[1].id);
    expect(out.procs[2].blockId).toBe("k1");
    // Второй проход — ничего нового.
    expect(withProcBlocks(out)).toBe(out);
  });
  it("петли и ссылки на несуществующих родителей разрываются; удаление поднимает детей", () => {
    const c = normalizeConcepts([{ id: "a", parent: "b" }, { id: "b", parent: "a" }, { id: "c", parent: "zz" }]);
    expect(c.find((x) => x.id === "c").parent).toBeNull();
    expect(c.filter((x) => x.parent === null).length).toBeGreaterThanOrEqual(2);
    const tree = [{ id: "r", parent: null }, { id: "m", parent: "r" }, { id: "l", parent: "m" }];
    expect(dropBlock(tree, "m")).toEqual([{ id: "r", parent: null }, { id: "l", parent: "r" }]);
  });
  it("доска «с техпроцессом» — у её блока есть процесс", () => {
    const c = [{ id: "k1", boardId: "b1" }, { id: "k2", boardId: "b2" }, { id: "k3", boardId: null }];
    expect([...appliedBoards(c, [{ id: "p", blockId: "k1" }, { id: "q", blockId: "k3" }])]).toEqual(["b1"]);
  });
});
