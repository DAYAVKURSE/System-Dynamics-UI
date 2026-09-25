import React, { useEffect, useMemo } from "react";
import SystemModel from "./components/SystemModel.jsx";
import CallApp from "./components/CallApp.jsx";
import { initTelegram } from "./telegram.js";
import { callFromLocation } from "./calls.js";
import BoardApp from "./components/BoardApp.jsx";
import { boardFromLocation } from "./boards.js";
import ShareView, { shareFromLocation } from "./components/ShareView.jsx";

// Тот же тёмный фон, что и в самой модели (C.ink) — Telegram красит им
// системные элементы (шапку, safe area), чтобы WebApp не мигал белым при запуске.
const BG = "var(--bg-base)";

export default function App() {
  // Ссылка на звонок открывает окно звонка, а не модель с вкладками: у звонка
  // свой вход (/call), но если открыли через главное мини-приложение
  // (t.me/<бот>?startapp=call_…) — показываем то же окно и здесь.
  const call = useMemo(() => callFromLocation(), []);
  /* Ссылка на блок карты отчётов открывает страницу «что сделано», а не
     приложение: пришедший по ней — не участник модели, и вкладки, роли и
     правка ему не только не нужны, но и не полагаются. */
  /* Ссылка на брейншторм-доску (t.me/<бот>?startapp=board_…) открывает
     ГЛАВНОЕ мини-приложение бота, если оно заведено, — а это модель.
     Доска должна открыться доской на весь экран, а не вкладками
     (владелец, 2026-09-25): «открывает основное приложение, а не доску». */
  const board = useMemo(() => (call ? null : boardFromLocation()), [call]);
  const share = useMemo(() => (call || board ? null : shareFromLocation()), [call, board]);
  useEffect(() => {
    // Доска сама красит окно Telegram в свой цвет и разворачивает его.
    if (!call && !board) initTelegram(BG);
  }, [call, board]);

  if (call) return <CallApp />;
  if (board) return <BoardApp />;
  if (share) return <ShareView token={share} />;
  return <SystemModel />;
}
