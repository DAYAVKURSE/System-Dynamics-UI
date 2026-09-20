import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { renameRole,
  addForm, addRole, addUser, contractHtml, identify, listOrg, openRoles, registerUser, removeForm,
  removeRole, removeUser, setForm, setProfile, setRoleContract, setRoleForm, setRoleTabs,
  setUserRole, setUserRoles, TABS,
  addVirtualUser, claimVirtual, formsFor, mayActAs, profileOf, virtualByToken, virtualToken,
  accessCodeOf, dropAccessCode, dropGrant, grantFor, grantsTo, makeAccessCode,
  removeVirtualUser, useAccessCode,
} from "../lib/orgStore.js";
import { MAX_REPORT_BYTES, saveReport } from "../lib/reportStore.js";
import {
  BadInput, addDoc, addVersion, agreementHtml, createAgreement, docHtml, inviteLink,
  listAgreements, removeDoc, removeVersion, revokeAgreement, setRoleDoc, signAgreement,
  updateDoc,
} from "../lib/contractStore.js";

const fail = (res, e, next) => (e instanceof BadInput
  ? res.status(e.status).json({ error: e.message }) : next(e));

const router = Router();
router.use(telegramUser);

// Кто я и что мне видно. Единственный маршрут, открытый всем вошедшим:
// без него интерфейс не знает, какие вкладки рисовать.
/* ─── ЧТО ВИДНО НА ЧУЖОЙ ВИРТУАЛЬНОЙ СТРАНИЦЕ (владелец, 2026-09-20) ───

   Владелец видит всё, что увидел бы сам человек, и всем управляет:
   модель его. А тот, кто завёл страницу и не владелец, приходит на неё
   ради одного — заполнить за будущего сотрудника то, что можно заполнить
   заранее: его АНКЕТУ и его ДОГОВОР, кроме подписи. Подпись — то
   единственное, что за человека не делают: она и есть его согласие.
   Поэтому остальные вкладки на такой странице не рисуются вовсе. */
const RECRUITER_TABS = ["me"];
const asRecruiter = (req, me) => !!req.actingAs
  && String(req.telegramRealId || "") !== String(me?.ownerId || "");

/* Гость по коду видит РОВНО то, что ему открыли (владелец, 2026-09-20):
   выбранные вкладки и не выше выбранного права. Пересекаем с тем, что
   есть у самой страницы: открыть гостю вкладку, которой у хозяина нет,
   значит показать пустое место и назвать это доступом. */
const byGrant = (me, grant) => {
  const has = me.access && typeof me.access === "object" ? me.access : {};
  const tabs = (grant.tabs || []).filter((t) => has[t] || (me.tabs || []).includes(t));
  const cap = (t) => (grant.access === "r" ? "r" : (has[t] || "rw"));
  return {
    tabs: [...new Set(["me", ...tabs])],
    access: Object.fromEntries(["me", ...tabs].map((t) => [t, cap(t)])),
  };
};

router.get("/me", async (req, res, next) => {
  try {
    const me = await identify(req.telegramUserId, req.telegramProfile || {});
    if (req.actingAs) {
      const org = await listOrg();
      const owner = String(org.ownerId || "") === String(req.telegramRealId || "");
      const grant = await grantFor(req.telegramRealId, req.actingAs);
      me.actingAs = req.actingAs;
      me.actingOwner = owner && !grant;
      me.actingGrant = grant ? { access: grant.access, until: grant.until } : null;
      if (grant) {
        const g = byGrant(me, grant);
        me.tabs = g.tabs;
        me.access = g.access;
        me.isOwner = false;
      } else if (!owner) {
        me.tabs = [...RECRUITER_TABS];
        me.access = Object.fromEntries(RECRUITER_TABS.map((t) => [t, "rw"]));
        me.isOwner = false;
      }
    }
    return res.json(me);
  } catch (e) { return next(e); }
});

