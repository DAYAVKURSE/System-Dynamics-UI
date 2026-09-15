import { FACTORS_ON } from "../lib/flags.js";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { Workers } from "../components/AssetPanel.jsx";

/* Карточка актива: воркеры, функции, ресурсы — три равноправные части,
   устроенные одинаково.

   Здесь проверяется не красота редактора, а то, из-за чего такие правки
   обычно и разваливаются: новые списки должны пережить выгрузку и загрузку,
   отмену, удаление актива и удаление ресурса. Стоит забыть один из них в
   одном из мест, где перечислены части документа, — и работа молча исчезнет
   при первом же сохранении. */

let container;
beforeEach(() => { localStorage.clear(); ({ container } = render(<SystemModel />)); });

const scheme = () => fireEvent.click(screen.getByRole("button", { name: "Схема" }));
/* Кнопка «Выгрузка» переключает раздел: нажать её, когда он уже открыт,
   значит закрыть его — и поле пропадёт. Поэтому открываем по факту. */
const openExport = () => {
  fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
  if (!container.querySelector("textarea")) {
    fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
  }
  return container.querySelector("textarea");
};
const dump = () => {
  openExport();
  fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
  const m = JSON.parse(container.querySelector("textarea").value);
  scheme();
  return m;
};
/* Три части актива живут во вкладках: чтобы дотянуться до ресурсов или
   воркеров, надо сначала переключиться на них. */
const assetTab = (name) => fireEvent.click(
  screen.getByRole("button", { name: new RegExp(`^${name}`) }));
const addFunc = () => {
  scheme();
  assetTab("Функции");
  fireEvent.click(screen.getByRole("button", { name: "+ функция" }));
};
/* Вход и выход добавляются одним полем на всю схему: в нём и свои ресурсы,
   и чужие. `addPort` возвращает имя выбранного — по нему потом ищутся поля
   вилки. */
const addPort = (kind, name) => {
  const sel = screen.getByLabelText(kind === "takes" ? "взять ресурс" : "выдать ресурс");
  const opt = name ? [...sel.options].find((o) => o.textContent === name)
    : [...sel.options].find((o) => o.value);
  fireEvent.change(sel, { target: { value: opt.value } });
  return opt.textContent;
};
const loadJson = (m) => {
  const area = openExport();
  fireEvent.change(area, { target: { value: JSON.stringify(m) } });
  // Поле отдаёт значение по расфокусу: без blur «Загрузить» взял бы прежний
  // текст, и проверка ничего бы не проверяла.
  fireEvent.blur(area);
  const row = screen.getByRole("button", { name: "Выгрузить" }).parentElement;
  fireEvent.click(within(row).getByRole("button", { name: "Загрузить" }));
};

describe("актив состоит из трёх частей", () => {
  it("воркеры, функции и ресурсы — три вкладки одного вида", () => {
    scheme();
    ["Воркеры", "Функции", "Ресурсы"].forEach((name) => {
      expect(screen.getByRole("button", { name: new RegExp(`^${name} \\d`) }))
        .toBeInTheDocument();
    });
    // Открыта одна за раз: части равноправны, и ни одна не «та, до которой
    // надо долистать».
    assetTab("Воркеры");
    expect(screen.getByText("воркеры актива")).toBeInTheDocument();
    expect(screen.queryByText("ресурсы актива")).toBeNull();
    assetTab("Ресурсы");
    expect(screen.getByText("ресурсы актива")).toBeInTheDocument();
    expect(screen.queryByText("функции актива")).toBeNull();
  });

  it("на вкладке видно, сколько в ней всего", () => {
    scheme();
    expect(screen.getByRole("button", { name: /^Ресурсы 2$/ })).toBeInTheDocument();
  });

  it("у функции ровно две формы: «берёт» и «выдаёт»", () => {
    addFunc();
    expect(screen.getByText("берёт")).toBeInTheDocument();
    expect(screen.getByText("выдаёт")).toBeInTheDocument();
    expect(screen.queryByText(/передаёт другим/)).toBeNull();
    expect(screen.queryByRole("button", { name: /стрелка от этого элемента/ })).toBeNull();
  });
});

