import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import ProfilePanel from "../components/ProfilePanel.jsx";

/* ИМЯ — В АНКЕТЕ (владелец, 2026-09-20).

   Справа от имени карандаш: нажали — имя стало полем ввода. Названное
   здесь имя приложение показывает везде, поэтому оно уезжает на сервер
   своим нажатием и возвращается в «кто я» и в список людей. Чужое имя не
   правится: анкету пишет сам человек. */

const ME = { id: "2", name: "Иван", isOwner: false, known: true, tabs: ["tasks"],
  profile: { about: "" } };
const PEOPLE = [{ id: "2", name: "Иван" }, { id: "3", name: "Пётр" }];

const server = (over = {}) => {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method,
      body: opts.body ? JSON.parse(opts.body) : null });
    if (over.fail) {
      return { ok: false, status: 400, json: async () => ({ error: "имя занято" }) };
    }
    return { ok: true, status: 200,
      json: async () => ({ profile: { ...ME.profile, name: "Иван Петров" } }) };
  }));
  return calls;
};
afterEach(() => vi.restoreAllMocks());

const view = (props = {}) => render(
  <ProfilePanel me={ME} people={PEOPLE} tasks={[]} funcs={[]} entities={[]}
    rolesOf={() => []} {...props} />);

describe("имя правится в анкете", () => {
  it("карандаш превращает имя в поле ввода, и новое имя уходит на сервер", async () => {
    const calls = server();
    const saved = [];
    view({ onSaved: (p) => saved.push(p) });
    expect(screen.getByText("Иван")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("изменить имя"));
    const field = screen.getByLabelText("имя");
    expect(field).toHaveValue("Иван");
    fireEvent.change(field, { target: { value: "Иван Петров" } });
    fireEvent.blur(field);
    const saves = () => calls.filter((c) => c.method === "PUT");
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0]).toMatchObject({ url: "/api/org/me/profile", method: "PUT",
      body: { name: "Иван Петров" } });
    // Наружу уходит запись с именем — оттуда его берут все остальные формы.
    await waitFor(() => expect(saved[0]).toMatchObject({ name: "Иван Петров" }));
  });

  it("пустое имя не сохраняется", async () => {
    const calls = server();
    view();
    fireEvent.click(screen.getByLabelText("изменить имя"));
    const field = screen.getByLabelText("имя");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.blur(field);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(screen.getByText("Иван")).toBeInTheDocument();
  });

  it("чужое имя не правится: анкету пишет сам человек", () => {
    server();
    view({ personId: "3" });
    expect(screen.getByText("Пётр")).toBeInTheDocument();
    expect(screen.queryByLabelText("изменить имя")).toBeNull();
  });

  it("отказ сервера показан словами", async () => {
    server({ fail: true });
    view();
    fireEvent.click(screen.getByLabelText("изменить имя"));
    const field = screen.getByLabelText("имя");
    fireEvent.change(field, { target: { value: "Другой" } });
    fireEvent.blur(field);
    expect(await screen.findByText(/имя занято/)).toBeInTheDocument();
  });
});
