import crypto from "node:crypto";
import fs from "node:fs/promises";
import { aliasOf } from "./alias.js";
import path from "node:path";
import { getReport } from "./reportStore.js";
import { docxToHtml } from "./docx.js";
import { isMain, scopedDir } from "./storages.js";

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
const TAB_ALIAS = { json: "tools:export", calls: "tools:calls",
  timeline: "scheme:time", sim: "scheme:sim" };
/* ВКЛАДКИ — ВСЕ, что вообще есть в приложении (владелец, 2026-09-20), и
   верхние, и внутренние: внутренняя вкладка — такое же место, и роль
   должна уметь открыть «Звонки», не открывая «Выгрузку». Внутренние
   пишутся через двоеточие: «tools:calls». Открытая внутренняя открывает и
   свою верхнюю — иначе до неё не дойти. */
export const TABS = ["market", "me", "tasks", "review",
  "scheme", "scheme:edit", "scheme:time", "scheme:sim",
  "reports",
  "tools", "tools:people", "tools:assistant", "tools:virtual", "tools:reminders",
  "tools:calls", "tools:issues", "tools:export"];
/* Право на вкладке: «r» — только смотреть, «rw» — ещё и править
   (владелец, 2026-09-20: одно нажатие — жёлтая «r», второе — зелёная
   «rw»). Прежние роли хранили просто список вкладок — он читается как
   полное право: ничего у них не отнимаем. */
export const ACCESS = ["r", "rw"];
export const accessOf = (role = {}) => {
  const out = {};
  const put = (t, a) => {
    const tab = TAB_ALIAS[t] || t;
    if (!TABS.includes(tab)) return;
    if (out[tab] === "rw") return;
    out[tab] = ACCESS.includes(a) ? a : "rw";
  };
  /* Карта прав — главная; список `tabs` остался для прежних читателей и
     повторяет её. Читать его первым значило бы выдавать «rw» там, где в
     карте стоит «r»: вкладка уже полная, и «r» до неё не доходит. Роль без
     карты — запись прошлой версии: её список и есть полное право. */
  const map = role.access && typeof role.access === "object" ? role.access : null;
  if (map) Object.entries(map).forEach(([t, a]) => put(t, a));
  (role.tabs || []).forEach((t) => {
    if (!map || !((TAB_ALIAS[t] || t) in map)) put(t, "rw");
  });
  /* Внутренняя вкладка открывает и свою верхнюю: до «Звонков» иначе не
     добраться. Право у верхней — не ниже права внутренней. */
  Object.entries({ ...out }).forEach(([t, a]) => {
    const top = t.includes(":") ? t.split(":")[0] : "";
    if (top && out[top] !== "rw") out[top] = a;
  });
  return out;
};
/* Прежние имена вкладок из сохранённых ролей: «выгрузка» и «звонки» стали
   внутренними вкладками «инструментов», а «таймлайн» и «прогноз» —
   разделами «Схемы». Читаем старое как новое, чтобы роль, заведённая
   вчера, не потеряла вкладку сегодня. */

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
const EMPTY = { ownerId: null, roles: BUILTIN_ROLES, users: [], forms: [], docs: [],
  agreements: [], codes: [], grants: [] };

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
/** Дата как день: «2026-01-31». Чужая строка в запись не пускается. */
const dayOnly = (v) => {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : "";
};

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
  return scopedDir(process.env.ORG_DIR
    ? path.resolve(process.env.ORG_DIR)
    : path.resolve(process.cwd(), "data", "org"));
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
      ...roles.map((r) => ({ ...r, tabs: Object.keys(accessOf(r)), access: accessOf(r),
        contract: fileRef(r.contract),
        form: formLink(r.form),
        /* Договор-документ роли (lib/contractStore.js): по нему зовут
           участника и его подписывают. Прежний `contract` (файл-шаблон)
           остаётся читаться — роли, заведённые до документов, живут. */
        doc: r.doc == null || r.doc === "" ? null : String(r.doc) })),
      ...old.filter((p) => p && p.id && !roles.some((r) => r.id === String(p.id)))
        .map((p) => ({ id: String(p.id), name: String(p.name || p.id),
          tabs: [], contract: null, form: null, builtin: false })),
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
          contracts: u.contracts && typeof u.contracts === "object" ? u.contracts : {},
          answers: answersOf(u) };
      }),
      // Записи без анкет — это «анкет нет», а не поломка: список пустой.
      forms: (Array.isArray(parsed.forms) ? parsed.forms : []).map(formOf).filter(Boolean),
      /* Документы договоров с версиями и выданные соглашения — как
         записаны: их форму держит lib/contractStore.js. */
      docs: Array.isArray(parsed.docs) ? parsed.docs : [],
      agreements: Array.isArray(parsed.agreements) ? parsed.agreements : [],
      /* Коды доступа и выданные по ним разрешения (см. ниже). Их форму
         держат `makeAccessCode` и `useAccessCode`; здесь они только
         читаются, чтобы не пропасть при следующей записи. */
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      grants: Array.isArray(parsed.grants) ? parsed.grants : [],
    };
  } catch {
    return { ...EMPTY, roles: [...BUILTIN_ROLES], users: [], forms: [], docs: [], agreements: [],
      codes: [], grants: [] };
  }
}

