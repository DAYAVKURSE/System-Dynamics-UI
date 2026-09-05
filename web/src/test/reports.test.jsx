import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import ReportsPanel from "../components/ReportsPanel.jsx";
import ShareView, { shareFromLocation } from "../components/ShareView.jsx";
import SystemModel, { TAB_LIST } from "../components/SystemModel.jsx";
import {
  briefOf, childrenOf, dropNode, newProject, newSection, normalizeReports,
  pathOf, reportFromLocation, resultsOf, rootsOf, shareLink, subtree, summaryOf,
} from "../lib/reports.js";

/* ОТЧЁТЫ · карта проектов.

   Проект и раздел — один и тот же блок, вложенный в другой: карта
   складывается фрактально, без предела глубины. В блоке сказано, результаты
   какой функции и по какому ресурсу в него попадают; остальное собирается
   из уже сделанных сдач, а не переписывается руками. */

const MODEL = {
  traits: [{ id: "t2", e: "e1", l: "макет" }],
  funcs: [{ id: "f1", e: "e1", name: "Собрать макет" }],
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
  { id: "rp1", parent: null, name: "Заказ «Сайт»", brief: "сделать сайт", picks: [] },
  { id: "rs1", parent: "rp1", name: "Макеты", brief: "",
    picks: [{ id: "pk1", func: "f1", trait: "t2" }] },
  { id: "rs2", parent: "rs1", name: "Главная", brief: "", picks: [] },
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
      .toEqual({ id: "x", parent: null, name: "", brief: "", picks: [] });
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

  it("задание наследуется сверху, а не копируется в каждый раздел", () => {
    // Копии разошлись бы: в одном месте поправили, в другом забыли.
    expect(briefOf(NODES, "rs2").node.id).toBe("rp1");
    const own = NODES.map((n) => (n.id === "rs1" ? { ...n, brief: "своё" } : n));
    expect(briefOf(own, "rs1").brief).toBe("своё");
    expect(briefOf(own, "rs2").brief).toBe("своё");
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

  it("раздел показывает задание проекта, пока не завёл своё", () => {
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    expect(screen.getByText(/Действует задание «Заказ «Сайт»»/)).toBeInTheDocument();
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
      brief: { name: "Заказ «Сайт»", text: "сделать сайт" },
      block: { name: "Макеты", brief: "",
        results: [{ title: "Макет главной", func: "Собрать макет", trait: "макет",
          at: "2026-02-01T10:00:00Z", by: "Иван", hours: 4, qty: 1, text: "готово",
          file: { name: "макет.pdf", type: "application/pdf", url: "/api/reports/x/y" } }],
        sections: [{ name: "Главная", brief: "", results: [], sections: [] }] } } };

  it("токен читается из адреса, и только настоящий", () => {
    expect(shareFromLocation("?share=" + "a".repeat(64))).toBe("a".repeat(64));
    expect(shareFromLocation("?share=коротышка")).toBeNull();
    expect(shareFromLocation("")).toBeNull();
  });

  it("показывает задание, сделанное и вложенные разделы — без входа", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200,
      json: async () => SNAP })));
    render(<ShareView token={"a".repeat(64)} />);
    expect(await screen.findByText("Макет главной")).toBeInTheDocument();
    expect(screen.getByText(/сделать сайт/)).toBeInTheDocument();
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
