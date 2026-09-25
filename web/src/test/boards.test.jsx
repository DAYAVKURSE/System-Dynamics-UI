import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import BoardView from "../components/BoardView.jsx";
import { inkOn, initials } from "../boardColors.js";
import {
  boardFromLocation, createBoard, getBoard, listBoards, setStickerText,
} from "../boards.js";
import { boardServer, member } from "./boardServer.js";

/* ════════════════════════════════════════════════════════════════
   БРЕЙНШТОРМ-ДОСКА (владелец, 2026-09-25)

   «Все участники могли открыть и видели одно и то же на ней. Когда
   кто-то что-то пишет, что-то добавляет, неважно, любое действие должно
   отображаться у всех одинаково.» Здесь — то, что видит один из них:
   доска приходит с сервера и обновляется длинным опросом, свой текст не
   перезатирается входящим состоянием, стикеры — цвета автора, участниками
   управляет только создатель и только после предупреждения.
   ════════════════════════════════════════════════════════════════ */

const ME = "100";
const BOARD = {
  id: "b1", name: "Идеи на квартал", color: "#1B2430", by: ME, byName: "Иван Петров",
  createdAt: "2026-09-25", rev: 1,
  members: [
    member(ME, "Иван Петров", "#9BCB5A", { registered: true }),
    member("200", "Ольга", "#1F6E78", { avatar: "/api/boards/b1/avatar/200?v=ab", registered: true }),
    member("300", "maria", "#4B4FC4"),
  ],
  stickers: [
    { id: "a", by: ME, text: "Моё", createdAt: "1", updatedAt: "1" },
    { id: "b", by: "200", text: "Её мысль", createdAt: "2", updatedAt: "2" },
  ],
};

let srv;
const setUrl = (search) => {
  delete window.location;
  window.location = new URL(`https://example.test/${search}`);
};
beforeEach(() => {
  srv = boardServer(BOARD, { me: ME });
  global.fetch = srv.fetch;
  window.Telegram = { WebApp: { initData: "signed", initDataUnsafe: { user: { id: 100 } } } };
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete window.Telegram;
  sessionStorage.clear();
  setUrl("");
});

const stickerOf = (text) => screen.getByText(text).closest("[data-sticker]");

describe("цвета", () => {
  it("буквы и текст — чёрные или белые, что контрастнее цвета участника", () => {
    expect(inkOn("#9BCB5A")).toBe("#111111");     // салатный — светлый
    expect(inkOn("#D8C08E")).toBe("#111111");     // песок
    expect(inkOn("#1F6E78")).toBe("#FFFFFF");     // петроль — тёмный
    expect(inkOn("#4B4FC4")).toBe("#FFFFFF");     // индиго
    expect(inkOn("#5E3A6E")).toBe("#FFFFFF");     // баклажан
    expect(inkOn("не цвет")).toBe("#FFFFFF");
  });

  it("вместо лица — две первые буквы имени, первая заглавная", () => {
    expect(initials("ольга")).toBe("Ол");
    expect(initials("Иван Петров")).toBe("Ив");
    expect(initials("@maria_k")).toBe("Ma");
    expect(initials("Я")).toBe("Я");
    expect(initials("")).toBe("?");
  });
});