describe("новое в форме функции", () => {
  it("вход расходуется или только обрабатывается — и это переживает выгрузку", () => {
    /* Взять ресурс можно двумя способами. Расходует — взятое исчезает у
       всех; не расходует — остаётся и достаётся другим, но эта функция
       второй раз ту же единицу не берёт. */
    addFunc();
    const name = addPort("takes");
    /* Метка-переключатель, а не галочка с абзацем под каждым входом:
       пояснение стоит один раз под секцией, и строка ресурса читается
       строкой. Состояние — в aria-pressed, его же слышит читалка. */
    expect(screen.getByLabelText(`расходует ${name}`))
      .toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText(`расходует ${name}`));
    expect(screen.getByLabelText(`расходует ${name}`))
      .toHaveAttribute("aria-pressed", "false");
    // Пояснение — одно на секцию, а не под каждым входом.
    expect(screen.getByText(/взятое исчезает/i)).toBeInTheDocument();
    expect(dump().funcs.pop().takes[0].spend).toBe(false);
  });

  it("у функции есть описание, и оно необязательно", () => {
    addFunc();
    const box = screen.getByLabelText("описание функции");
    // Пустое описание не мешает функции быть функцией.
    expect(box.value).toBe("");
    fireEvent.change(box, { target: { value: "разбираем заявку и пишем ТЗ" } });
    fireEvent.blur(box);
    expect(dump().funcs.pop().about).toBe("разбираем заявку и пишем ТЗ");
  });

  it("сколько дел держит ОДИН ВОРКЕР — спрашивается у функции", () => {
    /* Настройка про долгие работы: юрист ведёт восемь дел месяцами разом.
       Выстроить их друг за другом значило бы обещать восемь месяцев там,
       где выйдет один. */
    addFunc();
    const box = screen.getByLabelText("одновременных выполнений на воркера");
    // По умолчанию одно: обещать иное без слов человека нельзя.
    expect(box).toHaveValue(1);
    expect(screen.getByText(/по одному, друг за другом/)).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "8" } });
    expect(screen.getByText(/столько одному под силу разом/)).toBeInTheDocument();
    // Выгрузка проверяется последней: она уводит на другую вкладку.
    expect(dump().funcs.pop().par).toBe(8);
  });

  it("предел АКТИВА — второе поле, и пусто в нём значит «предела нет»", () => {
    /* Станок один, кабинет один, лицензий три: сколько бы людей ни было,
       разом идёт столько. Молчание — не запрет, поэтому по умолчанию
       предела нет, и прежние схемы ничего не теряют. */
    addFunc();
    const all = screen.getByLabelText("одновременных выполнений на актив");
    expect(all).toHaveValue(0);
    expect(screen.getByText(/предела нет/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("одновременных выполнений на воркера"),
      { target: { value: "8" } });
    fireEvent.change(all, { target: { value: "3" } });
    expect(screen.getByText(/больше 3 в активе разом не идёт/)).toBeInTheDocument();
    // В календарь помещается меньшее из двух: потолок актива обязан работать.
    expect(screen.getByText(/в календарь помещается 3 разом/)).toBeInTheDocument();
    const f = dump().funcs.pop();
    expect([f.par, f.parAll]).toEqual([8, 3]);
  });

  it("«= количеству воркеров»: число не вводят, его говорит состав актива", () => {
    /* Править число каждый раз, когда в актив кого-то добавили, — это
       вторая запись того же самого, и она разошлась бы с первой. */
    addFunc();
    const box = screen.getByLabelText(
      "одновременных выполнений на актив = количеству воркеров");
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    // Поле числа уходит: оно спрашивало бы уже сказанное.
    expect(screen.queryByLabelText("одновременных выполнений на актив")).toBeNull();
    expect(screen.getByText(/воркеров в активе: 0/)).toBeInTheDocument();
    expect(dump().funcs.pop().parCrew).toBe(true);
  });

  it("меньше одного одновременного выполнения на воркера не бывает", () => {
    // Ноль означал бы, что работа не делается вовсе, — поле не про это.
    addFunc();
    const box = screen.getByLabelText("одновременных выполнений на воркера");
    fireEvent.change(box, { target: { value: "0" } });
    expect(dump().funcs.pop().par).toBe(1);
  });

  /* ─── готовность функции ───

     Проверки говорят, что функция СОБРАНА. «Принята» — слово человека:
     заполнено может быть всё, а автор ещё думает. Цвета два, состояния
     три, и различаются они подписью — так просил владелец. */
  /* Схема открыта не пустой, функций в ней несколько — смотрим на свою:
     кнопка «Принять» лежит в форме «принять» внутри раскрытой карточки, а
     от неё три шага до самой карточки со статусом. */
  const btnAccept = () => screen.getAllByLabelText(/принять функцию/).pop();
  const myCard = () => btnAccept().parentElement.parentElement.parentElement;

  it("незаполненная функция красная и говорит, чего не хватает", () => {
    addFunc();
    expect(within(myCard()).getByText("не заполнена")).toBeInTheDocument();
    // Причина названа и в подписи, и на самой кнопке — это одно и то же.
    expect(within(myCard()).getAllByText(/не сказано, что берёт/).length)
      .toBeGreaterThan(0);
    // Но кнопка нажимается: подсказка — не запрет.
    expect(btnAccept()).toBeEnabled();
    expect(btnAccept().textContent).toBe("Принять");
  });

  it("принять можно всегда: незаполненная после «Принять» — зелёная «готова»", () => {
    /* Проверка находит пробелы, а годится ли функция — решает человек.
       Кнопка, которая «пока нельзя», была условием сверх того, что он
       просил: убрана. */
    addFunc();
    expect(within(myCard()).getByText("не заполнена")).toBeInTheDocument();
    fireEvent.click(btnAccept());
    expect(within(myCard()).getByText("готова")).toBeInTheDocument();
    expect(within(myCard()).queryByText(/не сказано, что берёт/)).toBeNull();
    expect(dump().funcs.pop().accepted).toBe(true);
  });

  it("собранная функция ещё не зелёная — её принимает человек", () => {
    addFunc();
    addPort("takes");
    addPort("gives");
    expect(within(myCard()).getByText("не принята")).toBeInTheDocument();
    expect(btnAccept()).toBeEnabled();
    fireEvent.click(btnAccept());
    expect(within(myCard()).getByText("готова")).toBeInTheDocument();
    expect(dump().funcs.pop().accepted).toBe(true);
  });

  it("правка снимает «принято»: зелёная метка на изменённой функции врала бы", () => {
    addFunc();
    addPort("takes");
    addPort("gives");
    fireEvent.click(btnAccept());
    expect(within(myCard()).getByText("готова")).toBeInTheDocument();
    // Меняем время — функция снова ждёт слова человека.
    fireEvent.change(screen.getAllByLabelText("время одного выполнения").pop(),
      { target: { value: "4" } });
    expect(within(myCard()).getByText("не принята")).toBeInTheDocument();
    expect(dump().funcs.pop().accepted).toBe(false);
  });

  it("правка на соседней вкладке тоже снимает «принято»", () => {
    /* Пометка — слово человека о ТОЙ функции, которую он видел. Удаление
       ресурса меняет её рецепт, и если пометка остаётся, зелёное «готова»
       стоит на работе, которую в этом виде никто не одобрял. Раньше сброс
       жил в одной панели, и правки с других вкладок его обходили. */
    addFunc();
    const name = addPort("takes");
    addPort("gives");
    fireEvent.click(btnAccept());
    expect(dump().funcs.pop().accepted).toBe(true);

    assetTab("Ресурсы");
    const card = screen.getByDisplayValue(name).closest("div");
    fireEvent.click(within(card).getByRole("button", { name: "удалить" }));
    const after = dump().funcs.pop();
    expect(after.accepted).toBe(false);
    expect(after.takes).toHaveLength(0);
  });

  it("расфокус без правки «принято» не снимает", () => {
    /* Поля отдают значение по расфокусу, и клик мимо поля — не правка.
       Иначе пометка слетала бы от того, что человек ткнул в название и
       передумал, а в историю падал бы шаг за действие, которого никто не
       совершал. */
    addFunc();
    addPort("takes");
    addPort("gives");
    fireEvent.click(btnAccept());
    const title = screen.getAllByLabelText("название функции").pop();
    fireEvent.focus(title);
    fireEvent.blur(title);
    expect(within(myCard()).getByText("готова")).toBeInTheDocument();
    expect(dump().funcs.pop().accepted).toBe(true);
  });

  it("ресурсу ставят несколько классификаций сразу", () => {
    /* Деньги — и ресурс, и затрата. Выбирать, какой правдой пожертвовать,
       человек не должен: кнопки ставят и снимают каждую саму по себе. */
    scheme();
    assetTab("Ресурсы");
    // Заводим свой: у заведённого кнопкой «◆ ресурс» одна классификация.
    const box = screen.getByPlaceholderText("текст нового ресурса");
    fireEvent.change(box, { target: { value: "деньги" } });
    fireEvent.blur(box);
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ ◆ ресурс$/ })[0]);

    fireEvent.click(screen.getByLabelText("затрата: деньги"));
    expect(screen.getByLabelText("затрата: деньги"))
      .toHaveAttribute("aria-pressed", "true");
    // И первая, которой его завели, на месте: они не переключают друг друга.
    expect(screen.getByLabelText("ресурс: деньги"))
      .toHaveAttribute("aria-pressed", "true");

    const t = dump().traits.find((x) => x.l === "деньги");
    expect(t.ks).toEqual(["res", "cost"]);
  });

  it("«точное время» называется одинаково у работы и у попытки", () => {
    /* Точное время и точный срок — это одно и то же, и двух имён у него
       быть не должно. */
    addFunc();
    expect(screen.getByLabelText("точное время")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("когда следующая попытка"),
      { target: { value: "every" } });
    expect(screen.getByLabelText("точное время попытки")).toBeInTheDocument();
    expect(screen.queryByLabelText("точный срок")).toBeNull();
  });
});

