import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import RegisterPanel from "../components/RegisterPanel.jsx";

/* РЕГИСТРАЦИЯ: участником становятся, подписав договор роли.

   Путей два (владелец, 2026-09-20). ПОЗВАННОМУ роль назначил владелец: ему
   показывают договор ТОЛЬКО этой роли, и выбора нет. НЕЗВАНЫЙ выбирает
   роль сам, подписывает её договор и отвечает на её анкету — а доступ ему
   открывает владелец на «Участниках». */

const ROLES = [
  { id: "exec", name: "исполнитель",
    contract: { name: "договор-исполнителя.pdf", url: "/api/reports/o/1" },
    form: { id: "f1", name: "анкета исполнителя",
      questions: [{ id: "q1", text: "чем занимались раньше" }] } },
  { id: "guest", name: "гость", contract: null },
];

const fetchMock = (over = {}) => vi.fn(async (url, opts) => {
  const u = String(url);
  if (u.includes("/api/org/roles")) {
    return { ok: true, json: async () => ({ roles: ROLES }) };
  }
  if (u.includes("/api/org/register")) {
    over.sent?.push(JSON.parse(opts.body));
    if (over.fail) {
      return { ok: false, status: 400,
        json: async () => ({ error: "Договор не приложен: без подписанного экземпляра роль не выдаётся." }) };
    }
    return { ok: true, json: async () => ({ me: { id: "9", known: true, tabs: ["tasks"] } }) };
  }
  return { ok: true, json: async () => ({}) };
});

afterEach(() => { vi.restoreAllMocks(); delete global.fetch; });

/* У договора всегда есть срок (владелец, 2026-09-20): у принесённого
   файлом плейсхолдеров нет, и даты называет тот, кто его подписал. */
const attach = (name = "подписан.pdf") => {
  const input = screen.getByLabelText("подписанный договор");
  const f = new File(["x"], name, { type: "application/pdf" });
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  fireEvent.change(input);
  fireEvent.change(screen.getByLabelText("договор действует с"),
    { target: { value: "2026-01-01" } });
  fireEvent.change(screen.getByLabelText("договор действует по"),
    { target: { value: "2026-12-31" } });
};

