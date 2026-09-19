import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

// Карточки прогноза свёрнуты: имя и график. Всё остальное разворачивается
// нажатием на заголовок, поэтому тесты сначала раскрывают карточки.
const expandCards = (container) => {
  [...container.querySelectorAll("span")]
    .filter((s) => s.textContent === "\u25b8")
    .forEach((s) => fireEvent.click(s.parentElement));
};


/* Всё, что относится к активу, живёт на «Схеме»: его воркеры, функции и
   ресурсы, а классификации — там же, где ресурсы, потому что классификация
   это свойство ресурса. Цель у ресурса не хранится: она задаётся в
   «Прогнозе», где у неё есть темп, срок и цена. */

let container;
beforeEach(() => { ({ container } = render(<SystemModel />)); });

const tab = (name) => fireEvent.click(screen.getByRole("button", { name }));
/* Три части актива живут во вкладках: до ресурсов надо переключиться. */
const assetTab = (name) => fireEvent.click(
  screen.getByRole("button", { name: new RegExp(`^${name}`) }));
/* «Прогноз» — подвкладка под схемой: сначала схема, потом он. */
const forecast = () => { tab("Схема"); tab("Цели"); expandCards(container); };
const dump = () => {
  fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
  fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
  fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
  return JSON.parse(container.querySelector("textarea").value);
};

