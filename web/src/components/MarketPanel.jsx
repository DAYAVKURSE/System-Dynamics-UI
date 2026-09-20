import React, { useCallback, useEffect, useRef, useState } from "react";
import { ACC, Avatar, BAD, C, OK, S, WARN, btn } from "./ui.jsx";
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
const form = { background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8,
  padding: 10, marginTop: 8 };
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
        <div key={i} className="flex gap-2" style={{ alignItems: "center", marginTop: 4 }}>
          <input aria-label={`${label}: что`} style={{ ...S.inp, flex: "3 1 120px" }}
            placeholder="что" value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
          <input aria-label={`${label}: сколько`} inputMode="decimal"
            style={{ ...S.inp, flex: "1 1 60px", maxWidth: 90 }} placeholder="сколько"
            value={r.qty ?? ""} onChange={(e) => set(i, { qty: e.target.value })} />
          {!single && (
            <button type="button" style={{ ...btn(false), padding: "4px 8px" }}
              aria-label={`${label}: убрать строку`} onClick={() => drop(i)}>✕</button>)}
        </div>))}
      {!single && (
        <button type="button" style={{ ...btn(false), marginTop: 6, fontSize: 11 }}
          onClick={() => onChange([...rows, emptyRow()])}>+ ресурс</button>)}
    </div>
  );
}

const cleanRows = (rows) => rows.map((r) => ({ name: String(r.name || "").trim(),
  qty: r.qty === "" || r.qty == null ? null : Number(String(r.qty).replace(",", ".")) }))
  .filter((r) => r.name);

/* ─────── форма заказа: слова, цена, ресурсы, подходящие услуги ─────── */