/* ════════════════════════════════════════════════════════════════
   ВИРТУАЛЬНЫЕ СОТРУДНИКИ (владелец, 2026-09-20)

   Страница, за которой ещё нет человека. Заводит её любой позванный —
   рекрутер или реферер, который проводит онбординг сам; владелец видит
   и правит все, остальные — только свои.

   Что тут можно: завести, выбрать роль, получить ссылку для регистрации
   и войти под этой страницей. Всё остальное делается уже НА самой
   странице — тем же приложением, теми же маршрутами: страница виртуаль-
   ного сотрудника ничем не отличается от страницы человека, кроме того,
   что человека за ней пока нет.
   ════════════════════════════════════════════════════════════════ */
const mineVirtual = (u, me) => u.virtual === true
  && (me.isOwner || String(u.addedBy || "") === String(me.id));

router.get("/virtual", async (req, res, next) => {
  try {
    const me = await identify(req.telegramUserId, req.telegramProfile || {});
    if (!me.known) return res.status(403).json({ error: "you are not invited yet" });
    const org = await listOrg();
    const bot = process.env.BOT_NAME || "";
    const link = (t) => (t
      ? (bot ? `https://t.me/${bot}?startapp=join_${t}` : `?join=${t}`) : "");
    /* Страницы НАСТОЯЩИХ людей, открытые по коду, стоят в том же списке:
       гостю всё равно, кто за страницей, — ему на неё заходить. Отличает
       их `real`: у настоящего человека нет ни ссылки, ни ролей на правку,
       и «удалить» у него значит «убрать у себя», а не «стереть». */
    const granted = await grantsTo(me.id);
    const byId = new Map((org.users || []).map((u) => [u.id, u]));
    return res.json({
      // Ссылка показана прямо в форме (владелец, 2026-09-20): отдельной
      // кнопки для неё нет — страница заводится сразу со ссылкой.
      users: [
        ...(org.users || []).filter((u) => mineVirtual(u, me))
          .map((u) => ({ ...u, link: u.tg ? "" : link(u.token) })),
        ...granted.filter((g) => byId.has(g.by)).map((g) => ({
          ...byId.get(g.by), link: "", real: true,
          grant: { access: g.access, tabs: g.tabs || [], until: g.until },
        })),
      ],
      roles: (org.roles || []).map((r) => ({ id: r.id, name: r.name, doc: r.doc || null })),
      isOwner: !!me.isOwner,
      tabs: TABS,
      code: await accessCodeOf(me.id),
    });
  } catch (e) { return next(e); }
});

router.post("/virtual", async (req, res, next) => {
  try {
    const me = await identify(req.telegramUserId, req.telegramProfile || {});
    if (!me.known) return res.status(403).json({ error: "you are not invited yet" });
    // Виртуальный под виртуальным не заводится: это было бы деревом
    // страниц, за которыми нет никого.
    if (req.actingAs) return res.status(403).json({ error: "not from a virtual page" });
    /* С КОДОМ — это не новая страница, а чужая: человек уже есть, и он
       сам пустил к себе (владелец, 2026-09-20). Без кода — как прежде:
       пустая страница, за которой пока никого. */
    const code = String(req.body?.code || "").trim();
    if (code) {
      const r = await useAccessCode(code, me.id);
      if (r.error === "own code") {
        return res.status(400).json({ error: "Это ваш собственный код" });
      }
      if (r.error) return res.status(404).json({ error: "Код не подошёл или истёк" });
      return res.status(201).json({ ...r.user, real: true, link: "",
        grant: { access: r.grant.access, tabs: r.grant.tabs, until: r.grant.until } });
    }
    const user = await addVirtualUser({ roleId: req.body?.roleId || null, addedBy: me.id });
    return res.status(201).json(user);
  } catch (e) {
    if (/unknown role/.test(e.message)) return res.status(400).json({ error: e.message });
    return next(e);
  }
});

/* Роль виртуального сотрудника — здесь, а не в общем списке людей:
   раздавать роли может владелец, а эту страницу завёл рекрутер, и без
   роли ей нечего показывать и не под чем регистрироваться. */
router.put("/virtual/:id/role", async (req, res, next) => {
  try {
    if (!(await mayActAs(req.telegramUserId, req.params.id))) {
      return res.status(403).json({ error: "not your page" });
    }
    /* Ролей НЕСКОЛЬКО, как у обычного участника (владелец, 2026-09-20):
       он и дизайнер, и проверяющий. Прежний `roleId` читается как список
       из одной — чтобы старый вызов не сломался. */
    const roles = Array.isArray(req.body?.roles) ? req.body.roles
      : (req.body?.roleId ? [req.body.roleId] : []);
    const user = await setUserRoles(req.params.id, roles);
    if (!user) return res.status(404).json({ error: "not found" });
    return res.json(user);
  } catch (e) {
    if (/unknown role/.test(e.message)) return res.status(400).json({ error: e.message });
    return next(e);
  }
});

