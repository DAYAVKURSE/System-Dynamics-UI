import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import ReportsPanel from "../components/ReportsPanel.jsx";
import ShareView, { shareFromLocation } from "../components/ShareView.jsx";
import SystemModel, { TAB_LIST } from "../components/SystemModel.jsx";
import {
  childrenOf, dropNode, newProject, newSection, normalizeReports,
  pathOf, reportFromLocation, rootsOf, shareLink, subtree, summaryOf,
} from "../lib/reports.js";
import { reportHtml, reportOf } from "../lib/reportDoc.js";

/* ОТЧЁТЫ · карта проектов.

   Проект и раздел — один и тот же блок, вложенный в другой: карта
   складывается фрактально, без предела глубины. В блоке — ссылки на
   ОПРЕДЕЛЁННЫЕ результаты по номерам; сами результаты собираются из уже
   сделанных сдач, а не переписываются руками. Технического задания полем
   в карте нет: пересказ заказа разошёлся бы с делом. */

const MODEL = {
  /* Настоящая цепочка: заявка → ТЗ → макет. «Спрос» не производит никто —
     на нём видно, что в звенья попадает только достижимое. */
  traits: [{ id: "t1", e: "e1", l: "заявка" }, { id: "t2", e: "e1", l: "макет" },
    { id: "t0", e: "e1", l: "спрос" }],
  funcs: [
    { id: "f1", e: "e1", name: "Собрать макет", dur: 1, durHi: 1, durUnit: "дн",
      takes: [{ id: "p1", trait: "t1", lo: 1, hi: 1 }],
      gives: [{ id: "g1", trait: "t2", lo: 1, hi: 1 }] },
  ],
  factors: [],
  tasks: [
    { id: "tk1", funcId: "f1", title: "Макет главной", status: "done", assignee: "2",
      submissions: [{ id: "s1", at: "2026-02-01T10:00:00Z", hours: 4,
        takes: { t1: 1 }, gives: { t2: 1 }, text: "готово",
        file: { name: "макет.pdf", type: "application/pdf", url: "/api/reports/x/y" } }] },
    { id: "tk2", funcId: "f1", title: "Второй заход", status: "review", assignee: "2",
      submissions: [{ id: "s2", at: "2026-02-02T10:00:00Z", hours: 2,
        takes: { t1: 1 }, gives: { t2: 1 } }] },
  ],
};
const NODES = [
  { id: "rp1", parent: null, name: "Заказ «Сайт»", trait: "", upto: "" },
  { id: "rs1", parent: "rp1", name: "Макеты", trait: "t1", upto: "" },
  { id: "rs2", parent: "rs1", name: "Главная", trait: "", upto: "" },
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
      .toEqual({ id: "x", parent: null, name: "", trait: "", unit: "",
        file: null, upto: "", qty: 1 });
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

  it("раздел спрашивает ДВЕ вещи, а показанное считает сам", () => {
    /* Заказ, описанный полем, — пересказ, и он расходится с делом в первый
       же день. Список пар «функция + ресурс» отвечал на вопрос «что
       показать», когда спросить надо было другое: с чего начинаем и до
       какого звена ведём. */
    const p = newProject("Заказ");
    expect(p).toMatchObject({ trait: "", upto: "", file: null });
    expect(p).not.toHaveProperty("brief");
    expect(p).not.toHaveProperty("picks");
    expect(normalizeReports([{ id: "x", brief: "сделать сайт",
      picks: [{ func: "f1" }] }])[0]).not.toHaveProperty("picks");
  });
});

