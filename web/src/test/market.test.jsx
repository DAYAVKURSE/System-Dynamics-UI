import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import MarketPanel from "../components/MarketPanel.jsx";
import SystemModel, { TAB_LIST } from "../components/SystemModel.jsx";
import {
  daysOf, matchServices, orderFromFunc, rowsOf, serviceFromFunc, words,
} from "../lib/market.js";

/* РЫНОК УСЛУГ.

   Владелец (2026-09-13): первая вкладка перед анкетой; внутри «Заказы» и
   «Услуги»; заказ — название, содержание, стоимость, ресурсы; услуга —
   название, описание, берёт, выдаёт, срок; слова из функции, но
   правятся; подходящие услуги — сразу в форме заказа, одну можно выбрать;
   предложения видит только автор заказа; открыть отклик — открыть чат;
   «Договорились» → бриф → «Есть предложение» (изменить — цвет меняется,
   или принять) → заказчик загружает ресурсы. */

afterEach(() => vi.restoreAllMocks());

const TRAITS = [{ id: "t1", l: "макет" }, { id: "t2", l: "страница" }];
/* Текст карточки — ожидаемый результат функции (владелец, 2026-09-20:
   описания у функции больше нет, у неё есть результат). */
const FUNC = { id: "f1", name: "Вёрстка", chain: { id: "c1", name: "Вёрстка", result: "по макету" },
  takes: [{ trait: "t1", lo: 1, hi: 1 }],
  gives: [{ trait: "t2", lo: 2, hi: 3 }], dur: 24, durHi: 48 };

describe("слова из функции", () => {
  it("услуга: название, описание, берёт, выдаёт, срок в днях", () => {
    expect(serviceFromFunc(FUNC, { traits: TRAITS })).toEqual({ name: "Вёрстка", text: "по макету",
      takes: [{ name: "макет", qty: 1 }], gives: [{ name: "страница", qty: 3 }], days: 2, funcId: "f1" });
  });
  it("заказ: заказчик даёт то, что функция берёт; цена не угадывается", () => {
    expect(orderFromFunc(FUNC, { traits: TRAITS })).toEqual({ name: "Вёрстка", text: "по макету",
      price: null, resources: [{ name: "макет", qty: 1 }], funcId: "f1", serviceId: null });
    expect(rowsOf([{ trait: "нет" }], TRAITS)).toEqual([]);
    expect(daysOf({ dur: 0 })).toBe(null);
  });
  it("подходящие услуги — по общим словам, от самой похожей; одна функция важнее слов", () => {
    const svcs = [{ id: "a", name: "Дизайн логотипа", text: "", takes: [], gives: [{ name: "логотип" }] },
      { id: "b", name: "Вёрстка страниц", text: "по макету", takes: [{ name: "макет" }], gives: [] },
      { id: "c", name: "Уборка", text: "", takes: [], gives: [] },
      { id: "d", name: "Другое имя", funcId: "f1", takes: [], gives: [] }];
    const fit = matchServices({ name: "Сверстать три страницы", text: "макет готов", resources: [], funcId: "f1" }, svcs);
    expect(fit.map((s) => s.id)).toEqual(["d", "b"]);
    expect(words("Вёрстка, для страниц!")).toEqual(new Set(["вёрстк", "страни"]));
  });
});