function OrderForm({ initial, services, busy, onSave, onCancel, saveLabel = "Оставить заказ" }) {
  const [f, setF] = useState({ name: "", text: "", price: "", resources: [emptyRow()],
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
      <input aria-label="название заказа" style={{ ...S.inp, margin: "6px 0" }} placeholder="название"
        value={f.name} onChange={(e) => up({ name: e.target.value })} />
      <textarea aria-label="содержание заказа" style={{ ...S.inp, minHeight: 64, marginBottom: 6 }}
        placeholder="содержание: что нужно сделать" value={f.text}
        onChange={(e) => up({ text: e.target.value })} />
      <div className="flex gap-2" style={{ alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 11.5, color: C.muted }}>стоимость</span>
        <input aria-label="стоимость заказа" inputMode="decimal"
          style={{ ...S.inp, maxWidth: 140 }} placeholder="сколько платите"
          value={f.price ?? ""} onChange={(e) => up({ price: e.target.value })} />
      </div>
      <div style={{ ...S.lbl, marginTop: 6 }}>другие предоставляемые ресурсы</div>
      <Rows rows={f.resources} onChange={(rows) => up({ resources: rows })} label="ресурс заказа" />

      <div style={{ ...S.lbl, marginTop: 10 }}>подходящие услуги</div>
      {!services.length && <div style={hint}>Услуг пока никто не выложил.</div>}
      {!!services.length && !fit.length && (
        <div style={hint}>По словам заказа ничего не подошло — вот все услуги.</div>)}
      {shown.map((s) => {
        const on = f.serviceId === s.id;
        return (
          <button key={s.id} type="button" role="checkbox" aria-checked={on}
            aria-label={`услуга ${s.name}`}
            onClick={() => up({ serviceId: on ? null : s.id })}
            className="flex gap-2" style={{ width: "100%", textAlign: "left", marginTop: 4,
              background: on ? `${OK}22` : C.panel, border: `1px solid ${on ? OK : C.line}`,
              borderRadius: 6, padding: "6px 8px", color: C.text, cursor: "pointer" }}>
            <span style={{ width: 16, color: OK, fontWeight: 700 }}>{on ? "✓" : ""}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.name}</div>
              <div style={{ fontSize: 11, color: C.muted }}>
                {[s.gives?.length ? `выдаёт: ${rowsLine(s.gives)}` : "", daysText(s.days)]
                  .filter(Boolean).join(" · ")}</div>
            </span>
          </button>);
      })}

      <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
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

function ServiceForm({ initial, busy, onSave, onCancel, saveLabel = "Выложить услугу" }) {
  const [f, setF] = useState({ name: "", text: "", takes: [], gives: [], days: "", funcId: null,
    ...initial, days: initial?.days ?? "" });
  const up = (patch) => setF((x) => ({ ...x, ...patch }));
  return (
    <div style={form} aria-label="форма услуги">
      <div style={S.lbl}>услуга</div>
      <input aria-label="название услуги" style={{ ...S.inp, margin: "6px 0" }} placeholder="название"
        value={f.name} onChange={(e) => up({ name: e.target.value })} />
      <textarea aria-label="описание услуги" style={{ ...S.inp, minHeight: 64, marginBottom: 6 }}
        placeholder="описание: что делаете" value={f.text} onChange={(e) => up({ text: e.target.value })} />
      <div style={{ ...S.lbl, marginTop: 6 }}>какие ресурсы берёт</div>
      <Rows rows={f.takes} onChange={(rows) => up({ takes: rows })} label="берёт" />
      <div style={{ ...S.lbl, marginTop: 8 }}>какие выдаёт</div>
      <Rows rows={f.gives} onChange={(rows) => up({ gives: rows })} label="выдаёт" />
      <div className="flex gap-2" style={{ alignItems: "center", marginTop: 8 }}>
        <span style={{ fontSize: 11.5, color: C.muted }}>за какое время выполняется, дней</span>
        <input aria-label="срок услуги" inputMode="decimal" style={{ ...S.inp, maxWidth: 90 }}
          value={f.days ?? ""} onChange={(e) => up({ days: e.target.value })} />
      </div>
      <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
        <button type="button" style={btn(true, OK)} disabled={busy || !f.name.trim()}
          onClick={() => onSave({ name: f.name.trim(), text: f.text, takes: cleanRows(f.takes),
            gives: cleanRows(f.gives), days: f.days === "" ? null : f.days, funcId: f.funcId })}>
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
      <div style={{ ...S.lbl, marginTop: 6, color: C.text }}>заказчик отдаёт</div>
      <Rows rows={gives} onChange={setGives} label="отдаёт" />
      <div style={{ ...S.lbl, marginTop: 8, color: C.text }}>исполнитель выдаёт</div>
      <Rows rows={gets} onChange={setGets} label="получает" single />
      <div className="flex gap-2" style={{ alignItems: "center", marginTop: 8 }}>
        <span style={{ fontSize: 11.5, color: C.muted }}>ожидаемое время выполнения, дней</span>
        <input aria-label="срок брифа" inputMode="decimal" style={{ ...S.inp, maxWidth: 90 }}
          value={days} onChange={(e) => setDays(e.target.value)} />
      </div>
      <textarea aria-label="примечание брифа" style={{ ...S.inp, minHeight: 44, marginTop: 6 }}
        placeholder="примечание (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
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
      <div style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>{offer.text}</div>

      {/* ─── чат ─── */}
      <div style={{ ...S.lbl, marginTop: 8 }}>чат</div>
      <div role="log" aria-label="чат отклика" style={{ maxHeight: 220, overflowY: "auto",
        border: `1px solid ${C.line}`, borderRadius: 6, padding: 6, marginTop: 4, background: C.ink }}>
        {!(offer.chat || []).length && <div style={hint}>Пока ничего не сказано.</div>}
        {(offer.chat || []).map((c) => {
          const own = String(c.by) === String(me);
          return (
            <div key={c.id} style={{ marginBottom: 4, textAlign: own ? "right" : "left" }}>
              <span style={{ display: "inline-block", maxWidth: "85%", textAlign: "left",
                background: own ? `${ACC}22` : C.panel2, borderRadius: 6, padding: "4px 7px",
                fontSize: 12, lineHeight: 1.45 }}>
                {c.text}
                <div style={{ fontSize: 9.5, color: C.muted }}>{own ? "вы" : nameOf(c.by)} · {when(c.at)}</div>
              </span>
            </div>);
        })}
      </div>
      <div className="flex gap-2" style={{ marginTop: 6 }}>
        <input aria-label="сообщение" style={S.inp} placeholder="написать" value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
        <button type="button" style={btn(true)} disabled={busy || !text.trim()} onClick={send}>Отправить</button>
      </div>

      {/* ─── бриф ─── */}
      {!offer.accepted && (
        <div style={{ marginTop: 10 }}>
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
              <div style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
                <div><b>заказчик отдаёт:</b> {rowsLine(brief.gives) || "—"}</div>
                <div><b>исполнитель выдаёт:</b> {rowText(brief.gets) || "—"}</div>
                <div><b>ожидаемое время:</b> {daysText(brief.days)}</div>
                {brief.note && <div>{brief.note}</div>}
              </div>
              <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
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
          <div style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
            <div><b>заказчик отдаёт:</b> {rowsLine(brief?.gives) || "—"}</div>
            <div><b>исполнитель выдаёт:</b> {rowText(brief?.gets) || "—"}</div>
            <div><b>ожидаемое время:</b> {daysText(brief?.days)}</div>
          </div>
          <div style={{ ...hint, marginTop: 4 }}>
            {customer
              ? "Задача поставлена исполнителю: она у него на «Задачах», у вас — на «Проверке». Загрузите то, что отдаёте."
              : "Задача у вас на «Задачах» (или на «Проверке» — смотря что открывают ваши роли). Что отдал заказчик — ниже."}
          </div>
          <div style={{ ...S.lbl, marginTop: 8 }}>ресурсы от заказчика</div>
          {!(offer.deliveries || []).length && <div style={hint}>Пока ничего не загружено.</div>}
          {(offer.deliveries || []).map((d) => (
            <div key={d.id} style={{ fontSize: 12, marginTop: 4 }}>
              {d.name || d.file?.name || "ресурс"}
              {d.text ? <span style={{ color: C.muted }}> — {d.text}</span> : null}
              {d.file && (
                <a href={reportSrc(d.file)} target="_blank" rel="noreferrer"
                  style={{ color: ACC, marginLeft: 6 }}>📎 {d.file.name}</a>)}
              <span style={{ fontSize: 10, color: C.muted }}> · {when(d.at)}</span>
            </div>))}
          {customer && (
            <div style={{ marginTop: 8 }}>
              <input aria-label="название ресурса" style={{ ...S.inp, marginBottom: 4 }}
                placeholder="что отдаёте (например, логотип)" value={dlv.name}
                onChange={(e) => setDlv({ ...dlv, name: e.target.value })} />
              <textarea aria-label="текст ресурса" style={{ ...S.inp, minHeight: 40, marginBottom: 4 }}
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

function OrderCard({ order, me, nameOf, faceOf, onOpenPerson, services, busy, act, isOwner }) {
  const [edit, setEdit] = useState(false);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [openOffer, setOpenOffer] = useState(null);
  const mineOrder = String(order.by) === String(me);
  const svc = services.find((s) => s.id === order.serviceId);
  const myOffer = (order.offers || []).find((o) => String(o.by) === String(me));
  const status = order.status === "deal" ? "договорились" : order.status === "done" ? "выполнен" : "открыт";
  return (
    <div style={{ ...S.card, marginBottom: 8, borderColor: mineOrder ? `${ACC}55` : C.line }}
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
        {order.text && <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{order.text}</div>}
        <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.6 }}>
          <div><b>стоимость:</b> {order.price != null ? order.price : "не названа"}</div>
          {!!(order.resources || []).length && <div><b>предоставляет:</b> {rowsLine(order.resources)}</div>}
          {svc && <div><b>выбранная услуга:</b> {svc.name} ({nameOf(svc.by)})</div>}
        </div>
        <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
          {mineOrder && order.status === "open" && (
            <button type="button" style={btn(false)} disabled={busy} onClick={() => setEdit(true)}>Правка</button>)}
          {(mineOrder || isOwner) && (
            <button type="button" style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }} disabled={busy}
              aria-label={`удалить заказ ${order.name}`}
              onClick={() => act(() => dropOrder(order.id))}>Удалить</button>)}
          {!mineOrder && order.status === "open" && !myOffer && !replying && (
            <button type="button" style={btn(true, OK)} disabled={busy} onClick={() => setReplying(true)}>
              Откликнуться</button>)}
        </div>
        {replying && (
          <div style={form} aria-label="форма отклика">
            <div style={S.lbl}>ваше предложение — увидит только заказчик</div>
            <textarea aria-label="текст отклика" style={{ ...S.inp, minHeight: 56, margin: "6px 0" }}
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
        <div style={{ marginTop: 8 }}>
          <div style={S.lbl}>{mineOrder ? "предложения" : "ваше предложение"}</div>
          {(order.offers || []).map((o) => (
            <div key={o.id}>
              {/* Подпись — с кем разговор: заказчику — исполнитель, исполнителю — заказчик. */}
              <button type="button" style={{ ...btn(openOffer === o.id), marginTop: 4, width: "100%",
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

function ServiceCard({ s, me, nameOf, faceOf, onOpenPerson, busy, act, isOwner }) {
  const [edit, setEdit] = useState(false);
  const mineSvc = String(s.by) === String(me);
  return (
    <div style={{ ...S.card, marginBottom: 8, borderColor: mineSvc ? `${ACC}55` : C.line }}
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
        {s.text && <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{s.text}</div>}
        <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.6 }}>
          <div><b>берёт:</b> {rowsLine(s.takes) || "—"}</div>
          <div><b>выдаёт:</b> {rowsLine(s.gives) || "—"}</div>
          <div><b>выполняется за:</b> {daysText(s.days)}</div>
        </div>
        {(mineSvc || isOwner) && (
          <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
            {mineSvc && <button type="button" style={btn(false)} disabled={busy} onClick={() => setEdit(true)}>Правка</button>}
            <button type="button" style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }} disabled={busy}
              aria-label={`удалить услугу ${s.name}`} onClick={() => act(() => dropService(s.id))}>Удалить</button>
          </div>)}
      </>)}
    </div>
  );
}

/* ─────── вкладка ─────── */

export default function MarketPanel({ me, traits = [], draft = null, onDraftDone }) {
  const [view, setView] = useState(null);
  const [card, setCard] = useState(null);
  const [sub, setSub] = useState("orders");
  const [adding, setAdding] = useState(null);   // null | {kind, initial}
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
      <div style={{ ...S.card, marginBottom: 10 }}>
        <div style={S.lbl}>рынок услуг</div>
        <div style={{ ...hint, marginTop: 6 }}>
          {solo ? "Рынок услуг живёт на сервере: заказы и услуги видят все зарегистрированные. Откройте приложение через Telegram."
            : "Рынок открыт зарегистрированным: подпишите договор роли — и заказы с услугами появятся здесь."}
        </div>
      </div>);
  }

  return (
    <div>
      <div className="flex gap-2" style={{ marginBottom: 10 }} role="tablist" aria-label="рынок услуг">
        {[["orders", `Заказы${orders.length ? ` · ${orders.length}` : ""}`],
          ["services", `Услуги${services.length ? ` · ${services.length}` : ""}`]].map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={sub === k} style={btn(sub === k)}
            onClick={() => { setSub(k); setAdding(null); }}>{t}</button>))}
      </div>

      {!view && <div style={{ ...hint, marginBottom: 8 }}>{msg || "Загружаю…"}</div>}

      {sub === "orders" && view && (<>
        {adding?.kind === "order" ? (
          <OrderForm initial={adding.initial} services={services} busy={busy}
            onSave={(f) => act(() => addOrder(f)).then((r) => { if (r) setAdding(null); })}
            onCancel={() => setAdding(null)} />
        ) : (
          <button type="button" style={{ ...btn(true, OK), marginBottom: 8 }} disabled={busy}
            onClick={() => setAdding({ kind: "order", initial: null })}>+ заказ</button>)}
        {!orders.length && <div style={hint}>Заказов пока нет.</div>}
        {orders.slice().reverse().map((o) => (
          <OrderCard key={o.id} order={o} me={view.me} nameOf={nameOf} faceOf={faceOf}
            onOpenPerson={setCard} services={services}
            busy={busy} act={act} isOwner={Boolean(me?.isOwner)} />))}
      </>)}

      {sub === "services" && view && (<>
        {adding?.kind === "service" ? (
          <ServiceForm initial={adding.initial} busy={busy}
            onSave={(f) => act(() => addService(f)).then((r) => { if (r) setAdding(null); })}
            onCancel={() => setAdding(null)} />
        ) : (
          <button type="button" style={{ ...btn(true, OK), marginBottom: 8 }} disabled={busy}
            onClick={() => setAdding({ kind: "service", initial: null })}>+ услуга</button>)}
        {!services.length && <div style={hint}>Услуг пока нет.</div>}
        {services.slice().reverse().map((s) => (
          <ServiceCard key={s.id} s={s} me={view.me} nameOf={nameOf} faceOf={faceOf}
            onOpenPerson={setCard} busy={busy} act={act}
            isOwner={Boolean(me?.isOwner)} />))}
      </>)}

      {card != null && (
        <PersonModal id={card} me={me} onClose={() => setCard(null)} />)}

      {msg && view && <div role="status" style={{ fontSize: 12, color: WARN, marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
