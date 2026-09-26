import React, { useCallback, useEffect, useRef, useState } from "react";
import { ACC, Avatar, BAD, C, OK, S, WARN, btn, alpha } from "./ui.jsx";
import { statusColor } from "./ProfilePanel.jsx";
import { statusOf } from "../lib/workers.js";
import { nameHints, nearest, search } from "../lib/semantic.js";
import { SORTS, activeCount, emptyFilter, filterItems, pickedRes, resourcesIn, sortItems }
  from "../lib/marketSort.js";
import {
  addOffer, addOrder, addRequest, addService, dropOrder, dropService, getMarket,
  getMarketPerson, offerApi, requestApi, updateOrder, updateService,
} from "../market.js";
import {
  DUR_UNITS, daysFrom, daysText, durText, emptyRow, matchServices, orderFromFunc, rowsLine, rowText, serviceFromFunc,
} from "../lib/market.js";
import { putReportFile, reportSrc } from "../storage.js";
import Modal from "./Modal.jsx";
import ProfilePanel from "./ProfilePanel.jsx";
import { getRatings } from "../identity.js";

/* ════════════════════════════════════════════════════════════════
   РЫНОК УСЛУГ · первая вкладка

   Владелец (2026-09-13): «две вкладки внутри — «Заказы» и «Услуги».
   Любой зарегистрированный пользователь может оставить заказ: название,
   содержание, стоимость и другие предоставляемые ресурсы. В услуге:
   название, описание, какие ресурсы берёт, какие выдаёт, за какое время
   выполняется. Заказы и услуги берут слова из функций (кнопки в
   настройках функции), но их можно изменить. Заказчику при создании
   заказа показываются подходящие услуги, одну можно выбрать. Пользователи
   оставляют предложения — их видит только автор заказа. Открытие отклика
   — чат заказчика и исполнителя. У обоих — «Договорились»: что отдать,
   что получить, за сколько. Когда бриф заполнила одна сторона, у обоих —
   «Есть предложение»: изменить (кнопка меняет цвет) или принять. После
   принятия заказчику предложено загрузить ресурсы, у исполнителя —
   задача на «Задачах» или «Проверке» по его ролям».

   Что здесь решено:
   · Рынок — на сервере и общий: без входа через Telegram его нет, и
     вкладка честно говорит об этом, а не рисует пустые формы.
   · Список переспрашивается раз в полминуты и после каждого своего
     действия — как срез позванного: чат и отклики живут у других людей.
   · Отклик и чат — одно окно: открыл отклик — открыл разговор.
   · Цвет «Есть предложение»: жёлтая — предложение писала ДРУГАЯ сторона,
     его можно принять; голубая — последним правили вы, ждёте ответа.
   ════════════════════════════════════════════════════════════════ */

const POLL_MS = 30000;
const hint = { fontSize: "var(--fs-hint)", color: C.muted, lineHeight: 1.6 };
const form = { background: C.panel2, border: `1px solid ${C.line}`, borderRadius: "var(--radius-sm)",
  padding: "var(--space-8)", marginTop: "var(--space-8)" };
const when = (iso) => {
  const d = new Date(iso || "");
  return isNaN(d.getTime()) ? "" : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit" });
};

/* ─────── строки «что, сколько» ─────── */

function Rows({ rows, onChange, label, single = false }) {
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const drop = (i) => onChange(rows.filter((_, j) => j !== i));
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2" style={{ alignItems: "center", marginTop: "var(--space-4)" }}>
          <input aria-label={`${label}: что`} style={{ ...S.inp, flex: "3 1 120px" }}
            placeholder="что" value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
          <input aria-label={`${label}: сколько`} inputMode="decimal"
            style={{ ...S.inp, flex: "1 1 60px", maxWidth: 90 }} placeholder="сколько"
            value={r.qty ?? ""} onChange={(e) => set(i, { qty: e.target.value })} />
          {!single && (
            <button type="button" style={{ ...btn(false), paddingTop: "calc(var(--btn-py) + var(--text-nudge))", paddingBottom: "calc(var(--btn-py) - var(--text-nudge))", paddingLeft: "var(--space-8)", paddingRight: "var(--space-8)" }}
              aria-label={`${label}: убрать строку`} onClick={() => drop(i)}>✕</button>)}
        </div>))}
      {!single && (
        <button type="button" style={{ ...btn(false), marginTop: "var(--space-4)" }}
          onClick={() => onChange([...rows, emptyRow()])}>+ ресурс</button>)}
    </div>
  );
}

const cleanRows = (rows) => rows.map((r) => ({ name: String(r.name || "").trim(),
  qty: r.qty === "" || r.qty == null ? null : Number(String(r.qty).replace(",", ".")) }))
  .filter((r) => r.name);

/* ─────── две роли нанятого (владелец, 2026-09-26) ───────

   «Вместо роли соискателя сделай два поля: роль в техпроцессе, где может
   быть постановщик, исполнитель или проверяющий, и роль в сценарии, где
   выбираются те роли, которые установлены у заказчика в ролях». Одни и
   те же — у заказа и у заявки на услугу. */
export const PROC_ROLES = [["setter", "постановщик"], ["assignee", "исполнитель"], ["reviewer", "проверяющий"]];

