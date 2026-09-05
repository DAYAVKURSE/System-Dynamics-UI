import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import ReportsPanel from "../components/ReportsPanel.jsx";
import ShareView, { shareFromLocation } from "../components/ShareView.jsx";
import SystemModel, { TAB_LIST } from "../components/SystemModel.jsx";
import {
  childrenOf, dropNode, newProject, newSection, normalizeReports,
  pathOf, reportFromLocation, resultsOf, rootsOf, shareLink, subtree, summaryOf,
} from "../lib/reports.js";

/* ОТЧЁТЫ · карта проектов.

   Проект и раздел — один и тот же блок, вложенный в другой: карта
   складывается фрактально, без предела глубины. В блоке — ссылки на
   ОПРЕДЕЛЁННЫЕ результаты по номерам; сами результаты собираются из уже
   сделанных сдач, а не переписываются руками. Технического задания полем
   в карте нет: пересказ заказа разошёлся бы с делом. */

const MODEL = {
  /* «текст» выдаёт другая функция, «спрос» — никто: на нём и проверяется,
     что в списки не попадает то, у чего результатов быть не может. */
  traits: [{ id: "t2", e: "e1", l: "макет" }, { id: "t3", e: "e1", l: "текст" },
    { id: "t4", e: "e1", l: "спрос" }],
  funcs: [
    { id: "f1", e: "e1", name: "Собрать макет", takes: [{ trait: "t4" }],
      gives: [{ trait: "t2" }] },
    { id: "f2", e: "e1", name: "Написать текст", takes: [], gives: [{ trait: "t3" }] },
  ],
  tasks: [
    { id: "tk1", funcId: "f1", title: "Макет главной", status: "done", assignee: "2",
      submissions: [{ id: "s1", at: "2026-02-01T10:00:00Z", hours: 4,
        takes: {}, gives: { t2: 1 }, text: "готово",
        file: { name: "макет.pdf", type: "application/pdf", url: "/api/reports/x/y" } }] },
    { id: "tk2", funcId: "f1", title: "Второй заход", status: "review", assignee: "2",
      submissions: [{ id: "s2", at: "2026-02-02T10:00:00Z", hours: 2,
        takes: {}, gives: { t2: 1 } }] },
    { id: "tk3", funcId: "f1", title: "Не про этот ресурс", status: "done", assignee: "2",
      submissions: [{ id: "s3", at: "2026-02-03T10:00:00Z", hours: 1,
        takes: {}, gives: {} }] },
  ],
};
const NODES = [
  { id: "rp1", parent: null, name: "Заказ «Сайт»", picks: [] },
  { id: "rs1", parent: "rp1", name: "Макеты",
    picks: [{ id: "pk1", func: "f1", trait: "t2" }] },
  { id: "rs2", parent: "rs1", name: "Главная", picks: [] },
];

