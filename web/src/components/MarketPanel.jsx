import React, { useCallback, useEffect, useRef, useState } from "react";
import { ACC, Avatar, BAD, C, OK, S, WARN, btn } from "./ui.jsx";
import { statusColor } from "./ProfilePanel.jsx";
import { statusOf } from "../lib/workers.js";
import { nameHints, nearest, search } from "../lib/semantic.js";
import { SORTS, activeCount, emptyFilter, filterItems, pickedRes, resourcesIn, sortItems }
  from "../lib/marketSort.js";
import {
  acceptOffer, addDelivery, addOffer, addOrder, addService, dropOrder, dropService, getMarket,
  getMarketPerson, putBrief, sendChat, updateOrder, updateService,
} from "../market.js";
import {
  daysText, emptyRow, matchServices, orderFromFunc, rowsLine, rowText, serviceFromFunc,
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
const hint = { fontSize: 11.5, color: C.muted, lineHeight: 1.6 };
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
        <button type="button" style={{ ...btn(false), marginTop: "var(--space-4)", fontSize: 11 }}
          onClick={() => onChange([...rows, emptyRow()])}>+ ресурс</button>)}
    </div>
  );
}

const cleanRows = (rows) => rows.map((r) => ({ name: String(r.name || "").trim(),
  qty: r.qty === "" || r.qty == null ? null : Number(String(r.qty).replace(",", ".")) }))
  .filter((r) => r.name);

/* ─────── форма заказа: слова, цена, ресурсы, подходящие услуги ─────── */

