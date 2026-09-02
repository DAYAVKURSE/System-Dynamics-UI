import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CallApp from "../components/CallApp.jsx";
import App from "../App.jsx";
import { resetIdentity } from "../identity.js";

/* Отдельное окно звонка: открывается на пол-экрана и само не
   разворачивается; ссылка на звонок открывает именно его, а не модель.

   И главное требование владельца: по ссылке звонок открывается у любого,
   кому она попала. Поэтому окно звонка ничего не спрашивает про модель —
   ни ролей, ни «кто я в организации», — а без Telegram работает как гость. */

const setUrl = (search) => {
  delete window.location;
  window.location = new URL(`https://example.test/${search}`);
};
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

let tg;
beforeEach(() => {
  resetIdentity();
  tg = {
    ready: vi.fn(), expand: vi.fn(), setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(),
    disableVerticalSwipes: vi.fn(), initData: "x",
    initDataUnsafe: { user: { id: 100, first_name: "Иван" }, start_param: "" },
  };
  window.Telegram = { WebApp: tg };
  global.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.endsWith("/api/calls/m1")) return ok({ id: "m1", title: "Разбор", at: "", peers: [] });
    if (u.endsWith("/api/health")) return ok({ ok: false });
    return ok({}, 404);
  });
});
afterEach(() => { vi.restoreAllMocks(); delete window.Telegram; setUrl(""); });

describe("окно звонка", () => {
  it("при запуске не разворачивается на весь экран — это делает человек", async () => {
    setUrl("?call=m1");
    render(<CallApp />);
    expect(await screen.findByText("Разбор")).toBeInTheDocument();
    expect(tg.ready).toHaveBeenCalled();
    expect(tg.expand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("на весь экран"));
    expect(tg.expand).toHaveBeenCalledTimes(1);
  });

  it("встреча берётся из startapp, как её присылает приглашение", async () => {
    setUrl("");
    tg.initDataUnsafe.start_param = "call_m1";
    render(<CallApp />);
    expect(await screen.findByText("Разбор")).toBeInTheDocument();
  });

  it("без встречи в ссылке — так и сказано", async () => {
    setUrl("");
    render(<CallApp />);
    expect(await screen.findByText(/Ссылка на звонок неполная/)).toBeInTheDocument();
  });

  it("свайпы не сворачивают окно: видео тянут пальцем", async () => {
    setUrl("?call=m1");
    render(<CallApp />);
    await screen.findByText("Разбор");
    expect(tg.disableVerticalSwipes).toHaveBeenCalled();
  });
});

describe("звонок открывается у любого, кому дали ссылку", () => {
  it("окно звонка не спрашивает сервер, кто я в модели", async () => {
    // Прежде окно звонка звало whoAmI() → /api/org/me, а тот назначал
    // владельцем модели первого встречного. По ссылке на звонок приходит
    // кто угодно.
    setUrl("?call=m1");
    render(<CallApp />);
    await screen.findByText("Разбор");
    const asked = global.fetch.mock.calls.map((c) => String(c[0]));
    expect(asked.some((u) => u.includes("/api/org"))).toBe(false);
    expect(asked.some((u) => u.includes("/api/health"))).toBe(false);
  });

  it("без Telegram участник заводится гостем и подписывается сам", async () => {
    delete window.Telegram;
    localStorage.clear();
    setUrl("?call=m1");
    render(<CallApp />);
    await screen.findByText("Разбор");

    // Номер гостя уехал на сервер заголовком — по нему сигналы одного
    // участника отличаются от сигналов другого.
    const [, init] = global.fetch.mock.calls.find(([u]) => String(u).endsWith("/api/calls/m1"));
    expect(init.headers["X-Call-Guest"]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);

    const nameBox = screen.getByLabelText("как вас зовут");
    fireEvent.change(nameBox, { target: { value: "Пётр" } });
    await waitFor(() => expect(localStorage.getItem("sd.call.name")).toBe("Пётр"));
  });

  it("у своего в Telegram имя уже есть — спрашивать нечего", async () => {
    setUrl("?call=m1");
    render(<CallApp />);
    await screen.findByText("Разбор");
    expect(screen.queryByLabelText("как вас зовут")).toBeNull();
  });

  it("гостю не предлагают запись: сервер её всё равно не примет", async () => {
    delete window.Telegram;
    setUrl("?call=m1");
    render(<CallApp />);
    await screen.findByText("Разбор");
    expect(screen.queryByLabelText("запись")).toBeNull();
  });
});

describe("вход приложения", () => {
  it("ссылка на звонок открывает окно звонка, а не модель с вкладками", async () => {
    setUrl("?call=m1");
    render(<App />);
    expect(await screen.findByTestId("call-fit")).toBeInTheDocument();
    expect(screen.queryByText("Схема")).toBeNull();
    // Главное приложение разворачивается само; окно звонка — нет.
    expect(tg.expand).not.toHaveBeenCalled();
  });

  it("без параметра звонка открывается модель", async () => {
    setUrl("");
    render(<App />);
    expect(await screen.findByText("Схема")).toBeInTheDocument();
    expect(screen.queryByTestId("call-fit")).toBeNull();
    expect(tg.expand).toHaveBeenCalled();
  });
});