describe("запись карты", () => {
  it("проект и раздел — одна и та же запись, разница только в родителе", () => {
    const p = newProject("Заказ");
    const s = newSection(p.id, "Раздел");
    expect(p.parent).toBeNull();
    expect(s.parent).toBe(p.id);
    expect(Object.keys(p).sort()).toEqual(Object.keys(s).sort());
  });

  it("чужая запись достраивается, а не ломается", () => {
    expect(normalizeReports([{ id: "x" }])[0])
      .toEqual({ id: "x", parent: null, name: "", picks: [] });
    expect(normalizeReports(null)).toEqual([]);
  });

  it("вложенность без предела: раздел в разделе в проекте", () => {
    expect(rootsOf(NODES).map((n) => n.id)).toEqual(["rp1"]);
    expect(childrenOf(NODES, "rs1").map((n) => n.id)).toEqual(["rs2"]);
    expect(pathOf(NODES, "rs2").map((n) => n.name))
      .toEqual(["Заказ «Сайт»", "Макеты", "Главная"]);
  });

  it("потерявший родителя всплывает наверх, а не пропадает", () => {
    // Иначе раздел удалённого проекта исчез бы из карты, оставшись в записи.
    const orphan = [...NODES, { id: "rs9", parent: "нет", name: "Сирота", picks: [] }];
    expect(rootsOf(orphan).map((n) => n.id)).toContain("rs9");
  });

  it("удаление блока уносит и всё, что внутри", () => {
    expect(subtree(NODES, "rs1").map((n) => n.id).sort()).toEqual(["rs1", "rs2"]);
    expect(dropNode(NODES, "rp1")).toEqual([]);
  });

  it("технического задания полем нет ни у проекта, ни у раздела", () => {
    /* Заказ, описанный полем, — это пересказ, а пересказ расходится с тем,
       что и правда сделано, в первый же день. Само задание — такой же
       результат чьей-то работы, со своим номером. */
    expect(newProject("Заказ")).not.toHaveProperty("brief");
    expect(newSection("rp1", "Раздел")).not.toHaveProperty("brief");
    // И из чужой записи оно не переносится: двух источников правды не будет.
    expect(normalizeReports([{ id: "x", brief: "сделать сайт" }])[0])
      .not.toHaveProperty("brief");
  });
});

describe("что попадает в блок", () => {
  const picks = [{ id: "pk1", func: "f1", trait: "t2" }];

  it("сдачи выбранной функции по выбранному ресурсу — с числами и файлом", () => {
    const rows = resultsOf(MODEL, picks);
    expect(rows.map((r) => r.title)).toEqual(["Второй заход", "Макет главной"]);
    expect(rows[1]).toMatchObject({ qty: 1, hours: 4, accepted: true });
    expect(rows[1].file.name).toBe("макет.pdf");
  });

  it("сдача, не тронувшая этот ресурс, сюда не относится", () => {
    expect(resultsOf(MODEL, picks).map((r) => r.title)).not.toContain("Не про этот ресурс");
  });

  it("принятое и непринятое различены: заявление — не результат", () => {
    const rows = resultsOf(MODEL, picks);
    expect(rows.find((r) => r.title === "Второй заход").accepted).toBe(false);
  });

  it("сводка блока считает и то, что лежит в его разделах", () => {
    const sum = summaryOf(MODEL, NODES[0], NODES);
    expect(sum).toMatchObject({ rows: 2, accepted: 1, files: 1, hours: 6 });
  });
});

