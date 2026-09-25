import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BAD } from "./ui.jsx";
import BoardView from "./BoardView.jsx";
import { boardFromLocation } from "../boards.js";
import { getTelegram } from "../telegram.js";

/* ════════════════════════════════════════════════════════════════
   ДОСКА · мини-приложение для общего чата (владелец, 2026-09-25)

   «Добавь еще один миниап, такой же, как со звонками. Только это должна
   быть доска для брейншторма… В Миниапе должна быть только одна доска
   со стикерами под одну тему… На весь экран должна быть эта доска.»

   Открывается кнопкой под сообщением из инлайн-режима бота: ссылка ведёт
   в то же мини-приложение, что и звонок (`startapp=board_<id>`, см.
   call-main.jsx), или прямо на страницу /board?board=<id>. Как и окно
   звонка, про модель оно не знает ничего: ни ролей, ни вкладок — только
   доску, а кто есть кто, решает сервер по подписи Telegram.

   В отличие от звонка, окно РАЗВОРАЧИВАЕТСЯ: доска — на весь экран, и
   шапка Telegram красится в её цвет, чтобы доска начиналась от самого
   края, а не из-под чужой полосы.
   ════════════════════════════════════════════════════════════════ */

export default function BoardApp() {
  const boardId = useMemo(() => boardFromLocation(), []);
  const [color, setColor] = useState("");

  useEffect(() => {
    const tg = getTelegram();
    if (!tg) return;
    try { tg.ready(); } catch { /* старый клиент */ }
    try { tg.expand(); } catch { /* старый клиент */ }
    // Доска прокручивается вниз — свайп по ней не должен сворачивать окно.
    try { tg.disableVerticalSwipes?.(); } catch { /* необязательно */ }
  }, []);

  useEffect(() => {
    if (!color) return;
    const tg = getTelegram();
    if (tg) {
      try { tg.setHeaderColor(color); tg.setBackgroundColor(color); } catch { /* старый клиент */ }
      try { tg.setBottomBarColor?.(color); } catch { /* необязательно */ }
    }
    // Под доской при оттягивании — тот же цвет, а не фон приложения.
    try { document.body.style.background = color; } catch { /* нет документа */ }
  }, [color]);

  const onBoard = useCallback((b) => {
    if (b?.color) setColor(b.color);
    try { if (b?.name) document.title = b.name; } catch { /* нет документа */ }
  }, []);

  return (
    <div style={{ height: "100%", minHeight: 200 }}>
      {boardId
        ? <BoardView boardId={boardId} fill onBoard={onBoard} />
        : (
          <div style={{ fontSize: "var(--fs-body)", color: BAD, lineHeight: 1.6,
            padding: "var(--space-16)", fontFamily: "var(--font-sans)" }}>
            Ссылка на доску неполная — откройте её из сообщения в чате.
          </div>)}
    </div>);
}