/* Подменный сервер рынка: заказы всем, отклики двоим, как настоящий. */
function marketServer({ me = "200", people = { 200: "Заказчик", 300: "Мастер" } } = {}) {
  const state = { orders: [], services: [] };
  const log = [];
  const view = () => ({ me, people, services: state.services,
    orders: state.orders.map((o) => ({ ...o, offerCount: o.offers.length,
      offers: o.offers.filter((f) => o.by === me || f.by === me) })) });
  const findOffer = (url) => {
    const m = String(url).match(/orders\/([^/]+)\/offers\/([^/]+)/);
    const o = state.orders.find((x) => x.id === m[1]);
    return { o, f: o.offers.find((x) => x.id === m[2]) };
  };
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const method = opts.method || "GET";
    const body = opts.body ? JSON.parse(opts.body) : {};
    log.push({ url: String(url), method, body });
    const ok = (b, status = 200) => ({ ok: true, status, json: async () => b });
    if (method === "GET") return ok(view());
    if (method === "POST" && /\/orders$/.test(url)) {
      const o = { id: `o${state.orders.length + 1}`, by: me, at: "2026-09-13T10:00:00Z", status: "open", offers: [], ...body };
      state.orders.push(o); return ok(o, 201);
    }
    if (method === "POST" && /\/services$/.test(url)) {
      const s = { id: `s${state.services.length + 1}`, by: me, at: "2026-09-13T10:00:00Z", ...body };
      state.services.push(s); return ok(s, 201);
    }
    if (method === "POST" && /\/offers$/.test(url)) {
      const o = state.orders.find((x) => String(url).includes(`/orders/${x.id}/`));
      const f = { id: `f${o.offers.length + 1}`, by: me, at: "2026-09-13T11:00:00Z", chat: [], brief: null,
        accepted: false, deliveries: [], ...body };
      o.offers.push(f); return ok(f, 201);
    }
    if (method === "POST" && /\/chat$/.test(url)) {
      const { f } = findOffer(url);
      f.chat.push({ id: `m${f.chat.length + 1}`, by: me, at: "2026-09-13T11:05:00Z", text: body.text });
      return ok(f);
    }
    if (method === "PUT" && /\/brief$/.test(url)) {
      const { f } = findOffer(url);
      f.brief = { by: me, at: "2026-09-13T12:00:00Z", rev: (f.brief?.rev || 0) + 1, ...body };
      return ok(f);
    }
    if (method === "POST" && /\/accept$/.test(url)) {
      const { o, f } = findOffer(url);
      f.accepted = true; f.acceptedAt = "2026-09-13T13:00:00Z"; o.status = "deal";
      return ok({ offer: f, task: { id: "tk1" } });
    }
    if (method === "POST" && /\/deliveries$/.test(url)) {
      const { f } = findOffer(url);
      f.deliveries.push({ id: `d${f.deliveries.length + 1}`, by: me, at: "2026-09-13T14:00:00Z", ...body });
      return ok(f);
    }
    if (method === "DELETE") {
      state.orders = state.orders.filter((o) => !String(url).endsWith(`/orders/${o.id}`));
      state.services = state.services.filter((s) => !String(url).endsWith(`/services/${s.id}`));
      return { ok: true, status: 204, json: async () => null };
    }
    return { ok: false, status: 404, json: async () => ({ error: "not found" }) };
  }));
  return { state, log, setMe: (id) => { me = id; } };
}

const ME = { id: "200", name: "Заказчик", known: true, solo: false, isOwner: false, tabs: [] };
const tabs = () => screen.getByRole("tablist", { name: "рынок услуг" });