describe("карта в форме", () => {
  const Panel = ({ nodes: n0 = [] }) => {
    const [nodes, setNodes] = React.useState(n0);
    const [focus, setFocus] = React.useState(null);
    return (<ReportsPanel nodes={nodes} setNodes={setNodes} model={MODEL}
      entities={[{ id: "e1", name: "Мы" }]} nameOf={(id) => `человек ${id}`}
      focus={focus} onFocus={setFocus} />);
  };

  it("проект заводится кнопкой, раздел — внутри блока", () => {
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "+ проект" }));
    expect(screen.getByLabelText("название проекта")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ раздел внутри" }));
    expect(screen.getByLabelText("название раздела")).toBeInTheDocument();
  });

  it("в блоке видно, что в него попадает, и что по этому сделано", () => {
    render(<Panel nodes={NODES} />);
    // Вложенные блоки свёрнуты: карта должна читаться сверху, а не вываливать
    // всю глубину сразу.
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    expect(screen.getByText("Макет главной")).toBeInTheDocument();
    // Принятое и непринятое различены прямо в строке.
    expect(screen.getAllByText("принято").length).toBeGreaterThan(0);
    expect(screen.getByText("не принято")).toBeInTheDocument();
    expect(screen.getByText(/📎 макет.pdf/)).toBeInTheDocument();
  });

  it("поля задания в блоке нет — только разделы и результаты", () => {
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    expect(screen.queryByLabelText("техническое задание")).toBeNull();
    expect(screen.queryByText(/задание раздела/)).toBeNull();
  });

  it("ресурс выбирается из того, что функция ВЫДАЁТ, а не из всех подряд", () => {
    /* Результат бывает только там, где функция ресурс выдаёт. Пара, у
       которой результатов быть не может, — это предложение выбрать
       пустоту: человек потом ищет работы, которых там никогда не было. */
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    const traits = () => [...screen.getByLabelText("ресурс результата").options]
      .map((o) => o.textContent);
    // Выбрана «Собрать макет» — она выдаёт только макет.
    expect(traits()).toEqual(["— что она выдаёт —", "макет"]);
    // «Спрос» она берёт, а не выдаёт, — его в списке нет.
    expect(traits()).not.toContain("спрос");

    // И наоборот: функции — те, кто выбранный ресурс выдаёт.
    const funcs = () => [...screen.getByLabelText("функция результата").options]
      .map((o) => o.textContent);
    // Список функций при выбранной функции не сужается: сменить её можно
    // всегда, иначе человек заперт в первом же выборе.
    expect(funcs()).toEqual(["— функция —", "Мы · Собрать макет", "Мы · Написать текст"]);
  });

  it("сменили функцию — ресурс, которого она не выдаёт, не остаётся", () => {
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    fireEvent.change(screen.getByLabelText("функция результата"),
      { target: { value: "f2" } });
    // «Написать текст» макета не выдаёт: пара молча невозможной не станет.
    expect(screen.getByLabelText("ресурс результата").value).toBe("");
    expect([...screen.getByLabelText("ресурс результата").options]
      .map((o) => o.textContent)).toEqual(["— что она выдаёт —", "текст"]);
  });

  it("можно начать и с ресурса: тогда предлагают тех, кто его делает", () => {
    /* Путь «мне нужно вот это техническое задание — кто его делает».
       Пока функция не выбрана, список сужается ресурсом. */
    render(<Panel nodes={NODES.map((n) => (n.id === "rs1"
      ? { ...n, picks: [{ id: "pk1", func: "", trait: "t3" }] } : n))} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    expect([...screen.getByLabelText("функция результата").options]
      .map((o) => o.textContent)).toEqual(["— функция —", "Мы · Написать текст"]);
  });

  it("невозможная пара из прежней записи показана, а не спрятана пустотой", () => {
    /* Пустое поле читалось бы как «ничего не выбрано», и человек не понял
       бы, что именно сломалось. */
    render(<Panel nodes={NODES.map((n) => (n.id === "rs1"
      ? { ...n, picks: [{ id: "pk1", func: "f2", trait: "t2" }] } : n))} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    expect(screen.getByLabelText("ресурс результата").value).toBe("t2");
    expect(screen.getByText(/Эта функция такого ресурса не выдаёт/))
      .toBeInTheDocument();
  });

  it("результат выбирается определённой единицей — по номеру", () => {
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    const pick = screen.getByLabelText("определённый результат");
    // В списке — те единицы, что и правда получились из сдач, каждая с номером.
    expect([...pick.options].map((o) => o.textContent))
      .toEqual(["все результаты этой функции по этому ресурсу",
        "№2 · Второй заход (не принято)", "№1 · Макет главной"]);
    fireEvent.change(pick, { target: { value: "s1~t2" } });
    // Выбрана одна — остальные из блока уходят: раздел ссылается на вещь.
    expect(screen.getByText("Макет главной")).toBeInTheDocument();
    expect(screen.queryByText("Второй заход")).toBeNull();
  });

  it("удаление блока уносит вложенные разделы", () => {
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getAllByRole("button", { name: "удалить" })[0]);
    expect(screen.getByText(/Проектов пока нет/)).toBeInTheDocument();
  });

  it("ссылка наружу — это снимок на сервере, а не адрес приложения", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      calls.push([String(url), opts]);
      return { ok: true, status: 201,
        json: async () => ({ token: "b".repeat(64), node: "rp1" }) };
    }));
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getAllByRole("button", { name: "ссылка на этот блок" })[0]);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0][0]).toBe("/api/shares");
    expect(await screen.findByText(new RegExp(`\\?share=${"b".repeat(64)}`)))
      .toBeInTheDocument();
    expect(screen.getByText(/Открывается у кого угодно и без входа/)).toBeInTheDocument();
  });

  it("сервер отказал — сказано словами, а ссылка остаётся внутренней", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403,
      json: async () => ({ error: "only the owner can do this" }) })));
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getAllByRole("button", { name: "ссылка на этот блок" })[0]);
    expect(await screen.findByText(/откроется только у тех, у кого модель уже есть/))
      .toBeInTheDocument();
  });
});

