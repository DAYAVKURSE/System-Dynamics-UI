/* ════════════════════════════════════════════════════════════════
   РЕЕСТР MCP-СЕРВЕРОВ (владелец, 2026-09-20)

   «Сделай, чтобы у меня был просто добавлен MCP registry, и на форме
   MCP-серверов я видел список доступных серверов и мог обновить».

   Реестр — общий каталог MCP-серверов (`registry.modelcontextprotocol.io`);
   адрес можно сменить переменной MCP_REGISTRY_URL, если понадобится свой.
   Мы у него только СПРАШИВАЕМ список: ни ключа, ни записи туда нет.

   Берём не все записи, а те, к которым приложение может подключиться
   САМО, — у которых объявлен удалённый адрес (`remotes`). Сервер,
   который надо сначала установить пакетом и запустить у себя, в этот
   список не попадает: показать его значило бы предложить кнопку
   «Добавить», после которой ничего не работает.

   Всё, что приходит из реестра, — ЧУЖИЕ ДАННЫЕ: имена, описания, адреса.
   Они режутся по длине и никуда, кроме экрана и поля адреса, не идут.
   ════════════════════════════════════════════════════════════════ */

export const DEFAULT_REGISTRY = "https://registry.modelcontextprotocol.io";
const TIMEOUT_MS = 20000;
export const MAX_SERVERS = 200;

const str = (v, limit) => String(v == null ? "" : v).trim().slice(0, limit);

export const registryUrl = () =>
  String(process.env.MCP_REGISTRY_URL || DEFAULT_REGISTRY).replace(/\/+$/, "");

/* Короткое имя: в реестре они пишутся как «io.github.owner/server» — на
   кнопке нужна последняя часть, а полное имя остаётся подписью. */
const shortName = (full) => {
  const s = str(full, 200);
  const tail = s.includes("/") ? s.slice(s.lastIndexOf("/") + 1) : s;
  return tail || s;
};

/* Адрес, по которому можно подключиться. Реестр отдаёт список удалённых
   точек; берём первую — на большее у формы нет ни поля, ни смысла. */
const remoteOf = (s) => {
  const list = Array.isArray(s?.remotes) ? s.remotes
    : (Array.isArray(s?.deployments) ? s.deployments : []);
  for (const r of list) {
    const url = str(r?.url, 500);
    if (/^https?:\/\//i.test(url)) return { url, transport: str(r?.type || r?.transport, 40) };
  }
  return null;
};

/* Служебная часть записи: она у реестра лежит под длинным ключом, и
   читать её надо аккуратно — записи бывают снятые с публикации. */
const metaOf = (raw) => {
  const m = raw?._meta && typeof raw._meta === "object" ? raw._meta : {};
  const own = m["io.modelcontextprotocol.registry/official"];
  return own && typeof own === "object" ? own : {};
};

const view = (raw) => {
  // Реестр отдаёт либо сам сервер, либо обёртку `{ server, _meta }`.
  const s = raw?.server && typeof raw.server === "object" ? raw.server : raw;
  const meta = metaOf(raw);
  // Снятое с публикации не показываем: кнопка «Добавить» под ним лгала бы.
  if (meta.status && meta.status !== "active") return null;
  const remote = remoteOf(s);
  if (!remote) return null;
  const full = str(s?.name, 200);
  if (!full) return null;
  return {
    id: str(s?.name, 200),
    // Своё название сервер даёт сам; slug остаётся полным именем.
    name: str(s?.title, 120) || shortName(full),
    full,
    description: str(s?.description, 600),
    version: str(s?.version, 60),
    repo: str(s?.repository?.url || s?.repository, 500),
    url: remote.url,
    transport: remote.transport,
  };
};

/**
 * Спросить у реестра, какие серверы есть.
 *
 * Ошибку не прячем: «обновить» без ответа — это ответ «реестр молчит», и
 * человек должен увидеть именно это, а не пустой список, который выглядит
 * как «серверов нет».
 */
export async function listRegistry({ signal, limit = MAX_SERVERS } = {}) {
  const base = registryUrl();
  const ctl = signal ? null : new AbortController();
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  try {
    /* `version=latest` — иначе реестр отдаёт КАЖДУЮ версию каждого
       сервера, и сотня записей оказывается десятком серверов, повторённых
       по десять раз. */
    const res = await fetch(
      `${base}/v0/servers?version=latest&limit=${Math.min(limit, MAX_SERVERS)}`, {
      headers: { Accept: "application/json" },
      signal: signal || ctl.signal,
    });
    if (!res.ok) throw new Error(`Реестр ответил ${res.status}`);
    const body = await res.json();
    const raw = Array.isArray(body) ? body
      : (Array.isArray(body?.servers) ? body.servers : []);
    const out = [];
    const seen = new Set();
    for (const item of raw) {
      const v = view(item);
      if (!v || seen.has(v.id)) continue;
      seen.add(v.id);
      out.push(v);
      if (out.length >= limit) break;
    }
    out.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    return { url: base, servers: out };
  } finally { if (timer) clearTimeout(timer); }
}
