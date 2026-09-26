import { vi } from "vitest";

/* ════════════════════════════════════════════════════════════════
   ПОДДЕЛЬНЫЙ СЕРВЕР ДОСОК ДЛЯ ТЕСТОВ

   Отвечает так, как описано в договоре (server/src/routes/boards.js):
   длинный опрос держит GET с нынешним `rev`, пока доску не изменят, и
   отпускает его по abort. Изменение «чужими руками» — `bump`: так тест
   видит, что доска у всех одна.
   ════════════════════════════════════════════════════════════════ */

const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const copy = (v) => JSON.parse(JSON.stringify(v));

export const member = (id, name, color, extra = {}) => ({
  id, name, color, avatar: null, registered: false, blocked: false, stickers: 0, ...extra,
});

export function boardServer(initial, { list = [], me = "100" } = {}) {
  const boards = new Map([[initial.id, { rev: 1, stickers: [], members: [], ...copy(initial) }]]);
  const waiters = new Set();
  const calls = [];
  let gone = null;          // { status, body } — ответ на любой запрос доски
  let nextSid = 1;
  let boardList = copy(list);

  const wake = () => { for (const w of [...waiters]) w(); };
  const view = (id) => {
    const b = copy(boards.get(id));
    b.me = me;
    b.isCreator = String(b.by) === String(me);
    return { board: b };
  };
  const bump = (mut, id = initial.id) => {
    const b = boards.get(id);
    mut(b);
    b.rev += 1;
    wake();
  };

  const fetch = vi.fn(async (url, opts = {}) => {
    const u = new URL(String(url), "https://example.test");
    const method = (opts.method || "GET").toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path: u.pathname, search: u.search, method, body, headers: opts.headers || {} });
    const p = u.pathname;

    if (p === "/api/boards" && method === "GET") return res({ boards: boardList, canCreate: true });
    if (p === "/api/boards" && method === "POST") {
      const name = String(body?.name || "").trim();
      if (!name) return res({ error: "Название доски не может быть пустым." }, 400);
      const b = { id: `n${boardList.length + 1}`, name, color: "#162A2E", by: me, byName: "Я",
        stickers: 0, createdAt: "2026-09-25" };
      boardList = [b, ...boardList];
      boards.set(b.id, { ...b, rev: 1, stickers: [],
        members: [member(me, "Я", "#9BCB5A")] });
      return res({ board: b }, 201);
    }

    const m = p.match(/^\/api\/boards\/([^/]+)(\/.*)?$/);
    if (!m) return res({}, 404);
    const id = decodeURIComponent(m[1]);
    const rest = m[2] || "";
    if (gone) return res(gone.body, gone.status);
    const b = boards.get(id);
    if (!b) return res({ error: "Доски нет." }, 404);

    if (!rest && method === "GET") {
      const rev = u.searchParams.get("rev");
      if (rev != null && Number(rev) === b.rev) {
        await new Promise((done, fail) => {
          const w = () => { waiters.delete(w); done(); };
          waiters.add(w);
          opts.signal?.addEventListener?.("abort", () => {
            waiters.delete(w);
            fail(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
        if (gone) return res(gone.body, gone.status);
      }
      return res(view(id));
    }
    if (rest === "/stickers" && method === "POST") {
      bump((x) => { x.stickers.push({ id: `s${nextSid++}`, by: me, text: "", createdAt: "", updatedAt: "" }); }, id);
      return res(view(id), 201);
    }
    // Статус стикера — ставит создатель доски (владелец, 2026-09-26).
    const st = rest.match(/^\/stickers\/([^/]+)\/status$/);
    if (st && method === "POST") {
      if (String(b.by) !== String(me)) return res({ error: "Статус стикера меняет только создатель доски." }, 403);
      const s = b.stickers.find((x) => x.id === st[1]);
      if (!s) return res({ error: "Стикера нет." }, 404);
      bump(() => { s.status = body?.status ?? null; }, id);
      return res(view(id));
    }
    if (rest === "/applied" && method === "PUT") {
      bump((x) => { x.applied = body?.applied === true; }, id);
      boardList = boardList.map((x) => (x.id === id ? { ...x, applied: body?.applied === true } : x));
      return res({ rev: b.rev });
    }
    const sm = rest.match(/^\/stickers\/([^/]+)$/);
    if (sm) {
      const s = b.stickers.find((x) => x.id === sm[1]);
      if (!s) return res({ error: "Стикера нет." }, 404);
      if (String(s.by) !== String(me)) return res({ error: "Править стикер может только его автор." }, 403);
      if (method === "PATCH") bump(() => { s.text = String(body?.text || ""); }, id);
      if (method === "DELETE") bump((x) => { x.stickers = x.stickers.filter((y) => y.id !== s.id); }, id);
      return res({ rev: b.rev });
    }
    const mm = rest.match(/^\/members\/([^/]+)(\/block|\/unblock)?$/);
    if (mm) {
      if (String(b.by) !== String(me)) {
        return res({ error: "Управлять участниками может только создатель доски." }, 403);
      }
      const uid = decodeURIComponent(mm[1]);
      if (mm[2] === "/block") bump((x) => { x.members.find((y) => y.id === uid).blocked = true; }, id);
      else if (mm[2] === "/unblock") bump((x) => { x.members.find((y) => y.id === uid).blocked = false; }, id);
      else if (method === "DELETE") {
        bump((x) => {
          x.members = x.members.filter((y) => y.id !== uid);
          x.stickers = x.stickers.filter((y) => String(y.by) !== uid);
        }, id);
      }
      return res(view(id));
    }
    return res({}, 404);
  });

  return {
    fetch, calls, bump,
    board: (id = initial.id) => boards.get(id),
    addBoard: (b) => boards.set(b.id, { rev: 1, stickers: [], members: [], ...copy(b) }),
    /** Все последующие запросы доски — этим отказом (и ждущий — тоже). */
    refuse: (status, body) => { gone = { status, body }; wake(); },
    waiting: () => waiters.size,
  };
}