describe("клиент", () => {
  it("список и создание — с заголовками основного приложения, доска — только с подписью", async () => {
    sessionStorage.setItem("sd_storage", "st1");
    sessionStorage.setItem("sd_act_as", "v1");
    await listBoards();
    await createBoard("Новая");
    await getBoard("b1");
    const [list, create, board] = srv.calls;
    expect(list.headers["X-Telegram-Init-Data"]).toBe("signed");
    expect(list.headers["X-Storage"]).toBe("st1");
    expect(list.headers["X-Act-As"]).toBe("v1");
    expect(create.method).toBe("POST");
    expect(create.body).toEqual({ name: "Новая" });
    expect(create.headers["X-Storage"]).toBe("st1");
    expect(board.headers["X-Telegram-Init-Data"]).toBe("signed");
    expect(board.headers["X-Storage"]).toBeUndefined();
    expect(board.headers["X-Act-As"]).toBeUndefined();
  });

  it("длинный опрос — с rev того, что на экране", async () => {
    const out = await getBoard("b1");
    expect(out.board.rev).toBe(1);
    expect(srv.calls[0].search).toBe("");
    const ctl = new AbortController();
    const waiting = getBoard("b1", 1, ctl.signal);
    await waitFor(() => expect(srv.waiting()).toBe(1));
    expect(srv.calls[1].search).toBe("?rev=1");
    ctl.abort();
    await expect(waiting).rejects.toThrow();
  });

  it("отказ сервера — ошибка с его словами, статусом и признаками блока и удаления", async () => {
    srv.refuse(403, { error: "Вы были заблокированы.", blocked: true });
    const e = await getBoard("b1").catch((x) => x);
    expect(e.message).toBe("Вы были заблокированы.");
    expect(e.status).toBe(403);
    expect(e.blocked).toBe(true);
    expect(e.removed).toBe(false);
    const e2 = await setStickerText("b1", "a", "x").catch((x) => x);
    expect(e2.blocked).toBe(true);
  });

  it("доска из startapp=board_…, из ?board= и из фрагмента адреса", () => {
    setUrl("");
    window.Telegram.WebApp.initDataUnsafe.start_param = "board_xyz";
    expect(boardFromLocation()).toBe("xyz");
    window.Telegram.WebApp.initDataUnsafe.start_param = "call_m1";
    expect(boardFromLocation()).toBeNull();
    setUrl("board?board=q1");
    expect(boardFromLocation()).toBe("q1");
    setUrl("call#tgWebAppData=x&tgWebAppStartParam=board_h1");
    expect(boardFromLocation()).toBe("h1");
  });
});

