import React, { useEffect, useMemo, useState } from "react";
import { C, BAD } from "./ui.jsx";
import CallRoom from "./CallRoom.jsx";
import { callFromLocation, callerId } from "../calls.js";
import { getInitData, getTelegram } from "../telegram.js";

/* ════════════════════════════════════════════════════════════════
   ОКНО ЗВОНКА · отдельное мини-приложение

   Открывается ссылкой из приглашения и показывает только звонок: ни
   вкладок, ни модели. Нарочно НЕ разворачивается на весь экран при
   запуске — Telegram открывает его на пол-экрана (mode=compact), и
   человек сам тянет вверх или жмёт «⤢», если хочет больше. Всё окно
   помещается в экран телефона без прокрутки: сетка видео растягивается,
   кнопки — внизу.

   Про модель это окно не знает ничего и знать не должно: ни ролей, ни
   вкладок, ни «кто я в организации». Приглашение на звонок — это ссылка,
   а не запись в списке людей, и спрашивать сервер «свой ли ты» здесь
   некого и незачем. Заодно снимается неприятность: запрос «кто я»
   назначал владельцем модели первого, кто её открыл, — а по ссылке на
   звонок приходит кто угодно.

   Кто я для комнаты: id из initData Telegram, если звонок открыт
   мини-приложением, иначе номер гостя, который завёл себе сам браузер
   (см. calls.js). Имя — из Telegram, а гость пишет его сам: без имени
   у собеседников подписана безымянная плитка.
   ════════════════════════════════════════════════════════════════ */

const BG = "#0E1420";
const NAME_KEY = "sd.call.name";
const LOW_KEY = "sd.call.low";

/* ─── звонок на нижней части экрана ───

   Владелец просил окно на пол-экрана. Само окно нам не подчиняется:
   высоту листа Android считает в onMeasure из размера экрана и
   фиксирует (MeasureSpec.EXACTLY), содержимое страницы в этот расчёт не
   входит, а свернуть окно из страницы нечем — expand() односторонний, и
   обратного метода в Mini Apps нет. Замер с телефона владельца это и
   показал: Telegram выдал 843 точки из 883 при своём же isExpanded=false.

   Что в нашей власти — где на этой высоте лежит сам звонок. В нижнем
   режиме он занимает нижние 40% и получает скруглённый верх, а над ним
   остаётся фон приложения, по которому можно нажать и развернуть звонок
   обратно. Окно от этого меньше не станет — станет меньше то, что в нём
   работает; это разные вещи, и обещать первое, делая второе, нельзя.

   Выбор запоминается: человек решает один раз, а не каждый звонок. */
const LOW_PART = "40%";
const LOW_MIN = 240;

const keptLow = () => {
  try { return localStorage.getItem(LOW_KEY) !== "0"; } catch { return true; }
};

/* ─── чем открыли окно, по словам самого Telegram ───

   Со стороны сервера высоту окна не видно вовсе: и половина экрана, и
   весь — один и тот же запрос. А «весь экран» у Telegram не один: есть
   развёрнутый лист (isExpanded), есть fullsize из ответа сервера и есть
   fullscreen из Bot API 8.0 — и лечатся они по-разному. Спорить о высоте
   вслепую бессмысленно, поэтому страница один раз говорит, что ей
   сообщил SDK, и это видно в /api/health.

   Дважды: сразу и через три секунды. Разница между замерами отвечает на
   отдельный вопрос — открылось сразу во весь экран или сначала на
   половину, а развернулось потом (и тогда виновато что-то на странице).

   Про человека здесь ничего нет: ни id, ни имени, ни initData — только
   размеры, платформа и версия. Отладка не должна превращаться в слежку. */
const viewFacts = (when) => {
  const tg = getTelegram();
  const scr = typeof window !== "undefined" ? window.screen : null;
  const start = String(tg?.initDataUnsafe?.start_param || "");
  return {
    when,
    expanded: tg ? Boolean(tg.isExpanded) : null,
    fullscreen: tg ? Boolean(tg.isFullscreen) : null,
    height: tg?.viewportHeight ?? null,
    stable: tg?.viewportStableHeight ?? null,
    innerHeight: typeof window !== "undefined" ? window.innerHeight : null,
    screenHeight: scr?.height ?? null,
    // Доля экрана в процентах — то самое, о чём спор: 100 значит «на весь».
    ratio: scr?.height ? Math.round(((tg?.viewportHeight ?? window.innerHeight) / scr.height) * 100) : null,
    platform: tg?.platform || "нет Telegram",
    version: tg?.version || "",
    // Только вид параметра, не значение: по id встречи входят в комнату.
    start: start ? (start.startsWith("call_") ? "call" : start.slice(0, 12)) : "нет",
  };
};

