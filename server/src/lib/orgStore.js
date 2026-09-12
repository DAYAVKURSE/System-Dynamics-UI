import fs from "node:fs/promises";
import path from "node:path";

/* ════════════════════════════════════════════════════════════════
   ЛЮДИ И РОЛИ

   До этого приложение было однопользовательским: у каждого свой каталог
   сценариев, и никто ничего чужого не видел просто потому, что не было
   общего. Теперь модель одна, и надо отвечать на два вопроса: кто ты и
   что тебе видно.

   Владелец — один. Он задан переменной OWNER_TELEGRAM_ID, а если её нет,
   владельцем становится первый, кто открыл приложение, и это записывается
   на диск навсегда. Второй способ ненадёжен и назван таковым в
   DEPLOYMENT.md: на публичном адресе первым может оказаться не тот.

   Роль — это набор вкладок. Не «уровень доступа» с лесенкой прав: лесенка
   врёт, как только появляется роль, которой нужно одно из середины и
   ничего сверху. Владелец в лесенку тоже не укладывается — он видит всё
   и не ограничен ролью вовсе.
   ════════════════════════════════════════════════════════════════ */

/* Вкладки — РОВНО те, что есть в приложении, и в том же порядке
   (`TAB_LIST` в `web/src/components/SystemModel.jsx`). Список, в котором
   лежит вкладка, которой нет, — это обещание доступа к несуществующему
   месту: роль открывает «Прогноз», человек её получает и не находит.
   «Анкета» сюда не входит: она открыта всем вошедшим и роли не требует. */
export const TABS = ["tasks", "review", "scheme", "reports", "tools"];
/* Прежние имена вкладок из сохранённых ролей: «выгрузка» и «звонки» стали
   внутренними вкладками «инструментов», а «таймлайн» и «прогноз» —
   разделами «Схемы». Читаем старое как новое, чтобы роль, заведённая
   вчера, не потеряла вкладку сегодня. */
const TAB_ALIAS = { json: "tools", calls: "tools", timeline: "scheme", sim: "scheme" };
export const normTabs = (tabs) => [...new Set((tabs || [])
  .map((t) => TAB_ALIAS[t] || t).filter((t) => TABS.includes(t)))];

// Встроенные роли переименовать и удалить нельзя: на них ссылается
// приглашение из бота, и остаться без единой роли значит остаться без
// возможности кого-либо добавить.
export const BUILTIN_ROLES = [
  { id: "executor", name: "исполнитель", tabs: ["tasks"], builtin: true },
  { id: "reviewer", name: "проверяющий", tabs: ["review"], builtin: true },
  { id: "worker", name: "исполнитель и проверяющий", tabs: ["tasks", "review"], builtin: true },
  // Созвон нужен всем, кто вообще работает в модели: договориться о
  // встрече — не привилегия.
  { id: "caller", name: "исполнитель со звонками", tabs: ["tasks", "tools"], builtin: true },
];

/* ─────── должность ≠ роль ───────

   РОЛЬ отвечает на «что человеку показывать»: она даёт вкладки, и её
   выбирают при приглашении (исполнитель, проверяющий и т. п.).
   ДОЛЖНОСТЬ отвечает на «кем человек числится»: дизайнер, аналитик,
   бухгалтер. Это разные вопросы, и общего списка у них быть не может —
   один и тот же дизайнер может быть и исполнителем, и проверяющим.
   Должности заводит владелец в блоке воркеров; встроенных нет — какие
   должности бывают, знает он, а не мы. */
const EMPTY = { ownerId: null, roles: BUILTIN_ROLES, users: [] };

/* ─────── договор — акцепт участия ───────

   Человек становится участником не потому, что его добавили, а потому,
   что он подписал договор. Поэтому договор — у РОЛИ: у каждой свой, и
   ролей у человека может быть несколько. Шаблон («что подписать»)
   владелец кладёт к роли; подписанный экземпляр приносит сам человек,
   когда регистрируется, и по нему система сама выдаёт ему эту роль.

   Роль без шаблона договора выдаётся без акцепта — подписывать нечего.
   Это не исключение из правила, а его край: правило говорит «договор
   есть — значит подписан», а не «договор есть всегда».

   ДОЛЖНОСТЕЙ больше нет. Прежде их было два списка: роли (что человеку
   показывать) и должности (кем он числится) — и у человека было по одной
   из каждого. На деле это один вопрос: кто он здесь. Должности прежних
   записей читаются как роли без вкладок, и никто ничего не теряет. */
