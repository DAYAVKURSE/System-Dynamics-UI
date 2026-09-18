import { describe, expect, it } from "vitest";
import { postMap, procPlan, schedulePlan, taskLines, whoText } from "../components/ProcMaps.jsx";

/* ТАЙМЛАЙН: что идёт одновременно (владелец, 2026-09-18: «в таймлайне должно
   быть видно параллельность, если задачи выполняются разными людьми и не
   требуют последовательного создания ресурсов, или есть ветвление»). */

const model = {
  entities: [{ id: "own", name: "Владелец", posts: ["r_owner"] }, { id: "prt", name: "Партнёр", posts: ["r_prt"] }],
  positions: [{ id: "r_owner", name: "Владелец" }, { id: "r_prt", name: "Партнёр-фрилансер" }],
  traits: [{ id: "t1", l: "оффер", e: "own" }, { id: "t2", l: "оплата", e: "prt" }, { id: "t3", l: "отчёт", e: "own" }],
};
const plan = (text) => schedulePlan(procPlan(text, model, {}));

describe("таймлайн: параллельность", () => {
  it("задача ждёт того, у кого берёт ресурс", () => {
    const [a, b] = plan("Задача: выдать\nКто: Владелец\nОтдаёт: оффер 1\n\nЗадача: принять\nКто: Партнёр-фрилансер\nБерёт: оффер 1");
    expect(a.start).toBe(0);
    expect(b.start).toBe(a.end);          // вторая начинается по готовности ресурса
    expect(b.along).toEqual([]);
  });

  it("разные люди без общего ресурса идут разом", () => {
    const [a, b] = plan("Задача: письма\nКто: Владелец\nОтдаёт: оффер 1\n\nЗадача: счета\nКто: Партнёр-фрилансер\nОтдаёт: оплата 1");
    expect(a.start).toBe(0);
    expect(b.start).toBe(0);
    expect(a.along).toEqual(["счета"]);
    expect(b.along).toEqual(["письма"]);
  });

  it("один человек делает свои задачи по очереди", () => {
    const [a, b] = plan("Задача: письма\nКто: Владелец\nОтдаёт: оффер 1\n\nЗадача: отчёт\nКто: Владелец\nОтдаёт: отчёт 1");
    expect(b.start).toBe(a.end);
    expect(a.along).toEqual([]);
  });

  it("ветки одного условия идут разом даже у одного человека", () => {
    const text = ["Задача: приём", "Кто: Владелец", "Отдаёт: оффер 1", "",
      "Если: заявка полная", "То:", "Задача: принять", "Кто: Владелец", "Берёт: оффер 1", "Отдаёт: оплата 1",
      "Иначе:", "Задача: вернуть", "Кто: Владелец", "Берёт: оффер 1", "Отдаёт: отчёт 1"].join("\n");
    const [first, yes, no] = plan(text);
    expect(first.start).toBe(0);
    expect(yes.start).toBe(first.end);
    expect(no.start).toBe(yes.start);     // «иначе» не ждёт «то»
    expect(yes.along).toEqual(["вернуть"]);
    expect(yes.cond).toBe("заявка полная");
    expect(no.isElse).toBe(true);
  });
});

describe("кто и кому — должность, переменная в скобках (владелец, 2026-09-18)", () => {
  it("«кто» — должность; рука и сотрудник в скобках", () => {
    expect(whoText({ name: "Владелец" })).toBe("Владелец");
    expect(whoText({ name: "Владелец", hand: "Синий кот" })).toBe("Владелец (Синий кот)");
    expect(whoText({ name: "Владелец", person: "Иван" })).toBe("Владелец (Иван)");
    expect(whoText({ hand: "Синий кот" })).toBe("(Синий кот)");
    expect(whoText({})).toBe("должность не названа");
  });

  it("должность видна, даже если в строке названа только рука (владелец, 2026-09-18)", () => {
    const text = ["Задача: уточнить", "Кто: {wise oyster}", "Берёт: оффер 1", "",
      "Задача: передать", "Кто: Владелец", "Отдаёт: оплата 1", "Кому: Партнёр-фрилансер {wise oyster}"].join("\n");
    const plan = procPlan(text, model, {});
    expect(plan[0].who[0]).toMatchObject({ name: "", hand: "wise oyster" });   // в строке должности нет
    const postOf = postMap(plan);
    expect(postOf({ hand: "wise oyster" })).toBe("Партнёр-фрилансер");          // но процесс её знает
    expect(whoText(plan[0].who[0], postOf)).toBe("Партнёр-фрилансер (wise oyster)");
    expect(whoText(plan[0].who[0])).toBe("(wise oyster)");                      // без справки — только рука
  });

  it("«кому отдаёт» — та же запись", () => {
    const text = "Задача: выдать\nКто: Владелец\nОтдаёт: оффер 1 {Синий кот}\nКому: Партнёр-фрилансер";
    const [t] = procPlan(text, model, {});
    const give = taskLines(t).find((r) => r.kind === "give");
    expect(give.text).toContain("→ Партнёр-фрилансер");
  });
});
