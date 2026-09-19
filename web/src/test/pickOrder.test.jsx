import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { Workers } from "../components/AssetPanel.jsx";
import { TaskSetup, newTask } from "../components/TasksBoard.jsx";
import { normalizeAsset } from "../lib/funcs.js";
import { pickByOrderOf, pickOrder } from "../lib/pickOrder.js";

/* ПОРЯДОК ВОРКЕРОВ ВЛИЯЕТ НА ВЫБОР.

   Владелец выстраивает список воркеров актива руками, и по умолчанию это
   значит: кого поставили выше, того берут первым — в форме постановки он
   стоит первым и подставляется сам в пустое поле. Под списком галочка
   «учитывать положение в списке при выборе воркера»: снятая — порядок в
   списке ничего не решает, воркеров предлагают по алфавиту и никого не
   подставляют.

   Отсутствующее поле читается как «включено»: этого владелец и просил, а
   галочка — чтобы отказаться. Старые записи ничего не теряют. */

const PEOPLE = [
  { id: "1", name: "Владелец", roles: [] },
  { id: "2", name: "Яна", roles: ["p1"] },
  { id: "3", name: "Антон", roles: ["p1", "p2"] },
  { id: "4", name: "Борис", roles: ["p2"] },
];
const rolesOf = (id) => PEOPLE.find((x) => x.id === String(id))?.roles || [];
const nameOf = (id) => PEOPLE.find((p) => p.id === String(id))?.name || id;

describe("запись актива: pickByOrder", () => {
  it("у старой записи поля нет — читается как «учитывать»", () => {
    expect(pickByOrderOf({ id: "A", crew: ["2"] })).toBe(true);
    expect(pickByOrderOf(undefined)).toBe(true);
    expect(normalizeAsset({ id: "A" }).pickByOrder).toBe(true);
    // Явное «нет» — единственное, что выключает.
    expect(normalizeAsset({ id: "A", pickByOrder: false }).pickByOrder).toBe(false);
    expect(pickByOrderOf({ pickByOrder: false })).toBe(false);
    // Остальные поля нормализация не теряет.
    expect(normalizeAsset({ id: "A", crew: ["2", "3"], name: "Актив" }))
      .toMatchObject({ id: "A", name: "Актив", crew: ["2", "3"], pickByOrder: true });
  });

  it("порядок предложений: по списку, когда учитывается, иначе по алфавиту", () => {
    const people = [PEOPLE[1], PEOPLE[2], PEOPLE[3]];
    expect(pickOrder({ crew: ["4", "2", "3"] }, people).map((p) => p.name))
      .toEqual(["Борис", "Яна", "Антон"]);
    expect(pickOrder({ crew: ["4", "2", "3"], pickByOrder: false }, people).map((p) => p.name))
      .toEqual(["Антон", "Борис", "Яна"]);
  });
});

describe("галочка под списком воркеров", () => {
  const mount = (over = {}) => render(<Workers workers={{ crew: ["2", "3"] }} people={PEOPLE}
    nameOf={nameOf} tasks={[]} funcs={[]} rolesOf={rolesOf} roleName={() => ""}
    onOrder={() => {}} onOpenPerson={() => {}} positions={[]} {...over} />);

  it("по умолчанию отмечена и выключает порядок через onPickByOrder", () => {
    const onPickByOrder = vi.fn();
    mount({ onPickByOrder });
    const box = screen.getByLabelText("учитывать положение в списке при выборе воркера");
    expect(box.checked).toBe(true);
    expect(screen.getByText(/по умолчанию назначается тот, кто выше/)).toBeInTheDocument();
    fireEvent.click(box);
    expect(onPickByOrder).toHaveBeenCalledWith(false);
  });

  it("снятая — подпись говорит, что порядок на выбор не влияет", () => {
    mount({ onPickByOrder: () => {}, pickByOrder: false });
    expect(screen.getByLabelText("учитывать положение в списке при выборе воркера").checked)
      .toBe(false);
    expect(screen.getByText(/по алфавиту, и никто не назначается сам/)).toBeInTheDocument();
    expect(screen.getByText(/на выбор он сейчас не влияет/)).toBeInTheDocument();
  });

  it("без обработчика галочки нет: там, где актив не редактируют, менять нечего", () => {
    mount();
    expect(screen.queryByLabelText("учитывать положение в списке при выборе воркера")).toBeNull();
  });
});

describe("форма постановки", () => {
  const FUNCS = [{ id: "f1", e: "A", name: "Разбор", dur: 1, durUnit: "ч",
    takes: [], gives: [], setters: ["1"],
    posts: { setters: [], owners: ["p1"], reviewers: ["p2"] } }];
  // В списке актива Яна выше Антона, а Борис выше обоих — значит, исполнителем
  // предложена она, проверяющим — он; по алфавиту вышло бы иначе.
  const asset = (over = {}) => ({ id: "A", name: "Актив", crew: ["1", "4", "2", "3"], ...over });

  function Setup({ entity, onSetup, task: t0 = newTask({ funcId: "f1", setter: "1" }) }) {
    const [tasks, setTasks] = React.useState([t0]);
    return (<TaskSetup task={tasks[0]} tasks={tasks} funcs={FUNCS} entities={[entity]}
      traits={[]} setTasks={setTasks} people={PEOPLE} rolesOf={rolesOf}
      canAssign nameOf={nameOf} onSetup={onSetup} />);
  }
  const names = (label) => Array.from(screen.getByLabelText(label).options)
    .map((o) => o.textContent.split(" · ")[0]);

  it("порядок учитывается: первым подставлен тот, кто выше в списке воркеров", async () => {
    const onSetup = vi.fn(async () => ({}));
    render(<Setup entity={asset()} onSetup={onSetup} />);
    // Ролей на форме не выбирают — подстановка уходит на сервер сама.
    await waitFor(() => expect(onSetup).toHaveBeenCalledWith(
      expect.objectContaining({ funcId: "f1" }), { assignee: "2", reviewer: "4" }));
    expect(screen.queryByLabelText("исполнитель")).toBeNull();
  });

  it("уже назначенного не трогает: подставляется только в пустое", async () => {
    const onSetup = vi.fn(async () => ({}));
    render(<Setup entity={asset()} onSetup={onSetup}
      task={newTask({ funcId: "f1", setter: "1", assignee: "3" })} />);
    await waitFor(() => expect(onSetup).toHaveBeenCalledWith(expect.anything(), { reviewer: "4" }));
  });

  it("поставленную задачу форма не переигрывает", () => {
    const onSetup = vi.fn(async () => ({}));
    render(<Setup entity={asset()} onSetup={onSetup}
      task={{ ...newTask({ funcId: "f1", setter: "1" }), status: "backlog" }} />);
    expect(onSetup).not.toHaveBeenCalled();
  });

  it("порядок выключен: подставляется первый по алфавиту", async () => {
    const onSetup = vi.fn(async () => ({}));
    render(<Setup entity={asset({ pickByOrder: false })} onSetup={onSetup} />);
    // По алфавиту первым идёт Антон — он и в исполнителях, и в проверяющих.
    await waitFor(() => expect(onSetup).toHaveBeenCalledWith(
      expect.objectContaining({ funcId: "f1" }), { assignee: "3", reviewer: "3" }));
  });
});