export async function writeOrg(org) {
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
  /* Владелец из переменной — только у MAIN: у личного хранилища
     владелец записан при его заведении (lib/storages.js). */
  const env = isMain() ? envOwner() : null;
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
  /* Имя из Telegram обновляем на входе: человек мог его сменить, а в
     приглашении оно записано таким, каким было тогда. НО не поверх
     своего: если человек назвал себя сам в анкете (`nameOwn`), это имя и
     есть его имя во всём приложении (владелец, 2026-09-20), и телеграмное
     его не переписывает. */
  if (user && !user.nameOwn && profile.name && user.name !== profile.name) {
    user.name = profile.name; changed = true;
  }
  /* Аватарка из Telegram — то, что показывается по умолчанию (владелец,
     2026-09-20). Она живёт отдельно от своей (`avatar`): человек мог
     сменить её в Telegram, и запомненная вчера ссылка сегодня уже пустая.
     Своя картинка ею не переписывается — у неё своё поле. */
  if (user && profile.photo != null && user.photo !== profile.photo) {
    user.photo = String(profile.photo || ""); changed = true;
  }
  if (changed) await writeOrg(org);

  /* Ролей у человека может быть несколько: он и дизайнер, и проверяющий.
     Вкладки — ОБЪЕДИНЕНИЕ их вкладок: роль ничего не отнимает, она
     только открывает. */
  const mine = userRoles(user || {})
    .map((rid) => org.roles.find((r) => r.id === rid)).filter(Boolean);
  /* ДЕЙСТВУЮЩИЕ роли — те, что открывают вкладки. Роль с
     договором-документом действует, пока действует подписанное по ней
     соглашение (срок начался и не кончился); отключённая владельцем на
     «Участниках» роль в `mine` не попадает вовсе. Роль без документа —
     как прежде: выдана — действует (владелец, 2026-09-14: «интерфейс
     недоступен, пока предложенный договор не подписан, если срок старого
     закончился/не начался или роль отключена»). */
  const active = mine.filter((r) => roleActive(org, user || {}, r));
  const role = active[0] || mine[0] || null;
  const offered = user ? pendingAgreementFor(org, user) : null;
  const wantId = user?.wants ? String(user.wants) : "";
  const wantRole = wantId ? org.roles.find((r) => r.id === wantId) : null;
  const wants = wantId ? { id: wantId, name: wantRole?.name || wantId } : null;
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
    // И вопросы к ней — по ролям человека: без них ответы в анкете были
    // бы текстом под номерами, которые ничего не значат.
    forms: formsFor(org, user || {}),
    role: role || null,
    // Владельцу доступно всё; остальным — то, что дают ЕГО ДЕЙСТВУЮЩИЕ
    // роли вместе. Ни одной (удалили, договор не подписан, срок вышел) —
    // не показываем ничего, кроме объяснения.
    tabs: isOwner ? [...TABS] : normTabs(active.flatMap((r) => Object.keys(accessOf(r)))),
    /* Право на каждой вкладке: «r» — смотреть, «rw» — править. У
       владельца полное везде; у остальных — самое широкое из его
       действующих ролей (владелец, 2026-09-20). */
    access: isOwner
      ? Object.fromEntries(TABS.map((t) => [t, "rw"]))
      : active.reduce((acc, r) => {
        Object.entries(accessOf(r)).forEach(([t, a]) => {
          if (acc[t] !== "rw") acc[t] = a;
        });
        return acc;
      }, {}),
    /* Роли, которые у человека есть, но не действуют, — словами, чтобы
       объяснение было точным: «срок договора вышел», а не «ролей нет». */
    inactive: mine.filter((r) => !active.includes(r))
      .map((r) => ({ id: r.id, name: r.name, why: roleWhyInactive(org, user || {}, r) })),
    /* Предложенное соглашение — договор, который ждёт подписи ЭТОГО
       человека: приложение ведёт его заполнять и подписывать. */
    agreement: offered,
    /* Заявка ждёт владельца: человек, которого в систему заранее не
       добавляли, выбрал роль и подписал её договор — но доступа у него
       нет, пока владелец не добавит его на «Участниках». */
    waiting: wants ? { id: wants.id, name: wants.name } : null,
  };
}

/* ─────── действует ли роль ───────

   Соглашение (lib/contractStore.js) — подписанный договор с датами и
   суммой. Роль с документом действует, пока есть подписанное по ней
   соглашение этого человека, чей срок начался и не кончился (день
   окончания — включительно). Роль без документа, но с прежним
   файлом-шаблоном — действует, если подписанный экземпляр есть (как
   прежде); без того и другого — просто выдана. */
