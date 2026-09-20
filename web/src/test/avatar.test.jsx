import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import ProfilePanel from "../components/ProfilePanel.jsx";
import MarketPanel from "../components/MarketPanel.jsx";

/* ЛИЦО ЧЕЛОВЕКА (владелец, 2026-09-20).

   В анкете перед именем — круглая картинка. По умолчанию та, что стоит у
   него в Telegram; нажатие открывает её саму, а под ней «Заменить» и
   «Удалить». Картинка ОДНА.

   На «Рынке услуг» такой же кружок стоит перед названием заказа и услуги,
   и нажатие открывает страницу автора. Автор, с которым смотрящий вместе
   не работает, представлен двумя словами, а вместо лица у него знак
   приложения. */

const ME = { id: "1", name: "Иван", known: true, solo: false, isOwner: false,
  tabs: ["market"], profile: { name: "Иван", avatar: "https://t.me/i/a.jpg",
    about: "", days: [], from: "", to: "", perDay: {}, status: "ready",
    statusAt: null, warnMin: 10, deferMin: 30, answers: {} }, forms: [] };

afterEach(() => vi.restoreAllMocks());
beforeEach(() => { localStorage.clear(); });

describe("лицо в анкете", () => {
  it("кружок стоит перед именем и показывает телеграмную картинку", () => {
    render(<ProfilePanel me={ME} people={[]} />);
    const dot = screen.getByRole("button", { name: "ваше лицо" });
    expect(dot.querySelector("img")).toHaveAttribute("src", "https://t.me/i/a.jpg");
    // Имя — следом за кружком, в той же строке.
    expect(dot.parentElement.textContent).toContain("Иван");
  });

  it("нажатие открывает картинку, под ней «Заменить» и «Удалить»", () => {
    render(<ProfilePanel me={ME} people={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "ваше лицо" }));
    expect(screen.getByLabelText("лицо крупно: Иван"))
      .toHaveAttribute("src", "https://t.me/i/a.jpg");
    expect(screen.getByLabelText("новое лицо")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Удалить" })).toBeInTheDocument();
  });

  it("«Удалить» уезжает на сервер пустой строкой — остаётся пустой кружок",
    async () => {
      const calls = [];
      vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
        calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
        return { ok: true, status: 200,
          json: async () => ({ profile: { ...ME.profile, avatar: "" } }) };
      }));
      const saved = vi.fn();
      render(<ProfilePanel me={ME} people={[]} onSaved={saved} />);
      fireEvent.click(screen.getByRole("button", { name: "ваше лицо" }));
      fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
      await waitFor(() => expect(saved).toHaveBeenCalled());
      // Анкета по пути спрашивает и поручения — ищем нужный запрос, а не первый.
      const put = calls.find((c) => c.url === "/api/org/me/profile");
      expect(put).toBeTruthy();
      expect(put.body).toEqual({ avatar: "" });
    });

  it("без картинки в кружке первая буква имени", () => {
    render(<ProfilePanel me={{ ...ME, profile: { ...ME.profile, avatar: "" } }} people={[]} />);
    const dot = screen.getByRole("button", { name: "ваше лицо" });
    expect(dot.querySelector("img")).toBeNull();
    expect(dot.textContent).toBe("И");
  });

  it("чужую картинку только смотрят — кнопок под ней нет", () => {
    const person = { id: "2", name: "Пётр", avatar: "https://t.me/i/b.jpg" };
    render(<ProfilePanel me={ME} personId="2" people={[person]} />);
    fireEvent.click(screen.getByRole("button", { name: "лицо: Пётр" }));
    expect(screen.getByLabelText("лицо крупно: Пётр")).toBeInTheDocument();
    expect(screen.queryByLabelText("новое лицо")).toBeNull();
    expect(screen.queryByRole("button", { name: "Удалить" })).toBeNull();
  });
});

/* ─── рынок ─── */
const VIEW = {
  me: "1",
  people: { 1: "Иван", 7: "wise oyster", 9: "Пётр" },
  faces: { 1: { avatar: "https://t.me/i/a.jpg", anon: false },
    7: { avatar: "", anon: true },
    9: { avatar: "https://t.me/i/b.jpg", anon: false } },
  orders: [{ id: "o1", by: "7", name: "Сайт-визитка", text: "", price: 100,
    at: "2026-09-20T10:00:00Z", status: "open", resources: [], offers: [] }],
  services: [{ id: "s1", by: "9", name: "Вёрстка", text: "", takes: [], gives: [],
    days: 3, at: "2026-09-20T10:00:00Z" }],
};
const marketServer = (person = null) => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("/api/market/people/")) {
      return { ok: true, status: 200, json: async () => person };
    }
    if (u.includes("/api/workspace/ratings")) {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => VIEW };
  }));
};

describe("лицо на рынке", () => {
  it("кружок стоит перед названием заказа и перед названием услуги", async () => {
    marketServer();
    render(<MarketPanel me={ME} />);
    const dot = await screen.findByRole("button", { name: "страница: wise oyster" });
    // Перед названием: кружок идёт раньше самого имени заказа в строке.
    const row = dot.parentElement;
    expect(row.textContent).toContain("Сайт-визитка");
    expect([...row.children].indexOf(dot)).toBe(0);

    fireEvent.click(screen.getByRole("tab", { name: /Услуги/ }));
    const svc = await screen.findByRole("button", { name: "страница: Пётр" });
    expect([...svc.parentElement.children].indexOf(svc)).toBe(0);
  });

  it("незнакомый автор — знак приложения вместо лица и два слова вместо имени",
    async () => {
      marketServer();
      render(<MarketPanel me={ME} />);
      const dot = await screen.findByRole("button", { name: "страница: wise oyster" });
      // Знак приложения — картинка, но не лицо: у незнакомца его нет.
      expect(dot.querySelector("img")).toBeTruthy();
      expect(screen.getByText(/wise oyster/)).toBeInTheDocument();
    });

  it("знакомый автор — со своим лицом", async () => {
    marketServer();
    render(<MarketPanel me={ME} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Услуги/ }));
    const dot = await screen.findByRole("button", { name: "страница: Пётр" });
    expect(dot.querySelector("img")).toHaveAttribute("src", "https://t.me/i/b.jpg");
  });

  it("нажатие на кружок открывает страницу автора окном", async () => {
    marketServer({ id: "7", name: "wise oyster", anon: true, avatar: "",
      profile: { name: "wise oyster", avatar: "", about: "делаю сайты", days: [],
        from: "", to: "", perDay: {}, status: "ready", statusAt: null,
        warnMin: 10, deferMin: 30, answers: {} }, forms: [] });
    render(<MarketPanel me={ME} />);
    fireEvent.click(await screen.findByRole("button", { name: "страница: wise oyster" }));
    // Страница открылась, и на ней он всё так же под двумя словами.
    await waitFor(() => expect(screen.getAllByText(/wise oyster/).length).toBeGreaterThan(1));
    expect(screen.getByLabelText("лицо скрыто")).toBeInTheDocument();
  });
});
