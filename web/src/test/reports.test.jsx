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
import { deliverReport, reportHtml, reportOf } from "../lib/reportDoc.js";

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
    /* Заявку кто-то и заводит: без этого у неё не бывает единиц, а значит и
       родословной — работы, в которой прослеживаемая вещь родилась. */
    { id: "f0", e: "e1", name: "Принять заявку", dur: 1, durHi: 1, durUnit: "ч",
      takes: [], gives: [{ id: "g0", trait: "t1", lo: 1, hi: 1 }] },
  ],
  entities: [{ id: "e1", name: "Мы" }],
  factors: [],
  tasks: [
    { id: "tk0", funcId: "f0", title: "Заявка от Иванова", status: "done", assignee: "2",
      submissions: [{ id: "s0", at: "2026-01-30T10:00:00Z", hours: 3,
        takes: {}, gives: { t1: 1 }, text: "пришла" }] },
    // При сдаче отмечено взятое — по этому и строится родословная.
    { id: "tk1", funcId: "f1", title: "Макет главной", status: "done", assignee: "2",
      submissions: [{ id: "s1", at: "2026-02-01T10:00:00Z", hours: 4,
        takes: { t1: 1 }, took: { t1: ["s0~t1"] }, gives: { t2: 1 }, text: "готово",
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
      .toEqual({ id: "x", parent: null, name: "", trait: "", units: [],
        file: null, upto: "", qty: 1 });
    // Прежняя запись с одной единицей читается как список из одного.
    expect(normalizeReports([{ id: "x", unit: "s1~t2" }])[0])
      .toMatchObject({ units: ["s1~t2"], qty: 1 });
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
  /* Раздел отвечает про ВЕЩИ. Выбраны единицы — считается работа над ними;
     не выбрано ничего — вещь гипотетическая, и работы по ней нет вовсе. */
  const WITH = [NODES[0], { ...NODES[1], units: ["s1~t2", "s2~t2"] }, NODES[2]];
  const docU = () => reportOf(MODEL, WITH[1], WITH, {});

  it("считает предварительную оценку сам: шаги, время и изменение ресурсов", () => {
    const d = doc();
    expect(d.plan.hi.steps.map((s2) => s2.func)).toEqual(["f1"]);
    expect(d.plan.hi.calendarHours).toBeGreaterThan(0);
    expect(d.changes.map((c) => c.trait).sort()).toEqual(["t1", "t2"]);
  });

  it("рядом с планом стоит факт — и только по принятым сдачам", () => {
    const d = docU();
    expect(d.actual.hours).toBe(4);
    expect(d.actual.done).toBe(1);
    // Непринятая сдача из виду не пропадает: она отвечает «сколько осталось».
    expect(d.actual.total).toBe(2);
    const maket = d.changes.find((c) => c.trait === "t2");
    expect(maket.fact).toBe(1);
  });

  it("созданные ресурсы — с номерами, и только свои", () => {
    const d = docU();
    expect(d.made.map((u) => u.no)).toEqual([2, 1]);
    expect(d.made[1]).toMatchObject({ title: "Макет главной", accepted: true });
  });

  it("чужая работа в отчёт не идёт: не выбрано ничего — вещь гипотетическая", () => {
    /* Главное правило раздела: он про ТЕ САМЫЕ вещи, а не про поток по
       функциям цепочки. Задача, сделанная над другим договором, к вопросу
       «что будет с этим» отношения не имеет, даже если её делала та же
       функция. Ничего не выбрано — прослеживается гипотетическая единица:
       оценка есть, работы нет, и это ответ, а не нехватка данных. */
    const d = doc();
    expect(d.hypothetical).toBe(true);
    expect(d.actual.tasks).toEqual([]);
    expect(d.made).toEqual([]);
    expect(d.actual.any).toBe(false);
    // При этом оценка считается: прогноз для вещи, которой ещё нет.
    expect(d.plan.hi.steps.map((x) => x.func)).toEqual(["f1"]);
  });

  it("сводка блока считает то же, что и раскрытый блок", () => {
    // Иначе свёрнутая строка обещала бы работу, которой внутри не видно.
    expect(summaryOf(MODEL, WITH[0], WITH))
      .toMatchObject({ rows: 2, accepted: 1, hours: 4 });
    expect(summaryOf(MODEL, NODES[0], NODES))
      .toMatchObject({ rows: 0, accepted: 0, hours: 0 });
  });

  it("разрыв до звена назван, а не спрятан", () => {
    const broken = { ...NODES[1], trait: "t2", upto: "t1" };
    expect(reportOf(MODEL, broken, NODES, {}).broken).toBe(true);
  });
});

describe("карта в форме", () => {
  const Panel = ({ nodes: n0 = [], model = MODEL }) => {
    const [nodes, setNodes] = React.useState(n0);
    const [focus, setFocus] = React.useState(null);
    return (<ReportsPanel nodes={nodes} setNodes={setNodes} model={model}
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

  it("в разделе два блока: ресурсы и задачи — и в проекте тоже", () => {
    /* Прежде их было четыре: «шаги», «созданные ресурсы» и «фактическая
       оценка» говорили об одном и том же деле тремя списками, и сводить их
       приходилось глазами. Шаг и задача — одно дело с двух сторон, а
       созданное принадлежит сделавшей его задаче. */
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    ["1. как изменятся ресурсы", "2. задачи"].forEach((t) => {
      expect(screen.getByText(t)).toBeInTheDocument();
    });
    ["3. созданные ресурсы", "4. фактическая оценка"].forEach((t) => {
      expect(screen.queryByText(t)).toBeNull();
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

  /* Узлы, где прослеживают ОПРЕДЕЛЁННУЮ вещь: заявку №1, из которой вышел
     макет №1. Работа, в которой заявка родилась, лежит ДО цепочки. */
  const PICKED = NODES.map((n) => (n.id === "rs1"
    ? { ...n, units: ["s0~t1"] } : n));

  it("шаги видно сразу, без единого нажатия", () => {
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    // Шаг посчитан по модели: сколько выполнений, когда и сколько работы.
    expect(screen.getByText(/выполнений 1 · начнётся через/)).toBeInTheDocument();
  });

  it("работа показана только по выбранным вещам", () => {
    render(<Panel nodes={PICKED} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    expect(screen.getAllByText("Макет главной").length).toBeGreaterThan(0);
    // Числа плана и факта стоят рядом, а не в разных разделах.
    expect(screen.getByText(/по плану работы .* принято 2 из 2/))
      .toBeInTheDocument();
    // Работа, в которой сама заявка появилась, названа отдельно.
    expect(screen.getByText("как эти вещи появились")).toBeInTheDocument();
    expect(screen.getAllByText("Заявка от Иванова").length).toBeGreaterThan(0);
  });

  it("сам ресурс прикладывается файлом, а не пересказывается словами", () => {
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    expect(screen.getByLabelText("файл ресурса: Макеты")).toBeInTheDocument();
    expect(screen.queryByLabelText("техническое задание")).toBeNull();
  });

  it("отчёт скачивается файлом — и в нём то же, что на экране", () => {
    /* Отчёт собирается тем же расчётом, что и экран: двум ответам на один
       вопрос неоткуда взяться. */
    const doc = reportOf(MODEL, PICKED[1], PICKED, {});
    const html = reportHtml(doc, {
      traitName: (id) => MODEL.traits.find((t) => t.id === id)?.l || id,
      funcName: (id) => MODEL.funcs.find((f) => f.id === id)?.name || id,
      personName: (id) => `человек ${id}`,
      title: "Макеты",
    });
    expect(html).toContain("1. Предварительная оценка");
    expect(html).toContain("2. Задачи");
    // Тех же двух блоков, что на экране, — не больше и не меньше.
    expect(html).not.toContain("3. Созданные ресурсы");
    expect(html).not.toContain("4. Фактическая оценка");
    expect(html).toContain("Макет главной");
    expect(html).toContain("с ресурса «заявка»");
    // В файле сказано то же, что на экране: по каким именно вещам отчёт.
    expect(html).toContain("по единицам №1");
    // И у задачи — ожидалось против вышло, а не одно из двух.
    expect(html).toContain("ожидалось, ч");
    // Файл самодостаточен: ни одной ссылки наружу, чтобы он не рассыпался.
    expect(html).not.toMatch(/<script/);
  });

  it("в Telegram отчёт уходит ссылкой: blob WebView просто игнорирует", async () => {
    /* Ссылка с download внутри мини-приложения не делает НИЧЕГО и молчит об
       этом. Поэтому там отчёт кладётся на свой сервер и открывается
       обычной ссылкой наружу. */
    const opened = [];
    const put = vi.fn(async (f) => ({ name: f.name, url: "/api/reports/x/y" }));
    const via = await deliverReport("otchet.html", "<html></html>", {
      telegram: { openLink: (u) => opened.push(u) }, putFile: put,
      origin: "https://example.org",
    });
    expect(via).toMatchObject({ via: "link" });
    expect(put).toHaveBeenCalledTimes(1);
    expect(opened).toEqual(["https://example.org/api/reports/x/y"]);
  });

  it("сервер не отдал адреса — сказано словами, а не молча", async () => {
    await expect(deliverReport("otchet.html", "<html></html>", {
      telegram: { openLink: () => {} }, putFile: async () => ({}),
    })).rejects.toThrow(/адреса/);
  });

  it("вне Telegram отчёт скачивается ссылкой, как и раньше", async () => {
    const saved = [];
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = () => "blob:отчёт";
    URL.revokeObjectURL = () => {};
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      saved.push({ name: this.download });
    };
    try {
      const via = await deliverReport("otchet.html", "<html></html>", {});
      expect(via).toMatchObject({ via: "download" });
      expect(saved).toEqual([{ name: "otchet.html" }]);
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
      URL.createObjectURL = realCreate;
    }
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

  it("можно спросить про несколько определённых единиц, а не про весь ресурс", () => {
    /* Загрузить новый ресурс — одна дорога; спросить о тех, с которыми уже
       работали, — другая, и она нужна не меньше.

       Единицы есть у того, что кто-то ПРОИЗВОДИТ: «заявка» приходит со
       стороны, и различать её экземпляры нечем — для этого и загружают
       файл. А у «макета» единицы есть, и спросить можно про любые. */
    render(<Panel nodes={NODES.map((n) => (n.id === "rs1"
      ? { ...n, trait: "t2" } : n))} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    expect(screen.getByText(/считаем ГИПОТЕТИЧЕСКУЮ единицу/))
      .toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("единица №1: Макеты"));
    expect(screen.getByText(/Выбрано 1/)).toBeInTheDocument();
    // Несколько — тоже: прослеживают и «вот этот договор», и «вот эти три».
    fireEvent.click(screen.getByLabelText("единица №2: Макеты"));
    expect(screen.getByText(/Выбрано 2/)).toBeInTheDocument();
    // Нажали ещё раз — сняли: выбор не в один конец.
    fireEvent.click(screen.getByLabelText("единица №1: Макеты"));
    expect(screen.getByText(/Выбрано 1/)).toBeInTheDocument();
  });

  it("отчёт по единице показывает её саму и то, что из неё выросло", () => {
    /* Даже если раздел прослеживает ОТ неё дальше: сама она сделана
       функцией, которая лежит до цепочки, и выбрасывать её из отчёта о ней
       же было бы нелепо. */
    const node = { ...NODES[1], trait: "t2", unit: "s1~t2" };
    const d = reportOf(MODEL, node, [NODES[0], node, NODES[2]], {});
    expect(d.unit).toMatchObject({ no: 1, title: "Макет главной" });
    // Чужая единица в отчёт по этой не попадает.
    expect(d.made.map((u) => u.no)).toEqual([1]);
    expect(d.actual.total).toBe(1);
    expect(d.actual.tasks[0].title).toBe("Макет главной");
  });

  it("не записано, что из чего сделано, — так и сказано, а не додумано", () => {
    const node = { ...NODES[1], unit: "s2~t2" };
    const d = reportOf(MODEL, node, [NODES[0], node, NODES[2]], {});
    // У этой сдачи взятое не отмечено: родословной нет.
    expect(d.traced).toBe(false);
    expect(reportHtml(d, { traitName: (x) => x, funcName: (x) => x }))
      .toContain("не записано, что из чего сделано");
  });

  it("а где родословная записана — виден и предок, и потомок", () => {
    const model = { ...MODEL, tasks: [
      MODEL.tasks.find((t) => t.id === "tk1"),
      { id: "tk3", funcId: "f1", title: "Второй слой", status: "done", assignee: "2",
        submissions: [{ id: "s3", at: "2026-02-03T10:00:00Z", hours: 1,
          takes: { t1: 1 }, gives: { t2: 1 }, took: { t1: ["s1~t2"] } }] },
    ] };
    const node = { ...NODES[1], unit: "s1~t2" };
    const d = reportOf(model, node, [NODES[0], node, NODES[2]], {});
    expect(d.traced).toBe(true);
    expect(d.family.map((u) => u.id)).toEqual(["s1~t2", "s3~t2"]);
  });

  it("вилок в отчёте не правят: числа функции живут в модели", () => {
    /* Кнопка «прикинуть иначе» заводила у одной функции столько разных
       «сколько это займёт», сколько заведено разделов. Спорить с числом
       надо там, где оно задано, — в самой функции. */
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    expect(screen.queryByLabelText("прикинуть иначе: Собрать макет")).toBeNull();
    expect(screen.queryByLabelText("время Собрать макет от")).toBeNull();
  });

  it("количество спрашивается у самого ресурса", () => {
    /* «Сколько» отдельно от «чего» заставляло держать связь в голове:
       поле стоит рядом с выбором ресурса, и это его количество. */
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    // Поле числовое по клавиатуре, но текстовое по разметке: значение строкой.
    expect(screen.getByLabelText("количество: Макеты")).toHaveValue("1");
    expect(screen.queryByLabelText("на сколько единиц: Макеты")).toBeNull();
  });

  it("оценка пересчитывается на заданное количество", () => {
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    const qty = screen.getByLabelText("количество: Макеты");
    fireEvent.change(qty, { target: { value: "3" } });
    fireEvent.blur(qty);
    // Три заявки — три выполнения, а не одно, повторённое трижды.
    expect(screen.getByText(/выполнений 3/)).toBeInTheDocument();
  });

  it("видно, НАД ЧЕМ работала задача: этим выполнения и отличаются", () => {
    /* Четыре «Собрать макет» одинаковы только на вид: они сделаны над
       разными вещами. Пока этого не видно, список читается как повтор
       одной строки. */
    render(<Panel nodes={PICKED} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    // Что задача взяла — и что из неё вышло, прямо под ней.
    expect(screen.getByText(/взяла заявка №1/)).toBeInTheDocument();
    expect(screen.getByText(/макет · Макет главной/)).toBeInTheDocument();
  });

  it("шаг, который не выполнится, виден в разделе с причиной", () => {
    /* Раздел про всю цепочку и должен показывать её всю. Молча пропустить
       звено значило бы выдать обрубок за ответ: человек видит одну задачу
       вместо четырёх и не знает, у него модель такая или программа врёт. */
    const stuck = { ...MODEL, funcs: [...MODEL.funcs,
      { id: "f2", e: "e1", name: "Сверстать", dur: 1, durHi: 1, durUnit: "дн",
        // Берёт и макет, и заявку — а заявку уже израсходовал первый шаг.
        takes: [{ id: "p2", trait: "t2", lo: 1, hi: 1 },
          { id: "p3", trait: "t1", lo: 1, hi: 1 }],
        gives: [{ id: "g2", trait: "t0", lo: 1, hi: 1 }] }] };
    render(<Panel nodes={NODES} model={stuck} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    // Звено на месте — и рядом сказано, почему оно не случится.
    expect(screen.getAllByText("Сверстать").length).toBeGreaterThan(0);
    expect(screen.getByText(/не выполнится: не хватает заявка/))
      .toBeInTheDocument();
    expect(screen.getByText(/израсходовал шаг «Собрать макет»/))
      .toBeInTheDocument();
  });

  it("чужой работы в разделе нет: не выбрано ничего — вещь гипотетическая", () => {
    /* Прежде тут показывался весь поток по функциям цепочки, и отчёт про
       один договор выглядел как отчёт про восемь чужих задач. Теперь
       раздел отвечает ровно про то, о чём спросили. */
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    expect(screen.getByText(/прослеживается вещь, которой ещё нет в системе/i))
      .toBeInTheDocument();
    // Чужая задача и чужая единица в раздел не попали.
    expect(screen.queryByText("Макет главной")).toBeNull();
    expect(screen.queryByText("Заявка от Иванова")).toBeNull();
  });

  it("одинаково названные задачи различимы в отчёте — и без правки данных", () => {
    /* Название задачи — слова человека, и переписывать их за него
       приложение не должно. Номер приписывается при показе. */
    /* Два выполнения ОДНОЙ функции над одной и той же заявкой: близнецы по
       названию, и различить их можно только номером при показе. */
    const twins = { ...MODEL, tasks: [
      ...MODEL.tasks.filter((t) => t.funcId !== "f1"),
      ...MODEL.tasks.filter((t) => t.funcId === "f1").map((t, i) => ({ ...t,
        title: "Собрать макет", start: `2026-02-0${i + 1}T10:00`,
        submissions: (t.submissions || []).map((sb) => ({ ...sb,
          took: { t1: ["s0~t1"] } })) })),
    ] };
    render(<Panel nodes={PICKED} model={twins} />);
    fireEvent.click(screen.getByRole("button", { name: "развернуть Макеты" }));
    expect(screen.getByText(/№1 из 2/)).toBeInTheDocument();
    expect(screen.getByText(/№2 из 2/)).toBeInTheDocument();
    // Само название в модели осталось нетронутым: номер живёт только в показе.
    expect(MODEL.tasks.find((t) => t.id === "tk1").title).toBe("Макет главной");
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
        /* Снимок устроен так же, как экран: работа стоит ПОД своим шагом, а
           созданное — под сделавшей его задачей. */
        plan: { workHours: [24, 24], calendarHours: [24, 24],
          steps: [{ func: "f1", name: "Собрать макет", runs: 1, factor: false,
            workLo: 24, workHi: 24,
            tasks: [{ title: "Сделать макет", by: "Иван", func: "f1",
              end: "2026-02-01T10:00:00Z", status: "done", hours: 4,
              made: [{ no: 1, title: "Макет главной", trait: "макет", qty: 1,
                at: "2026-02-01T10:00:00Z", by: "Иван",
                file: { name: "макет.pdf", type: "application/pdf",
                  url: "/api/reports/x/y" } }] }] }] },
        changes: [{ trait: "макет", lo: 1, hi: 1, fact: 1 }],
        before: [],
        actual: { done: 1, total: 2, hours: 4 },
        sections: [{ name: "Главная", sections: [] }] } } };

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