/* «Удалить сотрудника» (владелец, 2026-09-20). Что именно удаляется,
   решает вид страницы, а не кнопка: виртуальная — стирается, за ней
   никого нет; настоящего человека кнопка убирает ИЗ СВОЕГО СПИСКА,
   гасит разрешение и больше ничего — стереть человека из организации
   она не вправе. */
router.delete("/virtual/:id", async (req, res, next) => {
  try {
    const me = await identify(req.telegramUserId, req.telegramProfile || {});
    if (!me.known) return res.status(403).json({ error: "you are not invited yet" });
    if (await dropGrant(me.id, req.params.id)) return res.json({ ok: true, kind: "grant" });
    if (!(await mayActAs(req.telegramUserId, req.params.id))) {
      return res.status(403).json({ error: "not your page" });
    }
    if (!(await removeVirtualUser(req.params.id))) {
      return res.status(404).json({ error: "not found" });
    }
    return res.json({ ok: true, kind: "page" });
  } catch (e) { return next(e); }
});

/* ─────── КОД ДОСТУПА ДЛЯ ТЕХПОДДЕРЖКИ (владелец, 2026-09-20) ───────

   Свою страницу открывает сам человек: выдаёт код, называет срок в
   минутах, «r» или «rw» и вкладки, которые гостю будет видно. Код вводят
   на «+ сотрудник» — и страница появляется в списке у гостя. */
router.get("/access-code", async (req, res, next) => {
  try {
    const me = await identify(req.telegramUserId, req.telegramProfile || {});
    if (!me.known) return res.status(403).json({ error: "you are not invited yet" });
    return res.json({ code: await accessCodeOf(me.id), tabs: TABS, mine: me.tabs || [] });
  } catch (e) { return next(e); }
});

router.post("/access-code", async (req, res, next) => {
  try {
    const me = await identify(req.telegramUserId, req.telegramProfile || {});
    if (!me.known) return res.status(403).json({ error: "you are not invited yet" });
    // Код на ЧУЖУЮ страницу не выдают: пустить к себе решает хозяин.
    if (req.actingAs) return res.status(403).json({ error: "not your page" });
    const code = await makeAccessCode(me.id, {
      minutes: req.body?.minutes,
      access: req.body?.access,
      tabs: Array.isArray(req.body?.tabs) ? req.body.tabs : [],
    });
    return res.status(201).json({ code });
  } catch (e) { return next(e); }
});