const tellServer = (when) => {
  try {
    fetch("/api/call-view", { method: "POST", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(viewFacts(when)) }).catch(() => {});
  } catch { /* отладке нельзя мешать звонку */ }
};

const keptName = () => {
  try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; }
};

export default function CallApp() {
  const meetingId = useMemo(() => callFromLocation(), []);
  const tgUser = getTelegram()?.initDataUnsafe?.user;
  const tgName = [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(" ")
    || tgUser?.username || "";
  const [name, setName] = useState(() => tgName || keptName());

  useEffect(() => {
    const tg = getTelegram();
    if (!tg) return;
    try { tg.ready(); } catch { /* старый клиент */ }
    try { tg.setHeaderColor(BG); tg.setBackgroundColor(BG); } catch { /* старый клиент */ }
    // Свайп по видео не должен сворачивать окно.
    try { tg.disableVerticalSwipes?.(); } catch { /* необязательно */ }
  }, []);

  // Рассказ о высоте окна — см. viewFacts. Отдельным эффектом, чтобы
  // отладка не перепуталась с настройкой окна и снималась одной строкой.
  useEffect(() => {
    tellServer("старт");
    const t = setTimeout(() => tellServer("через 3 с"), 3000);
    return () => clearTimeout(t);
  }, []);

  // Сигналинг сравнивает id с тем, что видит сервер: у своего это id
  // Telegram, у гостя — его номер.
  const meId = useMemo(() => callerId(), []);
  const expand = () => { try { getTelegram()?.expand(); } catch { /* нет Telegram */ } };

  const rename = (v) => {
    setName(v);
    try { localStorage.setItem(NAME_KEY, v); } catch { /* хранилище закрыто — не беда */ }
  };

  const [low, setLow] = useState(keptLow);
  const putLow = (v) => {
    setLow(v);
    try { localStorage.setItem(LOW_KEY, v ? "1" : "0"); } catch { /* не беда */ }
  };

  return (
    /* Высоту окна задаёт Telegram переменной --tg-viewport-stable-height, и
       на части клиентов сразу после запуска она приходит НУЛЕВОЙ. Без нижней
       границы окно звонка схлопывалось в несколько пикселей — снаружи это
       выглядит как пустой экран, и понять по нему нечего. 200 пикселей ниже
       любого настоящего окна Telegram (даже на пол-экрана), поэтому в
       обычной жизни граница не мешает, а вырожденный случай перестаёт быть
       невидимым. */
    <div style={{ height: "var(--tg-viewport-stable-height, 100%)", minHeight: 200,
      background: C.ink, color: C.text, padding: 8, boxSizing: "border-box",
      overflow: "hidden", display: "flex", flexDirection: "column", gap: 6,
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      {meetingId ? (
        <>
          {low ? (
            /* Пустое место сверху — не пустое: по нему разворачивают звонок
               обратно. Иначе нижний режим было бы некуда отменить, а
               маленькое окно на большом экране нужно не всегда. */
            <button type="button" onClick={() => putLow(false)}
              style={{ flex: 1, minHeight: 0, background: "transparent", border: 0,
                color: C.muted, fontSize: 12, cursor: "pointer", display: "flex",
                alignItems: "flex-end", justifyContent: "center", paddingBottom: 8 }}>
              Звонок внизу экрана · нажмите, чтобы развернуть
            </button>
          ) : (
            <button type="button" onClick={() => putLow(true)}
              style={{ flex: "0 0 auto", background: "transparent", border: 0, color: C.muted,
                fontSize: 11, cursor: "pointer", alignSelf: "flex-end", padding: "2px 4px" }}>
              ▾ вниз экрана
            </button>
          )}
          {!tgName && (
            <input aria-label="как вас зовут" placeholder="Как вас зовут — увидят собеседники"
              value={name} onChange={(e) => rename(e.target.value)} maxLength={40}
              style={{ flex: "0 0 auto", background: C.panel, color: C.text, fontSize: 12,
                border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 8px" }} />)}
          <div data-testid="комната"
            style={low
              ? { flex: `0 0 ${LOW_PART}`, minHeight: LOW_MIN, overflow: "hidden",
                borderRadius: "14px 14px 0 0", background: C.panel, padding: 4 }
              : { flex: 1, minHeight: 0 }}>
            <CallRoom meetingId={meetingId} meId={meId} myName={name} fit
              canRecord={Boolean(getInitData())}
              onExpand={getTelegram() ? expand : null} />
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: BAD, lineHeight: 1.6, padding: 12 }}>
          Ссылка на звонок неполная — откройте её из приглашения в чате.
        </div>)}
    </div>);
}