const fileRef = (f) => (f && typeof f === "object" && f.url
  ? { name: String(f.name || "файл"), type: String(f.type || ""),
    size: Number(f.size) || 0, url: String(f.url) }
  : null);

const roleIds = (v) => [...new Set((Array.isArray(v) ? v : [])
  .map((x) => String(x ?? "")).filter(Boolean))];

/* Роли человека из любой записи: нынешний список, прежняя одиночная роль
   и прежняя должность — всё это его роли. */
const userRoles = (u = {}) => roleIds([
  ...(Array.isArray(u.roles) ? u.roles : []),
  ...(u.roleId ? [u.roleId] : []),
  ...(u.position ? [u.position] : []),
]);

function baseDir() {
  return process.env.ORG_DIR
    ? path.resolve(process.env.ORG_DIR)
    : path.resolve(process.cwd(), "data", "org");
}
const file = () => path.join(baseDir(), "org.json");

export async function readOrg() {
  try {
    const parsed = JSON.parse(await fs.readFile(file(), "utf8"));
    const roles = Array.isArray(parsed.roles) && parsed.roles.length
      ? parsed.roles : BUILTIN_ROLES;
    /* Прежние ДОЛЖНОСТИ становятся ролями без вкладок: это тот же вопрос
       «кто он здесь», и двух списков для него не нужно. Вкладок им не
       дописываем — доступ человека собран из его прежней роли. */
    const old = Array.isArray(parsed.positions) ? parsed.positions : [];
    const all = [
      ...roles.map((r) => ({ ...r, tabs: normTabs(r.tabs), contract: fileRef(r.contract) })),
      ...old.filter((p) => p && p.id && !roles.some((r) => r.id === String(p.id)))
        .map((p) => ({ id: String(p.id), name: String(p.name || p.id),
          tabs: [], contract: null, builtin: false })),
    ];
    return {
      ownerId: parsed.ownerId != null ? String(parsed.ownerId) : null,
      // Роли — как записаны: встроенные тоже можно удалить, и воскрешать их
      // при каждом чтении нельзя. Пустой список — единственный случай, когда
      // подставляются встроенные: иначе позвать в модель станет некого.
      roles: all,
      users: (Array.isArray(parsed.users) ? parsed.users : []).map((u) => {
        const { roleId, position, ...rest } = u;
        return { ...rest, roles: userRoles(u),
          contracts: u.contracts && typeof u.contracts === "object" ? u.contracts : {} };
      }),
    };
  } catch {
    return { ...EMPTY, roles: [...BUILTIN_ROLES], users: [] };
  }
}