function RoleFields({ procRole, roleId, roles = [], onChange }) {
  return (<>
    <div style={{ ...S.lbl, marginTop: "var(--space-8)" }}>роль в техпроцессе</div>
    <select aria-label="роль в техпроцессе" value={procRole || "assignee"}
      onChange={(e) => onChange({ procRole: e.target.value })}
      style={{ ...S.inp, marginTop: "var(--space-4)" }}>
      {PROC_ROLES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
    </select>
    {!!roles.length && (<>
      <div style={{ ...S.lbl, marginTop: "var(--space-8)" }}>роль в сценарии</div>
      <select aria-label="роль в сценарии" value={roleId || ""}
        onChange={(e) => onChange({ roleId: e.target.value })}
        style={{ ...S.inp, marginTop: "var(--space-4)" }}>
        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
    </>)}
  </>);
}

/* ─────── форма заказа: слова, ресурсы, роли, подходящие услуги ─────── */

function OrderForm({ initial, services, orders = [], roles = [], busy, onSave, onCancel,
  saveLabel = "Оставить заказ" }) {
  const [f, setF] = useState({ name: "", text: "",
    serviceId: null, funcId: null, ...initial,
    procRole: initial?.procRole || "assignee", roleId: initial?.roleId || (roles[0]?.id ?? ""),
    resources: initial?.resources?.length ? initial.resources : [emptyRow()] });
  const up = (patch) => setF((x) => ({ ...x, ...patch }));
  /* Подходящие услуги — сразу, по мере набора: заказчик видит, кто уже
     делает такое, и выбирает одну — она уедет с заказом. */
  const fit = matchServices({ ...f, resources: cleanRows(f.resources) }, services);
  const shown = fit.length ? fit : services;
  return (
    <div style={form} aria-label="форма заказа">
      <div style={S.lbl}>заказ</div>
      {/* Пока набирают название, рядом падают уже придуманные — близкие
          по смыслу (владелец, 2026-09-20): можно взять готовое. */}
      <NameField label="название заказа" placeholder="название" value={f.name}
        onChange={(v) => up({ name: v })} items={[...orders, ...services]} />
      <textarea aria-label="содержание заказа" style={{ ...S.inp, minHeight: 64, marginBottom: "var(--space-4)" }}
        placeholder="содержание: что нужно сделать" value={f.text}
        onChange={(e) => up({ text: e.target.value })} />
      {/* Стоимости нет (владелец, 2026-09-26): деньги — такой же ресурс,
          как остальные. */}
      <div style={{ ...S.lbl, marginTop: "var(--space-4)" }}>предоставляемые ресурсы</div>
      <Rows rows={f.resources} onChange={(rows) => up({ resources: rows })} label="ресурс заказа" />

      <RoleFields procRole={f.procRole} roleId={f.roleId} roles={roles} onChange={up} />

      <div style={{ ...S.lbl, marginTop: "var(--space-8)" }}>подходящие услуги</div>
      {!services.length && <div style={hint}>Услуг пока никто не выложил.</div>}
      {!!services.length && !fit.length && (
        <div style={hint}>По словам заказа ничего не подошло — вот все услуги.</div>)}
      {shown.map((s) => {
        const on = f.serviceId === s.id;
        return (
          <button key={s.id} type="button" role="checkbox" aria-checked={on}
            aria-label={`услуга ${s.name}`}
            onClick={() => up({ serviceId: on ? null : s.id })}
            className="flex gap-2" style={{ width: "100%", textAlign: "left", marginTop: "var(--space-4)",
              background: on ? `${alpha(OK, "22")}` : C.panel, border: `1px solid ${on ? OK : C.line}`,
              borderRadius: "var(--radius-sm)", padding: "var(--space-4) var(--space-8)", color: C.text, cursor: "pointer" }}>
            <span style={{ width: 16, color: OK, fontWeight: 700 }}>{on ? "✓" : ""}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--fs-body)", fontWeight: 600 }}>{s.name}</div>
              <div style={{ fontSize: "var(--fs-hint)", color: C.muted }}>
                {[s.gives?.length ? `выдаёт: ${rowsLine(s.gives)}` : "", daysText(s.days)]
                  .filter(Boolean).join(" · ")}</div>
            </span>
          </button>);
      })}

      <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-8)" }}>
        <button type="button" style={btn(true, OK)} disabled={busy || !f.name.trim()}
          onClick={() => onSave({ name: f.name.trim(), text: f.text,
            resources: cleanRows(f.resources), serviceId: f.serviceId, funcId: f.funcId,
            procRole: f.procRole, ...(f.roleId ? { roleId: f.roleId } : {}) })}>
          {saveLabel}</button>
        <button type="button" style={btn(false)} onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}

/* ─────── форма услуги: слова, берёт, выдаёт, срок ─────── */

function ServiceForm({ initial, services = [], busy, onSave, onCancel,
  saveLabel = "Выложить услугу" }) {
  const [f, setF] = useState({ name: "", text: "", takes: [], gives: [], funcId: null,
    ...initial, days: initial?.days ?? "", auto: initial?.auto === true,
    // Срок — число и единица (владелец, 2026-09-21); прежние записи — в днях.
    dur: initial?.dur ?? initial?.days ?? "", durUnit: initial?.durUnit || "day",
    // Приватна по умолчанию (владелец, 2026-09-21).
    private: initial?.private !== false });
  const up = (patch) => setF((x) => ({ ...x, ...patch }));
  return (
    <div style={form} aria-label="форма услуги">
      <div style={S.lbl}>услуга</div>
      <NameField label="название услуги" placeholder="название" value={f.name}
        onChange={(v) => up({ name: v })} items={services} />
      <textarea aria-label="описание услуги" style={{ ...S.inp, minHeight: 64, marginBottom: "var(--space-4)" }}
        placeholder="описание: что делаете" value={f.text} onChange={(e) => up({ text: e.target.value })} />
      <div style={{ ...S.lbl, marginTop: "var(--space-4)" }}>какие ресурсы берёт</div>
      <Rows rows={f.takes} onChange={(rows) => up({ takes: rows })} label="берёт" />
      <div style={{ ...S.lbl, marginTop: "var(--space-8)" }}>какие выдаёт</div>
      <Rows rows={f.gives} onChange={(rows) => up({ gives: rows })} label="выдаёт" />
      <div className="flex gap-2" style={{ alignItems: "center", marginTop: "var(--space-8)", flexWrap: "wrap" }}>
        <span style={{ fontSize: "var(--fs-hint)", color: C.muted }}>за какое время выполняется</span>
        <input aria-label="срок услуги" inputMode="decimal" style={{ ...S.inp, maxWidth: 90 }}
          value={f.dur ?? ""} onChange={(e) => up({ dur: e.target.value })} />
        <select aria-label="единица срока" value={f.durUnit}
          onChange={(e) => up({ durUnit: e.target.value })} style={{ ...S.inp, maxWidth: 120 }}>
          {DUR_UNITS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>
      </div>
      {/* Автоматический приём (владелец, 2026-09-20): заказ по этой
          услуге не ждёт переписки — отклик создаётся сам и сам
          принимается, и задача сразу падает в бэклог. Вне рабочего
          времени — обычный путь: обещать за себя круглосуточно нельзя. */}
      <label className="flex items-center gap-2"
        style={{ marginTop: "var(--space-8)", fontSize: "var(--fs-hint)", cursor: "pointer" }}>
        <input type="checkbox" checked={f.auto} aria-label="принять автоматически в рабочее время"
          onChange={(e) => up({ auto: e.target.checked })} style={{ accentColor: OK }} />
        Принять автоматически в рабочее время
      </label>
      <label className="flex items-center gap-2"
        style={{ marginTop: "var(--space-4)", fontSize: "var(--fs-hint)", cursor: "pointer" }}>
        <input type="checkbox" checked={f.private} aria-label="приватная услуга"
          onChange={(e) => up({ private: e.target.checked })} style={{ accentColor: OK }} />
        Приватная
      </label>
      <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-8)" }}>
        <button type="button" style={btn(true, OK)} disabled={busy || !f.name.trim()}
          onClick={() => onSave({ name: f.name.trim(), text: f.text, takes: cleanRows(f.takes),
            gives: cleanRows(f.gives), days: daysFrom(f.dur, f.durUnit), dur: f.dur === "" ? null : f.dur,
            durUnit: f.durUnit, funcId: f.funcId,
            auto: f.auto, private: f.private })}>
          {saveLabel}</button>
        <button type="button" style={btn(false)} onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}

/* ─────── бриф: что отдать, что получить, за сколько ─────── */

function BriefForm({ initial, busy, onSave, onCancel }) {
  const [gives, setGives] = useState(initial?.gives?.length ? initial.gives : [emptyRow()]);
  const [gets, setGets] = useState([initial?.gets || emptyRow()]);
  const [days, setDays] = useState(initial?.days ?? "");
  const [note, setNote] = useState(initial?.note || "");
  return (
    <div style={form} aria-label="бриф">
      <div style={S.lbl}>договорились: условия</div>
      <div style={{ ...S.lbl, marginTop: "var(--space-4)", color: C.text }}>заказчик отдаёт</div>
      <Rows rows={gives} onChange={setGives} label="отдаёт" />
      <div style={{ ...S.lbl, marginTop: "var(--space-8)", color: C.text }}>исполнитель выдаёт</div>
      <Rows rows={gets} onChange={setGets} label="получает" single />
      <div className="flex gap-2" style={{ alignItems: "center", marginTop: "var(--space-8)" }}>
        <span style={{ fontSize: "var(--fs-hint)", color: C.muted }}>ожидаемое время выполнения, дней</span>
        <input aria-label="срок брифа" inputMode="decimal" style={{ ...S.inp, maxWidth: 90 }}
          value={days} onChange={(e) => setDays(e.target.value)} />
      </div>
      <textarea aria-label="примечание брифа" style={{ ...S.inp, minHeight: 44, marginTop: "var(--space-4)" }}
        placeholder="примечание (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-8)" }}>
        <button type="button" style={btn(true, OK)} disabled={busy}
          onClick={() => onSave({ gives: cleanRows(gives), gets: cleanRows(gets)[0] || null,
            days: days === "" ? null : days, note })}>Сохранить условия</button>
        <button type="button" style={btn(false)} onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}