describe("вкладка", () => {
  it("«Рынок услуг» — первая, перед «Анкетой», и видна без ролей", () => {
    expect(TAB_LIST.slice(0, 2).map(([, t]) => t)).toEqual(["Рынок услуг", "Анкета"]);
    localStorage.clear();
    render(<SystemModel />);
    const all = screen.getAllByRole("button").map((b) => b.textContent);
    expect(all.indexOf("Рынок услуг")).toBeLessThan(all.indexOf("Анкета"));
    fireEvent.click(screen.getByRole("button", { name: "Рынок услуг" }));
    // Без сервера — честно сказано, почему пусто.
    expect(screen.getByText(/живёт на сервере/)).toBeInTheDocument();
  });

  it("две вкладки внутри; заказ — название, содержание, стоимость, ресурсы; подходящая услуга выбирается", async () => {
    const { state, log } = marketServer();
    state.services.push({ id: "s1", by: "300", at: "2026-09-13T09:00:00Z", name: "Вёрстка страниц", text: "",
      takes: [{ name: "макет", qty: 1 }], gives: [{ name: "страница", qty: 3 }], days: 2 },
    { id: "s2", by: "300", at: "2026-09-13T09:00:00Z", name: "Уборка", text: "", takes: [], gives: [], days: 1 });
    render(<MarketPanel me={ME} />);
    await screen.findByRole("tab", { name: /Заказы/ });
    expect(within(tabs()).getByRole("tab", { name: /Услуги · 2/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ заказ" }));
    fireEvent.change(screen.getByLabelText("название заказа"), { target: { value: "Сверстать три страницы" } });
    fireEvent.change(screen.getByLabelText("содержание заказа"), { target: { value: "макет готов" } });
    fireEvent.change(screen.getByLabelText("стоимость заказа"), { target: { value: "30000" } });
    fireEvent.change(screen.getByLabelText("ресурс заказа: что"), { target: { value: "макет" } });
    fireEvent.change(screen.getByLabelText("ресурс заказа: сколько"), { target: { value: "1" } });
    // Подходящие — только по словам: «Уборка» не показана.
    expect(screen.getByRole("checkbox", { name: "услуга Вёрстка страниц" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "услуга Уборка" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "услуга Вёрстка страниц" }));
    fireEvent.click(screen.getByRole("button", { name: "Оставить заказ" }));
    await screen.findByLabelText("заказ Сверстать три страницы");
    const post = log.find((r) => r.method === "POST" && r.url.endsWith("/orders"));
    expect(post.body).toEqual({ name: "Сверстать три страницы", text: "макет готов", price: "30000",
      resources: [{ name: "макет", qty: 1 }], serviceId: "s1", funcId: null });
    expect(screen.getByText(/выбранная услуга:/).parentElement.textContent).toContain("Вёрстка страниц");
  });

  it("заготовка из функции заполняет форму услуги, и её можно поправить", async () => {
    const { log } = marketServer();
    const onDone = vi.fn();
    render(<MarketPanel me={ME} traits={TRAITS} draft={{ kind: "service", func: FUNC }} onDraftDone={onDone} />);
    const name = await screen.findByLabelText("название услуги");
    expect(name).toHaveValue("Вёрстка");
    expect(screen.getByLabelText("срок услуги")).toHaveValue("2");
    expect(screen.getByLabelText("берёт: что")).toHaveValue("макет");
    expect(onDone).toHaveBeenCalled();
    fireEvent.change(name, { target: { value: "Вёрстка по макету" } });
    fireEvent.click(screen.getByRole("button", { name: "Выложить услугу" }));
    await screen.findByLabelText("услуга Вёрстка по макету");
    expect(log.find((r) => r.url.endsWith("/services") && r.method === "POST").body)
      .toMatchObject({ name: "Вёрстка по макету", funcId: "f1", days: 2, gives: [{ name: "страница", qty: 3 }] });
  });
});

describe("отклик, чат, бриф, сделка", () => {
  const seed = (srv) => {
    srv.state.orders.push({ id: "o1", by: "200", at: "2026-09-13T10:00:00Z", name: "Сайт", text: "три страницы",
      price: 30000, resources: [{ name: "логотип", qty: 1 }], status: "open", serviceId: null, offers: [] });
  };

  it("исполнитель откликается; открыть отклик — открыть чат", async () => {
    const srv = marketServer({ me: "300" });
    seed(srv);
    render(<MarketPanel me={{ ...ME, id: "300" }} />);
    await screen.findByLabelText("заказ Сайт");
    fireEvent.click(screen.getByRole("button", { name: "Откликнуться" }));
    fireEvent.change(screen.getByLabelText("текст отклика"), { target: { value: "сделаю за 4 дня" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить предложение" }));
    const open = await screen.findByRole("button", { name: "открыть отклик Заказчик" });
    fireEvent.click(open);
    expect(screen.getByRole("log", { name: "чат отклика" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("сообщение"), { target: { value: "когда начнём?" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(within(screen.getByRole("log", { name: "чат отклика" }))
      .getByText("когда начнём?")).toBeInTheDocument());
    expect(srv.log.find((r) => r.url.endsWith("/chat")).body).toEqual({ text: "когда начнём?" });
  });

  it("«Договорились» → бриф → «Есть предложение» своим цветом; принимает другая сторона; заказчик загружает ресурсы", async () => {
    const srv = marketServer({ me: "200" });
    seed(srv);
    srv.state.orders[0].offers.push({ id: "f1", by: "300", at: "2026-09-13T11:00:00Z", text: "могу", chat: [],
      brief: null, accepted: false, deliveries: [] });
    render(<MarketPanel me={ME} />);
    await screen.findByLabelText("заказ Сайт");
    fireEvent.click(screen.getByRole("button", { name: "открыть отклик Мастер" }));
    fireEvent.click(screen.getByRole("button", { name: "Договорились" }));
    fireEvent.change(screen.getByLabelText("отдаёт: что"), { target: { value: "логотип" } });
    fireEvent.change(screen.getByLabelText("отдаёт: сколько"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("получает: что"), { target: { value: "сайт" } });
    fireEvent.change(screen.getByLabelText("срок брифа"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить условия" }));
    const has = await screen.findByRole("button", { name: "есть предложение" });
    // Своё предложение — голубое, принять его нельзя.
    expect(has).toHaveAttribute("data-tone", "mine");
    expect(srv.log.find((r) => r.url.endsWith("/brief")).body)
      .toEqual({ gives: [{ name: "логотип", qty: 1 }], gets: { name: "сайт", qty: null }, days: "4", note: "" });
    expect(screen.getByLabelText("условия")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Принять предложение" })).toBeNull();
    // Другая сторона правит — у заказчика кнопка жёлтая и есть «Принять».
    srv.state.orders[0].offers[0].brief = { by: "300", at: "2026-09-13T12:30:00Z", rev: 2,
      gives: [{ name: "логотип", qty: 1 }], gets: { name: "сайт", qty: 1 }, days: 6 };
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    // Перечитать — как после любого действия.
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    fireEvent.change(screen.getByLabelText("сообщение"), { target: { value: "ок" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "есть предложение" }))
      .toHaveAttribute("data-tone", "theirs"));
    // Условия уже раскрыты — в них появилось «Принять».
    fireEvent.click(await screen.findByRole("button", { name: "Принять предложение" }));
    await screen.findByLabelText("сделка");
    expect(srv.log.some((r) => r.url.endsWith("/accept"))).toBe(true);
    // Заказчику предложено загрузить ресурсы.
    fireEvent.change(screen.getByLabelText("название ресурса"), { target: { value: "логотип" } });
    fireEvent.change(screen.getByLabelText("текст ресурса"), { target: { value: "во вложении" } });
    fireEvent.click(screen.getByRole("button", { name: "Отдать текстом" }));
    await waitFor(() => expect(within(screen.getByLabelText("сделка")).getByText(/во вложении/)).toBeInTheDocument());
    expect(srv.log.find((r) => r.url.endsWith("/deliveries")).body).toEqual({ name: "логотип", text: "во вложении" });
  });
});

/* ─────── АВТОМАТИЧЕСКИЙ ПРИЁМ (владелец, 2026-09-20) ───────
   Отметка стоит в форме услуги, а заказчик видит зелёный кружок: по такой
   услуге ему не придётся ждать ответа. */
describe("принимает заказ автоматически", () => {
  it("в форме услуги есть чекбокс, и он уезжает на сервер", async () => {
    const { log } = marketServer();
    render(<MarketPanel me={ME} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Услуги/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ услуга" }));
    const box = screen.getByLabelText("принять автоматически в рабочее время");
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    fireEvent.change(screen.getByLabelText("название услуги"), { target: { value: "Вёрстка" } });
    fireEvent.click(screen.getByRole("button", { name: "Выложить услугу" }));
    await waitFor(() => expect(log.some((c) => /\/services$/.test(c.url)
      && c.method === "POST")).toBe(true));
    expect(log.find((c) => /\/services$/.test(c.url) && c.method === "POST").body.auto)
      .toBe(true);
  });

  it("заказчик видит зелёный кружок только у такой услуги", async () => {
    const { state } = marketServer();
    state.services.push(
      { id: "s9", by: "300", name: "Вёрстка", text: "", takes: [], gives: [], days: 3,
        at: "2026-09-13T10:00:00Z", auto: true },
      { id: "s8", by: "300", name: "Дизайн", text: "", takes: [], gives: [], days: 3,
        at: "2026-09-13T10:00:00Z", auto: false });
    render(<MarketPanel me={ME} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Услуги/ }));
    const auto = await screen.findByLabelText("услуга Вёрстка");
    expect(within(auto).getByLabelText("принимает заказ автоматически").textContent)
      .toContain("Принимает заказ автоматически");
    const plain = screen.getByLabelText("услуга Дизайн");
    expect(within(plain).queryByLabelText("принимает заказ автоматически")).toBeNull();
  });
});

/* ─────── ПОИСК ПО СМЫСЛУ (владелец, 2026-09-20) ───────
   Поле справа от «+ заказ» и «+ услуга»; выпадающий список подходящего;
   нажатие ставит выбранное первым, а под ним — ближайшее по смыслу. */
describe("поиск на рынке", () => {
  const SERVICES = [
    { id: "s1", by: "300", name: "Разработка", text: "сделаю сайт", takes: [], gives: [],
      days: 3, at: "2026-09-13T10:00:00Z" },
    { id: "s2", by: "300", name: "Доставка грузов", text: "по городу", takes: [], gives: [],
      days: 1, at: "2026-09-13T10:00:00Z" },
    { id: "s3", by: "300", name: "Вёрстка лендинга", text: "адаптивная", takes: [], gives: [],
      days: 2, at: "2026-09-13T10:00:00Z" },
  ];
  const withServices = () => {
    const s = marketServer();
    s.state.services.push(...SERVICES);
    return s;
  };

  it("поле стоит справа от «+ услуга»", async () => {
    withServices();
    render(<MarketPanel me={ME} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Услуги/ }));
    const add = await screen.findByRole("button", { name: "+ услуга" });
    const field = screen.getByLabelText("поиск услуг");
    const row = add.parentElement;
    expect(row).toContainElement(field);
    expect([...row.children].indexOf(add))
      .toBeLessThan([...row.children].indexOf(field.parentElement));
  });

  it("ищет по смыслу: «программирование» находит «Разработку»", async () => {
    withServices();
    render(<MarketPanel me={ME} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Услуги/ }));
    fireEvent.change(screen.getByLabelText("поиск услуг"),
      { target: { value: "программирование" } });
    const list = await screen.findByRole("listbox", { name: /поиск услуг/ });
    const found = within(list).getAllByRole("option").map((o) => o.textContent);
    expect(found.some((t) => t.includes("Разработка"))).toBe(true);
    expect(found.some((t) => t.includes("Доставка"))).toBe(false);
  });

  it("нажатие ставит выбранное первым, под ним — ближайшее по смыслу", async () => {
    withServices();
    render(<MarketPanel me={ME} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Услуги/ }));
    fireEvent.change(screen.getByLabelText("поиск услуг"), { target: { value: "разработка" } });
    fireEvent.click(await screen.findByRole("option", { name: "найдено: Разработка" }));
    await waitFor(() => {
      const cards = screen.getAllByLabelText(/^услуга /).map((c) => c.getAttribute("aria-label"));
      expect(cards[0]).toBe("услуга Разработка");
      expect(cards[1]).toBe("услуга Вёрстка лендинга");
    });
  });

  it("пустое поле возвращает список как был", async () => {
    withServices();
    render(<MarketPanel me={ME} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Услуги/ }));
    const field = screen.getByLabelText("поиск услуг");
    fireEvent.change(field, { target: { value: "разработка" } });
    fireEvent.click(await screen.findByRole("option", { name: "найдено: Разработка" }));
    await waitFor(() => expect(screen.getAllByLabelText(/^услуга /)[0]
      .getAttribute("aria-label")).toBe("услуга Разработка"));
    fireEvent.change(field, { target: { value: "" } });
    await waitFor(() => expect(screen.getAllByLabelText(/^услуга /)[0]
      .getAttribute("aria-label")).toBe("услуга Вёрстка лендинга"));
  });

  it("в названии новой услуги подсказываются готовые, близкие по смыслу", async () => {
    withServices();
    render(<MarketPanel me={ME} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Услуги/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ услуга" }));
    fireEvent.change(screen.getByLabelText("название услуги"),
      { target: { value: "программирование" } });
    const hints = await screen.findByRole("listbox", { name: /название услуги/ });
    fireEvent.click(within(hints).getByRole("option", { name: "название: Разработка" }));
    expect(screen.getByLabelText("название услуги")).toHaveValue("Разработка");
  });
});