describe("регистрация по договору", () => {
  it("вся последовательность на одном экране: роль → договор → подпись → вступить", async () => {
    const sent = [];
    global.fetch = fetchMock({ sent });
    const done = [];
    render(<RegisterPanel me={{ known: false }} onDone={(m) => done.push(m)} />);
    await waitFor(() => expect(screen.getByLabelText("роль: исполнитель")).toBeTruthy());
    // Пока роль не выбрана, подписывать нечего.
    expect(screen.queryByLabelText("подписанный договор")).toBeNull();

    fireEvent.click(screen.getByLabelText("роль: исполнитель"));
    // Договор — ссылкой: его скачивают и читают.
    const link = screen.getByLabelText("скачать договор роли «исполнитель»");
    expect(link.getAttribute("href")).toBe("/api/reports/o/1");
    // Без подписанного экземпляра «Вступить» не нажимается.
    expect(screen.getByRole("button", { name: "Вступить" })).toBeDisabled();
    attach();
    expect(screen.getByText(/подписан\.pdf/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Вступить" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].roleId).toBe("exec");
    expect(sent[0].file.name).toBe("подписан.pdf");
    expect(sent[0].file.data).toMatch(/^data:/);
    expect(sent[0].start).toBe("2026-01-01");
    expect(sent[0].end).toBe("2026-12-31");
    // Роль выдана — приложение узнаёт об этом сразу, без перезагрузки.
    await waitFor(() => expect(done[0]).toMatchObject({ known: true, tabs: ["tasks"] }));
  });

  it("у роли без договора подписывать нечего — прикладывать тоже", async () => {
    const sent = [];
    global.fetch = fetchMock({ sent });
    render(<RegisterPanel me={{ known: false }} />);
    await waitFor(() => expect(screen.getByLabelText("роль: гость")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("роль: гость"));
    expect(screen.queryByLabelText("подписанный договор")).toBeNull();
    expect(screen.getByText(/У этой роли договора нет/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Вступить" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ roleId: "guest" });
  });

  it("позванному показывают договор только его роли — выбора нет", async () => {
    global.fetch = fetchMock({ sent: [] });
    render(<RegisterPanel me={{ known: true, pending: "exec" }} />);
    await waitFor(() => expect(
      screen.getByLabelText("скачать договор роли «исполнитель»")).toBeTruthy());
    expect(screen.getByText(/Вас позвали/)).toBeTruthy();
    // Ни своей роли выбрать заново, ни чужую: списка ролей у него нет.
    expect(screen.queryByLabelText("роль: исполнитель")).toBeNull();
    expect(screen.queryByLabelText("роль: гость")).toBeNull();
  });

  it("без срока договора «Вступить» не нажимается", async () => {
    global.fetch = fetchMock({ sent: [] });
    render(<RegisterPanel me={{ known: false }} />);
    await waitFor(() => expect(screen.getByLabelText("роль: исполнитель")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("роль: исполнитель"));
    const input = screen.getByLabelText("подписанный договор");
    const f = new File(["x"], "п.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [f], configurable: true });
    fireEvent.change(input);
    expect(screen.getByRole("button", { name: "Вступить" })).toBeDisabled();
    expect(screen.getByText(/не указан срок договора/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("договор действует с"),
      { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("договор действует по"),
      { target: { value: "2026-12-31" } });
    expect(screen.getByRole("button", { name: "Вступить" })).not.toBeDisabled();
  });

  it("«Назад» с выбранной роли возвращает к выбору роли", async () => {
    global.fetch = fetchMock({ sent: [] });
    render(<RegisterPanel me={{ known: false }} />);
    await waitFor(() => expect(screen.getByLabelText("роль: исполнитель")).toBeTruthy());
    // Пока роль не выбрана, назад идти некуда.
    expect(screen.queryByLabelText("назад")).toBeNull();
    fireEvent.click(screen.getByLabelText("роль: исполнитель"));
    expect(screen.getByLabelText("подписанный договор")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("назад"));
    expect(screen.queryByLabelText("подписанный договор")).toBeNull();
    expect(screen.getByLabelText("роль: исполнитель")).toBeTruthy();
  });

  it("анкета роли заполняется при вступлении и уезжает вместе с договором", async () => {
    const sent = [];
    global.fetch = fetchMock({ sent });
    render(<RegisterPanel me={{ known: false }} />);
    await waitFor(() => expect(screen.getByLabelText("роль: исполнитель")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("роль: исполнитель"));
    const field = screen.getByLabelText("чем занимались раньше");
    fireEvent.change(field, { target: { value: "курьером" } });
    fireEvent.blur(field);
    attach();
    fireEvent.click(screen.getByRole("button", { name: "Вступить" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].answers).toEqual({ q1: "курьером" });
  });

  it("заявка подана — ждут владельца, и подписывать второй раз нечего", async () => {
    global.fetch = fetchMock({ sent: [] });
    render(<RegisterPanel me={{ known: true, waiting: { id: "exec", name: "исполнитель" } }} />);
    expect(screen.getByText(/Заявка отправлена/)).toBeTruthy();
    expect(screen.getByText(/ждёт владельца/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Вступить" })).toBeNull();
  });

  it("отказ сервера показан словами, а не молчанием", async () => {
    global.fetch = fetchMock({ sent: [], fail: true });
    render(<RegisterPanel me={{ known: false }} />);
    await waitFor(() => expect(screen.getByLabelText("роль: исполнитель")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("роль: исполнитель"));
    attach();
    fireEvent.click(screen.getByRole("button", { name: "Вступить" }));
    expect(await screen.findByText(/Договор не приложен/)).toBeTruthy();
  });

  it("ролей нет — сказано, что вступать не во что", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ roles: [] }) }));
    render(<RegisterPanel me={{ known: false }} />);
    await waitFor(() => expect(screen.getByText(/Ролей ещё нет/)).toBeTruthy());
  });
});