/* ─────── отклик = чат + бриф + сделка ───────

   Тот же разговор — у заявки на услугу (владелец, 2026-09-26): кто
   заказчик и что вызывать, приходит снаружи (`customerId`, `api`). */

function OfferView({ offer, customerId, executorId = offer.by, api, me, nameOf, busy, act, label = "отклик" }) {
  const [text, setText] = useState("");
  const [briefOpen, setBriefOpen] = useState(false);   // «Есть предложение» раскрыто
  const [editing, setEditing] = useState(false);
  const [dlv, setDlv] = useState({ name: "", text: "" });
  const fileRef = useRef(null);
  const customer = String(customerId) === String(me);
  const other = customer ? executorId : customerId;
  const brief = offer.brief;
  const theirs = brief && String(brief.by) !== String(me);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    act(() => api.chat(t)).then(() => setText(""));
  };
  const upload = async (file) => {
    if (!file) return;
    const saved = await act(() => putReportFile(file, { kind: "market" }));
    if (saved) await act(() => api.deliver({ name: dlv.name || file.name, file: saved }));
    if (fileRef.current) fileRef.current.value = "";
  };
  return (
    <div style={form} aria-label={`${label} ${nameOf(offer.by)}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span style={S.lbl}>{customer ? "исполнитель" : "заказчик"}</span>
        <span style={{ fontSize: "var(--fs-body)", fontWeight: 600 }}>{nameOf(other)}</span>
        <span style={{ fontSize: "var(--fs-hint)", color: C.muted }}>{when(offer.at)}</span>
      </div>
      <div style={{ fontSize: "var(--fs-hint)", marginTop: "var(--space-4)", lineHeight: 1.5 }}>{offer.text}</div>

      {/* ─── чат ─── */}
      <div style={{ ...S.lbl, marginTop: "var(--space-8)" }}>чат</div>
      <div role="log" aria-label={label === "заявка" ? "чат заявки" : "чат отклика"} style={{ maxHeight: 220, overflowY: "auto",
        border: `1px solid ${C.line}`, borderRadius: "var(--radius-sm)", padding: "var(--space-4)", marginTop: "var(--space-4)", background: C.ink }}>
        {!(offer.chat || []).length && <div style={hint}>Пока ничего не сказано.</div>}
        {(offer.chat || []).map((c) => {
          const own = String(c.by) === String(me);
          return (
            <div key={c.id} style={{ marginBottom: "var(--space-4)", textAlign: own ? "right" : "left" }}>
              <span style={{ display: "inline-block", maxWidth: "85%", textAlign: "left",
                background: own ? `${alpha(ACC, "22")}` : C.panel2, borderRadius: "var(--radius-sm)", padding: "var(--space-4) var(--space-8)",
                fontSize: "var(--fs-hint)", lineHeight: 1.45 }}>
                {c.text}
                <div style={{ fontSize: "var(--fs-hint)", color: C.muted }}>{own ? "вы" : nameOf(c.by)} · {when(c.at)}</div>
              </span>
            </div>);
        })}
      </div>
      <div className="flex gap-2" style={{ marginTop: "var(--space-4)" }}>
        <input aria-label="сообщение" style={S.inp} placeholder="написать" value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
        <button type="button" style={btn(true)} disabled={busy || !text.trim()} onClick={send}>Отправить</button>
      </div>

      {/* ─── бриф ─── */}
      {!offer.accepted && (
        <div style={{ marginTop: "var(--space-8)" }}>
          {!brief && !editing && (
            <button type="button" style={btn(true, OK)} disabled={busy} onClick={() => setEditing(true)}>
              Договорились</button>)}
          {brief && !editing && (
            /* Жёлтая — предложение писала другая сторона, его можно принять;
               голубая — последним правили вы и ждёте ответа. */
            <button type="button" style={btn(true, theirs ? WARN : ACC)} disabled={busy}
              aria-label="есть предложение" data-tone={theirs ? "theirs" : "mine"}
              onClick={() => setBriefOpen((v) => !v)}>
              Есть предложение{theirs ? "" : " (ваше)"}</button>)}
          {editing && (
            <BriefForm initial={brief} busy={busy}
              onSave={(b) => act(() => api.brief(b)).then(() => { setEditing(false); setBriefOpen(true); })}
              onCancel={() => setEditing(false)} />)}
          {brief && briefOpen && !editing && (
            <div style={{ ...form, borderColor: theirs ? `${alpha(WARN, "66")}` : `${alpha(ACC, "66")}` }} aria-label="условия">
              <div style={hint}>
                {theirs ? `Предложение от ${nameOf(brief.by)}` : "Ваше предложение"} · версия {brief.rev} · {when(brief.at)}
              </div>
              <div style={{ fontSize: "var(--fs-hint)", marginTop: "var(--space-4)", lineHeight: 1.6 }}>
                <div><b>заказчик отдаёт:</b> {rowsLine(brief.gives) || "—"}</div>
                <div><b>исполнитель выдаёт:</b> {rowText(brief.gets) || "—"}</div>
                <div><b>ожидаемое время:</b> {daysText(brief.days)}</div>
                {brief.note && <div>{brief.note}</div>}
              </div>
              <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-8)" }}>
                <button type="button" style={btn(false)} disabled={busy} onClick={() => setEditing(true)}>
                  Изменить</button>
                {theirs && (
                  <button type="button" style={btn(true, OK)} disabled={busy}
                    onClick={() => act(() => api.accept())}>Принять предложение</button>)}
                {!theirs && <span style={hint}>Принять должна другая сторона.</span>}
              </div>
            </div>)}
        </div>)}

      {/* ─── сделка ─── */}
      {offer.accepted && (
        <div style={{ ...form, borderColor: `${alpha(OK, "66")}` }} aria-label="сделка">
          <div style={{ fontSize: "var(--fs-hint)", color: OK, fontWeight: 600 }}>Договорились · {when(offer.acceptedAt)}</div>
          <div style={{ fontSize: "var(--fs-hint)", marginTop: "var(--space-4)", lineHeight: 1.6 }}>
            <div><b>заказчик отдаёт:</b> {rowsLine(brief?.gives) || "—"}</div>
            <div><b>исполнитель выдаёт:</b> {rowText(brief?.gets) || "—"}</div>
            <div><b>ожидаемое время:</b> {daysText(brief?.days)}</div>
          </div>
          <div style={{ ...hint, marginTop: "var(--space-4)" }}>
            {customer ? "Задача заведена. Загрузите то, что отдаёте." : "Задача заведена. Что отдал заказчик — ниже."}
          </div>
          <div style={{ ...S.lbl, marginTop: "var(--space-8)" }}>ресурсы от заказчика</div>
          {!(offer.deliveries || []).length && <div style={hint}>Пока ничего не загружено.</div>}
          {(offer.deliveries || []).map((d) => (
            <div key={d.id} style={{ fontSize: "var(--fs-hint)", marginTop: "var(--space-4)" }}>
              {d.name || d.file?.name || "ресурс"}
              {d.text ? <span style={{ color: C.muted }}> — {d.text}</span> : null}
              {d.file && (
                <a href={reportSrc(d.file)} target="_blank" rel="noreferrer"
                  style={{ color: ACC, marginLeft: "var(--space-4)" }}>📎 {d.file.name}</a>)}
              <span style={{ fontSize: "var(--fs-hint)", color: C.muted }}> · {when(d.at)}</span>
            </div>))}
          {customer && (
            <div style={{ marginTop: "var(--space-8)" }}>
              <input aria-label="название ресурса" style={{ ...S.inp, marginBottom: "var(--space-4)" }}
                placeholder="что отдаёте (например, логотип)" value={dlv.name}
                onChange={(e) => setDlv({ ...dlv, name: e.target.value })} />
              <textarea aria-label="текст ресурса" style={{ ...S.inp, minHeight: 40, marginBottom: "var(--space-4)" }}
                placeholder="текстом — если ресурс словами" value={dlv.text}
                onChange={(e) => setDlv({ ...dlv, text: e.target.value })} />
              <div className="flex flex-wrap gap-2">
                <button type="button" style={btn(true)} disabled={busy || (!dlv.name.trim() && !dlv.text.trim())}
                  onClick={() => act(() => api.deliver(dlv)).then(() => setDlv({ name: "", text: "" }))}>
                  Отдать текстом</button>
                <label style={{ ...btn(false), display: "inline-block" }}>
                  Отдать файлом
                  <input ref={fileRef} type="file" aria-label="файл ресурса" style={{ display: "none" }}
                    onChange={(e) => upload(e.target.files?.[0])} />
                </label>
              </div>
            </div>)}
        </div>)}
    </div>
  );
}

/* ─────── ПОИСК ПО СМЫСЛУ (владелец, 2026-09-20) ───────

   Поле стоит справа от «+ заказ» и «+ услуга». Пока человек печатает,
   встроенный эмбеддер (`lib/semantic.js`) ищет подходящее ПО СМЫСЛУ, а не
   по буквам: «программирование» находит «Разработку». Подходящее падает
   выпадающим списком — по нему и нажимают.

   Нажали — выбранное встаёт ПЕРВЫМ, а под ним ближайшие по смыслу: это и
   есть ответ на «покажи такое же». Пустое поле возвращает список как был.

   Всё считается на месте, без сети: записи уже загружены, а ходить к
   модели на каждую букву значило бы ждать ответа на каждое нажатие. */
function SearchBox({ items, label, onPick, value, onChange }) {
  const [open, setOpen] = useState(false);
  const found = value.trim() ? search(value, items, { limit: 8 }) : [];
  return (
    <div style={{ position: "relative", flex: "1 1 180px", minWidth: 140 }}>
      <input aria-label={label} placeholder="Поиск" value={value}
        style={{ ...S.inp, width: "100%" }}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        /* Закрываем с задержкой: без неё список исчезает раньше, чем
           нажатие по строке успевает дойти. */
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && !!found.length && (
        <div role="listbox" aria-label={`${label}: подходящее`}
          style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
            background: C.panel, border: `1px solid ${ACC}`, borderRadius: "var(--radius-sm)",
            marginTop: 0, maxHeight: 220, overflowY: "auto" }}>
          {found.map(({ item }) => (
            <button key={item.id} type="button" role="option" aria-selected="false"
              aria-label={`найдено: ${item.name}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick(item); setOpen(false); }}
              style={{ display: "block", width: "100%", textAlign: "left",
                background: "transparent", border: "none", color: C.text,
                borderBottom: `1px solid ${C.line}`, padding: "var(--space-4) var(--space-8)",
                fontSize: "var(--fs-hint)", cursor: "pointer" }}>
              <div style={{ fontWeight: 600 }}>{item.name}</div>
              {item.text && (
                <div style={{ fontSize: "var(--fs-hint)", color: C.muted }}>
                  {item.text.length > 70 ? `${item.text.slice(0, 69)}…` : item.text}</div>)}
            </button>))}
        </div>)}
    </div>);
}

