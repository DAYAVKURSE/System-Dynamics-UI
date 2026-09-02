import React, { useEffect, useMemo, useState } from "react";
import { C, BAD } from "./ui.jsx";
import CallRoom from "./CallRoom.jsx";
import { callFromLocation } from "../calls.js";
import { getTelegram } from "../telegram.js";
import { whoAmI } from "../identity.js";

/* ════════════════════════════════════════════════════════════════
   ОКНО ЗВОНКА · отдельное мини-приложение

   Открывается ссылкой из приглашения и показывает только звонок: ни
   вкладок, ни модели. Нарочно НЕ разворачивается на весь экран при
   запуске — Telegram открывает его на пол-экрана (mode=compact), и
   человек сам тянет вверх или жмёт «⤢», если хочет больше. Всё окно
   помещается в экран телефона без прокрутки: сетка видео растягивается,
   кнопки — внизу.

   Кто я — из initData Telegram: id нужен серверу и сигналингу (кто из
   пары делает предложение соединения, решает порядок id), имя — чтобы
   подписать плитку у других. Приглашённость в модель для звонка не
   требуется: ссылка и есть приглашение.
   ════════════════════════════════════════════════════════════════ */

const BG = "#0E1420";

export default function CallApp() {
  const meetingId = useMemo(() => callFromLocation(), []);
  const [me, setMe] = useState(null);

  useEffect(() => {
    const tg = getTelegram();
    if (tg) {
      try { tg.ready(); } catch { /* старый клиент */ }
      try { tg.setHeaderColor(BG); tg.setBackgroundColor(BG); } catch { /* старый клиент */ }
      // Свайп по видео не должен сворачивать окно.
      try { tg.disableVerticalSwipes?.(); } catch { /* необязательно */ }
    }
    let live = true;
    whoAmI().then((m) => { if (live) setMe(m); }).catch(() => { if (live) setMe({}); });
    return () => { live = false; };
  }, []);

  const tgUser = getTelegram()?.initDataUnsafe?.user;
  // Сигналинг сравнивает id с тем, что видит сервер, — это id Telegram.
  const meId = String(tgUser?.id || (me?.id && me.id !== "local" ? me.id : "guest"));
  const myName = me?.name
    || [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(" ")
    || "";
  const expand = () => { try { getTelegram()?.expand(); } catch { /* нет Telegram */ } };

  return (
    <div style={{ height: "var(--tg-viewport-stable-height, 100%)", minHeight: 0,
      background: C.ink, color: C.text, padding: 8, boxSizing: "border-box",
      overflow: "hidden", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      {meetingId ? (
        <CallRoom meetingId={meetingId} meId={meId} myName={myName} fit
          onExpand={getTelegram() ? expand : null} />
      ) : (
        <div style={{ fontSize: 13, color: BAD, lineHeight: 1.6, padding: 12 }}>
          Ссылка на звонок неполная — откройте её из приглашения в чате.
        </div>)}
    </div>);
}