describe("функция заводится и живёт", () => {
  it("новая функция принадлежит выбранному активу и видна в выгрузке", () => {
    const before = dump().funcs.length;
    addFunc();
    const m = dump();
    expect(m.funcs).toHaveLength(before + 1);
    expect(m.entities.some((e) => e.id === m.funcs[before].e)).toBe(true);
  });

  it("рецепт задаётся: что берёт, что выдаёт и за какое время", () => {
    addFunc();
    addPort("takes");
    addPort("gives");

    const f = dump().funcs.pop();
    expect(f.takes).toHaveLength(1);
    expect(f.gives).toHaveLength(1);
    // Время — одно на функцию, а не по одному на каждый выход.
    expect(f.dur).toBeGreaterThan(0);
    expect(f.durUnit).toBeTruthy();
    expect(f.gives[0].dur).toBeUndefined();
  });

  it("сколько берёт и сколько выдаёт — по умолчанию точное число", () => {
    /* Чаще всего берут и выдают РОВНО столько-то. Два поля «от» и «до»
       заставляли писать одно и то же число дважды, поэтому вилка — по
       галочке, а без неё поле одно и обе границы у него общие. */
    addFunc();
    const name = addPort("takes");
    expect(screen.queryByLabelText(`сколько минимум ${name}`)).toBeNull();
    fireEvent.change(screen.getByLabelText(`сколько ${name}`), { target: { value: "3" } });

    expect(screen.getAllByText("ровно 3").length).toBeGreaterThan(0);
    expect(dump().funcs.pop().takes[0]).toMatchObject({ lo: 3, hi: 3 });
  });

  it("«диапазон» открывает вторую границу, и вилка сохраняется", () => {
    addFunc();
    const name = addPort("takes");
    fireEvent.click(screen.getByLabelText(`диапазон ${name}`));
    fireEvent.change(screen.getByLabelText(`сколько минимум ${name}`), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(`сколько максимум ${name}`), { target: { value: "5" } });

    /* Числа стоят в самих полях, а не пересказываются рядом словами:
       «от 3 до 5» рядом с полями «3» и «5» — это одно и то же, сказанное
       дважды. Пересказ остался там, где полей нет: в сводке выполнений. */
    expect(screen.getByLabelText(`сколько минимум ${name}`)).toHaveValue(3);
    expect(screen.getByLabelText(`сколько максимум ${name}`)).toHaveValue(5);
    expect(dump().funcs.pop().takes[0]).toMatchObject({ lo: 3, hi: 5 });
  });

  it("снятая галочка схлопывает вилку в нижнюю границу", () => {
    addFunc();
    const name = addPort("takes");
    fireEvent.click(screen.getByLabelText(`диапазон ${name}`));
    fireEvent.change(screen.getByLabelText(`сколько минимум ${name}`), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(`сколько максимум ${name}`), { target: { value: "6" } });
    fireEvent.click(screen.getByLabelText(`диапазон ${name}`));

    // «От 2 до 6» без галочки — это «ровно 2»: рассчитывали на два.
    expect(screen.getByLabelText(`сколько ${name}`).value).toBe("2");
    expect(screen.getAllByText("ровно 2").length).toBeGreaterThan(0);
    expect(dump().funcs.pop().takes[0]).toMatchObject({ lo: 2, hi: 2 });
  });

  it("вилка из модели открывает функцию с уже поднятой галочкой", () => {
    /* Стартовая функция берёт «от 2 до 4» — про такую сразу видно, что это
       вилка, и вторая граница не спрятана. */
    scheme();
    assetTab("Функции");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть функции" })[0]);
    expect(screen.getByLabelText("диапазон спрос").checked).toBe(true);
    expect(screen.getByLabelText("сколько максимум спрос")).toBeTruthy();
    // А выход у неё ровно один — и он показан одним полем.
    expect(screen.getByLabelText("диапазон заявки").checked).toBe(false);
    expect(screen.getByLabelText("сколько заявки").value).toBe("1");
  });

  it("название правится и переживает выгрузку", () => {
    addFunc();
    const box = screen.getAllByLabelText("название функции").pop();
    fireEvent.change(box, { target: { value: "вёрстка страницы" } });
    fireEvent.blur(box);
    expect(dump().funcs.pop().name).toBe("вёрстка страницы");
  });
});

