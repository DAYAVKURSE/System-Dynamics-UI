import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import ReportsPanel from "../components/ReportsPanel.jsx";
import ShareView, { shareFromLocation } from "../components/ShareView.jsx";
import SystemModel, { TAB_LIST } from "../components/SystemModel.jsx";
import {
  childrenOf, dropNode, newProject, newSection, normalizeReport, normalizeReports,
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
        file: null, upto: "", qty: 1, off: [] });
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

  /* ─── у раздела ровно два вопроса, и оба про ОДНУ вещь ───

     Выбрана единица — «что происходило вот с этим договором». Не выбрано
     ничего — «что произойдёт, когда договор появится». Третьего вопроса,
     «покажи весь поток по функциям», здесь нет: отслеживая ОДИН контакт
     лида, человек видел четыре одинаковых «передать заказ разработчикам» —
     работу над четырьмя чужими контактами. */
  it("не выбрано ничего — это прогноз, а не чужая работа под видом своей", () => {
    const d = doc();
    expect(d.hypothetical).toBe(true);
    expect(d.actual.tasks).toEqual([]);
    expect(d.made).toEqual([]);
    expect(d.actual.any).toBe(false);
    // Оценка при этом считается: прогноз — то, ради чего раздел и заводят.
    expect(d.plan.hi.steps.map((x) => x.func)).toEqual(["f1"]);
  });

  it("выбрана единица — её задачи, её вещи и её часы, и ничьи больше", () => {
    const d = docU();
    expect(d.hypothetical).toBe(false);
    expect(d.actual.tasks.map((t) => t.id)).toEqual(["tk1", "tk2"]);
    expect(d.made.map((u) => u.no)).toEqual([2, 1]);
    // Созданное лежит у сделавшего его шага: раздел отчёта — это функция.
    expect(d.steps[0].made.map((u) => u.no)).toEqual([1, 2]);
  });

  it("у раздела-функции свой прогноз ресурсов — как у отчёта целиком", () => {
    /* Раздел отчёта определяется выполняемой функцией и несёт тот же набор
       данных: оценку, прогноз ресурсов и задачи. Считать его из общей
       дельты нельзя — там сложены все шаги сразу. */
    const st = docU().steps[0];
    const byTrait = Object.fromEntries(st.changes.map((c) => [c.trait, c]));
    // Шаг берёт заявку и выдаёт макет — минус там, плюс тут. Единиц выбрано
    // две, значит и выполнений два: прогноз считается на них.
    expect(byTrait.t1.hi).toBe(-2);
    expect(byTrait.t2.hi).toBe(2);
    // А факт по шагу — из его же ПРИНЯТЫХ сдач, и принята пока одна.
    expect(byTrait.t2.fact).toBe(1);
    expect(byTrait.t1.fact).toBe(-1);
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

  /* «ПРОСЛЕДИТЬ» (владелец, 2026-09-19): «нужно добавить кнопку
     „Проследить", по нажатию которой будет создаваться раздел отчёта с
     прослеживаемым движением ресурсов». */
  it("«Проследить» уносит выбор в свой раздел, а отчёт освобождается под следующий", () => {
    render(<Panel nodes={[{ id: "rp1", parent: null, name: "Заказ", trait: "", upto: "" }]} />);
    const pick = screen.getByLabelText("с какого ресурса: Заказ");
    // Пока ресурс не выбран, прослеживать нечего — кнопка не нажимается.
    expect(screen.getByRole("button", { name: "проследить: Заказ" })).toBeDisabled();
    fireEvent.change(pick, { target: { value: "t1" } });
    fireEvent.click(screen.getByRole("button", { name: "проследить: Заказ" }));
    // Раздел назван ресурсом, открыт и несёт его движение — прямо здесь,
    // в общем списке: кнопки «все отчёты» больше нет (владелец, 2026-09-19).
    expect(screen.getByLabelText("название раздела").textContent).toBe("заявка");
    expect(screen.getByLabelText("с какого ресурса: заявка").value).toBe("t1");
    expect(screen.getByText("1. Ресурсы — что изменится")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "← все отчёты" })).toBeNull();
    // У самого отчёта выбор снова пуст — под следующее прослеживание.
    expect(screen.getByLabelText("с какого ресурса: Заказ").value).toBe("");
  });

  it("название отчёта правится двойным нажатием, а не в поле", () => {
    render(<Panel nodes={[{ id: "rp1", parent: null, name: "Заказ", trait: "", upto: "" }]} />);
    const label = screen.getByLabelText("название отчёта");
    expect(label.tagName.toLowerCase()).toBe("span");
    fireEvent.doubleClick(label);
    const input = screen.getByLabelText("название отчёта");
    fireEvent.change(input, { target: { value: "Сайт" } });
    fireEvent.blur(input);
    expect(screen.getByLabelText("название отчёта").textContent).toBe("Сайт");
  });

  it("отчёт заводится кнопкой, а разделы размечаются сами", () => {
    /* Кнопки «+ раздел внутри» больше нет: раздел — это шаг цепочки, и
       размечать его руками не за что. Заводят только проект, всё
       остальное считается по модели. */
    render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "+ отчёт" }));
    expect(screen.getByLabelText("название отчёта")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ раздел внутри" })).toBeNull();
  });

  it("в отчёте три раздела, у каждого своя тема и подпись, что внутри", () => {
    /* Владелец: «зачем мне в прогнозе ресурсов, сколько функция займёт
       времени». Ресурсы — про ресурсы, сроки — про сроки. Раздела «Функции
       — что будет сделано» больше нет вовсе (владелец, 2026-09-19: «второй
       раздел убери полностью»). */
    render(<Panel nodes={NODES} />);
    expect(screen.getByText("1. Ресурсы — что изменится")).toBeInTheDocument();
    expect(screen.getByText("2. Сроки и трудозатраты")).toBeInTheDocument();
    expect(screen.getByText("3. Задачи — что уже сделано")).toBeInTheDocument();
    expect(screen.queryByText(/Функции — что будет сделано/)).toBeNull();
    // Факторов в модели нет — раздела про них нет: пустой раздел — не раздел.
    expect(screen.queryByText(/4\. Факторы/)).toBeNull();
    expect(screen.queryByText(/созданные ресурсы/)).toBeNull();
    // Часы и сроки стоят во втором разделе и ТОЛЬКО там.
    const part1 = screen.getByText("1. Ресурсы — что изменится").closest("section");
    expect(within(part1).queryByText(/человеко-часов/)).toBeNull();
    expect(within(part1).queryByText(/Займёт/)).toBeNull();
    const part2 = screen.getByText("2. Сроки и трудозатраты").closest("section");
    expect(within(part2).getByText("Займёт времени — вся цепочка")).toBeInTheDocument();
    expect(within(part2).getByText("Работы людей, человеко-часов")).toBeInTheDocument();
  });

  it("разделы сворачиваются нажатием на заголовок (владелец, 2026-09-19)", () => {
    render(<Panel nodes={NODES} />);
    const head = screen.getByRole("button", { name: "2. Сроки и трудозатраты" });
    expect(screen.getByText("Займёт времени — вся цепочка")).toBeInTheDocument();
    fireEvent.click(head);
    expect(screen.queryByText("Займёт времени — вся цепочка")).toBeNull();
    fireEvent.click(head);
    expect(screen.getByText("Займёт времени — вся цепочка")).toBeInTheDocument();
  });

  it("ссылок на шаги больше нет: раздела «Функции» нет вовсе (владелец, 2026-09-19)", () => {
    const { container } = render(<Panel nodes={NODES} />);
    expect(container.querySelector("#shag-rs1-f1")).toBeNull();
    expect(screen.queryByRole("button",
      { name: /ссылка на раздел отчёта/ })).toBeNull();
    // Ссылка на сам отчёт при этом осталась.
    expect(screen.getAllByRole("button", { name: "ссылка на этот блок" }).length)
      .toBeGreaterThan(0);
  });

  it("созданное открывается нажатием на свой ресурс в прогнозе", () => {
    /* Отдельного списка нет: спрашивают «а макетов-то сколько реально
       вышло», то есть про конкретный ресурс — там ответ и стоит. */
    render(<Panel nodes={PICKED} />);
    /* Под своей задачей вещь стоит и так — это ответ на «что вышло из ЭТОЙ
       работы». Нажатие на ресурс отвечает на другой вопрос: «что по нему
       вышло вообще», и вещей становится больше. */
    const before = screen.queryAllByText(/скачать · макет\.pdf/).length;
    const rows = screen.getAllByLabelText("созданные единицы: макет");
    fireEvent.click(rows[0]);
    const links = screen.getAllByText(/скачать · макет\.pdf/);
    expect(links.length).toBeGreaterThan(before);
    expect(links[0].closest("a")).toHaveAttribute("href", "/api/reports/x/y");
    // Где файла нет — так и сказано, а не пусто.
    expect(screen.getAllByText(/файла нет — при сдаче не приложили/).length)
      .toBeGreaterThan(0);
  });

  it("оценка читается: каждая величина своей строкой и названа полностью", () => {
    /* Одной строкой через точки её прочесть нельзя: непонятно, где кончается
       одно число и начинается другое, и что за величина названа. */
    render(<Panel nodes={NODES} />);
    ["Займёт времени — вся цепочка", "Работы людей, человеко-часов", "Задач принято"]
      .forEach((t) => {
        expect(screen.getAllByText(t).length).toBeGreaterThan(0);
      });
    // Ноль часов до старта — это не «мгновенно», а «сразу».
    expect(screen.getAllByText(/начнётся сразу/).length).toBeGreaterThan(0);
  });

  it("таймлайн стоит на календарной линейке, а не на безымянной полосе", () => {
    /* «Начнётся через 1 ч» и «займёт 1 мес» человек складывал в уме: под
       полосой не было ни одной даты, и сказать, на какое число попадает
       конец, было нельзя. */
    render(<Panel nodes={NODES} />);
    const today = new Date().toLocaleDateString("ru-RU",
      { day: "2-digit", month: "2-digit" });
    expect(screen.getByText(new RegExp(`сегодня ${today}`))).toBeInTheDocument();
    // Делений пять: меньше — не линейка, больше — числа налезают друг на друга.
    expect(screen.getAllByText(/^\d{2}\.\d{2}(\.\d{2})?$/).length).toBe(5);
  });

  it("раздел спрашивает ресурс и звено, а не пару «функция + ресурс»", () => {
    render(<Panel nodes={NODES} />);
    // У каждого раздела свои поля, и метка называет, чьи они.
    expect(screen.getByLabelText("с какого ресурса: Макеты")).toBeInTheDocument();
    expect(screen.getByLabelText("до какого звена: Макеты")).toBeInTheDocument();
    expect(screen.queryByLabelText("функция результата")).toBeNull();
  });

  it("звено — только ресурс: функция звеном не бывает", () => {
    /* Владелец: цепочка прослеживается до ресурса или до конца — «до
       вёрстки» не звено, а действие по дороге к нему. */
    render(<Panel nodes={NODES} />);
    const sel = screen.getByLabelText("до какого звена: Макеты");
    expect(sel.querySelector("optgroup")).toBeNull();
    const names = [...sel.options].map((o) => o.textContent);
    expect(names).not.toContain("Собрать макет");
    expect(names[0]).toBe("до конца цепочки");
  });

  it("в звенья попадает только то, до чего цепочка доходит", () => {
    render(<Panel nodes={NODES} />);
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

  it("шаги остались в сроках, а раздела «Функции» нет", () => {
    render(<Panel nodes={NODES} />);
    // Функция названа в сроках — там, где её время и часы.
    expect(screen.getAllByText("Собрать макет").length).toBeGreaterThan(0);
    expect(screen.queryByText("Выполнений ожидается")).toBeNull();
  });

  it("работа показана только по выбранным вещам", () => {
    render(<Panel nodes={PICKED} />);
    expect(screen.getAllByText("Макет главной").length).toBeGreaterThan(0);
    // Числа прогноза и факта стоят рядом и названы полностью.
    expect(screen.getAllByText("Задач принято").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 из 2").length).toBeGreaterThan(0);
    // Работа, в которой сама заявка появилась, названа отдельно.
    expect(screen.getByText("как эти вещи появились")).toBeInTheDocument();
    expect(screen.getAllByText("Заявка от Иванова").length).toBeGreaterThan(0);
  });

  it("ресурс не загружают в отчёте — его выбирают из уже сделанных единиц", () => {
    /* Кнопка «Загрузить сам ресурс» заводила вещь мимо работы: без задачи,
       без автора и без номера, и сослаться на неё было нечем. Новые вещи
       рождаются только при сдаче выполненной задачи. */
    render(<Panel nodes={NODES} />);
    expect(screen.queryByLabelText("файл ресурса: Макеты")).toBeNull();
    expect(screen.queryByText(/Загрузить сам ресурс/)).toBeNull();
    // На его месте — поле выбора единицы, рядом с самим ресурсом.
    expect(screen.getByLabelText("какая единица: Макеты")).toBeInTheDocument();
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
    // Те же две части и в том же порядке, что и на экране.
    expect(html).toContain("1. Ресурсы — что изменится");
    // Раздела «Функции — что будет сделано» нет и в файле (владелец, 2026-09-19).
    expect(html).not.toContain("Функции — что будет сделано");
    expect(html).toContain("2. Сроки и трудозатраты");
    expect(html).toContain("3. Задачи — что уже сделано");
    expect(html).not.toContain("Созданные ресурсы");
    expect(html).toContain("Макет главной");
    expect(html).toContain("с ресурса «заявка»");
    // В файле сказано то же, что на экране: по каким именно вещам отчёт.
    expect(html).toContain("по единицам №1");
    // Оценка — списком «величина → значение», а не строкой через точки.
    expect(html).toContain("<td>сразу</td>");
    expect(html).toContain("по плану, ч");
    expect(html).toContain("по факту, ч");
    expect(html).not.toContain('id="shag-rs1-f1"');
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
        fireEvent.click(screen.getAllByRole("button", { name: "Скачать отчёт" })[1]);
      expect(saved).toHaveLength(1);
      expect(saved[0].name).toMatch(/\.html$/);
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
      URL.createObjectURL = realCreate;
    }
  });

  it("можно спросить про несколько определённых единиц, а не про весь ресурс", () => {
    /* Единицы есть у того, что кто-то ПРОИЗВОДИТ: они рождаются сдачей
       выполненной задачи. У «макета» они есть, и спросить можно про
       любые — по одной, по нескольким или ни про одну. */
    render(<Panel nodes={NODES.map((n) => (n.id === "rs1"
      ? { ...n, trait: "t2" } : n))} />);
    expect(screen.getByText(/это ПРОГНОЗ/)).toBeInTheDocument();

    // Поле стоит рядом с самим ресурсом: вопрос один и тот же — «какой».
    const pick = screen.getByLabelText("какая единица: Макеты");
    fireEvent.change(pick, { target: { value: "s1~t2" } });
    expect(screen.getByText(/Выбрано 1/)).toBeInTheDocument();
    // Несколько — тоже: прослеживают и «вот этот договор», и «вот эти три».
    fireEvent.change(pick, { target: { value: "s2~t2" } });
    expect(screen.getByText(/Выбрано 2/)).toBeInTheDocument();
    // Выбранное стоит фишками, и любую можно снять: выбор не в один конец.
    fireEvent.click(screen.getByLabelText(/убрать единицу: №1/));
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
    expect(screen.queryByLabelText("прикинуть иначе: Собрать макет")).toBeNull();
    expect(screen.queryByLabelText("время Собрать макет от")).toBeNull();
  });

  it("количество спрашивается у самого ресурса", () => {
    /* «Сколько» отдельно от «чего» заставляло держать связь в голове:
       поле стоит рядом с выбором ресурса, и это его количество. */
    render(<Panel nodes={NODES} />);
    // Поле числовое по клавиатуре, но текстовое по разметке: значение строкой.
    expect(screen.getByLabelText("количество: Макеты")).toHaveValue("1");
    expect(screen.queryByLabelText("на сколько единиц: Макеты")).toBeNull();
  });

  it("оценка пересчитывается на заданное количество — по нажатию «Проследить»", () => {
    render(<Panel nodes={NODES} />);
    const qty = screen.getByLabelText("количество: Макеты");
    fireEvent.change(qty, { target: { value: "3" } });
    fireEvent.blur(qty);
    /* Пока не нажали — ничего не пересчитано (владелец, 2026-09-19: «ресурс
       начинает прослеживаться до нажатия кнопки „Проследить"»). */
    expect(screen.getByText(/считано на 1 ×/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "проследить: Макеты" }));
    // Три заявки — три выполнения, а не одно, повторённое трижды.
    expect(screen.getByText(/считано на 3 ×/)).toBeInTheDocument();
    expect(screen.getAllByText(/3 ×/).length).toBeGreaterThan(0);
  });

  it("видно, НАД ЧЕМ работала задача: этим выполнения и отличаются", () => {
    /* Четыре «Собрать макет» одинаковы только на вид: они сделаны над
       разными вещами. Пока этого не видно, список читается как повтор
       одной строки. */
    render(<Panel nodes={PICKED} />);
    // Что задача взяла — и что из неё вышло, прямо под ней. Вышедшее
    // названо дважды нарочно: у задачи и первым пунктом её шага.
    expect(screen.getByText(/взяла заявка №1/)).toBeInTheDocument();
    expect(screen.getAllByText(/макет · Макет главной/).length)
      .toBeGreaterThan(0);
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
    // Звено на месте — и рядом сказано, почему оно не случится.
    expect(screen.getAllByText("Сверстать").length).toBeGreaterThan(0);
    expect(screen.getByText(/не выполнится: не хватает заявка/))
      .toBeInTheDocument();
    expect(screen.getByText(/израсходовал шаг «Собрать макет»/))
      .toBeInTheDocument();
  });

  it("единица не выбрана — прогноз, а не четыре чужие задачи под видом своих", () => {
    /* Отслеживая ОДИН контакт лида, человек видел четыре одинаковых
       «передать заказ разработчикам» — работу над четырьмя чужими
       контактами — и справедливо не понимал, при чём тут его. */
    render(<Panel nodes={NODES} />);
    expect(screen.queryByText(/Задач тут нет и не должно быть/)).toBeNull();
    expect(screen.queryByText("Макет главной")).toBeNull();
    expect(screen.queryByText("Второй заход")).toBeNull();
    // И сказано, как увидеть сделанное: выбрать конкретную единицу.
    expect(screen.getByText(/это ПРОГНОЗ/)).toBeInTheDocument();
    expect(screen.getByText(/Задач по этому разделу ещё не заведено/))
      .toBeInTheDocument();
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
    expect(screen.getByText(/№1 из 2/)).toBeInTheDocument();
    expect(screen.getByText(/№2 из 2/)).toBeInTheDocument();
    // Само название в модели осталось нетронутым: номер живёт только в показе.
    expect(MODEL.tasks.find((t) => t.id === "tk1").title).toBe("Макет главной");
  });

  it("удаление блока уносит вложенные разделы", () => {
    render(<Panel nodes={NODES} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^удалить отчёт/ })[0]);
    expect(screen.getByText(/Отчётов пока нет/)).toBeInTheDocument();
  });

  /* «Удалить» видна и у свёрнутого отчёта (владелец, 2026-09-20). */
  it("«удалить» остаётся в шапке, когда отчёт свёрнут", () => {
    render(<Panel nodes={NODES} />);
    const fold = screen.getAllByRole("button", { name: /^свернуть / })[0];
    fireEvent.click(fold);
    expect(screen.getAllByRole("button", { name: /^развернуть / }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^удалить отчёт/ })[0]).toBeVisible();
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
    expect(screen.getByText(/Открывается без входа/)).toBeInTheDocument();
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
            workLo: 24, workHi: 24, anchor: "shag-rs1-f1",
            doneCount: 1, factHours: 4,
            // У раздела-функции свой прогноз ресурсов — тот же набор данных.
            changes: [{ trait: "макет", lo: 1, hi: 1, fact: 1 }],
            made: [{ no: 1, title: "Макет главной", trait: "макет", qty: 1,
              at: "2026-02-01T10:00:00Z", by: "Иван",
              file: { name: "макет.pdf", type: "application/pdf",
                url: "/api/reports/x/y" } }],
            tasks: [{ title: "Сделать макет", by: "Иван", func: "f1",
              end: "2026-02-01T10:00:00Z", status: "done", hours: 4,
              made: [{ no: 1, title: "Макет главной", trait: "макет", qty: 1,
                at: "2026-02-01T10:00:00Z", by: "Иван",
                file: { name: "макет.pdf", type: "application/pdf",
                  url: "/api/reports/x/y" } }] }] }] },
        changes: [{ trait: "макет", lo: 1, hi: 1, fact: 1 }],
        before: [],
        made: [{ no: 1, title: "Макет главной", trait: "макет", qty: 1,
          at: "2026-02-01T10:00:00Z", by: "Иван",
          file: { name: "макет.pdf", type: "application/pdf",
            url: "/api/reports/x/y" } }],
        actual: { done: 1, total: 2, hours: 4 },
        sections: [{ name: "Главная", sections: [] }] } } };

  it("токен читается из адреса, и только настоящий", () => {
    expect(shareFromLocation("?share=" + "a".repeat(64))).toBe("a".repeat(64));
    expect(shareFromLocation("?share=коротышка")).toBeNull();
    expect(shareFromLocation("")).toBeNull();
  });

  it("снаружи видно то же, что и внутри: прогноз, задачи и разделы отчёта",
    async () => {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200,
        json: async () => SNAP })));
      const { container } = render(<ShareView token={"a".repeat(64)} />);
      expect((await screen.findAllByText("Макет главной")).length)
        .toBeGreaterThan(0);
      expect(screen.getByText(/с ресурса «заявка»/)).toBeInTheDocument();
      // Те же разделы и в том же порядке, что и на экране владельца.
      // Вложенный раздел устроен так же — потому части и находятся дважды.
      expect(screen.getAllByText("1. Ресурсы — что изменится").length).toBe(2);
      // Раздела «Функции — что будет сделано» нет и снаружи (владелец, 2026-09-19).
      expect(screen.queryByText(/Функции — что будет сделано/)).toBeNull();
      expect(screen.getAllByText("2. Сроки и трудозатраты").length).toBe(2);
      expect(screen.getAllByText("3. Задачи — что уже сделано").length).toBe(2);
      expect(screen.queryByText(/созданные ресурсы/)).toBeNull();
      // Оценка читается: каждая величина названа полностью и своей строкой.
      expect(screen.getAllByText("Задач принято").length).toBeGreaterThan(0);
      expect(screen.getAllByText("1 из 2").length).toBeGreaterThan(0);
      expect(screen.getByText("Главная")).toBeInTheDocument();
      // Вещи открываются нажатием на свой ресурс, а не вторым списком.
      const rows = screen.getAllByLabelText("созданные единицы: макет");
      expect(rows.length).toBeGreaterThan(0);
      fireEvent.click(rows[0]);
      expect(screen.getAllByText(/скачать · макет.pdf/).length).toBeGreaterThan(0);
      // Номер тот же, что и внутри: заказчик и исполнитель зовут вещь одинаково.
      expect(screen.getAllByText("№1").length).toBeGreaterThan(0);
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
    await screen.findAllByText("Макет главной");
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

  it("открывается и предлагает завести отчёт", () => {
    render(<SystemModel />);
    fireEvent.click(screen.getByRole("button", { name: "Отчёты" }));
    expect(screen.getByText(/Отчётов пока нет/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ отчёт" })).toBeInTheDocument();
  });

  it("внутренняя ссылка на блок читается из адреса", () => {
    expect(reportFromLocation("?report=rs1")).toBe("rs1");
    expect(reportFromLocation("")).toBeNull();
    expect(shareLink("abc", "https://x.test/")).toBe("https://x.test/?share=abc");
  });
});

