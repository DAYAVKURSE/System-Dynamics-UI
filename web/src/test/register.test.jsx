import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import RegisterPanel from "../components/RegisterPanel.jsx";

/* РЕГИСТРАЦИЯ: участником становятся, подписав договор роли.

   Прежде человека впускал владелец, и на вопрос «на каких условиях он тут
   работает» ответа не было. Теперь акцепт — сам договор: человек выбирает
   роль, читает её договор, присылает подписанный экземпляр — и роль
   выдаётся сама, без чужого нажатия. */

const ROLES = [
  { id: "exec", name: "исполнитель",
    contract: { name: "договор-исполнителя.pdf", url: "/api/reports/o/1" } },
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

const attach = (name = "подписан.pdf") => {
  const input = screen.getByLabelText("подписанный договор");
  const f = new File(["x"], name, { type: "application/pdf" });
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  fireEvent.change(input);
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
    // Роль выдана — приложение узнаёт об этом сразу, без перезагрузки.
    await waitFor(() => expect(done[0]).toMatchObject({ known: true, tabs: ["tasks"] }));
  });

  it("у роли без договора подписывать нечего — вступают сразу", async () => {
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

  it("позванному роль выбрана заранее — остаётся подписать", async () => {
    global.fetch = fetchMock({ sent: [] });
    render(<RegisterPanel me={{ known: true, pending: "exec" }} />);
    await waitFor(() => expect(screen.getByLabelText("роль: исполнитель"))
      .toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByText(/Вас позвали/)).toBeTruthy();
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