describe("передача в другой актив", () => {
  it("это чужой ресурс на выходе, а не поле «передаёт в»", () => {
    // Ресурс принадлежит активу, и выдать чужой ресурс значит передать
    // туда. Отдельное поле получателя спрашивало бы то, что уже сказано
    // выбором ресурса, — и могло с ним разойтись.
    addFunc();
    const sel = screen.getByLabelText("выдать ресурс");
    // Чужие ресурсы лежат в списке под названием своего актива.
    const alien = [...sel.options].find((o) => o.parentElement.label
      && o.parentElement.label !== "этот актив");
    fireEvent.change(sel, { target: { value: alien.value } });

    const m = dump();
    const f = m.funcs.pop();
    expect(f.gives[0]).not.toHaveProperty("to");
    expect(screen.queryByLabelText(/кому передаётся/)).toBeNull();
    // Ресурс, который функция выдаёт, принадлежит другому активу — это и
    // есть передача.
    expect(m.traits.find((t) => t.id === f.gives[0].trait).e).not.toBe(f.e);
    expect(m.flows).toBeUndefined();
  });

  it("на схеме передача видна и подписана своим ресурсом", () => {
    scheme();
    // Стартовая модель уже передаёт заявки в «Виртуальный менеджер».
    const texts = [...container.querySelectorAll("svg text")].map((t) => t.textContent);
    expect(texts.some((t) => t.startsWith("заявки:"))).toBe(true);
  });
});