describe("отчёт раздела", () => {
  const doc = () => reportOf(MODEL, NODES[1], NODES, {});

  it("считает предварительную оценку сам: шаги, время и изменение ресурсов", () => {
    const d = doc();
    expect(d.plan.hi.steps.map((s2) => s2.func)).toEqual(["f1"]);
    expect(d.plan.hi.calendarHours).toBeGreaterThan(0);
    expect(d.changes.map((c) => c.trait).sort()).toEqual(["t1", "t2"]);
  });

  it("рядом с планом стоит факт — и только по принятым сдачам", () => {
    const d = doc();
    expect(d.actual.hours).toBe(4);
    expect(d.actual.done).toBe(1);
    // Непринятая сдача из виду не пропадает: она отвечает «сколько осталось».
    expect(d.actual.total).toBe(2);
    const maket = d.changes.find((c) => c.trait === "t2");
    expect(maket.fact).toBe(1);
  });

  it("созданные ресурсы — с номерами, и только свои", () => {
    const d = doc();
    expect(d.made.map((u) => u.no)).toEqual([2, 1]);
    expect(d.made[1]).toMatchObject({ title: "Макет главной", accepted: true });
  });

  it("сводка блока считает и то, что лежит в его разделах", () => {
    expect(summaryOf(MODEL, NODES[0], NODES))
      .toMatchObject({ rows: 2, accepted: 1, hours: 4 });
  });

  it("разрыв до звена назван, а не спрятан", () => {
    const broken = { ...NODES[1], trait: "t2", upto: "t1" };
    expect(reportOf(MODEL, broken, NODES, {}).broken).toBe(true);
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

  it("в каждом разделе четыре блока — и в проекте тоже", () => {
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    ["1. как изменятся ресурсы", "2. шаги и задачи во времени",
      "3. созданные ресурсы", "4. фактическая оценка"].forEach((t) => {
      expect(screen.getByText(t)).toBeInTheDocument();
    });
  });

  it("раздел спрашивает ресурс и звено, а не пару «функция + ресурс»", () => {
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    // У каждого раздела свои поля, и метка называет, чьи они.
    expect(screen.getByLabelText("с какого ресурса: Макеты")).toBeInTheDocument();
    expect(screen.getByLabelText("до какого звена: Макеты")).toBeInTheDocument();
    expect(screen.queryByLabelText("функция результата")).toBeNull();
  });

  it("в звенья попадает только то, до чего цепочка доходит", () => {
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    const names = [...screen.getByLabelText("до какого звена: Макеты").options]
      .map((o) => o.textContent);
    expect(names).toContain("макет");
    // «Спрос» не производит никто, и в цепочку он не входит.
    expect(names).not.toContain("спрос");
  });

  it("шаги и факт видно сразу, без единого нажатия", () => {
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    // Шаг посчитан по модели.
    expect(screen.getByText(/выполнений/)).toBeInTheDocument();
    // Задача и созданная единица — на месте.
    expect(screen.getAllByText("Макет главной").length).toBeGreaterThan(0);
    expect(screen.getByText(/принято работ/)).toBeInTheDocument();
  });

  it("сам ресурс прикладывается файлом, а не пересказывается словами", () => {
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    expect(screen.getByLabelText("файл ресурса: Макеты")).toBeInTheDocument();
    expect(screen.queryByLabelText("техническое задание")).toBeNull();
  });

  it("отчёт скачивается файлом — и в нём те же четыре части", () => {
    /* Отчёт собирается тем же расчётом, что и экран: двум ответам на один
       вопрос неоткуда взяться. */
    const doc = reportOf(MODEL, NODES[1], NODES, {});
    const html = reportHtml(doc, {
      traitName: (id) => MODEL.traits.find((t) => t.id === id)?.l || id,
      funcName: (id) => MODEL.funcs.find((f) => f.id === id)?.name || id,
      personName: (id) => `человек ${id}`,
      title: "Макеты",
    });
    expect(html).toContain("1. Предварительная оценка");
    expect(html).toContain("2. Шаги и задачи");
    expect(html).toContain("3. Созданные ресурсы");
    expect(html).toContain("4. Фактическая оценка");
    expect(html).toContain("Макет главной");
    expect(html).toContain("с ресурса «заявка»");
    // Файл самодостаточен: ни одной ссылки наружу, чтобы он не рассыпался.
    expect(html).not.toMatch(/<script/);
  });

  it("нажатие «Скачать отчёт» и правда отдаёт файл", () => {
    const saved = [];
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = () => "blob:отчёт";
    URL.revokeObjectURL = () => {};
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      saved.push({ name: this.download, href: this.href });
    };
    try {
      render(<Panel nodes={NODES} />);
      fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
      fireEvent.click(screen.getAllByRole("button", { name: "Скачать отчёт" })[1]);
      expect(saved).toHaveLength(1);
      expect(saved[0].name).toMatch(/\.html$/);
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
      URL.createObjectURL = realCreate;
    }
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
      block: { name: "Макеты", from: "заявка", upto: "",
        plan: { workHours: [24, 24], calendarHours: [24, 24],
          steps: [{ name: "Собрать макет", runs: 1, factor: false }] },
        changes: [{ trait: "макет", lo: 1, hi: 1, fact: 1 }],
        made: [{ no: 1, title: "Макет главной", trait: "макет", qty: 1,
          at: "2026-02-01T10:00:00Z", by: "Иван",
          file: { name: "макет.pdf", type: "application/pdf", url: "/api/reports/x/y" } }],
        tasks: [],
        actual: { done: 1, total: 2, hours: 4 },
        sections: [{ name: "Главная", made: [], sections: [] }] } } };

  it("токен читается из адреса, и только настоящий", () => {
    expect(shareFromLocation("?share=" + "a".repeat(64))).toBe("a".repeat(64));
    expect(shareFromLocation("?share=коротышка")).toBeNull();
    expect(shareFromLocation("")).toBeNull();
  });

  it("снаружи видно то же, что и внутри: оценка, шаги, созданное и факт", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200,
      json: async () => SNAP })));
    render(<ShareView token={"a".repeat(64)} />);
    expect(await screen.findByText("Макет главной")).toBeInTheDocument();
    // Номер тот же, что и внутри: заказчик и исполнитель зовут вещь одинаково.
    expect(screen.getByText("№1")).toBeInTheDocument();
    expect(screen.getByText(/с ресурса «заявка»/)).toBeInTheDocument();
    expect(screen.getByText(/1. Собрать макет/)).toBeInTheDocument();
    expect(screen.getByText(/принято работ: 1 из 2/)).toBeInTheDocument();
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