router.delete("/access-code", async (req, res, next) => {
  try {
    const me = await identify(req.telegramUserId, req.telegramProfile || {});
    if (!me.known) return res.status(403).json({ error: "you are not invited yet" });
    await dropAccessCode(me.id);
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

/* Ссылка для регистрации. Ключ одноразовый: новая ссылка отменяет
   прежнюю — иначе разосланная вчера открывала бы страницу и сегодня. */
router.post("/virtual/:id/link", async (req, res, next) => {
  try {
    if (!(await mayActAs(req.telegramUserId, req.params.id))) {
      return res.status(403).json({ error: "not your page" });
    }
    const token = await virtualToken(req.params.id);
    if (!token) return res.status(404).json({ error: "not found" });
    const bot = process.env.BOT_NAME || "";
    return res.json({ token,
      link: bot ? `https://t.me/${bot}?startapp=join_${token}` : `?join=${token}` });
  } catch (e) { return next(e); }
});

/* Что за страница ждёт по ссылке — ДО входа: человеку показывают роль и
   договор, которые ему предлагают, а не пустой экран с кнопкой. */
router.get("/join/:token", async (req, res, next) => {
  try {
    const user = await virtualByToken(req.params.token);
    if (!user) return res.status(404).json({ error: "ссылка не открывается" });
    const org = await listOrg();
    const roleId = (user.roles || [])[0] || user.pending || null;
    const role = roleId ? (org.roles || []).find((r) => r.id === roleId) : null;
    return res.json({
      name: user.name,
      role: role ? { id: role.id, name: role.name, doc: role.doc || null } : null,
      // Что за него уже заполнили: человеку не нужно вводить это заново.
      profile: profileOf(user),
      forms: formsFor(org, user),
    });
  } catch (e) { return next(e); }
});

/* Забрать страницу себе. Дважды не регистрируются: у кого доступ уже
   есть, тот получает отказ словами (владелец, 2026-09-20). */
router.post("/join", async (req, res, next) => {
  try {
    const r = await claimVirtual(req.body?.token, req.telegramRealId || req.telegramUserId,
      req.telegramProfile || {});
    if (r.error === "already registered") {
      return res.status(409).json({ error: "Вы уже зарегистрированы в системе" });
    }
    if (r.error) return res.status(404).json({ error: "ссылка не открывается" });
    return res.json(await identify(r.user.id, {}));
  } catch (e) { return next(e); }
});

/* Своя анкета — единственное, что человек меняет о себе сам, поэтому
   маршрут стоит ДО проверки на владельца: чинить свою анкету через
   владельца значило бы просить его пересказывать твои же слова. */
router.put("/me/profile", async (req, res, next) => {
  try {
    const me = await identify(req.telegramUserId, req.telegramProfile || {});
    if (!me.known) return res.status(403).json({ error: "you are not invited yet" });
    const saved = await setProfile(me.id, req.body || {});
    if (!saved) return res.status(404).json({ error: "not found" });
    res.json({ profile: saved });
  } catch (e) { next(e); }
});

/* ─────── регистрация ───────

   Участником человек становится сам: выбирает роль, читает её договор и
   присылает подписанный экземпляр. Акцепт — сам договор, а не чужое
   нажатие: поэтому маршруты стоят ДО проверки на владельца.

   Список ролей открыт всем вошедшим, но в нём только названия и
   договоры: список организации незваному не показывают — в неё
   вступают, а не заглядывают.

   Подписанный экземпляр приходит СЮДА, а не в общее хранилище файлов:
   то заперто для участников (см. `routes/reports.js`), и открывать его
   ради регистрации значило бы раздать диск всем, у кого есть Telegram.
   Здесь же файл принимается только вместе с существующей ролью и только
   в свой каталог. */
router.get("/roles", async (_req, res, next) => {
  try { res.json({ roles: await openRoles() }); } catch (e) { next(e); }
});

const MAX_CONTRACT_BYTES = Math.min(MAX_REPORT_BYTES, 8 * 1024 * 1024);

router.post("/register", async (req, res, next) => {
  try {
    const { roleId, file, answers, start, end } = req.body || {};
    // Подписанный экземпляр — тоже подпись: за человека его не приносят.
    if (req.actingAs && file && file.data) {
      const org = await listOrg();
      if (String(org.ownerId || "") !== String(req.telegramRealId || "")) {
        return res.status(403).json({
          error: "Подписать договор за человека нельзя — это его согласие" });
      }
    }
    let saved = null;
    if (file && file.data) {
      /* Файл приезжает строкой base64 (или data:-ссылкой): тело здесь
         JSON, и байтам в нём иначе не проехать. */
      const raw = String(file.data);
      const bytes = Buffer.from(raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw,
        "base64");
      if (!bytes.length) return res.status(400).json({ error: "empty file" });
      if (bytes.length > MAX_CONTRACT_BYTES) {
        return res.status(413).json({ error: "file too large" });
      }
      saved = await saveReport(req.telegramUserId, {
        name: file.name, type: file.type, bytes, kind: "contract" });
    }
    const user = await registerUser(req.telegramUserId, req.telegramProfile || {},
      { roleId, file: saved, answers, start, end });
    const me = await identify(req.telegramUserId, req.telegramProfile || {});
    res.json({ me, user: { id: user.id, roles: user.roles } });
  } catch (e) {
    if (/unknown role/.test(e.message)) return res.status(404).json({ error: e.message });
    if (/contract is required/.test(e.message)) {
      return res.status(400).json({ error: "Договор не приложен: без подписанного экземпляра роль не выдаётся." });
    }
    if (/dates are required/.test(e.message)) {
      return res.status(400).json({ error: "У договора должны быть дата начала и дата окончания действия." });
    }
    return next(e);
  }
});

/* ─── договоры глазами позванного: свои соглашения, текст, подпись ─── */
router.get("/agreements/mine", async (req, res, next) => {
  try {
    const me = await identify(req.telegramUserId, req.telegramProfile || {}, { claim: false });
    res.json({ agreements: await listAgreements({ userId: me.id, isOwner: false }) });
  } catch (e) { fail(res, e, next); }
});
router.get("/agreements/:id/html", async (req, res, next) => {
  try {
    const me = await identify(req.telegramUserId, req.telegramProfile || {}, { claim: false });
    res.json(await agreementHtml(me.id, req.params.id, { asOwner: me.isOwner }));
  } catch (e) { fail(res, e, next); }
});
router.post("/agreements/:id/sign", async (req, res, next) => {
  try {
    /* Подпись за человека не ставят (владелец, 2026-09-20): заполнить
       договор с его страницы можно, подписать — нет. Владельцу можно:
       он и так распоряжается всем. */
    if (req.actingAs && req.body?.sign2) {
      const org = await listOrg();
      if (String(org.ownerId || "") !== String(req.telegramRealId || "")) {
        return res.status(403).json({
          error: "Подписать договор за человека нельзя — это его согласие" });
      }
    }
    const agreement = await signAgreement(req.telegramUserId, req.params.id, req.body || {});
    const me = await identify(req.telegramUserId, req.telegramProfile || {});
    res.json({ agreement, me });
  } catch (e) { fail(res, e, next); }
});

// Всё остальное — только владельцу. Проверка стоит на входе, а не в
// каждом обработчике: забыть её в одном месте проще, чем в одном.
router.use(async (req, res, next) => {
  try {
    const me = await identify(req.telegramUserId, req.telegramProfile || {});
    if (!me.isOwner) return res.status(403).json({ error: "only the owner can do this" });
    req.me = me;
    next();
  } catch (e) { next(e); }
});

router.get("/", async (_req, res, next) => {
  try { res.json({ ...(await listOrg()), tabs: TABS }); } catch (e) { next(e); }
});

router.post("/users", async (req, res, next) => {
  try {
    res.status(201).json(await addUser({ ...(req.body || {}), addedBy: req.telegramUserId }));
  } catch (e) {
    if (/required|unknown role/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

router.put("/users/:id/role", async (req, res, next) => {
  try {
    const user = await setUserRole(req.params.id, req.body?.roleId);
    if (!user) return res.status(404).json({ error: "not found" });
    res.json(user);
  } catch (e) {
    if (/unknown role/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

/* Подписанный договор участника — текстом для окна просмотра: Word
   разбирается на месте, остальное открывается по своей ссылке. */
router.get("/users/:id/contracts/:roleId/html", async (req, res, next) => {
  try { res.json(await contractHtml(req.params.id, req.params.roleId)); }
  catch (e) {
    if (/not found/.test(e.message)) return res.status(404).json({ error: "not found" });
    next(e);
  }
});

router.delete("/users/:id", async (req, res, next) => {
  try {
    const ok = await removeUser(req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

/* Ролей у человека может быть несколько: он и дизайнер, и проверяющий.
   Должностей больше нет — это был тот же вопрос «кто он здесь», заданный
   вторым списком. Владелец раздаёт роли здесь, сам человек — договором. */
router.put("/users/:id/roles", async (req, res, next) => {
  try {
    const user = await setUserRoles(req.params.id, req.body?.roles);
    if (!user) return res.status(404).json({ error: "not found" });
    res.json(user);
  } catch (e) {
    if (/unknown role/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

/* Договор роли — шаблон: что человек подписывает, вступая в неё. Кладёт
   владелец, читает всякий, кто регистрируется. Пусто — снять договор:
   роль без него выдаётся без акцепта, и это видно в списке. */
router.put("/roles/:id/contract", async (req, res, next) => {
  try {
    const role = await setRoleContract(req.params.id, req.body?.contract ?? null);
    if (!role) return res.status(404).json({ error: "not found" });
    res.json(role);
  } catch (e) { next(e); }
});

router.post("/roles", async (req, res, next) => {
  try { res.status(201).json(await addRole(req.body || {})); }
  catch (e) {
    if (/required|already exists/.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
});

router.put("/roles/:id/name", async (req, res, next) => {
  try {
    const role = await renameRole(req.params.id, req.body?.name);
    if (!role) return res.status(404).json({ error: "not found" });
    res.json(role);
  } catch (e) {
    if (/required|already exists/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

router.put("/roles/:id/tabs", async (req, res, next) => {
  try {
    const role = await setRoleTabs(req.params.id, req.body?.tabs);
    if (!role) return res.status(404).json({ error: "not found" });
    res.json(role);
  } catch (e) { next(e); }
});

router.delete("/roles/:id", async (req, res, next) => {
  try {
    const ok = await removeRole(req.params.id);
    if (!ok) return res.status(404).json({ error: "not found or built-in" });
    res.status(204).end();
  } catch (e) { next(e); }
});

/* ─────── анкеты как словари ───────

   Анкета — список вопросов, и заводит его владелец: какие вопросы задавать
   людям, знает он. Роли анкета назначается отдельным маршрутом, как
   договор: это свойство роли, а не анкеты. Сами ответы человек пишет
   через `/me/profile` — анкета лишь говорит, о чём его спросить. */
router.post("/forms", async (req, res, next) => {
  try { res.status(201).json(await addForm(req.body || {})); }
  catch (e) {
    if (/required/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

router.put("/forms/:id", async (req, res, next) => {
  try {
    const form = await setForm(req.params.id, req.body || {});
    if (!form) return res.status(404).json({ error: "not found" });
    res.json(form);
  } catch (e) { next(e); }
});

router.delete("/forms/:id", async (req, res, next) => {
  try {
    const ok = await removeForm(req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

router.put("/roles/:id/form", async (req, res, next) => {
  try {
    const role = await setRoleForm(req.params.id, req.body?.formId ?? null);
    if (!role) return res.status(404).json({ error: "not found" });
    res.json(role);
  } catch (e) {
    if (/unknown form/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

/* ─── документы договоров: версии, текст, значения ─── */
router.post("/docs", async (req, res, next) => {
  try { res.status(201).json(await addDoc(req.me.id, req.body || {})); }
  catch (e) { fail(res, e, next); }
});
router.post("/docs/:id/versions", async (req, res, next) => {
  try { res.status(201).json(await addVersion(req.me.id, req.params.id, req.body || {})); }
  catch (e) { fail(res, e, next); }
});
router.put("/docs/:id", async (req, res, next) => {
  try { res.json(await updateDoc(req.params.id, req.body || {})); }
  catch (e) { fail(res, e, next); }
});
router.delete("/docs/:id", async (req, res, next) => {
  try { await removeDoc(req.params.id); res.status(204).end(); }
  catch (e) { fail(res, e, next); }
});
router.delete("/docs/:id/versions/:vid", async (req, res, next) => {
  try { res.json(await removeVersion(req.params.id, req.params.vid)); }
  catch (e) { fail(res, e, next); }
});
router.get("/docs/:id/html", async (req, res, next) => {
  try { res.json(await docHtml(req.params.id, req.query.v)); }
  catch (e) { fail(res, e, next); }
});
router.put("/roles/:id/doc", async (req, res, next) => {
  try { res.json(await setRoleDoc(req.params.id, req.body?.docId ?? null)); }
  catch (e) { fail(res, e, next); }
});

/* ─── соглашения: выдать, список, отозвать ─── */
router.post("/agreements", async (req, res, next) => {
  try {
    const a = await createAgreement(req.me.id, req.body || {});
    res.status(201).json({ ...a, link: inviteLink(a.token) });
  } catch (e) { fail(res, e, next); }
});
router.get("/agreements", async (req, res, next) => {
  try { res.json({ agreements: await listAgreements({ userId: req.me.id, isOwner: true }) }); }
  catch (e) { fail(res, e, next); }
});
router.delete("/agreements/:id", async (req, res, next) => {
  try { res.json(await revokeAgreement(req.params.id)); }
  catch (e) { fail(res, e, next); }
});

export default router;