describe("воркеры принадлежат активу", () => {
  it("без людей раздел честно говорит, что их ещё нет", () => {
    scheme();
    assetTab("Воркеры");
    expect(screen.getByText(/Людей ещё нет/)).toBeInTheDocument();
  });

  it("роли выставляются У ФУНКЦИИ, и назначается РОЛЬ, а не человек", () => {
    /* Владелец: «постановщикам, исполнителям и проверяющим должен
       выбираться не конкретный человек, а роль, которая есть в этом
       активе». Человек в функции больше не записан. */
    addFunc();
    ["постановщики", "исполнители", "проверяющие"].forEach((many) => {
      expect(screen.getByText(`${many} — роли`)).toBeInTheDocument();
    });
    // Ролей в схеме ещё нет — так и сказано, у всех трёх мест.
    expect(screen.getAllByText(/ролей ещё нет/).length).toBeGreaterThanOrEqual(3);
  });
});

describe("исключения у воркера", () => {
  /* Владелец: «воркеры, имеющие эту роль, могут быть назначены на задачи
     этой функции, если у самого воркера не отмечено, что он не может взять
     эту задачу». Поэтому в строке воркера — не «что он умеет», а
     ИСКЛЮЧЕНИЯ: функции, к которым он и так допущен ролью. */
  const PEOPLE = [{ id: "2", name: "Иван", roles: ["designer"] },
    { id: "3", name: "Пётр", roles: ["editor"] }];
  const POSITIONS = [{ id: "designer", name: "Дизайнер" }, { id: "editor", name: "Редактор" }];
  const FUNCS = [
    { id: "f1", e: "a", name: "Верстать", posts: { owners: ["designer"] }, except: [], takes: [], gives: [] },
    { id: "f2", e: "a", name: "Принимать", posts: { reviewers: ["editor"] }, except: [], takes: [], gives: [] },
    { id: "f9", e: "b", name: "Чужая", posts: { owners: ["designer"] }, except: [], takes: [], gives: [] },
  ];
  const rolesOf = (id) => PEOPLE.find((p) => String(p.id) === String(id))?.roles || [];
  const show = (over = {}) => render(<Workers workers={{ crew: ["2", "3"] }} people={PEOPLE}
    funcs={FUNCS} entityId="a" positions={POSITIONS} rolesOf={rolesOf}
    nameOf={(id) => PEOPLE.find((p) => p.id === id)?.name || id} onToggleFunc={() => {}} {...over} />);

  it("в строке — только то, к чему допускает роль; чужой актив не предлагается", () => {
    show();
    expect(screen.getByRole("button", { name: "исключение «Верстать»: Иван" }))
      .toHaveAttribute("aria-pressed", "false");
    // Иван — дизайнер: «Принимать» ему не поручают, и исключать нечего.
    expect(screen.queryByRole("button", { name: "исключение «Принимать»: Иван" })).toBeNull();
    expect(screen.getByRole("button", { name: "исключение «Принимать»: Пётр" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Чужая/ })).toBeNull();
  });

  it("нажатие закрывает функцию человеку, повторное — открывает", () => {
    const calls = [];
    show({ onToggleFunc: (pid, fid) => calls.push([pid, fid]) });
    fireEvent.click(screen.getByRole("button", { name: "исключение «Верстать»: Иван" }));
    expect(calls).toEqual([["2", "f1"]]);
  });

  it("исключённый показан помеченным", () => {
    show({ funcs: FUNCS.map((f) => (f.id === "f1" ? { ...f, except: ["2"] } : f)) });
    expect(screen.getByRole("button", { name: "исключение «Верстать»: Иван" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("роль никому ничего не поручила — так и сказано", () => {
    show({ funcs: [{ id: "f1", e: "a", name: "Верстать", posts: {}, except: [], takes: [], gives: [] }] });
    expect(screen.getAllByText(/по его ролям ему пока ничего не поручено/).length)
      .toBeGreaterThan(0);
  });
});

describe("ресурс — такая же карточка", () => {
  it("«есть сейчас» не вводится — считается по материалам; цели у ресурса нет", () => {
    /* Число, введённое руками, разошлось бы с вещами, которые можно скачать:
       «есть 5», а скачать — три. Поэтому поле показывает остаток по
       материалам и сдачам (lib/units.js, `stockOf`) и не правится. Цель
       ушла с ресурса в «Прогноз»: у неё есть темп, срок и цена. */
    scheme();
    assetTab("Ресурсы");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть ресурса" })[0]);
    expect(screen.queryByPlaceholderText("без цели")).toBeNull();
    const box = screen.getByText("есть сейчас").parentElement;
    expect(box.querySelector("input")).toBeNull();
    expect(screen.getByLabelText("есть сейчас").textContent).toMatch(/по материалам/);
    expect(dump().traits.every((t) => t.want === undefined)).toBe(true);
  });

  it("удалённый ресурс исчезает из входов и выходов функций", () => {
    scheme();
    const before = dump().funcs.filter((f) => f.takes.length || f.gives.length).length;
    expect(before).toBeGreaterThan(0);

    scheme();
    assetTab("Ресурсы");
    // «заявки» — ресурс «Пользователей», его берёт функция другого актива.
    const card = screen.getByDisplayValue("заявки").closest("div");
    fireEvent.click(within(card).getByRole("button", { name: "удалить" }));

    const m = dump();
    expect(m.traits.some((t) => t.l === "заявки")).toBe(false);
    expect(m.funcs.some((f) => [...f.takes, ...f.gives]
      .some((p) => p.trait === "req"))).toBe(false);
  });
});

describe("модель не переживает того, чего не должна", () => {
  it("удаление актива уносит его функции и его задачи", () => {
    scheme();
    const was = dump().funcs.length;
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "Удалить актив" }));
    expect(dump().funcs.length).toBeLessThan(was);
  });
});

describe("модель переживает то, что должна", () => {
  it("отмена возвращает удалённую функцию", () => {
    scheme();
    const was = dump().funcs.length;
    scheme();
    assetTab("Функции");
    const card = screen.getByDisplayValue("Сбор заявок").closest("div");
    fireEvent.click(within(card).getByRole("button", { name: "удалить" }));
    expect(dump().funcs.length).toBe(was - 1);
    scheme();
    fireEvent.click(screen.getByRole("button", { name: /↶ отменить/ }));
    expect(dump().funcs.length).toBe(was);
  });

  it("загрузка JSON без поля funcs не выбрасывает функции", () => {
    const m = dump();
    const was = m.funcs.length;
    delete m.funcs;
    loadJson(m);
    expect(screen.getByText("Загружено.")).toBeInTheDocument();
    expect(dump().funcs).toHaveLength(was);
  });

  it("прежняя запись открывается, но её числа не переносятся", () => {
    // Модели, собранные под прежний расчёт, работать не должны: перенос дал
    // бы модель, которую никто не собирал. Но и падать приложение не должно —
    // пустые поля и красная подпись честнее белого экрана.
    const m = dump();
    m.entities = [{ id: "a", name: "Актив", color: "#fff", x: 0, y: 0 }];
    m.traits = [{ id: "t1", e: "a", k: "res", l: "сырьё", unit: "шт.", have: 0 },
      { id: "t2", e: "a", k: "res", l: "изделие", unit: "шт.", have: 0 }];
    m.funcs = [{
      id: "f1", e: "a", name: "старая",
      takes: [{ trait: "t1", qty: 3 }],
      gives: [{ id: "g1", trait: "t2", qty: 5, dur: 2, durUnit: "дн", owners: ["p1"] }],
    }];
    m.flows = [{ id: "w1", from: "f1", to: "f2", trait: "t2", lo: 3, hi: 5 }];
    m.tasks = [];
    loadJson(m);

    scheme();
    const out = dump();
    const f = out.funcs[0];
    expect(f.takes[0]).toMatchObject({ lo: 0, hi: 0 });
    expect(f.dur).toBe(0);
    expect(f.owners).toEqual([]);
    expect(out.entities[0].owners).toEqual([]);
    // И прежние стрелки между элементами никуда не вливаются.
    expect(f.gives).toHaveLength(1);
    expect(out.flows).toBeUndefined();
  });

  it("сохранённый и загруженный сценарий приносит функции обратно", async () => {
    addFunc();
    const box = screen.getAllByLabelText("название функции").pop();
    fireEvent.change(box, { target: { value: "вёрстка" } });
    fireEvent.blur(box);

    openExport();
    const nameBox = container.querySelector('input[placeholder="имя сценария"]');
    fireEvent.change(nameBox, { target: { value: "с функцией" } });
    fireEvent.blur(nameBox);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(container.textContent).toMatch(/Сохранено/));

    // Стираем функцию и грузим сценарий обратно.
    scheme();
    assetTab("Функции");
    const card = screen.getByDisplayValue("вёрстка").closest("div");
    fireEvent.click(within(card).getByRole("button", { name: "удалить" }));
    expect(screen.queryByDisplayValue("вёрстка")).toBeNull();

    openExport();
    const load = [...container.querySelectorAll("button")]
      .filter((b) => b.textContent === "Загрузить").pop();
    fireEvent.click(load);
    await waitFor(() => expect(container.textContent).toMatch(/Загружено:/));

    scheme();
    assetTab("Функции");
    expect(screen.getByDisplayValue("вёрстка")).toBeInTheDocument();
  });
});

describe("ресурс и фактор принимает человек — как функцию", () => {
  /* Владелец: «когда неподтверждены функции, ресурсы или факторы, они все
     в управлении должны помечаться красным, так же, как сейчас помечаются
     функции, которые не готовы; у факторов должна быть кнопка «Принять»,
     и у ресурсов». Пометка — слово о ТОМ, что человек видел: правка её
     снимает. */
  const addTrait = (name) => {
    scheme();
    assetTab("Ресурсы");
    const box = screen.getByPlaceholderText("текст нового ресурса");
    fireEvent.change(box, { target: { value: name } });
    fireEvent.blur(box);
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ ◆ ресурс$/ })[0]);
    return screen.getByDisplayValue(name).closest("div").parentElement;
  };
  const addFactor = (name) => {
    scheme();
    assetTab("Факторы");
    const box = screen.getByPlaceholderText("название нового фактора");
    fireEvent.change(box, { target: { value: name } });
    fireEvent.blur(box);
    fireEvent.click(screen.getByRole("button", { name: "+ фактор" }));
    return screen.getByDisplayValue(name).closest("div").parentElement;
  };

  it("новый ресурс красный и подписан «не принят»; «Принять» делает его зелёным «ресурс»", () => {
    const card = addTrait("коробки");
    expect(within(card).getByText("не принят")).toBeInTheDocument();
    // jsdom отдаёт цвет как rgb: #FF5C7A — это rgb(255, 92, 122).
    expect(card.style.borderLeft).toContain("rgb(255, 92, 122)");
    fireEvent.click(within(card).getByRole("button", { name: "принять ресурс коробки" }));
    expect(within(card).getByText("ресурс")).toBeInTheDocument();
    expect(within(card).queryByText("не принят")).toBeNull();
    expect(dump().traits.find((t) => t.l === "коробки").accepted).toBe(true);
  });

  it("правка единицы снимает «принят», расфокус без правки — нет", () => {
    const card = addTrait("коробки");
    fireEvent.click(within(card).getByRole("button", { name: "принять ресурс коробки" }));
    const unit = within(card).getByDisplayValue("ед.");
    fireEvent.focus(unit);
    fireEvent.blur(unit);
    expect(within(card).getByText("ресурс")).toBeInTheDocument();
    fireEvent.change(unit, { target: { value: "шт" } });
    fireEvent.blur(unit);
    expect(within(card).getByText("не принят")).toBeInTheDocument();
    expect(dump().traits.find((t) => t.l === "коробки").accepted).toBe(false);
  });

  it("прежняя запись без пометки читается как «не принят» — ничего не теряя", () => {
    const m = dump();
    loadJson({ ...m, traits: m.traits.map((t) => ({ id: t.id, e: t.e, k: t.k, l: t.l, unit: t.unit })) });
    scheme();
    assetTab("Ресурсы");
    expect(screen.getByDisplayValue("заявки")).toBeInTheDocument();
    expect(screen.getAllByText("не принят").length).toBeGreaterThan(0);
  });

  it.skipIf(!FACTORS_ON)("фактор: красный «не принят», «Принять» — зелёный «фактор», правка вероятности снимает", () => {
    const block = addFactor("сезон");
    expect(within(block).getByText("не принят")).toBeInTheDocument();
    fireEvent.click(within(block).getByRole("button", { name: "принять фактор сезон" }));
    expect(within(block).getByText("фактор")).toBeInTheDocument();
    expect(dump().factors.find((x) => x.name === "сезон").accepted).toBe(true);
    // Выгрузка уводила с карточки: она открывается заново, на функциях.
    assetTab("Факторы");
    fireEvent.change(screen.getByLabelText("вероятность фактора сезон"), { target: { value: "50" } });
    const again = screen.getByDisplayValue("сезон").closest("div").parentElement;
    expect(within(again).getByText("не принят")).toBeInTheDocument();
    expect(dump().factors.find((x) => x.name === "сезон").accepted).toBe(false);
  });
});

describe("операция у количества (владелец, 2026-09-15)", () => {
  it("«операция» у входа: выражение с процентом от ресурса считается по остатку и кладётся в число", () => {
    addFunc();
    const name = addPort("takes");
    // Операция — всегда на виду, под количеством, с подписью.
    expect(screen.getByLabelText(`операция ${name}`).textContent).toContain("операция");
    const field = screen.getByLabelText(`выражение ${name}`);
    // Ряд знаков без сравнения, с процентом.
    fireEvent.focus(field);
    expect(screen.getByRole("button", { name: "знак %" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "знак >" })).toBeNull();
    fireEvent.change(field, { target: { value: "50% 8" } });
    fireEvent.blur(field);
    expect(screen.getByLabelText(`сколько ${name}`)).toHaveValue(4);
    expect(screen.getByText(/= 4 по нынешним остаткам/)).toBeInTheDocument();
    const f = dump().funcs.find((x) => x.takes.some((p) => p.expr));
    expect(f.takes[0]).toMatchObject({ expr: "50% 8", lo: 4, hi: 4 });
  });
});