/* Подсказка готовых названий: то же по смыслу, но только по имени —
   человек набирает своё, а рядом падает список уже придуманных. */
function NameField({ value, onChange, items, label, placeholder }) {
  const [open, setOpen] = useState(false);
  const hints = nameHints(value, items);
  return (
    <div style={{ position: "relative", margin: "var(--space-4) 0" }}>
      <input aria-label={label} placeholder={placeholder} value={value}
        style={{ ...S.inp, width: "100%" }}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && !!hints.length && (
        <div role="listbox" aria-label={`${label}: готовые названия`}
          style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
            background: C.panel, border: `1px solid ${ACC}`, borderRadius: "var(--radius-sm)",
            marginTop: 0, maxHeight: 180, overflowY: "auto" }}>
          {hints.map((h) => (
            <button key={h.name} type="button" role="option" aria-selected="false"
              aria-label={`название: ${h.name}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(h.name); setOpen(false); }}
              style={{ display: "block", width: "100%", textAlign: "left",
                background: "transparent", border: "none", color: C.text,
                borderBottom: `1px solid ${C.line}`, padding: "var(--space-4) var(--space-8)",
                fontSize: "var(--fs-hint)", cursor: "pointer" }}>{h.name}</button>))}
        </div>)}
    </div>);
}

/** Список в порядке «выбранное, потом ближайшее по смыслу». */
export function orderedBy(picked, items) {
  if (!picked) return items;
  const self = items.find((x) => x.id === picked);
  if (!self) return items;
  const near = nearest(self, items).map((r) => r.item);
  const rest = items.filter((x) => x !== self && !near.includes(x));
  return [self, ...near, ...rest];
}

/** Цветной кружок статуса — тот же, что в строке воркера. */
const Dot = ({ color }) => (
  <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%",
    background: color, flex: "0 0 9px", display: "block" }} />);

/* Кружок с лицом автора: своё лицо у знакомого, знак приложения —
   у того, с кем смотрящий вместе не работает. */
function PersonDot({ id, nameOf, faceOf, onOpen }) {
  const face = faceOf?.(id) || {};
  return (
    <Avatar src={face.avatar || ""} name={nameOf(id)} size={28} logo={!!face.anon}
      title={`страница: ${nameOf(id)}`} onClick={() => onOpen?.(id)} />);
}

/* ─────── СТРАНИЦА АВТОРА ───────

   Нажали на кружок с лицом — окном открылась его страница: та же, что у
   воркера актива (анкета, график, рейтинг). Незнакомый смотрящему автор
   представлен двумя словами, и вместо лица у него знак приложения —
   решает это сервер, а не интерфейс.

   Окном, а не переходом: человек смотрит, кто это, и должен вернуться
   туда же, откуда смотрел. */
function PersonModal({ id, me, onClose }) {
  const [who, setWho] = useState(null);
  const [ratings, setRatings] = useState(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let alive = true;
    getMarketPerson(id).then((p) => { if (alive) setWho(p); },
      (e) => { if (alive) setMsg(e.message || "страница не открывается"); });
    getRatings().then((r) => { if (alive) setRatings(r); }, () => {});
    return () => { alive = false; };
  }, [id]);
  const person = who ? { id: who.id, name: who.name, ...who.profile, forms: who.forms } : null;
  return (
    <Modal title={who?.name || "страница"} onClose={onClose}>
      {!who && <div style={hint}>{msg || "Загружаю…"}</div>}
      {who && (
        <ProfilePanel me={me} personId={who.id} people={[person]} ratings={ratings}
          anon={who.anon} />)}
    </Modal>);
}

/* ─────── карточка заказа ─────── */

function OrderCard({ order, me, nameOf, faceOf, onOpenPerson, services, busy, act, isOwner,
  picked = false, roles = [] }) {
  const [edit, setEdit] = useState(false);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [openOffer, setOpenOffer] = useState(null);
  const mineOrder = String(order.by) === String(me);
  const svc = services.find((s) => s.id === order.serviceId);
  const myOffer = (order.offers || []).find((o) => String(o.by) === String(me));
  const status = order.status === "deal" ? "договорились" : order.status === "done" ? "выполнен" : "открыт";
  return (
    <div style={{ ...S.card, marginBottom: "var(--space-8)",
      borderColor: picked ? ACC : mineOrder ? `${alpha(ACC, "55")}` : C.line }}
      aria-label={`заказ ${order.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        {/* Кружок с лицом автора — ПЕРЕД названием (владелец,
            2026-09-20). Нажатие открывает его страницу. */}
        <PersonDot id={order.by} nameOf={nameOf} faceOf={faceOf} onOpen={onOpenPerson} />
        <span style={{ fontSize: "var(--fs-body)", fontWeight: 700, flex: 1 }}>{order.name}</span>
        <span style={{ fontSize: "var(--fs-hint)", color: order.status === "open" ? OK : WARN }}>{status}</span>
      </div>
      <div style={{ fontSize: "var(--fs-hint)", color: C.muted }}>
        {mineOrder ? "ваш заказ" : nameOf(order.by)} · {when(order.at)}
        {order.offerCount ? ` · откликов: ${order.offerCount}` : ""}
      </div>
      {edit ? (
        <OrderForm initial={order} services={services} roles={roles} busy={busy} saveLabel="Сохранить"
          onSave={(f) => act(() => updateOrder(order.id, f)).then(() => setEdit(false))}
          onCancel={() => setEdit(false)} />
      ) : (<>
        {order.text && <div style={{ fontSize: "var(--fs-hint)", marginTop: "var(--space-4)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{order.text}</div>}
        <div style={{ fontSize: "var(--fs-hint)", marginTop: "var(--space-4)", lineHeight: 1.6 }}>
          {!!(order.resources || []).length && <div><b>предоставляет:</b> {rowsLine(order.resources)}</div>}
          {svc && <div><b>выбранная услуга:</b> {svc.name} ({nameOf(svc.by)})</div>}
        </div>
        <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-8)" }}>
          {mineOrder && order.status === "open" && (
            <button type="button" style={btn(false)} disabled={busy} onClick={() => setEdit(true)}>Правка</button>)}
          {(mineOrder || isOwner) && (
            <button type="button" style={{ ...btn(true, BAD) }} disabled={busy}
              aria-label={`удалить заказ ${order.name}`}
              onClick={() => act(() => dropOrder(order.id))}>Удалить</button>)}
          {!mineOrder && order.status === "open" && !myOffer && !replying && (
            <button type="button" style={btn(true, OK)} disabled={busy} onClick={() => setReplying(true)}>
              Откликнуться</button>)}
        </div>
        {replying && (
          <div style={form} aria-label="форма отклика">
            <div style={S.lbl}>ваше предложение — увидит только заказчик</div>
            <textarea aria-label="текст отклика" style={{ ...S.inp, minHeight: 56, margin: "var(--space-4) 0" }}
              placeholder="что предлагаете: как сделаете, за сколько, когда"
              value={reply} onChange={(e) => setReply(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <button type="button" style={btn(true, OK)} disabled={busy || !reply.trim()}
                onClick={() => act(() => addOffer(order.id, { text: reply.trim() }))
                  .then(() => { setReplying(false); setReply(""); })}>Отправить предложение</button>
              <button type="button" style={btn(false)} onClick={() => setReplying(false)}>Отмена</button>
            </div>
          </div>)}
      </>)}

      {/* Отклики: заказчику — все, откликнувшемуся — свой. Открыть отклик —
          открыть чат. */}
      {!!(order.offers || []).length && (
        <div style={{ marginTop: "var(--space-8)" }}>
          <div style={S.lbl}>{mineOrder ? "предложения" : "ваше предложение"}</div>
          {(order.offers || []).map((o) => (
            <div key={o.id}>
              {/* Подпись — с кем разговор: заказчику — исполнитель, исполнителю — заказчик. */}
              <button type="button" style={{ ...btn(openOffer === o.id), marginTop: "var(--space-4)", width: "100%",
                textAlign: "left" }}
                aria-label={`открыть отклик ${String(o.by) === String(me) ? nameOf(order.by) : nameOf(o.by)}`}
                onClick={() => setOpenOffer(openOffer === o.id ? null : o.id)}>
                <span style={{ fontWeight: 600 }}>{String(o.by) === String(me) ? "вы" : nameOf(o.by)}</span>
                <span style={{ color: C.muted, fontSize: "var(--fs-hint)" }}> · {o.text.length > 60 ? `${o.text.slice(0, 59)}…` : o.text}</span>
                {o.accepted ? <span style={{ color: OK, fontSize: "var(--fs-hint)" }}> · сделка</span>
                  : o.brief ? <span style={{ color: String(o.brief.by) === String(me) ? ACC : WARN, fontSize: "var(--fs-hint)" }}> · есть предложение</span> : null}
                {(o.chat || []).length ? <span style={{ color: C.muted, fontSize: "var(--fs-hint)" }}> · сообщений: {o.chat.length}</span> : null}
              </button>
              {openOffer === o.id && (
                <OfferView offer={o} customerId={order.by} api={offerApi(order.id, o.id)}
                  me={me} nameOf={nameOf} busy={busy} act={act} />)}
            </div>))}
        </div>)}
    </div>
  );
}

/* ─────── карточка услуги ─────── */

function ServiceCard({ s, me, nameOf, faceOf, onOpenPerson, busy, act, isOwner,
  picked = false, onOpenStorage, roles = [] }) {
  const [edit, setEdit] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [ask, setAsk] = useState({ text: "", procRole: "assignee", roleId: roles[0]?.id ?? "" });
  const [openReq, setOpenReq] = useState(null);
  const mineSvc = String(s.by) === String(me);
  const requests = s.requests || [];
  const myOpen = requests.find((r) => String(r.by) === String(me) && !r.accepted);
  // Статус считает сервер: график лежит у него, и он же знает часовой пояс.
  const statusId = faceOf?.(s.by)?.status || "ready";
  return (
    <div style={{ ...S.card, marginBottom: "var(--space-8)",
      borderColor: picked ? ACC : mineSvc ? `${alpha(ACC, "55")}` : C.line }}
      aria-label={`услуга ${s.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <PersonDot id={s.by} nameOf={nameOf} faceOf={faceOf} onOpen={onOpenPerson} />
        <span style={{ fontSize: "var(--fs-body)", fontWeight: 700, flex: 1 }}>{s.name}</span>
        <span style={{ fontSize: "var(--fs-hint)", color: C.muted }}>{mineSvc ? "ваша услуга" : nameOf(s.by)} · {when(s.at)}</span>
      </div>
      {edit ? (
        <ServiceForm initial={s} busy={busy} saveLabel="Сохранить"
          onSave={(f) => act(() => updateService(s.id, f)).then(() => setEdit(false))}
          onCancel={() => setEdit(false)} />
      ) : (<>
        {/* Заказчик должен видеть это до того, как оставит заказ: по такой
            услуге ему не придётся ждать ответа (владелец, 2026-09-20). */}
        {s.auto && (
          <div className="flex flex-wrap items-center gap-2" style={{ marginTop: "var(--space-4)" }}
            aria-label="принимает заказ автоматически">
            {/* Статус автора по графику — ПЕРЕД надписью (владелец,
                2026-09-20): принимает он автоматически только в рабочее
                время, и по статусу видно, идёт оно сейчас или нет. Цвет
                кружка и слов — цвет самого статуса. */}
            <Dot color={statusColor(statusId)} />
            <span style={{ fontSize: "var(--fs-hint)", color: statusColor(statusId) }}>
              {statusOf(statusId).name}</span>
            <Dot color={OK} />
            <span style={{ fontSize: "var(--fs-hint)", color: OK }}>Принимает заказ автоматически</span>
          </div>)}
        {(s.private || s.customer) && (
          <div className="flex flex-wrap items-center gap-2" style={{ marginTop: "var(--space-4)" }}>
            {s.private && <span style={{ fontSize: "var(--fs-hint)", color: C.muted }}>приватная</span>}
            {s.customer && (
              <span style={{ fontSize: "var(--fs-hint)", color: C.muted }}>
                заказчик: {nameOf(s.customer)}</span>)}
          </div>)}
        {s.text && <div style={{ fontSize: "var(--fs-hint)", marginTop: "var(--space-4)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{s.text}</div>}
        <div style={{ fontSize: "var(--fs-hint)", marginTop: "var(--space-4)", lineHeight: 1.6 }}>
          <div><b>берёт:</b> {rowsLine(s.takes) || "—"}</div>
          <div><b>выдаёт:</b> {rowsLine(s.gives) || "—"}</div>
          <div><b>выполняется за:</b> {durText(s)}</div>
        </div>
        {/* Услугу заказывают с карточки (владелец, 2026-09-26): дальше —
            тот же чат и то же «Договорились», что у отклика на заказ. */}
        {!mineSvc && !s.customer && !myOpen && !ordering && (
          <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-8)" }}>
            <button type="button" style={btn(true, OK)} disabled={busy} onClick={() => setOrdering(true)}>
              Заказать</button>
          </div>)}
        {ordering && (
          <div style={form} aria-label="форма заявки">
            <textarea aria-label="текст заявки" style={{ ...S.inp, minHeight: 56, marginBottom: "var(--space-4)" }}
              placeholder="что нужно сделать" value={ask.text}
              onChange={(e) => setAsk({ ...ask, text: e.target.value })} />
            <RoleFields procRole={ask.procRole} roleId={ask.roleId} roles={roles}
              onChange={(patch) => setAsk({ ...ask, ...patch })} />
            <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-8)" }}>
              <button type="button" style={btn(true, OK)} disabled={busy || !ask.text.trim()}
                onClick={() => act(() => addRequest(s.id, { text: ask.text.trim(), procRole: ask.procRole,
                  ...(ask.roleId ? { roleId: ask.roleId } : {}) }))
                  .then((r) => { if (r) { setOrdering(false); setAsk({ ...ask, text: "" }); } })}>
                Отправить заявку</button>
              <button type="button" style={btn(false)} onClick={() => setOrdering(false)}>Отмена</button>
            </div>
          </div>)}
        {(mineSvc || isOwner) && (
          <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-8)" }}>
            {/* Работа для другого делается в ЕГО хранилище (владелец,
                2026-09-21): туда и ведёт услуга. */}
            {mineSvc && s.storage && onOpenStorage && (
              <button type="button" style={btn(true, ACC)} disabled={busy}
                onClick={() => onOpenStorage(s.storage)}>Открыть у заказчика</button>)}
            {mineSvc && <button type="button" style={btn(false)} disabled={busy} onClick={() => setEdit(true)}>Правка</button>}
            <button type="button" style={{ ...btn(true, BAD) }} disabled={busy}
              aria-label={`удалить услугу ${s.name}`} onClick={() => act(() => dropService(s.id))}>Удалить</button>
          </div>)}
      </>)}

      {/* Заявки: автору услуги — все, заказавшему — свои. */}
      {!!requests.length && (
        <div style={{ marginTop: "var(--space-8)" }}>
          <div style={S.lbl}>{mineSvc ? "заявки" : "ваша заявка"}</div>
          {requests.map((r) => (
            <div key={r.id}>
              <button type="button" style={{ ...btn(openReq === r.id), marginTop: "var(--space-4)", width: "100%",
                textAlign: "left" }}
                aria-label={`открыть заявку ${String(r.by) === String(me) ? nameOf(s.by) : nameOf(r.by)}`}
                onClick={() => setOpenReq(openReq === r.id ? null : r.id)}>
                <span style={{ fontWeight: 600 }}>{String(r.by) === String(me) ? "вы" : nameOf(r.by)}</span>
                <span style={{ color: C.muted, fontSize: "var(--fs-hint)" }}> · {r.text.length > 60 ? `${r.text.slice(0, 59)}…` : r.text}</span>
                {r.accepted ? <span style={{ color: OK, fontSize: "var(--fs-hint)" }}> · сделка</span>
                  : r.brief ? <span style={{ color: String(r.brief.by) === String(me) ? ACC : WARN, fontSize: "var(--fs-hint)" }}> · есть предложение</span> : null}
                {(r.chat || []).length ? <span style={{ color: C.muted, fontSize: "var(--fs-hint)" }}> · сообщений: {r.chat.length}</span> : null}
              </button>
              {openReq === r.id && (
                <OfferView offer={r} customerId={r.by} executorId={s.by} api={requestApi(s.id, r.id)}
                  label="заявка" me={me} nameOf={nameOf} busy={busy} act={act} />)}
            </div>))}
        </div>)}
    </div>
  );
}

/* ─────── СОРТИРОВКА И ФИЛЬТРЫ (владелец, 2026-09-21) ───────

   Сортировка — выпадающим списком над списком, с направлением («по дате:
   сначала новые / сначала старые»). Фильтры — кнопкой, которая открывает
   модальное окно: статусы и ресурсы (у каждого — отметка и диапазон);
   применяются по «Применить». Счёт — в lib/marketSort.js. */
function SortFilterBar({ found, sort, onSort, flt, onFlt }) {
  const [open, setOpen] = useState(false);
  const n = activeCount(flt);
  return (
    <div data-strip="" aria-label="сортировка и фильтры"
      className="flex items-center gap-2"
      style={{ marginTop: "var(--space-8)", marginBottom: "var(--space-8)" }}>
      <select aria-label="сортировка" value={sort} onChange={(e) => onSort(e.target.value)}
        style={{ ...S.inp, flex: 1, minWidth: 0 }}>
        {SORTS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
      </select>
      <button type="button" aria-label="фильтры" style={{ ...btn(n > 0, OK), flex: "0 0 auto" }}
        onClick={() => setOpen(true)}>Фильтры{n ? ` · ${n}` : ""}</button>
      {open && (
        <FilterModal found={found} flt={flt} onClose={() => setOpen(false)}
          onApply={(f) => { onFlt(f); setOpen(false); }} />)}
    </div>);
}

/* Окно фильтров: правится черновик, список меняется по «Применить». */
function FilterModal({ found, flt, onApply, onClose }) {
  const [draft, setDraft] = useState(() => ({ ...flt, res: { ...(flt.res || {}) } }));
  const res = resourcesIn(found);
  const setRes = (name, patch) => setDraft((d) => ({ ...d,
    res: { ...d.res, [name]: { ...(d.res[name] || { min: "", max: "" }), ...patch } } }));
  const toggleRes = (name) => setDraft((d) => {
    if (d.res[name]) { const next = { ...d.res }; delete next[name]; return { ...d, res: next }; }
    return { ...d, res: { ...d.res, [name]: { min: "", max: "" } } };
  });
  const lbl = { fontSize: "var(--fs-hint)", cursor: "pointer" };
  return (
    <Modal title="Фильтры" onClose={onClose}>
      <div style={S.lbl}>статус</div>
      <label className="flex items-center gap-2" style={{ ...lbl, marginTop: "var(--space-4)" }}>
        <input type="checkbox" checked={!!draft.ready} aria-label="на рабочем месте"
          onChange={(e) => setDraft((d) => ({ ...d, ready: e.target.checked }))} style={{ accentColor: OK }} />
        на рабочем месте
      </label>
      <label className="flex items-center gap-2" style={{ ...lbl, marginTop: "var(--space-4)" }}>
        <input type="checkbox" checked={!!draft.auto} aria-label="принимает заказ автоматически"
          onChange={(e) => setDraft((d) => ({ ...d, auto: e.target.checked }))} style={{ accentColor: OK }} />
        принимает заказ автоматически
      </label>
      <div style={{ ...S.lbl, marginTop: "var(--space-12)" }}>ресурсы</div>
      {!res.length && <div style={{ ...hint, marginTop: "var(--space-4)" }}>В найденном ресурсов нет.</div>}
      <div aria-label="фильтр ресурсов" style={{ marginTop: "var(--space-4)", maxHeight: "45vh", overflowY: "auto" }}>
        {res.map((r) => {
          const on = !!draft.res[r.name];
          const v = draft.res[r.name] || { min: "", max: "" };
          return (
            <div key={r.name} style={{ borderTop: `1px solid ${C.line}`, padding: "var(--space-4) 0" }}>
              <label className="flex items-center gap-2" style={lbl}>
                <input type="checkbox" checked={on} aria-label={`ресурс ${r.name}`}
                  onChange={() => toggleRes(r.name)} style={{ flex: "0 0 auto", margin: 0, accentColor: OK }} />
                <span style={{ flex: 1 }}>{r.name}</span>
                <span style={{ color: C.muted }}>
                  {r.min == null ? "" : `${r.min}…${r.max}`}</span>
              </label>
              {on && (
                <div className="flex items-center gap-2" style={{ marginTop: "var(--space-4)" }}>
                  <span style={{ fontSize: "var(--fs-hint)", color: C.muted }}>от</span>
                  <input aria-label={`${r.name}: от`} inputMode="decimal" value={v.min}
                    style={{ ...S.inp, maxWidth: 90 }} onChange={(e) => setRes(r.name, { min: e.target.value })} />
                  <span style={{ fontSize: "var(--fs-hint)", color: C.muted }}>до</span>
                  <input aria-label={`${r.name}: до`} inputMode="decimal" value={v.max}
                    style={{ ...S.inp, maxWidth: 90 }} onChange={(e) => setRes(r.name, { max: e.target.value })} />
                </div>)}
            </div>);
        })}
      </div>
      <div className="flex gap-2" style={{ marginTop: "var(--space-12)" }}>
        <button type="button" style={btn(true, OK)} onClick={() => onApply(draft)}>Применить</button>
        <button type="button" style={btn(false)} onClick={() => onApply(emptyFilter())}>Сбросить</button>
        <button type="button" style={btn(false)} onClick={onClose}>Отмена</button>
      </div>
    </Modal>);
}

/* ─────── вкладка ─────── */

export default function MarketPanel({ me, traits = [], draft = null, onDraftDone, roles = [],
  onOpenStorage }) {
  const [view, setView] = useState(null);
  const [card, setCard] = useState(null);
  const [sub, setSub] = useState("orders");
  /* Что ищут и что нашли: выбранное встаёт первым, под ним — ближайшее
     по смыслу (владелец, 2026-09-20). */
  const [findOrder, setFindOrder] = useState("");
  const [pickOrder, setPickOrder] = useState(null);
  const [findService, setFindService] = useState("");
  const [pickService, setPickService] = useState(null);
  const [adding, setAdding] = useState(null);   // null | {kind, initial}
  /* Сортировка — одна на обе вкладки; фильтры — у каждой свои: настроенные
     для услуг не включаются в заказах, и наоборот (владелец, 2026-09-21). */
  const [sort, setSort] = useState("");
  const [flts, setFlts] = useState(() => ({ orders: emptyFilter(), services: emptyFilter() }));
  const flt = flts[sub] || emptyFilter();
  const setFlt = (v) => setFlts((p) => ({ ...p, [sub]: v }));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const solo = Boolean(me?.solo);
  const known = Boolean(me?.known && !solo);

  const load = useCallback(async () => {
    if (!known) return;
    try { setView(await getMarket()); } catch (e) { setMsg(e.message); }
  }, [known]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!known) return undefined;
    const tick = () => { if (typeof document === "undefined" || document.visibilityState !== "hidden") load(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [known, load]);

  /* Из настроек функции: «Сделать заказ» / «Сделать услугой» приводят сюда
     с заполненной формой — слова функции уже в ней, их можно поправить. */
  useEffect(() => {
    if (!draft) return;
    const initial = draft.kind === "service" ? serviceFromFunc(draft.func, { traits })
      : orderFromFunc(draft.func, { traits });
    setSub(draft.kind === "service" ? "services" : "orders");
    setAdding({ kind: draft.kind, initial });
    onDraftDone?.();
  }, [draft]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* Одна обёртка на все действия: занято → сделать → перечитать → сказать. */
  const act = async (job) => {
    setBusy(true); setMsg("");
    try { const out = await job(); await load(); return out; }
    catch (e) { setMsg(e.message); return null; }
    finally { setBusy(false); }
  };

  const people = view?.people || {};
  const nameOf = (id) => people[String(id)] || (String(id) === String(me?.id) ? "вы" : `участник ${id}`);
  /* Лицо автора — от сервера: он же решает, знаком ли автор смотрящему.
     Нет записи — незнакомец, и вместо лица знак приложения. */
  const faces = view?.faces || {};
  const faceOf = (id) => faces[String(id)] || { avatar: "", anon: true };
  const orders = view?.orders || [];
  const services = view?.services || [];

  if (!known) {
    return (
      <div style={{ ...S.card, marginBottom: "var(--space-8)" }}>
        <div style={S.lbl}>рынок услуг</div>
        <div style={{ ...hint, marginTop: "var(--space-4)" }}>
          {solo ? "Рынок услуг живёт на сервере: заказы и услуги видят все зарегистрированные. Откройте приложение через Telegram."
            : "Рынок открыт зарегистрированным: подпишите договор роли — и заказы с услугами появятся здесь."}
        </div>
      </div>);
  }

  return (
    <div>
      <div className="flex gap-2" style={{ marginBottom: "var(--space-8)" }} role="tablist" aria-label="маркет">
        {[["orders", `Заказы${orders.length ? ` · ${orders.length}` : ""}`],
          ["services", `Услуги${services.length ? ` · ${services.length}` : ""}`]].map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={sub === k} style={btn(sub === k)}
            onClick={() => { setSub(k); setAdding(null); }}>{t}</button>))}
      </div>

      {!view && <div style={{ ...hint, marginBottom: "var(--space-8)" }}>{msg || "Загружаю…"}</div>}

      {sub === "orders" && view && (<>
        {/* Поиск — СПРАВА от «+ заказ» (владелец, 2026-09-20). */}
        <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: "var(--space-8)" }}>
          {adding?.kind !== "order" && (
            <button type="button" style={btn(true, OK)} disabled={busy}
              onClick={() => setAdding({ kind: "order", initial: null })}>+ заказ</button>)}
          <SearchBox items={orders} label="поиск заказов" value={findOrder}
            onChange={(v) => { setFindOrder(v); if (!v.trim()) setPickOrder(null); }}
            onPick={(item) => { setPickOrder(item.id); setFindOrder(item.name); }} />
        </div>
        <SortFilterBar found={orderedBy(pickOrder, orders.slice().reverse())}
          sort={sort} onSort={setSort} flt={flt} onFlt={setFlt} />
        {adding?.kind === "order" && (
          <OrderForm initial={adding.initial} services={services} orders={orders} roles={roles} busy={busy}
            onSave={(f) => act(() => addOrder(f)).then((r) => { if (r) setAdding(null); })}
            onCancel={() => setAdding(null)} />)}
        {!orders.length && <div style={hint}>Заказов пока нет.</div>}
        {sortItems(filterItems(orderedBy(pickOrder, orders.slice().reverse()), flt, { faceOf, services }),
          sort, { faceOf, picked: pickedRes(flt) }).map((o) => (
          <OrderCard key={o.id} order={o} me={view.me} nameOf={nameOf} faceOf={faceOf} roles={roles}
            onOpenPerson={setCard} services={services} picked={o.id === pickOrder}
            busy={busy} act={act} isOwner={Boolean(me?.isOwner)} />))}
      </>)}

      {sub === "services" && view && (<>
        <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: "var(--space-8)" }}>
          {adding?.kind !== "service" && (
            <button type="button" style={btn(true, OK)} disabled={busy}
              onClick={() => setAdding({ kind: "service", initial: null })}>+ услуга</button>)}
          <SearchBox items={services} label="поиск услуг" value={findService}
            onChange={(v) => { setFindService(v); if (!v.trim()) setPickService(null); }}
            onPick={(item) => { setPickService(item.id); setFindService(item.name); }} />
        </div>
        <SortFilterBar found={orderedBy(pickService, services.slice().reverse())}
          sort={sort} onSort={setSort} flt={flt} onFlt={setFlt} />
        {adding?.kind === "service" && (
          <ServiceForm initial={adding.initial} services={services} busy={busy}
            onSave={(f) => act(() => addService(f)).then((r) => { if (r) setAdding(null); })}
            onCancel={() => setAdding(null)} />)}
        {!services.length && <div style={hint}>Услуг пока нет.</div>}
        {sortItems(filterItems(orderedBy(pickService, services.slice().reverse()), flt, { faceOf, services }),
          sort, { faceOf, picked: pickedRes(flt) }).map((s) => (
          <ServiceCard key={s.id} s={s} me={view.me} nameOf={nameOf} faceOf={faceOf} onOpenStorage={onOpenStorage}
            roles={roles}
            onOpenPerson={setCard} busy={busy} act={act} picked={s.id === pickService}
            isOwner={Boolean(me?.isOwner)} />))}
      </>)}

      {card != null && (
        <PersonModal id={card} me={me} onClose={() => setCard(null)} />)}

      {msg && view && <div role="status" style={{ fontSize: "var(--fs-hint)", color: WARN, marginTop: "var(--space-8)" }}>{msg}</div>}
    </div>
  );
}