describe("страница по ссылке", () => {
  afterEach(() => vi.restoreAllMocks());
  const SNAP = { name: "Макеты", at: "2026-02-05T10:00:00Z",
    snapshot: { at: "2026-02-05T10:00:00Z", path: ["Заказ «Сайт»", "Макеты"],
      block: { name: "Макеты",
        results: [{ title: "Макет главной", no: 1, func: "Собрать макет", trait: "макет",
          at: "2026-02-01T10:00:00Z", by: "Иван", hours: 4, qty: 1, text: "готово",
          file: { name: "макет.pdf", type: "application/pdf", url: "/api/reports/x/y" } }],
        sections: [{ name: "Главная", results: [], sections: [] }] } } };

  it("токен читается из адреса, и только настоящий", () => {
    expect(shareFromLocation("?share=" + "a".repeat(64))).toBe("a".repeat(64));
    expect(shareFromLocation("?share=коротышка")).toBeNull();
    expect(shareFromLocation("")).toBeNull();
  });

  it("показывает сделанное с номерами и вложенные разделы — без входа", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200,
      json: async () => SNAP })));
    render(<ShareView token={"a".repeat(64)} />);
    expect(await screen.findByText("Макет главной")).toBeInTheDocument();
    // Номер тот же, что и внутри: заказчик и исполнитель зовут вещь одинаково.
    expect(screen.getByText("№1")).toBeInTheDocument();
    expect(screen.getByText("Главная")).toBeInTheDocument();
    expect(screen.getByText(/📎 макет.pdf/)).toBeInTheDocument();
  });

  it("отозванная ссылка говорит об этом, а не показывает пустоту", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404,
      json: async () => ({ error: "not found" }) })));
    render(<ShareView token={"a".repeat(64)} />);
    expect(await screen.findByText(/Возможно, ссылку отозвали/)).toBeInTheDocument();
  });

  it("правки на такой странице нет вовсе: это показ, а не работа", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200,
      json: async () => SNAP })));
    const { container } = render(<ShareView token={"a".repeat(64)} />);
    await screen.findByText("Макет главной");
    expect(container.querySelectorAll("input, textarea, select")).toHaveLength(0);
  });
});

describe("вкладка «Отчёты»", () => {
  beforeEach(() => { localStorage.clear(); });

  it("стоит в главном ряду", () => {
    expect(TAB_LIST.map(([k]) => k)).toContain("reports");
  });

  it("карту ведёт владелец: чужому она не отдаётся и не рисуется", () => {
    /* Сервер отдаёт карту только владельцу. Рисовать остальным пустую карту
       с кнопками, которые ничего не сохранят, значило бы обещать работу,
       которой не будет; наружу отчёт уходит ссылкой. */
    expect(TAB_LIST.map(([k]) => k)).toContain("reports");
  });

  it("открывается и предлагает завести проект", () => {
    render(<SystemModel />);
    fireEvent.click(screen.getByRole("button", { name: "Отчёты" }));
    expect(screen.getByText(/Проектов пока нет/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ проект" })).toBeInTheDocument();
  });

  it("внутренняя ссылка на блок читается из адреса", () => {
    expect(reportFromLocation("?report=rs1")).toBe("rs1");
    expect(reportFromLocation("")).toBeNull();
    expect(shareLink("abc", "https://x.test/")).toBe("https://x.test/?share=abc");
  });
});