const dayStart = (v) => { const d = new Date(String(v || "")); return isNaN(d) ? null : d.getTime(); };
export const agreementInForce = (a, now = Date.now()) => {
  if (!a || a.status !== "signed") return false;
  const s = dayStart(a.start), e = dayStart(a.end);
  if (s != null && now < s) return false;
  if (e != null && now > e + 86400000 - 1) return false;
  return true;
};
export function roleActive(org, user, role, now = Date.now()) {
  if (!role) return false;
  if (role.doc) {
    return (org.agreements || []).some((a) => a.roleId === role.id
      && String(a.to?.id || "") === String(user.id) && agreementInForce(a, now));
  }
  if (role.contract) return !!(user.contracts || {})[role.id];
  return true;
}
function roleWhyInactive(org, user, role, now = Date.now()) {
  if (!role.doc) return "договор не подписан";
  const own = (org.agreements || []).filter((a) => a.roleId === role.id
    && String(a.to?.id || "") === String(user.id) && a.status === "signed");
  if (!own.length) return "договор не подписан";
  if (own.some((a) => dayStart(a.start) != null && now < dayStart(a.start))) return "срок договора ещё не начался";
  return "срок договора закончился";
}
/** Соглашение, которое ждёт подписи человека, — самое свежее из «отправлено». */
function pendingAgreementFor(org, user) {
  const list = (org.agreements || []).filter((a) => a.status === "sent"
    && String(a.to?.id || "") === String(user.id));
  const a = list[list.length - 1];
  if (!a) return null;
  const doc = (org.docs || []).find((d) => d.id === a.docId);
  const ver = (doc?.versions || []).find((v) => v.id === a.versionId) || (doc?.versions || []).slice(-1)[0];
  const role = org.roles.find((r) => r.id === a.roleId);
  const filled = { ...(doc?.values || {}), ...(a.values || {}), sum: a.sum, start: a.start, end: a.end };
  return {
    id: a.id, docId: a.docId, versionId: ver?.id || null, docName: doc?.name || "договор",
    roleId: a.roleId, roleName: role?.name || a.roleId,
    sum: a.sum, start: a.start, end: a.end, from: a.by, docHash: ver?.hash || "",
    placeholders: (ver?.placeholders || []).map((p) => ({ ...p, value: filled[p.key] ?? "" })),
    userValues: a.userValues || {},
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
/** Момент в ISO или null: чужую строку в запись не пускаем. */
const isoOf = (v) => {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
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
  /* Когда статус выбрали: выбор человека приоритетнее графика до следующей
     смены по графику (2026-09-13), и без этой метки не сказать, что было
     раньше — выбор или смена. Нет метки — статус «старый», и действует
     график. */
  statusAt: isoOf(user.statusAt),
  warnMin: warnOf(user.warnMin),
  deadlinePct: deadOf(user.deadlinePct),
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

/* ─────── за сколько предупреждать ДО ДЕДЛАЙНА ───────

   Владелец (2026-09-21): «поле „предупреждать до дедлайна“, и тут должен
   быть выбор в процентах: пользователь должен предупреждаться за
   введённое количество процентов времени до момента сдачи». Проценты —
   от всего отпущенного на задачу срока: 20 % значит «когда осталась
   пятая часть». Ноль — не предупреждать; больше ста не бывает. */
export const DEAD_DEFAULT = 0;
const deadOf = (v) => {
  const n = Number(v);
  if (v == null || v === "" || !Number.isFinite(n)) return DEAD_DEFAULT;
  return Math.min(100, Math.max(0, Math.round(n)));
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
/* Картинка приезжает ссылкой на хранилище отчётов (`/api/reports/…`), а
   без него — самой картинкой в data:-URL. Предел щедрый ровно настолько,
   чтобы маленькая картинка поместилась: org.json — не файловый диск. */
const AVATAR_LIMIT = 400000;
/* ─────── АВАТАРКА (владелец, 2026-09-20) ───────

   Картинка у человека ОДНА, и у неё три состояния, записанные одним
   полем `avatar`:

   · нет поля вовсе — показывается та, что стоит у него в Telegram;
   · строка — своя, загруженная взамен телеграмной;
   · пустая строка — «Удалить»: пустой кружок с первой буквой имени.

   Двух полей тут быть не может: «есть своя» и «телеграмную убрали» — это
   один и тот же вопрос «что показывать», заданный дважды, и ответы на
   него разошлись бы. */
export const avatarOf = (user = {}) => {
  const own = user.avatar;
  const photo = String(user.photo || "");
  if (own == null) return { avatar: photo, avatarOwn: false, avatarOff: false };
  const s = String(own);
  return { avatar: s, avatarOwn: !!s, avatarOff: !s };
};

export const profileOf = (user = {}) => {
  const about = String(user.about || "");
  const old = LEGACY_FIELDS.map((k) => String(user[k] || "").trim()).filter(Boolean);
  /* Имя едет вместе с анкетой: его правят там же, и везде, где приложение
     показывает человека, оно берётся отсюда (владелец, 2026-09-20). */
  return { name: String(user.name || ""), ...avatarOf(user),
    about: about || old.join("\n"), ...scheduleOf(user), answers: answersOf(user) };
};

/** Свою анкету человек пишет сам. Чужую — никто. */
export async function setProfile(userId, patch = {}) {
  const org = await readOrg();
  const id = String(userId);
  const user = org.users.find((u) => u.id === id);
  if (!user) return null;
  /* Имя человек пишет сам, здесь же, где и анкету. Названное им имя
     сильнее телеграмного: `nameOwn` не даёт переписать его на входе.
     Пустое имя не принимается — безымянного человека не выберешь. */
  if (patch.name != null) {
    const called = String(patch.name).trim().slice(0, 200);
    if (called) { user.name = called; user.nameOwn = true; }
  }
  /* Картинка: строка — своя взамен телеграмной, пустая строка —
     «Удалить» (пустой кружок), `null` — вернуть телеграмную. */
  if (patch.avatar !== undefined) {
    if (patch.avatar === null) delete user.avatar;
    else user.avatar = String(patch.avatar).slice(0, AVATAR_LIMIT);
  }
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
    const next = WORK_STATUSES.includes(patch.status) ? patch.status : "ready";
    // Метка выбора — из запроса (нажатие в приложении), иначе — момент
    // смены статуса; повтор того же статуса без метки её не двигает.
    if (isoOf(patch.statusAt)) user.statusAt = isoOf(patch.statusAt);
    else if (next !== user.status || !user.statusAt) user.statusAt = new Date().toISOString();
    user.status = next;
  }
  if (patch.warnMin != null) user.warnMin = warnOf(patch.warnMin);
  if (patch.deadlinePct != null) user.deadlinePct = deadOf(patch.deadlinePct);
  if (patch.deferMin != null) user.deferMin = deferOf(patch.deferMin);
  /* Ответы на вопросы анкет — поверх прежних, а не вместо: форма шлёт те
     вопросы, что видит сейчас, и ответ на вопрос другой роли, не попавший
     в этот запрос, пропадать не должен. */
  if (patch.answers && typeof patch.answers === "object") {
    user.answers = { ...answersOf(user), ...answersOf({ answers: patch.answers }) };
  }
  await writeOrg(org);
  return profileOf(user);
}

/* ─────── анкеты как словари ───────

   Анкета — не одно большое поле с подсказкой «пиши по шаблону», а СЛОВАРЬ
   вопросов: человеку показывают каждый вопрос отдельно, и он отвечает на
   него, а не пересказывает шаблон по памяти. Анкет несколько, и назначают
   их РОЛЯМ: дизайнера спрашивают про стек, курьера — про район, а не
   всех обо всём.

   Ответы лежат у человека по идентификатору вопроса, а не по его тексту:
   владелец поправил формулировку — ответ остался при вопросе. Поэтому
   идентификатор вопросу выдаётся один раз, при добавлении, и не
   пересоздаётся при правке текста; удалённый вопрос свой идентификатор
   уносит, и новый с тем же текстом ответа не наследует.

   Старые записи: анкет нет — список пустой, ответов нет — пусто, и поле
   `about` читается как прежде. */
const QID = /^[a-z0-9_-]{1,64}$/i;
const answersOf = (user = {}) => {
  const raw = user.answers && typeof user.answers === "object" ? user.answers : {};
  return Object.fromEntries(Object.entries(raw)
    .filter(([k, v]) => QID.test(k) && v != null)
    .map(([k, v]) => [k, String(v).slice(0, LIMIT)]));
};
const formLink = (v) => (v == null || v === "" ? null : String(v));
const questionOf = (q) => {
  const text = String((q && typeof q === "object" ? q.text : q) ?? "").trim().slice(0, LIMIT);
  if (!text) return null;
  const id = q && typeof q === "object" && QID.test(String(q.id || "")) ? String(q.id) : null;
  return { id, text };
};
const formOf = (f) => (f && typeof f === "object" && f.id
  ? { id: String(f.id), name: String(f.name || f.id),
    questions: (Array.isArray(f.questions) ? f.questions : []).map(questionOf)
      .filter((q) => q && q.id) }
  : null);
const newQid = () => `q${crypto.randomBytes(4).toString("hex")}`;

/** Анкеты человека — по его ролям, каждая один раз, с вопросами. */
export const formsFor = (org, user = {}) => {
  const ids = [...new Set(userRoles(user)
    .map((rid) => org.roles.find((r) => r.id === rid)?.form).filter(Boolean))];
  return ids.map((id) => org.forms.find((f) => f.id === id)).filter(Boolean);
};

export async function addForm({ name, questions } = {}) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("name is required");
  const org = await readOrg();
  let id = slug(clean, "form"), n = 2;
  while (org.forms.some((f) => f.id === id)) id = `${slug(clean, "form")}-${n++}`;
  /* Вопросы можно принести сразу — «Загрузить анкету» списком: одна
     запись, а не «завести пустую и дописать». Идентификаторы новые. */
  const form = { id, name: clean,
    questions: (Array.isArray(questions) ? questions : []).map(questionOf).filter(Boolean)
      .map((q) => ({ id: newQid(), text: q.text })) };
  org.forms.push(form);
  await writeOrg(org);
  return form;
}

/**
 * Название и вопросы анкеты. Вопрос — строка или `{id, text}`: с известным
 * идентификатором он остаётся собой (и ответы при нём), без него — новый.
 * Пустой текст — это не вопрос: такие отбрасываются.
 */
export async function setForm(id, { name, questions } = {}) {
  const org = await readOrg();
  const form = org.forms.find((f) => f.id === id);
  if (!form) return null;
  if (name != null && String(name).trim()) form.name = String(name).trim();
  if (Array.isArray(questions)) {
    form.questions = questions.map(questionOf).filter(Boolean).map((q) => ({
      id: q.id && form.questions.some((x) => x.id === q.id) ? q.id : newQid(), text: q.text }));
  }
  await writeOrg(org);
  return form;
}

/** Убрать анкету: роли, которые на неё ссылались, остаются без анкеты. */
export async function removeForm(id) {
  const org = await readOrg();
  if (!org.forms.some((f) => f.id === id)) return false;
  org.forms = org.forms.filter((f) => f.id !== id);
  org.roles = org.roles.map((r) => (r.form === id ? { ...r, form: null } : r));
  await writeOrg(org);
  return true;
}

/** Какую анкету заполняют по этой роли; пусто — никакую. */
export async function setRoleForm(roleId, formId) {
  const org = await readOrg();
  const role = org.roles.find((r) => r.id === roleId);
  if (!role) return null;
  const want = formLink(formId);
  if (want && !org.forms.some((f) => f.id === want)) throw new Error("unknown form");
  role.form = want;
  await writeOrg(org);
  return role;
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
    // Вопросы анкет — рядом с ответами: чужая анкета читается вопросом и
    // ответом, а не ответом под номером. Тот же вид, что в «кто я».
    users: org.users.map((u) => ({ ...u, ...profileOf(u), forms: formsFor(org, u),
      /* Подписанные договоры человека — под его ролями на «Участниках»:
         даты и сумма (владелец, 2026-09-14). Штрихов подписей тут нет. */
      agreements: (org.agreements || [])
        .filter((a) => a.status === "signed" && String(a.to?.id || "") === String(u.id))
        .map((a) => ({ id: a.id, roleId: a.roleId, sum: a.sum, start: a.start, end: a.end,
          signedAt: a.signedAt, file: a.file,
          docName: (org.docs || []).find((d) => d.id === a.docId)?.name || "" })),
      active: userRoles(u).filter((rid) => {
        const r = org.roles.find((x) => x.id === rid);
        return r && roleActive(org, u, r);
      }) })),
    forms: org.forms,
    // Договоры-документы с версиями: штрихи подписей в них не лежат.
    docs: org.docs || [],
  };
}

/* ─────── роли человека ───────

   Должностей больше нет: роль и есть ответ на «кто он здесь». Ролей у
   человека бывает несколько — он и дизайнер, и проверяющий, — и тогда
   вкладки складываются, а работу ему можно поручить по любой из них.

   Раздаёт роли владелец (здесь) и сам человек, подписав договор
   (`registerUser`). Третьего пути нет. */

/* Договора здесь не ждут — и для людей тоже: роль от владельца этим
   маршрутом выдаётся сразу, `pending` заводит только приглашение
   (`addUser`). Агенту (`agent: true`) подписывать нечего и некому, и он
   идёт тем же путём без исключений. */
export async function setUserRoles(id, roles) {
  const org = await readOrg();
  const user = org.users.find((u) => u.id === String(id));
  if (!user) return null;
  const want = roleIds(roles);
  const unknown = want.find((r) => !org.roles.some((x) => x.id === r));
  if (unknown) throw new Error("unknown role");
  user.roles = want;
  /* Заявку снимает сам факт выдачи роли: владелец решил, и ждать больше
     нечего. */
  if (user.wants && want.length) delete user.wants;
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
  /* Анкета роли — рядом с её договором: человек заполняет то, о чём
     спрашивают именно в этой роли, ещё при вступлении. */
  return org.roles.map((r) => ({ id: r.id, name: r.name,
    tabs: normTabs(r.tabs), contract: fileRef(r.contract),
    form: (org.forms || []).find((f) => f.id === r.form) || null }));
}

/**
 * Регистрация: человек выбрал роль, подписал её договор, ответил на её
 * анкету.
 *
 * Дальше пути два, и решает их то, звали ли человека (владелец,
 * 2026-09-20):
 *
 *  — УЖЕ ДОБАВЛЕН. Роль ему назначил владелец, и подпись — последнее, чего
 *    не хватало: роль выдаётся сразу. Подписывать он может только ту роль,
 *    на которую его позвали, — её одну ему и показывают.
 *
 *  — НЕ ДОБАВЛЕН. Роль он выбрал сам, и одного его желания мало: договор и
 *    анкета ложатся к нему в заявку (`wants`), роли он не получает, и
 *    доступа тоже. Добавляет его владелец на «Участниках».
 *
 * Повторная регистрация в ту же роль заменяет подписанный экземпляр:
 * договор перезаключают, а не заводят вторую запись о том же.
 */
export async function registerUser(userId, profile = {}, { roleId, file, answers, start, end } = {}) {
  const org = await readOrg();
  const id = String(userId);
  const role = org.roles.find((r) => r.id === roleId);
  if (!role) throw new Error("unknown role");
  const signed = fileRef(file);
  if (role.contract && !signed) throw new Error("contract is required");
  /* У ДОГОВОРА ВСЕГДА ЕСТЬ СРОК (владелец, 2026-09-20). У договора-документа
     он приходит плейсхолдерами, которые заполняет владелец или сам
     подписывающий; у принесённого файлом плейсхолдеров нет вовсе — значит,
     даты называет тот, кто его приносит. Без них договора нет. */
  const from = dayOnly(start), to = dayOnly(end);
  if (signed && (!from || !to)) throw new Error("dates are required");

  let user = org.users.find((u) => u.id === id);
  const known = !!user;
  if (!user) {
    user = { id, name: profile.name || id, username: profile.username || "",
      roles: [], contracts: {}, addedAt: new Date().toISOString(), addedBy: null };
    org.users.push(user);
  }
  if (profile.name && user.name !== profile.name) user.name = profile.name;
  user.contracts = { ...(user.contracts || {}),
    [role.id]: { ...(signed || {}), at: new Date().toISOString(),
      ...(from ? { start: from } : {}), ...(to ? { end: to } : {}) } };
  if (answers && typeof answers === "object") {
    user.answers = { ...answersOf(user), ...answersOf({ answers }) };
  }
  if (known) {
    user.roles = roleIds([...(user.roles || []), role.id]);
    // Приготовленная роль дождалась договора — ждать больше нечего.
    if (String(user.pending || "") === role.id) delete user.pending;
    delete user.wants;
  } else {
    // Незваный ждёт владельца: роль ему выдаёт не подпись, а человек.
    user.roles = roleIds(user.roles);
    user.wants = role.id;
  }
  await writeOrg(org);
  return user;
}

/* ─────── подписанный договор глазами владельца ───────

   Файл лежит в каталоге того, кто его принёс (`lib/reportStore.js`), и
   ссылка на него — ключ к нему: скачивается он по ней. А ЧИТАЕТСЯ договор
   тем же окном, что и при правке документа, — значит, нужен HTML. Word
   разбирается на месте (`lib/docx.js`); всё остальное открывается как
   файл по своей ссылке. */
const REPORT_URL = /^\/api\/reports\/([a-f0-9]{32})\/([A-Za-z0-9-]{6,64})$/;
export async function contractHtml(userId, roleId) {
  const org = await readOrg();
  const user = org.users.find((u) => u.id === String(userId));
  const f = (user?.contracts || {})[String(roleId)];
  if (!f?.url) throw new Error("not found");
  const name = String(f.name || "договор");
  const m = REPORT_URL.exec(String(f.url));
  const file = m ? await getReport(m[1], m[2]) : null;
  if (m && !file) throw new Error("not found");
  const word = /\.docx?$/i.test(name) || /word|officedocument/i.test(String(f.type || ""));
  if (file && word) {
    try { return { name, html: await docxToHtml(file.bytes) }; }
    catch { /* не Word внутри — отдадим файлом */ }
  }
  return { name, url: String(f.url), type: String(f.type || file?.type || "") };
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

/* ─────── агенты как участники ───────

   Агент помощника (lib/assistantSettings.js) — не человек, но чтобы
   владелец мог выбрать его в роли и поручить ему работу, он должен быть в
   том же списке, откуда берутся люди. Участник-агент помечен `agent: true`,
   его id — `ag_<id агента>`: с Telegram-id он не пересечётся, и по нему
   видно, что это не человек. Договора у него нет, анкета пустая, входить
   он не входит — `identify` его не зовёт, а если позовёт, найдёт по имени.
   Заводит его владелец: агент не-владельца участником не становится. */
export const agentUserId = (agentId) => `ag_${String(agentId)}`;

export async function addAgentUser({ id, name, addedBy }) {
  if (!id) throw new Error("id is required");
  const org = await readOrg();
  const uid = agentUserId(id);
  const idx = org.users.findIndex((u) => u.id === uid);
  const was = idx >= 0 ? org.users[idx] : null;
  // Участник с таким id уже есть (агента удалили из списка и завели
  // снова) — обновляем имя, роли не трогаем: их раздал владелец.
  const entry = {
    id: uid, name: String(name || uid), agent: true,
    roles: roleIds(was?.roles), contracts: was?.contracts || {},
    addedAt: new Date().toISOString(), addedBy: addedBy ? String(addedBy) : null,
  };
  if (idx >= 0) org.users[idx] = { ...org.users[idx], ...entry };
  else org.users.push(entry);
  await writeOrg(org);
  return entry;
}

/** Агента переименовали в настройках — имя участника то же. Нет участника — null. */
export async function renameAgentUser(agentId, name) {
  const org = await readOrg();
  const user = org.users.find((u) => u.id === agentUserId(agentId) && u.agent);
  if (!user) return null;
  const clean = String(name || "").trim();
  if (clean && user.name !== clean) { user.name = clean; await writeOrg(org); }
  return user;
}

/* ════════════════════════════════════════════════════════════════
   ВИРТУАЛЬНЫЙ СОТРУДНИК (владелец, 2026-09-20)

   Третий вид участника, помимо человека и агента: страница, за которой
   ещё НЕ СТОИТ реальный человек. Всё остальное у него как у обычного
   участника — роль, анкета, договор, задачи, оценки.

   Зачем: рекрутер или реферер проводит онбординг сам, заполняя за
   будущего сотрудника всё, что можно заполнить заранее; а незарегистри-
   рованного заказчика может заменить тот, кто с ним работает.

   Имени у него нет — есть ФРАЗА ИЗ ДВУХ СЛОВ, та же, что у рук в тексте
   технологического процесса (`aliasOf`): звать страницу, за которой
   никого нет, чьим-то именем было бы обещанием, что человек уже есть.

   `id` — `vt_<случайное>`: с Telegram-id он не пересечётся, как и у
   агента. Когда по ссылке придёт настоящий человек, id НЕ МЕНЯЕТСЯ — к
   записи просто привязывается его Telegram (`tg`). Иначе пришлось бы
   переписать все ссылки на него: задачи, оценки, заказы, договоры, — и
   потерянная где-то одна означала бы потерянную историю.
   ════════════════════════════════════════════════════════════════ */
const VIRTUAL_PREFIX = "vt_";
export const isVirtualId = (id) => String(id || "").startsWith(VIRTUAL_PREFIX);
const newVirtualId = () =>
  `${VIRTUAL_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const newToken = () =>
  `${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;

/** Завести виртуального сотрудника. Роль можно выбрать сразу или позже. */
export async function addVirtualUser({ roleId = null, addedBy = null } = {}) {
  const org = await readOrg();
  if (roleId && !org.roles.some((r) => r.id === String(roleId))) {
    throw new Error("unknown role");
  }
  const id = newVirtualId();
  const entry = {
    id, name: aliasOf(id), virtual: true,
    roles: roleId ? [String(roleId)] : [],
    contracts: {},
    /* Ссылка — сразу (владелец, 2026-09-20): отдельной кнопки для неё
       нет, она просто показана внизу формы. Страница без ссылки —
       страница, которую некому забрать. */
    token: newToken(),
    addedAt: new Date().toISOString(),
    addedBy: addedBy ? String(addedBy) : null,
  };
  org.users.push(entry);
  await writeOrg(org);
  return entry;
}

/** Ссылка для регистрации: одноразовый ключ у самой записи. */
export async function virtualToken(id) {
  const org = await readOrg();
  const user = org.users.find((u) => u.id === String(id) && u.virtual);
  if (!user) return null;
  user.token = newToken();
  await writeOrg(org);
  return user.token;
}

/** Кого ждёт эта ссылка. Ключ не подошёл — null. */
export async function virtualByToken(token) {
  const key = String(token || "");
  if (!key) return null;
  const org = await readOrg();
  return org.users.find((u) => u.virtual && u.token === key && !u.tg) || null;
}

/**
 * По ссылке пришёл настоящий человек — страница становится его
 * (владелец, 2026-09-20). Запись не переезжает: к ней привязывается
 * Telegram, и всё, что на ней уже есть, остаётся при ней.
 *
 * Дважды не регистрируются: у кого доступ уже есть, тот получает отказ
 * словами, а не вторую страницу.
 */
export async function claimVirtual(token, telegramId, profile = {}) {
  const org = await readOrg();
  const tg = String(telegramId);
  const mine = org.users.find((u) => u.id === tg || String(u.tg || "") === tg);
  if (mine) return { error: "already registered" };
  if (org.ownerId === tg) return { error: "already registered" };
  const user = org.users.find((u) => u.virtual && u.token === String(token || "") && !u.tg);
  if (!user) return { error: "not found" };
  user.tg = tg;
  user.token = null;
  /* Имя из двух слов уступает настоящему: страница теперь его, и звать
     её псевдонимом больше не за что. Своё имя в анкете (`nameOwn`) — уже
     его выбор и сильнее телеграмного, как и у всех. */
  if (!user.nameOwn && profile.name) user.name = String(profile.name);
  if (profile.username) user.username = String(profile.username);
  if (profile.photo != null && user.avatar == null) user.photo = String(profile.photo || "");
  await writeOrg(org);
  return { user };
}

/**
 * Кем человек действует. Обычно — собой; но страница виртуального
 * сотрудника привязывается к Telegram (`tg`), и тогда человек всегда
 * работает под ней: id записи — тот же, что был у виртуальной, и все
 * ссылки на него остаются целыми.
 */
export async function recordIdFor(telegramId) {
  const id = String(telegramId);
  const org = await readOrg();
  const bound = org.users.find((u) => String(u.tg || "") === id);
  return bound ? bound.id : id;
}

/**
 * Может ли этот человек работать с чужой страницей.
 *
 * Два разных основания, и путать их нельзя:
 * · страница ВИРТУАЛЬНАЯ — за ней никого нет, и её открывает тот, кто её
 *   завёл (и владелец);
 * · страница НАСТОЯЩЕГО человека — её открывает только тот, кому сам
 *   хозяин выдал код доступа, и только пока код не истёк. Владелец сюда
 *   не входит: пустить к себе решает человек, а не должность.
 */
export async function mayActAs(actorId, virtualId) {
  const org = await readOrg();
  const target = org.users.find((u) => u.id === String(virtualId));
  if (!target) return false;
  if (!target.virtual || target.tg) return !!(await grantFor(actorId, virtualId));
  if (org.ownerId === String(actorId)) return true;
  return String(target.addedBy || "") === String(actorId);
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
  const map = accessOf({ tabs: tabs && tabs.length ? tabs : ["tasks"] });
  const role = { id, name: clean, tabs: Object.keys(map), access: map,
    contract: fileRef(contract), builtin: false };
  org.roles.push(role);
  await writeOrg(org);
  return role;
}

/** Переименовать роль (владелец, 2026-09-18): имя уникально без учёта регистра. */
export async function renameRole(id, name) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("name is required");
  const org = await readOrg();
  const role = org.roles.find((r) => r.id === id);
  if (!role) return null;
  if (org.roles.some((r) => r.id !== id && r.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error("role already exists");
  }
  role.name = clean;
  await writeOrg(org);
  return role;
}

/**
 * Что роль открывает и на каком праве.
 *
 * Принимает и прежний список вкладок (читается как полное право), и карту
 * «вкладка → r|rw» (владелец, 2026-09-20). Хранится карта; список `tabs`
 * остаётся для прежних читателей — в нём те же вкладки.
 */
export async function setRoleTabs(id, tabs) {
  const org = await readOrg();
  const role = org.roles.find((r) => r.id === id);
  if (!role) return null;
  const map = Array.isArray(tabs)
    ? accessOf({ tabs })
    : accessOf({ access: tabs || {} });
  role.access = map;
  role.tabs = Object.keys(map);
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

/* ════════════════════════════════════════════════════════════════
   КОД ДОСТУПА ДЛЯ ТЕХПОДДЕРЖКИ (владелец, 2026-09-20)

   «Сгенерировать код для техподдержки… время действия кода в минутах и
   r/rw… ниже кнопки с вкладками: по нажатию пользователь выбирает, какие
   из вкладок будет видеть агент техподдержки».

   Это вторая, обратная сторона виртуального сотрудника. Виртуальный —
   страница БЕЗ человека, и войти на неё может тот, кто её завёл. Здесь
   человек ЕСТЬ, и пустить на свою страницу решает он сам: выдаёт код, а
   тот, кто код ввёл, получает его страницу в своём списке и заходит на
   неё так же, как на виртуальную. Сам человек при этом продолжает
   работать у себя — доступ не передаётся, а РАЗДЕЛЯЕТСЯ.

   Поэтому у кода три свойства, и все три задаёт выдающий:
   · сколько минут он живёт — просроченный не открывает ничего;
   · «r» или «rw» — смотреть или ещё и править;
   · какие вкладки видно — остальных у гостя просто нет.

   Код одноразовый по смыслу, но не по счёту: им можно впустить одного
   гостя. Впустили — код гаснет, чтобы разосланный вчера не открывал
   страницу сегодня. Срок разрешения — тот же, что у кода: минуты
   отсчитываются от выдачи, а не от входа, иначе «10 минут» значили бы
   «десять минут с любого момента, когда гостю вздумается».
   ════════════════════════════════════════════════════════════════ */

/* Буквы без похожих друг на друга: «0» и «O», «1» и «I» в коде, который
   читают вслух по телефону, — это лишний круг разговора. */
const CODE_ABC = "ACEFHJKLMNPRTUVWXY3456789";
const newAccessCode = () => Array.from({ length: 8 },
  () => CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]).join("");
export const normCode = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const MIN_MS = 60 * 1000;
export const MAX_CODE_MINUTES = 24 * 60;
const minutesOf = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return 15;
  return Math.min(n, MAX_CODE_MINUTES);
};
const accessLevel = (v) => (String(v) === "r" ? "r" : "rw");

const live = (rec, nowMs) => !!rec && !rec.usedBy && Date.parse(rec.expiresAt || "") > nowMs;
const liveGrant = (g, nowMs) => !!g && Date.parse(g.until || "") > nowMs;

const codeView = (rec, nowMs = Date.now()) => (live(rec, nowMs) ? {
  code: rec.code,
  minutes: rec.minutes,
  access: rec.access,
  tabs: [...(rec.tabs || [])],
  expiresAt: rec.expiresAt,
} : null);

/** Выдать код на свою страницу. Прежний невыданный гаснет: код один. */
export async function makeAccessCode(byId, { minutes = 15, access = "rw", tabs = [] } = {}) {
  const org = await readOrg();
  const by = String(byId);
  const mins = minutesOf(minutes);
  const rec = {
    code: newAccessCode(),
    by,
    minutes: mins,
    access: accessLevel(access),
    tabs: normTabs(tabs),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + mins * MIN_MS).toISOString(),
    usedBy: null,
  };
  org.codes = [...(org.codes || []).filter((c) => c.by !== by), rec];
  await writeOrg(org);
  return codeView(rec);
}

/** Действующий код этого человека — чтобы поле не пустело при возврате. */
export async function accessCodeOf(byId) {
  const org = await readOrg();
  const now = Date.now();
  return codeView((org.codes || []).find((c) => c.by === String(byId)), now);
}

/** Погасить свой код досрочно. */
export async function dropAccessCode(byId) {
  const org = await readOrg();
  const by = String(byId);
  const before = (org.codes || []).length;
  org.codes = (org.codes || []).filter((c) => c.by !== by);
  if (org.codes.length !== before) await writeOrg(org);
  return true;
}

/**
 * Ввести чужой код — его страница появляется в списке у гостя.
 *
 * Сам код НЕ передаёт страницу: он делает её доступной ещё одному, и
 * хозяин продолжает работать у себя (владелец, 2026-09-20: «у реального
 * сотрудника также должна быть возможность пользоваться своей страницей,
 * как и у виртуального»).
 */
export async function useAccessCode(code, actorId) {
  const org = await readOrg();
  const key = normCode(code);
  const now = Date.now();
  const rec = (org.codes || []).find((c) => c.code === key);
  if (!live(rec, now)) return { error: "bad code" };
  const to = String(actorId);
  if (rec.by === to) return { error: "own code" };
  const user = (org.users || []).find((u) => u.id === rec.by);
  if (!user) return { error: "bad code" };
  rec.usedBy = to;
  org.grants = [...(org.grants || []).filter((g) => !(g.by === rec.by && g.to === to)), {
    by: rec.by,
    to,
    access: rec.access,
    tabs: [...(rec.tabs || [])],
    until: rec.expiresAt,
    at: new Date().toISOString(),
  }];
  await writeOrg(org);
  return { user, grant: org.grants[org.grants.length - 1] };
}

/** Чьи страницы открыты этому человеку по коду — только действующие. */
export async function grantsTo(actorId) {
  const org = await readOrg();
  const now = Date.now();
  return (org.grants || []).filter((g) => g.to === String(actorId) && liveGrant(g, now));
}

/** Разрешение на эту страницу — или null, если его нет или оно истекло. */
export async function grantFor(actorId, targetId) {
  const org = await readOrg();
  const now = Date.now();
  return (org.grants || []).find((g) => g.to === String(actorId)
    && g.by === String(targetId) && liveGrant(g, now)) || null;
}

/** Убрать чужую страницу из своего списка: «Удалить сотрудника». */
export async function dropGrant(actorId, targetId) {
  const org = await readOrg();
  const before = (org.grants || []).length;
  org.grants = (org.grants || [])
    .filter((g) => !(g.to === String(actorId) && g.by === String(targetId)));
  if (org.grants.length === before) return false;
  await writeOrg(org);
  return true;
}

/**
 * Удалить виртуального сотрудника (владелец, 2026-09-20).
 *
 * Только СТРАНИЦУ, за которой никого нет: забранную человеком страницу
 * удаляет уже не эта кнопка — за ней стоит участник, и убирают его в
 * «Участниках», зная, что теряют.
 */
export async function removeVirtualUser(id) {
  const org = await readOrg();
  const uid = String(id);
  const user = (org.users || []).find((u) => u.id === uid);
  if (!user || !user.virtual || user.tg) return false;
  org.users = org.users.filter((u) => u.id !== uid);
  await writeOrg(org);
  return true;
}