describe("доска", () => {
  it("название, участники, плашка создателя и стикеры цвета авторов", async () => {
    render(<BoardView boardId="b1" />);
    expect(await screen.findByText("Идеи на квартал")).toBeInTheDocument();
    // Плашка с именем создателя — справа вверху.
    expect(screen.getByRole("note", { name: "создатель доски: Иван Петров" })).toBeInTheDocument();
    // Участники: у зарегистрированного с картинкой — картинка, у прочих — две буквы.
    const olga = screen.getByRole("button", { name: "участник: Ольга" });
    expect(olga.querySelector("img").getAttribute("src")).toBe("/api/boards/b1/avatar/200?v=ab");
    const maria = screen.getByRole("button", { name: "участник: maria" });
    expect(maria).toHaveTextContent("Ma");
    expect(maria.querySelector("img")).toBeNull();
    // Подложка букв — цвет участника, буквы — контрастные к нему.
    expect(maria.style.background).toBe("rgb(75, 79, 196)");
    expect(maria.style.color).toBe("rgb(255, 255, 255)");
    // Полоска цвета участника — под каждой аватаркой.
    const strip = screen.getByRole("group", { name: "участники доски" });
    expect([...strip.querySelectorAll("[data-stripe]")].map((s) => s.dataset.stripe))
      .toEqual(["#9BCB5A", "#1F6E78", "#4B4FC4"]);
    // Свой стикер — поле ввода, чужой — просто текст.
    const mine = screen.getByDisplayValue("Моё").closest("[data-sticker]");
    expect(mine.style.background).toBe("rgb(155, 203, 90)");
    expect(mine.style.color).toBe("rgb(17, 17, 17)");
    expect(within(mine).getByText("Иван Петров")).toBeInTheDocument();
    const hers = stickerOf("Её мысль");
    expect(hers.style.background).toBe("rgb(31, 110, 120)");
    expect(hers.style.color).toBe("rgb(255, 255, 255)");
    expect(within(hers).queryByRole("textbox")).toBeNull();
    expect(within(hers).queryByRole("button", { name: "удалить стикер" })).toBeNull();
  });

  it("чужое действие доезжает само: длинный опрос", async () => {
    render(<BoardView boardId="b1" />);
    await screen.findByText("Её мысль");
    await waitFor(() => expect(srv.waiting()).toBe(1));
    act(() => { srv.bump((b) => { b.stickers[1].text = "Её мысль, дописанная"; }); });
    expect(await screen.findByText("Её мысль, дописанная")).toBeInTheDocument();
    act(() => {
      srv.bump((b) => { b.stickers.push({ id: "c", by: "300", text: "Третья", createdAt: "3", updatedAt: "3" }); });
    });
    const third = await screen.findByText("Третья");
    // Новый — последним: справа от предыдущих.
    const all = [...document.querySelectorAll("[data-sticker]")].map((s) => s.dataset.sticker);
    expect(all).toEqual(["a", "b", "c"]);
    expect(third.closest("[data-sticker]").style.background).toBe("rgb(75, 79, 196)");
  });

  it("свой текст виден сразу, уходит с задержкой и не перезатирается входящим", async () => {
    render(<BoardView boardId="b1" />);
    const box = await screen.findByDisplayValue("Моё");
    fireEvent.change(box, { target: { value: "Моё новое" } });
    expect(box.value).toBe("Моё новое");
    // Пока задержка не вышла — на сервер ничего.
    expect(srv.calls.some((c) => c.method === "PATCH")).toBe(false);
    // Приходит чужое изменение, а в нём у моего стикера — старый текст.
    act(() => { srv.bump((b) => { b.stickers[1].text = "другое"; }); });
    await screen.findByText("другое");
    expect(box.value).toBe("Моё новое");
    await waitFor(() => expect(srv.calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = srv.calls.find((c) => c.method === "PATCH");
    expect(patch.path).toBe("/api/boards/b1/stickers/a");
    expect(patch.body).toEqual({ text: "Моё новое" });
    await waitFor(() => expect(srv.board().stickers[0].text).toBe("Моё новое"));
    expect(box.value).toBe("Моё новое");
  });

  it("быстрый набор — один запрос с последним текстом", async () => {
    render(<BoardView boardId="b1" />);
    const box = await screen.findByDisplayValue("Моё");
    for (const v of ["М", "Мо", "Мов", "Мовы"]) fireEvent.change(box, { target: { value: v } });
    await waitFor(() => expect(srv.board().stickers[0].text).toBe("Мовы"));
    expect(srv.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("сеть моргнула на сохранении — текст уходит повтором, а не пропадает", async () => {
    render(<BoardView boardId="b1" />);
    const box = await screen.findByDisplayValue("Моё");
    const real = srv.fetch;
    let failed = 0;
    global.fetch = vi.fn(async (url, opts = {}) => {
      if (opts.method === "PATCH" && !failed) { failed += 1; throw new TypeError("Failed to fetch"); }
      return real(url, opts);
    });
    fireEvent.change(box, { target: { value: "дошло" } });
    await waitFor(() => expect(srv.board().stickers[0].text).toBe("дошло"), { timeout: 4000 });
    expect(failed).toBe(1);
    expect(box.value).toBe("дошло");
  });

  /* Текст, напечатанный, пока предыдущий PATCH был в пути, не теряется
     ни при смене доски, ни при уходе: он уходит вдогонку — следом за
     запросом в пути, а не наперегонки с ним. */
  it("PATCH в пути, допечатали, сменили доску — на сервере последний текст", async () => {
    srv.addBoard({ ...BOARD, id: "b2", name: "Другая", stickers: [] });
    const real = srv.fetch;
    let release;
    const held = new Promise((r) => { release = r; });
    let first = true;
    global.fetch = vi.fn(async (url, opts = {}) => {
      if (opts.method === "PATCH" && first) { first = false; await held; }
      return real(url, opts);
    });
    const { rerender } = render(<BoardView boardId="b1" />);
    const box = await screen.findByDisplayValue("Моё");
    fireEvent.change(box, { target: { value: "Моё раз" } });
    await waitFor(() => expect(global.fetch.mock.calls.some(([, o]) => o?.method === "PATCH")).toBe(true));
    // Первый PATCH висит; допечатали — и задержка тоже вышла.
    fireEvent.change(box, { target: { value: "Моё раз два" } });
    await new Promise((r) => setTimeout(r, 400));
    rerender(<BoardView boardId="b2" />);
    await screen.findByText("Другая");
    release();
    await waitFor(() => expect(srv.board("b1").stickers[0].text).toBe("Моё раз два"));
    // Старый текст не доехал последним.
    const patches = srv.calls.filter((c) => c.method === "PATCH" && c.path === "/api/boards/b1/stickers/a");
    expect(patches.at(-1).body).toEqual({ text: "Моё раз два" });
  });

  it("окно свернули или закрыли — набранное уходит сразу и с keepalive", async () => {
    render(<BoardView boardId="b1" />);
    const box = await screen.findByDisplayValue("Моё");
    fireEvent.change(box, { target: { value: "перед закрытием" } });
    expect(srv.calls.some((c) => c.method === "PATCH")).toBe(false);
    window.dispatchEvent(new Event("pagehide"));
    const patch = srv.fetch.mock.calls.find(([, o]) => o?.method === "PATCH");
    expect(patch).toBeTruthy();
    expect(patch[1].keepalive).toBe(true);
    await waitFor(() => expect(srv.board().stickers[0].text).toBe("перед закрытием"));
    // Задержка вышла позже — второго запроса нет: отправлять уже нечего.
    await new Promise((r) => setTimeout(r, 400));
    expect(srv.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  /* Сервер упал и поднялся без последней записи: его rev меньше того,
     что на экране. Верим серверу — иначе опрос крутился бы без пауз, а
     доска на экране застыла бы. */
  it("rev сервера ушёл назад — на экране его состояние, опрос ждёт с его rev", async () => {
    render(<BoardView boardId="b1" />);
    await screen.findByText("Её мысль");
    act(() => { srv.bump((b) => { b.stickers[1].text = "до сбоя"; }); });
    await screen.findByText("до сбоя");
    await waitFor(() => expect(srv.waiting()).toBe(1));
    // Сбой: доска вернулась к rev 1 и к прежнему тексту.
    act(() => {
      const b = srv.board();
      b.rev = 0;
      srv.bump((x) => { x.stickers[1].text = "после сбоя"; });
    });
    expect(await screen.findByText("после сбоя")).toBeInTheDocument();
    const gets = () => srv.calls.filter((c) => c.method === "GET" && c.path === "/api/boards/b1");
    await waitFor(() => expect(gets().at(-1).search).toBe("?rev=1"), { timeout: 3000 });
    await waitFor(() => expect(srv.waiting()).toBe(1));
    const n = gets().length;
    await new Promise((r) => setTimeout(r, 300));
    expect(gets()).toHaveLength(n);
    // И следующее изменение сервера доезжает.
    act(() => { srv.bump((x) => { x.stickers[1].text = "снова живая"; }); });
    expect(await screen.findByText("снова живая")).toBeInTheDocument();
  });

  it("«+» — новый пустой стикер последним, с курсором в нём", async () => {
    render(<BoardView boardId="b1" />);
    await screen.findByText("Её мысль");
    fireEvent.click(screen.getByRole("button", { name: "добавить стикер" }));
    await waitFor(() => expect(document.querySelectorAll("[data-sticker]")).toHaveLength(3));
    const post = srv.calls.find((c) => c.method === "POST");
    expect(post.path).toBe("/api/boards/b1/stickers");
    const last = [...document.querySelectorAll("[data-sticker]")].pop();
    const input = within(last).getByRole("textbox", { name: "текст стикера" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    // Шапка стикера — имя автора.
    expect(within(last).getByText("Иван Петров")).toBeInTheDocument();
  });

  it("свой стикер убирается «×»", async () => {
    render(<BoardView boardId="b1" />);
    const mine = (await screen.findByDisplayValue("Моё")).closest("[data-sticker]");
    fireEvent.click(within(mine).getByRole("button", { name: "удалить стикер" }));
    await waitFor(() => expect(screen.queryByDisplayValue("Моё")).toBeNull());
    await waitFor(() => expect(srv.board().stickers.map((s) => s.id)).toEqual(["b"]));
    expect(srv.calls.find((c) => c.method === "DELETE").path).toBe("/api/boards/b1/stickers/a");
  });

  it("«Участники» раздвигают аватарки из-под друг друга", async () => {
    render(<BoardView boardId="b1" />);
    await screen.findByText("Идеи на квартал");
    const toggle = screen.getByRole("button", { name: "Участники" });
    const wraps = () => [...screen.getByRole("group", { name: "участники доски" }).children];
    // Внахлёст: каждая следующая наезжает на предыдущую.
    expect(wraps().slice(1).every((w) => parseInt(w.style.marginLeft, 10) < 0)).toBe(true);
    expect(wraps()[1].style.transition).toContain("margin-left");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(wraps().slice(1).every((w) => parseInt(w.style.marginLeft, 10) > 0)).toBe(true);
    fireEvent.click(toggle);
    expect(wraps().slice(1).every((w) => parseInt(w.style.marginLeft, 10) < 0)).toBe(true);
  });

  it("меню участника: имя и сколько стикеров; создателю — «Заблокировать» и «Удалить»", async () => {
    render(<BoardView boardId="b1" />);
    await screen.findByText("Её мысль");
    fireEvent.click(screen.getByRole("button", { name: "участник: Ольга" }));
    const menu = document.querySelector("[data-board-menu]");
    expect(within(menu).getByText("Ольга")).toBeInTheDocument();
    expect(within(menu).getByText("Стикеров: 1")).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Заблокировать" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Удалить" })).toBeInTheDocument();
    // Клик мимо — меню закрывается.
    fireEvent.pointerDown(document.body);
    expect(document.querySelector("[data-board-menu]")).toBeNull();
    // Себя не заблокировать и не удалить.
    fireEvent.click(screen.getByRole("button", { name: "участник: Иван Петров" }));
    const own = document.querySelector("[data-board-menu]");
    expect(within(own).getByText("Стикеров: 1")).toBeInTheDocument();
    expect(within(own).queryByRole("button", { name: "Заблокировать" })).toBeNull();
    expect(within(own).queryByRole("button", { name: "Удалить" })).toBeNull();
  });

  it("не создателю управлять участниками нечем", async () => {
    srv = boardServer({ ...BOARD, by: "200", byName: "Ольга" }, { me: ME });
    global.fetch = srv.fetch;
    render(<BoardView boardId="b1" />);
    await screen.findByText("Её мысль");
    expect(screen.getByRole("note", { name: "создатель доски: Ольга" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "участник: maria" }));
    const menu = document.querySelector("[data-board-menu]");
    expect(within(menu).getByText("Стикеров: 0")).toBeInTheDocument();
    expect(within(menu).queryByRole("button", { name: "Заблокировать" })).toBeNull();
    expect(within(menu).queryByRole("button", { name: "Удалить" })).toBeNull();
  });

  it("«Заблокировать» — сперва предупреждение; «Отменить» ничего не делает", async () => {
    render(<BoardView boardId="b1" />);
    await screen.findByText("Её мысль");
    fireEvent.click(screen.getByRole("button", { name: "участник: Ольга" }));
    fireEvent.click(screen.getByRole("button", { name: "Заблокировать" }));
    const box = screen.getByRole("dialog");
    expect(box).toHaveTextContent("Ольга больше не сможет зайти на доску и вместо неё увидит «Вы были заблокированы». Стикеры участника останутся на доске.");
    fireEvent.click(within(box).getByRole("button", { name: "Отменить" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(srv.calls.some((c) => c.path.includes("/members/"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "участник: Ольга" }));
    fireEvent.click(screen.getByRole("button", { name: "Заблокировать" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Согласиться" }));
    await waitFor(() => expect(srv.board().members[1].blocked).toBe(true));
    expect(srv.calls.find((c) => c.path.includes("/members/")).path).toBe("/api/boards/b1/members/200/block");
    // Стикеры заблокированного остаются; аватарка — приглушена.
    expect(screen.getByText("Её мысль")).toBeInTheDocument();
    await waitFor(() => expect(Number(screen.getByRole("button", { name: "участник: Ольга" }).style.opacity))
      .toBeLessThan(1));
    // У заблокированного вместо «Заблокировать» — «Разблокировать», без переспроса.
    fireEvent.click(screen.getByRole("button", { name: "участник: Ольга" }));
    fireEvent.click(screen.getByRole("button", { name: "Разблокировать" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(srv.board().members[1].blocked).toBe(false));
  });

  it("«Удалить» — предупреждение, и по согласию уходят и участник, и его стикеры", async () => {
    render(<BoardView boardId="b1" />);
    await screen.findByText("Её мысль");
    fireEvent.click(screen.getByRole("button", { name: "участник: Ольга" }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    const box = screen.getByRole("dialog");
    expect(box).toHaveTextContent("Участник Ольга будет удалён из участников и больше не сможет зайти на доску. Все стикеры участника будут удалены.");
    fireEvent.click(within(box).getByRole("button", { name: "Согласиться" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "участник: Ольга" })).toBeNull());
    expect(screen.queryByText("Её мысль")).toBeNull();
    const del = srv.calls.find((c) => c.method === "DELETE");
    expect(del.path).toBe("/api/boards/b1/members/200");
  });

  it("заблокированный вместо доски видит «Вы были заблокированы.» — и сразу, и при входе", async () => {
    render(<BoardView boardId="b1" />);
    await screen.findByText("Её мысль");
    await waitFor(() => expect(srv.waiting()).toBe(1));
    // Блок случился, пока ждали изменений.
    act(() => { srv.refuse(403, { error: "Вы были заблокированы.", blocked: true }); });
    expect(await screen.findByText("Вы были заблокированы.")).toBeInTheDocument();
    expect(screen.queryByText("Её мысль")).toBeNull();
    expect(screen.queryByRole("button", { name: "добавить стикер" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Участники" })).toBeNull();
  });

  it("удалённый и несуществующая доска — свои слова вместо доски", async () => {
    srv.refuse(403, { error: "Вас удалили с доски.", removed: true });
    const { unmount } = render(<BoardView boardId="b1" />);
    expect(await screen.findByText("Вас удалили с доски.")).toBeInTheDocument();
    unmount();
    srv = boardServer(BOARD, { me: ME });
    global.fetch = srv.fetch;
    render(<BoardView boardId="нет" />);
    expect(await screen.findByText("Доски нет.")).toBeInTheDocument();
  });

  it("сеть упала — опрос повторяется сам", async () => {
    let first = true;
    const real = srv.fetch;
    global.fetch = vi.fn(async (...a) => {
      if (first) { first = false; throw new TypeError("Failed to fetch"); }
      return real(...a);
    });
    render(<BoardView boardId="b1" />);
    expect(await screen.findByText("Идеи на квартал", {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("уход с доски обрывает ожидание", async () => {
    const { unmount } = render(<BoardView boardId="b1" />);
    await screen.findByText("Её мысль");
    await waitFor(() => expect(srv.waiting()).toBe(1));
    unmount();
    await waitFor(() => expect(srv.waiting()).toBe(0));
  });

  it("отказ в действии — на экран, а не молча", async () => {
    render(<BoardView boardId="b1" />);
    await screen.findByText("Её мысль");
    const real = srv.fetch;
    global.fetch = vi.fn(async (url, opts = {}) => (opts.method === "POST"
      ? { ok: false, status: 400, json: async () => ({ error: "На доске уже 500 стикеров." }) }
      : real(url, opts)));
    fireEvent.click(screen.getByRole("button", { name: "добавить стикер" }));
    expect(await screen.findByText("На доске уже 500 стикеров.")).toBeInTheDocument();
  });
});