function OrderForm({ initial, services, orders = [], busy, onSave, onCancel,
  saveLabel = "Оставить заказ" }) {
  const [f, setF] = useState({ name: "", text: "", price: "",
    serviceId: null, funcId: null, ...initial,
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
      <div className="flex gap-2" style={{ alignItems: "center", marginBottom: "var(--space-4)" }}>
        <span style={{ fontSize: 11.5, color: C.muted }}>стоимость</span>
        <input aria-label="стоимость заказа" inputMode="decimal"
          style={{ ...S.inp, maxWidth: 140 }} placeholder="сколько платите"
          value={f.price ?? ""} onChange={(e) => up({ price: e.target.value })} />
      </div>
      <div style={{ ...S.lbl, marginTop: "var(--space-4)" }}>другие предоставляемые ресурсы</div>
      <Rows rows={f.resources} onChange={(rows) => up({ resources: rows })} label="ресурс заказа" />

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
              background: on ? `${OK}22` : C.panel, border: `1px solid ${on ? OK : C.line}`,
              borderRadius: "var(--radius-sm)", padding: "var(--space-4) var(--space-8)", color: C.text, cursor: "pointer" }}>
            <span style={{ width: 16, color: OK, fontWeight: 700 }}>{on ? "✓" : ""}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.name}</div>
              <div style={{ fontSize: 11, color: C.muted }}>
                {[s.gives?.length ? `выдаёт: ${rowsLine(s.gives)}` : "", daysText(s.days)]
                  .filter(Boolean).join(" · ")}</div>
            </span>
          </button>);
      })}

      <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-8)" }}>
        <button type="button" style={btn(true, OK)} disabled={busy || !f.name.trim()}
          onClick={() => onSave({ name: f.name.trim(), text: f.text, price: f.price,
            resources: cleanRows(f.resources), serviceId: f.serviceId, funcId: f.funcId })}>
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
    ...initial, days: initial?.days ?? "", auto: initial?.auto === true });
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
      <div className="flex gap-2" style={{ alignItems: "center", marginTop: "var(--space-8)" }}>
        <span style={{ fontSize: 11.5, color: C.muted }}>за какое время выполняется, дней</span>
        <input aria-label="срок услуги" inputMode="decimal" style={{ ...S.inp, maxWidth: 90 }}
          value={f.days ?? ""} onChange={(e) => up({ days: e.target.value })} />
      </div>
      {/* Автоматический приём (владелец, 2026-09-20): заказ по этой
          услуге не ждёт переписки — отклик создаётся сам и сам
          принимается, и задача сразу падает в бэклог. Вне рабочего
          времени — обычный путь: обещать за себя круглосуточно нельзя. */}
      <label className="flex items-center gap-2"
        style={{ marginTop: "var(--space-8)", fontSize: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={f.auto} aria-label="принять автоматически в рабочее время"
          onChange={(e) => up({ auto: e.target.checked })} style={{ accentColor: OK }} />
        Принять автоматически в рабочее время
      </label>
      <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-8)" }}>
        <button type="button" style={btn(true, OK)} disabled={busy || !f.name.trim()}
          onClick={() => onSave({ name: f.name.trim(), text: f.text, takes: cleanRows(f.takes),
            gives: cleanRows(f.gives), days: f.days === "" ? null : f.days, funcId: f.funcId,
            auto: f.auto })}>
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
        <span style={{ fontSize: 11.5, color: C.muted }}>ожидаемое время выполнения, дней</span>
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

/* ─────── отклик = чат + бриф + сделка ─────── */

function OfferView({ order, offer, me, nameOf, busy, act }) {
  const [text, setText] = useState("");
  const [briefOpen, setBriefOpen] = useState(false);   // «Есть предложение» раскрыто
  const [editing, setEditing] = useState(false);
  const [dlv, setDlv] = useState({ name: "", text: "" });
  const fileRef = useRef(null);
  const customer = String(order.by) === String(me);
  const other = customer ? offer.by : order.by;
  const brief = offer.brief;
  const theirs = brief && String(brief.by) !== String(me);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    act(() => sendChat(order.id, offer.id, t)).then(() => setText(""));
  };
  const upload = async (file) => {
    if (!file) return;
    const saved = await act(() => putReportFile(file, { kind: "market" }));
    if (saved) await act(() => addDelivery(order.id, offer.id, { name: dlv.name || file.name, file: saved }));
    if (fileRef.current) fileRef.current.value = "";
  };
  return (
    <div style={form} aria-label={`отклик ${nameOf(offer.by)}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span style={S.lbl}>{customer ? "исполнитель" : "заказчик"}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{nameOf(other)}</span>
        <span style={{ fontSize: 10.5, color: C.muted }}>{when(offer.at)}</span>
      </div>
      <div style={{ fontSize: 12, marginTop: "var(--space-4)", lineHeight: 1.5 }}>{offer.text}</div>

      {/* ─── чат ─── */}
      <div style={{ ...S.lbl, marginTop: "var(--space-8)" }}>чат</div>
      <div role="log" aria-label="чат отклика" style={{ maxHeight: 220, overflowY: "auto",
        border: `1px solid ${C.line}`, borderRadius: "var(--radius-sm)", padding: "var(--space-4)", marginTop: "var(--space-4)", background: C.ink }}>
        {!(offer.chat || []).length && <div style={hint}>Пока ничего не сказано.</div>}
        {(offer.chat || []).map((c) => {
          const own = String(c.by) === String(me);
          return (
            <div key={c.id} style={{ marginBottom: "var(--space-4)", textAlign: own ? "right" : "left" }}>
              <span style={{ display: "inline-block", maxWidth: "85%", textAlign: "left",
                background: own ? `${ACC}22` : C.panel2, borderRadius: "var(--radius-sm)", padding: "var(--space-4) var(--space-8)",
                fontSize: 12, lineHeight: 1.45 }}>
                {c.text}
                <div style={{ fontSize: 9.5, color: C.muted }}>{own ? "вы" : nameOf(c.by)} · {when(c.at)}</div>
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
              onSave={(b) => act(() => putBrief(order.id, offer.id, b)).then(() => { setEditing(false); setBriefOpen(true); })}
              onCancel={() => setEditing(false)} />)}
          {brief && briefOpen && !editing && (
            <div style={{ ...form, borderColor: theirs ? `${WARN}66` : `${ACC}66` }} aria-label="условия">
              <div style={hint}>
                {theirs ? `Предложение от ${nameOf(brief.by)}` : "Ваше предложение"} · версия {brief.rev} · {when(brief.at)}
              </div>
              <div style={{ fontSize: 12, marginTop: "var(--space-4)", lineHeight: 1.6 }}>
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
                    onClick={() => act(() => acceptOffer(order.id, offer.id))}>Принять предложение</button>)}
                {!theirs && <span style={hint}>Принять должна другая сторона.</span>}
              </div>
            </div>)}
        </div>)}

      {/* ─── сделка ─── */}
      {offer.accepted && (
        <div style={{ ...form, borderColor: `${OK}66` }} aria-label="сделка">
          <div style={{ fontSize: 12, color: OK, fontWeight: 600 }}>Договорились · {when(offer.acceptedAt)}</div>
          <div style={{ fontSize: 12, marginTop: "var(--space-4)", lineHeight: 1.6 }}>
            <div><b>заказчик отдаёт:</b> {rowsLine(brief?.gives) || "—"}</div>
            <div><b>исполнитель выдаёт:</b> {rowText(brief?.gets) || "—"}</div>
            <div><b>ожидаемое время:</b> {daysText(brief?.days)}</div>
          </div>
          <div style={{ ...hint, marginTop: "var(--space-4)" }}>
            {customer
              ? "Задача поставлена исполнителю: она у него на «Задачах», у вас — на «Проверке». Загрузите то, что отдаёте."
              : "Задача у вас на «Задачах» (или на «Проверке» — смотря что открывают ваши роли). Что отдал заказчик — ниже."}
          </div>
          <div style={{ ...S.lbl, marginTop: "var(--space-8)" }}>ресурсы от заказчика</div>
          {!(offer.deliveries || []).length && <div style={hint}>Пока ничего не загружено.</div>}
          {(offer.deliveries || []).map((d) => (
            <div key={d.id} style={{ fontSize: 12, marginTop: "var(--space-4)" }}>
              {d.name || d.file?.name || "ресурс"}
              {d.text ? <span style={{ color: C.muted }}> — {d.text}</span> : null}
              {d.file && (
                <a href={reportSrc(d.file)} target="_blank" rel="noreferrer"
                  style={{ color: ACC, marginLeft: "var(--space-4)" }}>📎 {d.file.name}</a>)}
              <span style={{ fontSize: 10, color: C.muted }}> · {when(d.at)}</span>
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
                  onClick={() => act(() => addDelivery(order.id, offer.id, dlv)).then(() => setDlv({ name: "", text: "" }))}>
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
                fontSize: 12, cursor: "pointer" }}>
              <div style={{ fontWeight: 600 }}>{item.name}</div>
              {item.text && (
                <div style={{ fontSize: 11, color: C.muted }}>
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
                fontSize: 12, cursor: "pointer" }}>{h.name}</button>))}
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
  picked = false }) {
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
      borderColor: picked ? ACC : mineOrder ? `${ACC}55` : C.line }}
      aria-label={`заказ ${order.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        {/* Кружок с лицом автора — ПЕРЕД названием (владелец,
            2026-09-20). Нажатие открывает его страницу. */}
        <PersonDot id={order.by} nameOf={nameOf} faceOf={faceOf} onOpen={onOpenPerson} />
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{order.name}</span>
        <span style={{ fontSize: 10.5, color: order.status === "open" ? OK : WARN }}>{status}</span>
      </div>
      <div style={{ fontSize: 11, color: C.muted }}>
        {mineOrder ? "ваш заказ" : nameOf(order.by)} · {when(order.at)}
        {order.offerCount ? ` · откликов: ${order.offerCount}` : ""}
      </div>
      {edit ? (
        <OrderForm initial={order} services={services} busy={busy} saveLabel="Сохранить"
          onSave={(f) => act(() => updateOrder(order.id, f)).then(() => setEdit(false))}
          onCancel={() => setEdit(false)} />
      ) : (<>
        {order.text && <div style={{ fontSize: 12, marginTop: "var(--space-4)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{order.text}</div>}
        <div style={{ fontSize: 12, marginTop: "var(--space-4)", lineHeight: 1.6 }}>
          <div><b>стоимость:</b> {order.price != null ? order.price : "не названа"}</div>
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
                <span style={{ color: C.muted, fontSize: 11 }}> · {o.text.length > 60 ? `${o.text.slice(0, 59)}…` : o.text}</span>
                {o.accepted ? <span style={{ color: OK, fontSize: 11 }}> · сделка</span>
                  : o.brief ? <span style={{ color: String(o.brief.by) === String(me) ? ACC : WARN, fontSize: 11 }}> · есть предложение</span> : null}
                {(o.chat || []).length ? <span style={{ color: C.muted, fontSize: 11 }}> · сообщений: {o.chat.length}</span> : null}
              </button>
              {openOffer === o.id && (
                <OfferView order={order} offer={o} me={me} nameOf={nameOf} busy={busy} act={act} />)}
            </div>))}
        </div>)}
    </div>
  );
}

/* ─────── карточка услуги ─────── */

function ServiceCard({ s, me, nameOf, faceOf, onOpenPerson, busy, act, isOwner,
  picked = false }) {
  const [edit, setEdit] = useState(false);
  const mineSvc = String(s.by) === String(me);
  // Статус считает сервер: график лежит у него, и он же знает часовой пояс.
  const statusId = faceOf?.(s.by)?.status || "ready";
  return (
    <div style={{ ...S.card, marginBottom: "var(--space-8)",
      borderColor: picked ? ACC : mineSvc ? `${ACC}55` : C.line }}
      aria-label={`услуга ${s.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <PersonDot id={s.by} nameOf={nameOf} faceOf={faceOf} onOpen={onOpenPerson} />
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{s.name}</span>
        <span style={{ fontSize: 10.5, color: C.muted }}>{mineSvc ? "ваша услуга" : nameOf(s.by)} · {when(s.at)}</span>
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
            <span style={{ fontSize: 11.5, color: statusColor(statusId) }}>
              {statusOf(statusId).name}</span>
            <Dot color={OK} />
            <span style={{ fontSize: 11.5, color: OK }}>Принимает заказ автоматически</span>
          </div>)}
        {s.text && <div style={{ fontSize: 12, marginTop: "var(--space-4)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{s.text}</div>}
        <div style={{ fontSize: 12, marginTop: "var(--space-4)", lineHeight: 1.6 }}>
          <div><b>берёт:</b> {rowsLine(s.takes) || "—"}</div>
          <div><b>выдаёт:</b> {rowsLine(s.gives) || "—"}</div>
          <div><b>выполняется за:</b> {daysText(s.days)}</div>
        </div>
        {(mineSvc || isOwner) && (
          <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-8)" }}>
            {mineSvc && <button type="button" style={btn(false)} disabled={busy} onClick={() => setEdit(true)}>Правка</button>}
            <button type="button" style={{ ...btn(true, BAD) }} disabled={busy}
              aria-label={`удалить услугу ${s.name}`} onClick={() => act(() => dropService(s.id))}>Удалить</button>
          </div>)}
      </>)}
    </div>
  );
}

/* ─────── ПОЛОСА ПОД ПОИСКОМ: СОРТИРОВКА И ФИЛЬТРЫ (владелец, 2026-09-21) ───────

   «Под поиском полоска, под которой будут кнопки сортировки и
   фильтрации». Сортировка — одна из четырёх, нажатие по той же снимает
   её. Фильтры — два статуса и ресурсы: список ресурсов — из всего, что
   найдено в этом поиске, у каждого чекбокс и диапазон. Счёт — в
   lib/marketSort.js. */
function SortFilterBar({ found, sort, onSort, flt, onFlt }) {
  const [resOpen, setResOpen] = useState(false);
  const res = resourcesIn(found);
  const picked = pickedRes(flt);
  const setRes = (name, patch) => onFlt({ ...flt, res: { ...flt.res, [name]: { ...(flt.res[name] || { min: "", max: "" }), ...patch } } });
  const toggleRes = (name) => {
    if (flt.res[name]) { const next = { ...flt.res }; delete next[name]; onFlt({ ...flt, res: next }); }
    else setRes(name, { min: "", max: "" });
  };
  const n = activeCount(flt);
  return (
    <div data-strip="" aria-label="сортировка и фильтры"
      style={{ borderTop: `1px solid ${C.line}`, marginTop: "var(--space-8)",
        paddingTop: "var(--space-8)", marginBottom: "var(--space-8)" }}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="сортировка">
        {SORTS.map(([k, t]) => (
          <button key={k} type="button" aria-pressed={sort === k}
            style={{ ...btn(sort === k, ACC), fontSize: 11.5 }}
            onClick={() => onSort(sort === k ? "" : k)}>{t}</button>))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="фильтры"
        style={{ marginTop: "var(--space-4)" }}>
        <button type="button" aria-pressed={flt.ready} style={{ ...btn(flt.ready, OK), fontSize: 11.5 }}
          onClick={() => onFlt({ ...flt, ready: !flt.ready })}>на рабочем месте</button>
        <button type="button" aria-pressed={flt.auto} style={{ ...btn(flt.auto, OK), fontSize: 11.5 }}
          onClick={() => onFlt({ ...flt, auto: !flt.auto })}>принимает заказ автоматически</button>
        <button type="button" aria-expanded={resOpen} aria-label="ресурсы"
          style={{ ...btn(picked.length > 0 || resOpen, WARN), fontSize: 11.5 }}
          onClick={() => setResOpen((v) => !v)}>
          ресурсы{picked.length ? ` · ${picked.length}` : ""}</button>
        {n > 0 && (
          <button type="button" style={{ ...btn(false), fontSize: 11.5 }} aria-label="снять фильтры"
            onClick={() => onFlt(emptyFilter())}>снять</button>)}
      </div>
      {resOpen && (
        <div aria-label="фильтр ресурсов" style={{ marginTop: "var(--space-8)", maxHeight: 220, overflowY: "auto" }}>
          {!res.length && <div style={hint}>В найденном ресурсов нет.</div>}
          {res.map((r) => {
            const on = !!flt.res[r.name];
            const cur = flt.res[r.name] || { min: "", max: "" };
            return (
              <div key={r.name} className="flex items-center gap-2"
                style={{ padding: "var(--space-4) 0", borderBottom: `1px solid ${C.lineSoft}` }}>
                <input type="checkbox" checked={on} aria-label={`ресурс ${r.name}`}
                  onChange={() => toggleRes(r.name)} style={{ flex: "0 0 auto", margin: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.name}
                  {r.min != null && (
                    <span style={{ color: C.muted, fontSize: 10.5 }}>
                      {" "}· {r.min === r.max ? r.max : `${r.min} … ${r.max}`}</span>)}
                </span>
                <input inputMode="decimal" aria-label={`${r.name}: от`} placeholder="от"
                  disabled={!on} value={cur.min} onChange={(e) => setRes(r.name, { min: e.target.value })}
                  style={{ ...S.inp, width: 64, flex: "0 0 64px", padding: "var(--space-4) var(--space-8)", fontSize: 12 }} />
                <input inputMode="decimal" aria-label={`${r.name}: до`} placeholder="до"
                  disabled={!on} value={cur.max} onChange={(e) => setRes(r.name, { max: e.target.value })}
                  style={{ ...S.inp, width: 64, flex: "0 0 64px", padding: "var(--space-4) var(--space-8)", fontSize: 12 }} />
              </div>);
          })}
        </div>)}
    </div>);
}

/* ─────── вкладка ─────── */

export default function MarketPanel({ me, traits = [], draft = null, onDraftDone }) {
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
  /* Сортировка и фильтры — одни на обе вкладки (владелец, 2026-09-21). */
  const [sort, setSort] = useState("");
  const [flt, setFlt] = useState(emptyFilter);
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
      <div className="flex gap-2" style={{ marginBottom: "var(--space-8)" }} role="tablist" aria-label="рынок услуг">
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
          <OrderForm initial={adding.initial} services={services} orders={orders} busy={busy}
            onSave={(f) => act(() => addOrder(f)).then((r) => { if (r) setAdding(null); })}
            onCancel={() => setAdding(null)} />)}
        {!orders.length && <div style={hint}>Заказов пока нет.</div>}
        {sortItems(filterItems(orderedBy(pickOrder, orders.slice().reverse()), flt, { faceOf, services }),
          sort, { faceOf, picked: pickedRes(flt) }).map((o) => (
          <OrderCard key={o.id} order={o} me={view.me} nameOf={nameOf} faceOf={faceOf}
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
          <ServiceCard key={s.id} s={s} me={view.me} nameOf={nameOf} faceOf={faceOf}
            onOpenPerson={setCard} busy={busy} act={act} picked={s.id === pickService}
            isOwner={Boolean(me?.isOwner)} />))}
      </>)}

      {card != null && (
        <PersonModal id={card} me={me} onClose={() => setCard(null)} />)}

      {msg && view && <div role="status" style={{ fontSize: 12, color: WARN, marginTop: "var(--space-8)" }}>{msg}</div>}
    </div>
  );
}
