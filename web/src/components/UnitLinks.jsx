import React from "react";
import { C, ACC, WARN, Download } from "./ui.jsx";
import { unitLabel, unitTitle } from "../lib/units.js";
import { reportSrc, textHref } from "../storage.js";

/* ════════════════════════════════════════════════════════════════
   СПИСОК ЕДИНИЦ СО СКАЧИВАНИЕМ

   Одна строка — одна вещь: номер, короткое имя и «скачать». Список один
   на форму задачи и на «Проверку»: вещь, которую исполнитель взял на
   входе, и вещь, которую проверяющий смотрит на выходе, — это одна и та
   же вещь, и зваться и скачиваться она должна одинаково. Полная история
   каждой единицы живёт в «Отчётах» (`UnitRow`); здесь — только то, чего
   хватает, чтобы узнать вещь и забрать её.
   ════════════════════════════════════════════════════════════════ */

/** Куда ведёт «скачать» и как назвать файл — как в «Отчётах». */
export const unitDownload = (u = {}, unitName = "ед.") => ({
  href: u.file ? reportSrc(u.file) : textHref(u.code || u.text),
  fileName: u.file ? u.file.name : `${unitName}-${u.no}.txt`,
});

export function UnitLine({ u, traitName, unitName }) {
  const { href, fileName } = unitDownload(u, unitName);
  const has = !!(u.file || u.text || u.code);
  return (
    <div className="flex flex-wrap gap-2" role="listitem"
      style={{ alignItems: "center", fontSize: 11, padding: "3px 0",
        borderTop: `1px solid ${C.line}` }}>
      <span style={{ color: ACC, fontWeight: 700 }}>№{u.no}</span>
      <span style={{ flex: "1 1 120px", minWidth: 0, overflowWrap: "anywhere" }}>
        {/* Код — и есть имя вещи, но он должен читаться как код, а не как
            слово: моноширинно, с разрядкой. */}
        {u.code
          ? <span style={{ fontFamily: "var(--font-sans)", letterSpacing: 1 }}>
              {u.code}</span>
          : unitLabel(u)}
      </span>
      {!u.accepted && <span style={{ fontSize: 10, color: WARN }}>не принята</span>}
      {has
        ? <Download url={u.file ? href : ""} text={u.file ? "" : (u.code || u.text)}
            name={fileName} aria-label={`скачать ${traitName} №${u.no}`}
            style={{ fontSize: 10.5, padding: "2px 7px", color: ACC }}
            /* У кода скачивают не сам код, а бумагу о выдаче: код уже на
               экране, а подтверждение — только файлом. */
            label={u.code && u.file ? "скачать подтверждение" : "скачать"} />
        : <span style={{ fontSize: 10, color: WARN }}>содержимого нет</span>}
    </div>);
}

/* ─────── ВЕЩИ СТРОКАМИ ───────

   В строке только ИМЯ вещи и «Скачать» справа (владелец, 2026-09-20): ни
   номера, ни задачи, при которой вещь получена, ни ресурса — их спросят
   в «Отчётах», где у каждой вещи своя история. */
export function MatList({ units = [], unitName = "ед.", label, empty = "нет" }) {
  if (!units.length) {
    return <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{empty}</div>;
  }
  return (
    <div role="list" aria-label={label} style={{ marginTop: 2 }}>
      {units.map((u) => (
        <div key={u.id} role="listitem" className="flex flex-wrap gap-2"
          style={{ alignItems: "center", fontSize: 11.5, padding: "3px 0",
            borderTop: `1px solid ${C.line}` }}>
          <span style={{ flex: "1 1 120px", minWidth: 0, overflowWrap: "anywhere" }}>
            {unitTitle(u)}</span>
          <Download url={u.file ? reportSrc(u.file) : ""}
            text={u.file ? "" : (u.code || u.text)}
            name={u.file ? u.file.name : `${unitName}-${u.no}.txt`}
            aria-label={`скачать ${unitTitle(u)}`}
            style={{ fontSize: 10.5, padding: "2px 7px", color: ACC }} />
        </div>))}
    </div>);
}

/**
 * Список единиц одного ресурса — в своей прокрутке, как везде.
 *
 * Пусто — так и сказано: молчание читалось бы как «не загрузилось».
 */
export function UnitList({ units = [], traitName, unitName, label, empty = "единиц пока нет" }) {
  if (!units.length) {
    return <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{empty}</div>;
  }
  return (
    <div role="list" aria-label={label}
      style={{ maxHeight: 160, overflowY: "auto", marginTop: 3, paddingRight: 4 }}>
      {units.map((u) => (
        <UnitLine key={u.id} u={u} traitName={traitName} unitName={unitName} />))}
    </div>);
}