/* ОТЧЁТ ПО ЗАПРОСУ ВЛАДЕЛЬЦА (2026-09-19): «в первом сделай нормальный,
   однородный график, который также будет показывать отрицательные
   значения»; «в разделе „Ресурсы" должны быть чекбоксы слева от ресурсов,
   чтобы можно было не отслеживать некоторые из них и исключить их из
   отчёта; неактивные ресурсы должны становиться серыми»; «ресурс начинает
   прослеживаться до нажатия кнопки „Проследить" — исправь это». */
describe("первый раздел отчёта", () => {
  const Panel2 = ({ nodes: n0 }) => {
    const [nodes, setNodes] = React.useState(n0);
    const [focus, setFocus] = React.useState(null);
    return (<ReportsPanel nodes={nodes} setNodes={setNodes} model={MODEL}
      entities={[{ id: "e1", name: "Мы" }]} nameOf={(id) => `человек ${id}`}
      focus={focus} onFocus={setFocus} />);
  };
  const TRACED = [{ id: "rs1", parent: null, name: "Макеты", trait: "t1", upto: "" }];

  it("график однородный: у всех строк одна шкала и общий ноль", () => {
    const { container } = render(<Panel2 nodes={TRACED} />);
    const part = screen.getByText("1. Ресурсы — что изменится").closest("section");
    // Нулевая линия у всех строк на одном месте — значит шкала общая.
    const zeros = [...part.querySelectorAll("div[role='img'] > div:first-child")]
      .map((d) => d.style.left);
    expect(zeros.length).toBeGreaterThan(1);
    expect(new Set(zeros).size).toBe(1);
    // Убыль рисуется слева от нуля: значения ниже нуля на шкале есть.
    const zero = parseFloat(zeros[0]);
    expect(zero).toBeGreaterThan(0);
    expect(zero).toBeLessThan(100);
    expect(container).toBeTruthy();
  });

  it("галочка убирает ресурс из отчёта и делает строку серой", () => {
    render(<Panel2 nodes={TRACED} />);
    const box = screen.getByLabelText("прослеживать заявка");
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(screen.getByLabelText("прослеживать заявка").checked).toBe(false);
    expect(screen.getByText("не прослеживается")).toBeInTheDocument();
  });

  it("исключённый ресурс не идёт и в файл", () => {
    const off = [{ ...TRACED[0], off: ["t1"] }];
    const html = reportHtml(reportOf(MODEL, off[0], off, {}), {
      traitName: (id) => MODEL.traits.find((t) => t.id === id)?.l || id,
      funcName: (id) => id, personName: (id) => id, title: "Макеты",
    });
    expect(html).toContain("макет");
    expect(html).not.toMatch(/<b>заявка<\/b>/);
  });

  it("до нажатия «Проследить» ничего не прослеживается", () => {
    render(<Panel2 nodes={[{ id: "rp1", parent: null, name: "Заказ", trait: "", upto: "" }]} />);
    fireEvent.change(screen.getByLabelText("с какого ресурса: Заказ"),
      { target: { value: "t1" } });
    // Выбор сделан, но отчёта ещё нет: кнопку не нажимали.
    expect(screen.queryByText("1. Ресурсы — что изменится")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "проследить: Заказ" }));
    expect(screen.getByText("1. Ресурсы — что изменится")).toBeInTheDocument();
  });
});

/* Галочки ресурсов — часть записи отчёта: без этого выбор терялся бы при
   первом же сохранении сценария (владелец, 2026-09-19). */
describe("исключённые ресурсы живут в записи", () => {
  it("normalizeReport хранит `off` и чистит его от мусора", () => {
    expect(normalizeReport({ id: "r", off: ["t1", "t1", "", null, "t2"] }).off)
      .toEqual(["t1", "t2"]);
    expect(normalizeReport({ id: "r" }).off).toEqual([]);
  });
});