async function writeOrg(org) {
  await fs.mkdir(baseDir(), { recursive: true });
  // Через временный файл и переименование: иначе читатель, попавший на
  // середину записи, получил бы обрезанный JSON — а разбор здесь молча
  // возвращает пустую организацию, и владелец «терялся» бы.
  const tmp = `${file()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(org, null, 2), "utf8");
  await fs.rename(tmp, file());
  return org;
}

/** Владелец из переменной окружения, если она задана. */
export const envOwner = () =>
  (process.env.OWNER_TELEGRAM_ID ? String(process.env.OWNER_TELEGRAM_ID).trim() : null);

/**
 * Кто спрашивает и что ему видно. Первый вошедший становится владельцем,
 * если владелец не задан ни переменной, ни файлом.
 *
 * `claim: false` выключает это назначение — для случаев, когда человек
 * пришёл не «открыть модель», а по ссылке со стороны: инлайн-запрос,
 * звонок. Хозяином модели такой человек становиться не должен.
 */
export async function identify(userId, profile = {}, { claim = true } = {}) {
  const org = await readOrg();
  const env = envOwner();
  let changed = false;

  if (env && org.ownerId !== env) { org.ownerId = env; changed = true; }
  if (!org.ownerId && claim) { org.ownerId = String(userId); changed = true; }

  const id = String(userId);
  const isOwner = org.ownerId === id;
  let user = org.users.find((u) => u.id === id) || null;

  // Владелец есть в списке всегда — иначе его нельзя ни показать, ни
  // назначить исполнителем собственной задачи.
  if (isOwner && !user) {
    user = { id, name: profile.name || "владелец", username: profile.username || "",
      roleId: null, addedAt: new Date().toISOString(), addedBy: null };
    org.users.push(user); changed = true;
  }
  // Имя из Telegram обновляем на входе: человек мог его сменить, а в
  // приглашении оно записано таким, каким было тогда.
  if (user && profile.name && user.name !== profile.name) {
    user.name = profile.name; changed = true;
  }
  if (changed) await writeOrg(org);

  /* Ролей у человека может быть несколько: он и дизайнер, и проверяющий.
     Вкладки — ОБЪЕДИНЕНИЕ их вкладок: роль ничего не отнимает, она
     только открывает. */
  const mine = userRoles(user || {})
    .map((rid) => org.roles.find((r) => r.id === rid)).filter(Boolean);
  const role = mine[0] || null;
  return {
    id, isOwner,
    known: isOwner || !!user,
    name: user?.name || profile.name || "",
    // Роли — рядом с «кто я»: ими записаны роли функций, и без них нельзя
    // сказать, что человеку поручено.
    roles: mine.map((r) => ({ id: r.id, name: r.name })),
    position: mine[0]?.id || "",
    /* Чего человек ещё не подписал: роль, которую ему приготовили, ждёт
       договора. Пока не подписал — роли у него нет, и приложение ведёт
       его на регистрацию, а не показывает пустые вкладки. */
    pending: user?.pending ? String(user.pending) : "",
    // Своя анкета приходит вместе с «кто я»: она нужна на первой же
    // вкладке, и отдельный запрос за ней был бы вторым кругом за тем же.
    profile: profileOf(user || {}),
    role: role || null,
    // Владельцу доступно всё; остальным — то, что дают ЕГО РОЛИ вместе.
    // Ни одной роли (её удалили или договор не подписан) — не показываем
    // ничего, кроме объяснения.
    tabs: isOwner ? [...TABS] : normTabs(mine.flatMap((r) => r.tabs || [])),
  };
}

/* ─────── анкета человека ───────

   Рейтинг говорит, как человек работал. Анкета — всё остальное, что он
   счёл нужным о себе сказать, и пишет её сам человек, не владелец за него:
   про себя он знает точнее, а заполненная кем-то другим анкета была бы
   чужим мнением под чужим именем.

   Поле ОДНО. Прежде их было четыре — «чем занимается», «о себе», «что
   умеет», «как связаться», — и это была не анкета, а допрос по форме,
   которую никто не заказывал. Что писать о себе, решает человек.

   Лежит анкета рядом с человеком, в списке организации: она свойство
   человека, а не модели, и переезжать из сценария в сценарий вместе с
   моделью ей незачем. */
export const PROFILE_FIELDS = ["about"];

/* ─────── рабочий график и статус ───────

   Анкета говорит, ЧТО человек умеет; график и статус — РАБОТАЕТ ЛИ ОН
   СЕЙЧАС. Второе спрашивают раньше первого: ставить задачу тому, у кого
   сегодня выходной, значит назначить срок, которого никто не обещал.

   Пишет их сам человек, тем же маршрутом, что и анкету: чужой график,
   записанный за человека, — это догадка под его именем. Правила разбора
   те же, что на клиенте (`scheduleOfPerson` в `web/src/lib/workers.js`):
   день это 0–6, часы — «ЧЧ:ММ» или пусто, статус — один из четырёх.
   Рядом — `warnMin`, за сколько минут его предупреждать о задаче, и
   `deferMin`, на сколько кнопка «Отложить» откладывает напоминание: это
   тоже про него самого, и отдаётся вместе с графиком — и в «кто я», и в
   списке людей. */
export const WORK_STATUSES = ["ready", "break", "off", "busy"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = (v) => (HHMM.test(String(v || "")) ? String(v) : "");
const weekDays = (v) => (Array.isArray(v)
  ? [...new Set(v.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
  : []);
/* Часы отдельного дня (`perDay`): исключения из общих «с — до», «в субботу
   с 10 до 14». Запись — целиком, без единого часа её нет, у выходного —
   тоже: день выключили, и его часы ушли с ним. Прежние записи без
   `perDay` читаются как прежде — исключений у них нет. */
const perDayOf = (v, days = null) => {
  const out = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  Object.entries(v).forEach(([k, h]) => {
    const d = Number(k);
    if (!Number.isInteger(d) || d < 0 || d > 6) return;
    if (days && !days.includes(d)) return;
    const from = hhmm(h?.from);
    const to = hhmm(h?.to);
    if (from || to) out[d] = { from, to };
  });
  return out;
};
const scheduleOf = (user = {}) => ({
  days: weekDays(user.days),
  from: hhmm(user.from),
  to: hhmm(user.to),
  perDay: perDayOf(user.perDay, weekDays(user.days)),
  status: WORK_STATUSES.includes(user.status) ? user.status : "ready",
  warnMin: warnOf(user.warnMin),
  deferMin: deferOf(user.deferMin),
});

/* ─────── за сколько предупреждать ───────

   «За сколько минут до начала напомнить» — настройка человека, а не
   задачи: напоминание приходит ему, и на сколько заранее ему удобно, знает
   он, а не постановщик. Прежде это поле стояло в форме постановки, и
   постановщик решал за исполнителя, когда того будить.

   Целое число минут от 0 (только «пора начинать») до суток. Не число —
   значит не названо, и берётся умолчание; число вне отрезка прижимается к
   его краю: «за неделю» — это не ошибка, а «за сутки, раньше не умеем». */
export const WARN_DEFAULT = 10;
export const WARN_MAX = 1440;
const warnOf = (v) => {
  const n = Number(v);
  if (v == null || v === "" || !Number.isFinite(n)) return WARN_DEFAULT;
  return Math.min(WARN_MAX, Math.max(0, Math.round(n)));
};

/* ─────── на сколько откладывать ───────

   «Отложить» под напоминанием больше не спрашивает «на сколько»: срок —
   настройка человека, та же карточка «Напоминания». Одно нажатие вместо
   трёх экранов, и число одно на оба вида напоминаний — о задаче и о
   постановке. Нижняя граница — минута, не ноль: отложить на ноль значит
   не отложить, а напоминание при этом обещало бы «напомню снова». */
export const DEFER_DEFAULT = 30;
export const DEFER_MAX = 1440;
const deferOf = (v) => {
  const n = Number(v);
  if (v == null || v === "" || !Number.isFinite(n)) return DEFER_DEFAULT;
  return Math.min(DEFER_MAX, Math.max(1, Math.round(n)));
};

/** На сколько минут этому человеку откладывать напоминание — боту. */
export async function deferMinOf(userId) {
  const org = await readOrg();
  const user = org.users.find((u) => u.id === String(userId));
  return deferOf(user?.deferMin);
}
/* Что было написано в прежних четырёх полях, не пропадает: пока анкета
   пуста, она читается как их склейка — а первое же сохранение переносит
   текст в неё насовсем. Молча выбросить чужие слова было бы хуже всего. */
const LEGACY_FIELDS = ["title", "skills", "contact"];
const LIMIT = 2000;
const profileOf = (user = {}) => {
  const about = String(user.about || "");
  const old = LEGACY_FIELDS.map((k) => String(user[k] || "").trim()).filter(Boolean);
  return { about: about || old.join("\n"), ...scheduleOf(user) };
};

/** Свою анкету человек пишет сам. Чужую — никто. */
export async function setProfile(userId, patch = {}) {
  const org = await readOrg();
  const id = String(userId);
  const user = org.users.find((u) => u.id === id);
  if (!user) return null;
  PROFILE_FIELDS.forEach((k) => {
    if (patch[k] == null) return;
    user[k] = String(patch[k]).slice(0, LIMIT);
  });
  /* График и статус разбираются, а не берутся как есть: сюда приходит то,
     что прислал браузер, и «понедельник» или «25:00» в записи человека
     означали бы график, по которому нельзя сказать ничего. */
  if (patch.days != null) user.days = weekDays(patch.days);
  if (patch.from != null) user.from = hhmm(patch.from);
  if (patch.to != null) user.to = hhmm(patch.to);
  // Часы дня разбираются так же строго и только для рабочих дней.
  if (patch.perDay != null) user.perDay = perDayOf(patch.perDay, weekDays(user.days));
  if (patch.status != null) {
    user.status = WORK_STATUSES.includes(patch.status) ? patch.status : "ready";
  }
  if (patch.warnMin != null) user.warnMin = warnOf(patch.warnMin);
  if (patch.deferMin != null) user.deferMin = deferOf(patch.deferMin);
  await writeOrg(org);
  return profileOf(user);
}

export async function listOrg() {
  const org = await readOrg();
  /* Люди уходят наружу вместе с разобранной анкетой: график и статус нужны
     там же, где список, — при выборе, кому поручить работу. Собирать их
     вторым запросом на каждого человека значило бы спрашивать по одному то,
     что уже лежит рядом. */
  return {
    ownerId: org.ownerId,
    roles: org.roles,
    users: org.users.map((u) => ({ ...u, ...profileOf(u) })),
  };
}

/* ─────── роли человека ───────

   Должностей больше нет: роль и есть ответ на «кто он здесь». Ролей у
   человека бывает несколько — он и дизайнер, и проверяющий, — и тогда
   вкладки складываются, а работу ему можно поручить по любой из них.

   Раздаёт роли владелец (здесь) и сам человек, подписав договор
   (`registerUser`). Третьего пути нет. */

export async function setUserRoles(id, roles) {
  const org = await readOrg();
  const user = org.users.find((u) => u.id === String(id));
  if (!user) return null;
  const want = roleIds(roles);
  const unknown = want.find((r) => !org.roles.some((x) => x.id === r));
  if (unknown) throw new Error("unknown role");
  user.roles = want;
  await writeOrg(org);
  return user;
}

/** Шаблон договора роли: что человек подписывает, вступая в неё. */
export async function setRoleContract(id, file) {
  const org = await readOrg();
  const role = org.roles.find((r) => r.id === id);
  if (!role) return null;
  role.contract = fileRef(file);
  await writeOrg(org);
  return role;
}

/**
 * Роли, в которые можно зарегистрироваться, — всем, кто открыл приложение.
 *
 * Отдаётся без имён людей и без чужих договоров: только чем эта роль
 * называется и что по ней подписывать. Незваный человек не должен видеть
 * список организации, чтобы в неё вступить.
 */
export async function openRoles() {
  const org = await readOrg();
  return org.roles.map((r) => ({ id: r.id, name: r.name,
    tabs: normTabs(r.tabs), contract: fileRef(r.contract) }));
}

/**
 * Регистрация: человек подписал договор роли — и роль у него есть.
 *
 * Акцепт здесь — сам подписанный экземпляр: без него роль не выдаётся, и
 * решать «пускать ли» отдельным нажатием владельцу не нужно. Роль, у
 * которой шаблона договора нет, подписывать нечем — она выдаётся сразу.
 *
 * Повторная регистрация в ту же роль заменяет подписанный экземпляр:
 * договор перезаключают, а не заводят вторую запись о том же.
 */
export async function registerUser(userId, profile = {}, { roleId, file } = {}) {
  const org = await readOrg();
  const id = String(userId);
  const role = org.roles.find((r) => r.id === roleId);
  if (!role) throw new Error("unknown role");
  const signed = fileRef(file);
  if (role.contract && !signed) throw new Error("contract is required");

  let user = org.users.find((u) => u.id === id);
  if (!user) {
    user = { id, name: profile.name || id, username: profile.username || "",
      roles: [], contracts: {}, addedAt: new Date().toISOString(), addedBy: null };
    org.users.push(user);
  }
  if (profile.name && user.name !== profile.name) user.name = profile.name;
  user.roles = roleIds([...(user.roles || []), role.id]);
  user.contracts = { ...(user.contracts || {}),
    [role.id]: { ...(signed || {}), at: new Date().toISOString() } };
  // Приготовленная роль дождалась договора — ждать больше нечего.
  if (String(user.pending || "") === role.id) delete user.pending;
  await writeOrg(org);
  return user;
}

/**
 * Позвать человека: владелец называет роль, человек подписывает договор.
 *
 * Роль сразу НЕ выдаётся, если у неё есть договор: акцептом участия
 * служит подпись, а не чужое решение. Приготовленная роль лежит в
 * `pending`, и приложение при первом входе ведёт человека подписывать её.
 * Договора у роли нет — подписывать нечего, и роль выдаётся сразу.
 */
export async function addUser({ id, name, username, roleId, addedBy }) {
  if (!id) throw new Error("id is required");
  const org = await readOrg();
  const role = org.roles.find((r) => r.id === roleId);
  if (!role) throw new Error("unknown role");
  const uid = String(id);
  const idx = org.users.findIndex((u) => u.id === uid);
  const was = idx >= 0 ? org.users[idx] : null;
  const signed = !role.contract || !!(was?.contracts || {})[role.id];
  const entry = {
    id: uid, name: name || uid, username: username || "",
    roles: signed ? roleIds([...(was?.roles || []), role.id]) : roleIds(was?.roles),
    ...(signed ? {} : { pending: role.id }),
    contracts: (was?.contracts) || {},
    addedAt: new Date().toISOString(), addedBy: addedBy ? String(addedBy) : null,
  };
  if (idx >= 0) org.users[idx] = { ...org.users[idx], ...entry };
  else org.users.push(entry);
  await writeOrg(org);
  return entry;
}

export async function removeUser(id) {
  const org = await readOrg();
  const uid = String(id);
  // Владельца из списка убрать нельзя: он останется владельцем, но
  // пропадёт из выбора исполнителей, и это выглядело бы как поломка.
  if (org.ownerId === uid) return false;
  const before = org.users.length;
  org.users = org.users.filter((u) => u.id !== uid);
  if (org.users.length === before) return false;
  await writeOrg(org);
  return true;
}

/** Одна роль вместо всех — прежний способ, оставлен для бота и ссылок. */
export async function setUserRole(id, roleId) {
  const org = await readOrg();
  const user = org.users.find((u) => u.id === String(id));
  if (!user) return null;
  if (!org.roles.some((r) => r.id === roleId)) throw new Error("unknown role");
  user.roles = [roleId];
  await writeOrg(org);
  return user;
}

const slug = (name, fallback = "role") => String(name).toLowerCase()
  .replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || fallback;

export async function addRole({ name, tabs, contract }) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("name is required");
  const org = await readOrg();
  if (org.roles.some((r) => r.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error("role already exists");
  }
  let id = slug(clean), n = 2;
  while (org.roles.some((r) => r.id === id)) id = `${slug(clean)}-${n++}`;
  // Новая роль по умолчанию — исполнитель: из бота роль заводится одним
  // именем, а видеть чужие проверки без явного решения она не должна.
  const list = normTabs(tabs);
  const role = { id, name: clean, tabs: list.length ? list : ["tasks"],
    contract: fileRef(contract), builtin: false };
  org.roles.push(role);
  await writeOrg(org);
  return role;
}

export async function setRoleTabs(id, tabs) {
  const org = await readOrg();
  const role = org.roles.find((r) => r.id === id);
  if (!role) return null;
  role.tabs = normTabs(tabs);
  await writeOrg(org);
  return role;
}

export async function removeRole(id) {
  const org = await readOrg();
  const role = org.roles.find((r) => r.id === id);
  // Удалить можно любую роль, включая встроенную, — кроме последней: без
  // единой роли позвать в модель станет некого.
  if (!role || org.roles.length <= 1) return false;
  org.roles = org.roles.filter((r) => r.id !== id);
  // Люди с удалённой ролью не исчезают — они теряют её одну, а остальные
  // остаются. Молча раздавать им другую роль нельзя.
  org.users = org.users.map((u) => ({ ...u,
    roles: (u.roles || []).filter((r) => r !== id) }));
  await writeOrg(org);
  return true;
}
