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

/* ─── чем открыли окно, по словам самого Telegram ───

   Со стороны сервера высоту окна не видно вовсе: и половина экрана, и
   весь — один и тот же запрос. А «весь экран» у Telegram не один: есть
   развёрнутый лист (isExpanded), есть fullsize из ответа сервера и есть
   fullscreen из Bot API 8.0 — и лечатся они по-разному. Спорить о высоте
   вслепую бессмысленно, поэтому страница один раз говорит, что ей
   сообщил SDK, и это видно в /api/health. Именно этот отчёт и нашёл
   расхождение 843 против 775, из-за которого страница была длиннее окна.

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
    ratio: scr?.height
      ? Math.round(((tg?.viewportHeight ?? window.innerHeight) / scr.height) * 100) : null,
    // Нижняя безопасная зона — главный оставшийся подозреваемый по
    // «кнопок не видно»: жестовая полоса Android накрывает их снизу.
    safeBottom: tg?.safeAreaInset?.bottom ?? null,
    contentBottom: tg?.contentSafeAreaInset?.bottom ?? null,
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

  return (
    /* Ровно по окну — ни больше, ни меньше.

       height:100% и только он. Число Telegram
       (--tg-viewport-stable-height) отсюда убрано намеренно: на Android
       владельца оно приходило больше окна (843 против 775), и страница
       становилась длиннее окна — низ с кнопками звонка уезжал за край.
       Ограничивать им сверху тоже нельзя: когда оно МЕНЬШЕ окна, страница
       стала бы меньше окна, а это ровно то, чего просили не делать —
       звонок повис бы посреди экрана на своём же фоне.

       min-height: 200 остаётся сторожем вырожденного случая: если у
       родителя почему-то не окажется высоты, height:100% посчитается в
       auto и окно схлопнется по содержимому — снаружи это пустой экран,
       по которому нечего понять.

       padding-bottom — про жестовую полосу и наэкранные кнопки Android.
       Замер на собранной странице показал: нижний край ряда кнопок в 767
       при окне 775, запас восемь точек. Жестовая полоса (около 24) съедает
       половину высоты кнопок, трёхкнопочная навигация (около 48) — весь
       ряд. Берём большее из двух источников: env() знает браузер, а
       --tg-safe-area-inset-bottom сообщает Telegram, и совпадают они не
       всегда. Если max() окажется непонятным старому WebView, правило
       просто отбросится и станет как было — в отличие от высоты, здесь
       такой отказ ничего не ломает. */
    <div style={{ height: "100%", minHeight: 200,
      background: C.ink, color: C.text, padding: 8, boxSizing: "border-box",
      paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px),"
        + " var(--tg-safe-area-inset-bottom, 0px))",
      overflow: "hidden", display: "flex", flexDirection: "column", gap: 6,
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      {meetingId ? (
        <>
          {!tgName && (
            <input aria-label="как вас зовут" placeholder="Как вас зовут — увидят собеседники"
              value={name} onChange={(e) => rename(e.target.value)} maxLength={40}
              style={{ flex: "0 0 auto", background: C.panel, color: C.text, fontSize: 12,
                border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 8px" }} />)}
          <div data-testid="комната" style={{ flex: 1, minHeight: 0 }}>
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