describe("состав вкладок", () => {
  it("отдельных «Цели» и «Типы» больше нет", () => {
    // Первыми в разметке идут кнопки истории — переключатели вкладок за ними.
    const bar = [...container.querySelectorAll("button")]
      .map((b) => b.textContent)
      .filter((t) => ["Задачи", "Проверка", "Схема",
        "Инструменты", "Звонки", "Выгрузить", "Цели", "Типы", "Отчёты"].includes(t));
    // «Прогноз» и «Деятельность» из главного ряда ушли под схему: обе про ту
    // же модель во времени, и ползунок месяца у них общий со схемой.
    expect(bar.slice(0, 5))
      .toEqual(["Задачи", "Проверка", "Схема", "Отчёты", "Инструменты"]);
    expect(screen.queryByRole("button", { name: "Цели" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Деятельность" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Цели" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Типы" })).toBeNull();
  });
});

describe("классификации — на «Схеме»", () => {
  it("список и добавление классификации живут под карточкой актива, за спойлером", () => {
    tab("Схема");
    assetTab("Ресурсы");
    // Под спойлером: правят их редко, а место они занимали всегда.
    expect(screen.queryByRole("button", { name: "+ классификация" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /классификации ресурсов/ }));
    const add = screen.getByRole("button", { name: "+ классификация" });
    // Ниже добавления ресурса, а не выше: тип выбирается уже после того,
    // как ресурс назван.
    const all = [...container.querySelectorAll("*")];
    const draft = screen.getByPlaceholderText("текст нового ресурса");
    expect(all.indexOf(add)).toBeGreaterThan(all.indexOf(draft));
  });

  it("добавленная классификация сразу доступна как кнопка создания ресурса", () => {
    tab("Схема");
    const before = dump().kinds.length;
    tab("Схема");
    assetTab("Ресурсы");
    fireEvent.click(screen.getByRole("button", { name: /классификации ресурсов/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ классификация" }));
    expect(dump().kinds.length).toBe(before + 1);
    tab("Схема");
    assetTab("Ресурсы");
    expect(screen.getByRole("button", { name: /^\+ • новая классификация$/ }))
      .toBeInTheDocument();
  });
});

describe("три части актива — одинаковыми формами", () => {
  it("вкладки идут в одном порядке: сначала люди, потом их работа, потом ресурсы", () => {
    tab("Схема");
    const all = [...container.querySelectorAll("*")];
    const at = (name) => all.indexOf(
      screen.getByRole("button", { name: new RegExp(`^${name} \\d`) }));
    expect(at("Воркеры")).toBeLessThan(at("Функции"));
    expect(at("Функции")).toBeLessThan(at("Ресурсы"));
  });

  it("карточки всех трёх вкладок раскрываются одинаково", () => {
    tab("Схема");
    // Одна грамматика на все части: «развернуть …» + название + «удалить».
    expect(screen.getAllByRole("button", { name: "развернуть функции" }).length)
      .toBeGreaterThan(0);
    assetTab("Ресурсы");
    expect(screen.getAllByRole("button", { name: "развернуть ресурса" }).length)
      .toBeGreaterThan(0);
  });
});

describe("цель", () => {
  it("у ресурса её нет — она задаётся в «Прогнозе»", () => {
    // Полем «сколько нужно» цель обеднялась до числа: ни темпа, ни срока,
    // ни цены в нём не выражалось.
    tab("Схема");
    assetTab("Ресурсы");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть ресурса" })[0]);
    expect(screen.queryByPlaceholderText("без цели")).toBeNull();
  });

  it("название цели правится двойным нажатием (владелец, 2026-09-19)", () => {
    tab("Схема"); tab("Цели");
    const name = document.querySelector("[data-goal-name]");
    expect(name.textContent).toMatch(/в неделю · через 3 мес/);   // без имени — цель словами
    fireEvent.doubleClick(name);
    const input = screen.getByLabelText("название цели");
    fireEvent.change(input, { target: { value: "Выйти на десять клиентов" } });
    fireEvent.blur(input);
    const again = document.querySelector("[data-goal-name]");
    expect(again.textContent).toMatch(/^Выйти на десять клиентов/);
    // Сама цель словами осталась подписью — смысл не потерян.
    expect(screen.getByText(/в неделю · через 3 мес/)).toBeTruthy();
  });

  it("«Прогноз» показывает цели, а расчёт — по кнопке", () => {
    tab("Схема"); tab("Цели");
    expect(screen.getByText("цели")).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ цель" })).toBeTruthy();
    // Свёрнутая цель называет себя целиком: «10 … в неделю · через 3 мес».
    expect(screen.getByText(/в неделю · через 3 мес/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть цель" })[0]);
    // Пока не посчитали — считать нечего и применять нечего.
    expect(screen.queryByText("что из этого следует")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Спрогнозировать" }));
    expect(screen.getByText("что из этого следует")).toBeTruthy();
    expect(screen.getByText("последовательность действий")).toBeTruthy();
  });

  /* ─── бюджет времени и дни недели ───

     Дни недели трогают ровно одно — бюджет времени: «час в день» по будням
     это пять часов в неделю, а не семь. Без заданного бюджета они не делают
     ничего, и отдельным блоком «по каким дням идёт работа» читались как
     расписание задач, которым не являются. */
  it("график учитывается флажком, и без него время и дни гаснут, не пропадая", () => {
    tab("Схема"); tab("Цели");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть цель" })[0]);
    // В этой модели бюджет задан — флажок стоит, поле и дни на месте.
    expect(screen.getByLabelText("учитывать график").checked).toBe(true);
    expect(screen.getByLabelText("сколько времени")).toBeInTheDocument();
    expect(screen.getByLabelText("день пн")).not.toBeDisabled();

    // Сняли — поле и дни погасли (не пропали) и прямо сказано, почему.
    fireEvent.click(screen.getByLabelText("учитывать график"));
    expect(screen.getByLabelText("учитывать график").checked).toBe(false);
    expect(screen.getByLabelText("сколько времени")).toBeDisabled();
    expect(screen.getByLabelText("единица времени")).toBeDisabled();
    expect(screen.getByLabelText("день пн")).toBeDisabled();
    expect(screen.getByText(/График не учитывается — время и дни в расчёт не идут/))
      .toBeInTheDocument();

    // Вернули — набранное число не потерялось, и дни снова нажимаются.
    fireEvent.click(screen.getByLabelText("учитывать график"));
    expect(screen.getByLabelText("сколько времени")).toHaveValue("2");
    expect(screen.getByLabelText("сколько времени")).not.toBeDisabled();
    expect(screen.getByLabelText("день пн")).not.toBeDisabled();
  });

  it("раздел «в график работ»: рабочее время и дни, а затрат в нём нет", () => {
    /* «Какой ценой» спрашивал две разные вещи сразу: сколько времени
       человек готов тратить и во сколько других ресурсов это обойдётся.
       Второе он называл наугад, а модель тут же считала настоящее. */
    tab("Схема"); tab("Цели");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть цель" })[0]);
    expect(screen.getByText("в график работ")).toBeInTheDocument();
    expect(screen.getByText("рабочее время")).toBeInTheDocument();
    expect(screen.queryByText("время на достижение")).toBeNull();
    expect(screen.queryByText("какой ценой")).toBeNull();
    expect(screen.queryByLabelText("добавить затрату ресурса")).toBeNull();
    expect(screen.queryByText(/затрата другого ресурса/)).toBeNull();
  });

  it("у числа времени есть единица, и она идёт в расчёт прогноза", () => {
    /* «2 в день» не читается вовсе: два часа или два дня — разные вещи, а
       поле молча считало часы. */
    tab("Схема"); tab("Цели");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть цель" })[0]);
    const unitField = screen.getByLabelText("единица времени");
    expect(unitField).toHaveValue("ч");

    // Пересчёт в месяц сказан прямо — с этим числом прогноз и сравнивает.
    const monthly = () => screen.getByText(/в месяц — с этим числом и сравнивается/);
    const was = monthly().textContent;
    fireEvent.change(unitField, { target: { value: "дн" } });
    expect(monthly().textContent).not.toBe(was);

    // И само сравнение в прогнозе меняется вместе с единицей.
    fireEvent.click(screen.getByRole("button", { name: "Спрогнозировать" }));
    expect(screen.getByText(/времени на это есть/)).toBeInTheDocument();
  });

  it("дни стоят под самим временем, а не отдельным блоком выше", () => {
    /* Прежнее название «по каким дням идёт работа» обещало расписание
       задач. На деле дни — множитель бюджета времени, и стоять им у
       времени. */
    tab("Схема"); tab("Цели");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть цель" })[0]);
    expect(screen.queryByText("по каким дням идёт работа")).toBeNull();
    expect(screen.getByText("рабочие дни")).toBeInTheDocument();
    expect(screen.queryByText("в какие дни недели это время тратится")).toBeNull();
  });

  it("под кнопкой прогноза не объясняют очевидное", () => {
    /* «Цель поправили — прежний прогноз уже не про неё, посчитайте заново»
       говорило то же, что и сама кнопка, которая в этот момент зовёт
       считать. */
    tab("Схема"); tab("Цели");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть цель" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Спрогнозировать" }));
    // Правка цели возвращает кнопку к «Спрогнозировать» — и молча.
    fireEvent.click(screen.getByLabelText("учитывать график"));
    expect(screen.getByRole("button", { name: "Спрогнозировать" })).toBeTruthy();
    expect(screen.queryByText(/прежний прогноз уже не про неё/)).toBeNull();
  });

  it("цель уезжает в модель отдельной частью документа", () => {
    tab("Схема"); tab("Цели");
    const m = dump();
    expect(Array.isArray(m.goals)).toBe(true);
    expect(m.goals.length).toBeGreaterThan(0);
    expect(m.goals[0]).toMatchObject({ trait: expect.any(String), rate: expect.any(String) });
  });

  it("ресурс без цели тоже показан — карточкой прогноза", () => {
    tab("Схема"); tab("Цели");
    // «заявки» — ресурс без планки: он в списке своего актива.
    expect(screen.getAllByText("заявки").length).toBeGreaterThan(0);
  });
});

describe("стрелка передачи ведёт к своей функции", () => {
  it("нажатие на стрелку открывает функцию, которая её рисует", () => {
    // Стрелку рисует функция — значит по стрелке до неё и надо доходить.
    // Прежде передачу было видно, а дотянуться до её причины приходилось
    // через актив и вкладку, гадая, какая из функций это делает.
    tab("Схема");
    // Заведём передачу: «Сбор заявок» выдаёт ресурс чужого актива.
    assetTab("Функции");
    fireEvent.click(screen.getAllByRole("button", { name: /^развернуть функции/ })[0]);
    const give = screen.getByLabelText("выдать ресурс");
    const alien = [...give.options].find((o) => o.parentElement.label
      && o.parentElement.label !== "этот актив");
    fireEvent.change(give, { target: { value: alien.value } });

    // Уходим на другой актив, чтобы было видно, что нажатие переключает.
    const other = [...container.querySelectorAll("svg text")]
      .find((t) => t.textContent === "Рынок услуг");
    fireEvent.pointerDown(other.closest("g"));
    fireEvent.click(other.closest("g"));

    const arrow = [...container.querySelectorAll("svg g")]
      .find((g) => g.querySelector("title")?.textContent.includes("открыть функцию"));
    expect(arrow).toBeTruthy();
    fireEvent.click(arrow);

    // Открылась карточка именно этой функции — со своими входами и выходами.
    // Карточка функции и внутри неё карточка её единственной задачи.
    expect(screen.getAllByText("Сбор заявок").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("выдать ресурс")).toBeInTheDocument();
  });
});

describe("применение цели", () => {
  const openGoal = () => {
    tab("Схема"); tab("Цели");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть цель" })[0]);
  };

  it("форма показывает полный расчёт: что прибавится, что убавится и какие задачи заведутся", () => {
    openGoal();
    fireEvent.click(screen.getByRole("button", { name: "Спрогнозировать" }));
    expect(screen.getByText("прибавится")).toBeInTheDocument();
    expect(screen.getByText("убавится")).toBeInTheDocument();
    expect(screen.getByText(/какие задачи и когда заведутся/)).toBeInTheDocument();
  });

  it("до применения цель ничего не меняет — это прикидка", () => {
    // Без этой границы каждая правка числа молча меняла бы доску задач.
    const before = dump().tasks.length;
    openGoal();
    fireEvent.click(screen.getByRole("button", { name: "Спрогнозировать" }));
    expect(dump().tasks.length).toBe(before);
    expect(dump().goals[0].appliedAt).toBeNull();
  });

  it("поправили цель — прогноз устарел, и кнопка снова зовёт считать", () => {
    /* Применять числа, которых человек не видел, нельзя: посчитали по
       одному, а применили бы другое. */
    openGoal();
    fireEvent.click(screen.getByRole("button", { name: "Спрогнозировать" }));
    expect(screen.getByRole("button", { name: "Применить цель" })).toBeTruthy();
    const qty = screen.getByLabelText("сколько ресурса");
    fireEvent.change(qty, { target: { value: "3" } });
    fireEvent.blur(qty);
    expect(screen.queryByRole("button", { name: "Применить цель" })).toBeNull();
    expect(screen.getByRole("button", { name: "Спрогнозировать" })).toBeTruthy();
  });

  it("операция добавляется второй — это и есть диапазон", () => {
    /* Одним условием говорится «не меньше» ИЛИ «не больше». Диапазон —
       два условия сразу, и держаться должны оба. */
    openGoal();
    const first = screen.getByLabelText("сколько ресурса");
    fireEvent.change(first, { target: { value: ">10" } });
    fireEvent.blur(first);
    fireEvent.click(screen.getByRole("button", { name: "+ операция" }));
    const second = screen.getByLabelText("операция 2");
    fireEvent.change(second, { target: { value: "<50" } });
    fireEvent.blur(second);
    expect(screen.getByText("диапазон: от 10 до 50")).toBeInTheDocument();
    // И убирается тем же списком.
    fireEvent.click(screen.getByRole("button", { name: "убрать операцию 2" }));
    expect(screen.queryByLabelText("операция 2")).toBeNull();
    // Выгрузка — последней: она уводит со вкладки прогноза.
    expect(dump().goals[0].exprs).toEqual([">10"]);
  });

  it("спорящие условия названы спорящими, а не посчитаны молча", () => {
    openGoal();
    const first = screen.getByLabelText("сколько ресурса");
    fireEvent.change(first, { target: { value: ">10" } });
    fireEvent.blur(first);
    fireEvent.click(screen.getByRole("button", { name: "+ операция" }));
    const second = screen.getByLabelText("операция 2");
    fireEvent.change(second, { target: { value: "<5" } });
    fireEvent.blur(second);
    expect(screen.getAllByText(/условия спорят/).length).toBeGreaterThan(0);
  });

  it("«Применить цель» заводит задачи и отмечает цель применённой", () => {
    const before = dump().tasks.length;
    openGoal();
    fireEvent.click(screen.getByRole("button", { name: "Спрогнозировать" }));
    fireEvent.click(screen.getByRole("button", { name: "Применить цель" }));
    const m = dump();
    expect(m.tasks.length).toBeGreaterThan(before);
    expect(m.goals[0].appliedAt).toBeTruthy();
    // Задачи знают, откуда они взялись, и ждут постановки.
    const made = m.tasks.filter((t) => t.goalId === m.goals[0].id);
    expect(made.length).toBeGreaterThan(0);
    expect(made[0]).toMatchObject({ status: "wait", funcId: expect.any(String) });
    expect(made[0].start).toBeTruthy();
    expect(made[0].end).toBeTruthy();

    // Задачи одной функции различимы по названию (правило — в `runTitle`).
    const sameFunc = made.filter((t) => t.funcId === made[0].funcId);
    expect(new Set(sameFunc.map((t) => t.title)).size).toBe(sameFunc.length);
  });

  it("применённая цель называет себя применённой, а повтор — отдельная цель", () => {
    /* Два применения это два разных решения: свои сроки, своя работа, свой
       результат. Одной строкой они сливались в неразличимую кучу задач. */
    const before = dump().goals.length;
    openGoal();
    fireEvent.click(screen.getByRole("button", { name: "Спрогнозировать" }));
    fireEvent.click(screen.getByRole("button", { name: "Применить цель" }));
    expect(screen.getByText("· применена")).toBeInTheDocument();

    const repeat = screen.getByRole("button", { name: "Повторить отдельной целью" });
    expect(repeat).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Применить заново" })).toBeNull();
    fireEvent.click(repeat);

    const m = dump();
    // В списке целей их теперь две, и у каждой своя работа.
    expect(m.goals.length).toBe(before + 1);
    const ids = m.goals.filter((g) => g.appliedAt).map((g) => g.id);
    expect(ids).toHaveLength(2);
    ids.forEach((id) => {
      expect(m.tasks.filter((t) => t.goalId === id).length).toBeGreaterThan(0);
    });
  });

  it("удаление цели уносит её незакрытую работу, а сделанное оставляет", () => {
    openGoal();
    fireEvent.click(screen.getByRole("button", { name: "Спрогнозировать" }));
    fireEvent.click(screen.getByRole("button", { name: "Применить цель" }));
    const applied = dump().goals.find((g) => g.appliedAt);
    expect(dump().tasks.some((t) => t.goalId === applied.id)).toBe(true);

    // `dump()` уходит в «Инструменты» и возвращается на «Управление» —
    // до целей надо дойти заново.
    openGoal();
    fireEvent.click(screen.getAllByRole("button", { name: "удалить цель" })[0]);
    const m = dump();
    expect(m.goals.some((g) => g.id === applied.id)).toBe(false);
    // Работа, которой никто уже не просит, уходит вместе с целью.
    expect(m.tasks.some((t) => t.goalId === applied.id)).toBe(false);
  });
});

describe("цель как показатель и последовательность действий", () => {
  const openGoal = () => {
    tab("Схема"); tab("Цели");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть цель" })[0]);
  };

  it("цель показывает мерку: сколько нужно и сколько есть", () => {
    // Цель — не только намерение, но и показатель: ради этой цифры её и
    // ставили.
    tab("Схема"); tab("Цели");
    expect(screen.getByText(/нужно 10 в неделю/)).toBeInTheDocument();
  });

  it("последовательность действий — очередь, а не список вперемешку", () => {
    openGoal();
    fireEvent.click(screen.getByRole("button", { name: "Спрогнозировать" }));
    const box = screen.getByText("последовательность действий").parentElement;
    const rows = [...box.querySelectorAll("div")]
      .map((d) => d.textContent).filter((t) => /^\d+\./.test(t));
    expect(rows.length).toBeGreaterThan(1);
    // Первый шаг начинается сразу, следующий — ждёт его выхода.
    expect(rows[0]).toMatch(/сразу/);
    expect(rows[1]).toMatch(/^2\./);
  });

  it("в последовательности действий нет галочек — только порядок, счёт и старт (владелец, 2026-09-19)", () => {
    openGoal();
    fireEvent.click(screen.getByRole("button", { name: "Спрогнозировать" }));
    expect(screen.getByText("последовательность действий")).toBeInTheDocument();
    expect(screen.queryAllByLabelText(/^выполнить: /)).toEqual([]);
    expect(screen.queryByText(/Отметьте, что из этого будет сделано/)).toBeNull();
  });

  it("в «Прогнозе» есть общая очередь по применённым целям", () => {
    openGoal();
    fireEvent.click(screen.getByRole("button", { name: "Спрогнозировать" }));
    fireEvent.click(screen.getByRole("button", { name: "Применить цель" }));
    expect(screen.getByText(/последовательность действий · по применённым целям/))
      .toBeInTheDocument();
  });
});
