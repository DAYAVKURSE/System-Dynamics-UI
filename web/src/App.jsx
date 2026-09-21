import React, { useEffect, useMemo } from "react";
import SystemModel from "./components/SystemModel.jsx";
import CallApp from "./components/CallApp.jsx";
import { initTelegram } from "./telegram.js";
import { callFromLocation } from "./calls.js";
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
  const share = useMemo(() => (call ? null : shareFromLocation()), [call]);
  useEffect(() => {
    if (!call) initTelegram(BG);
  }, [call]);

  if (call) return <CallApp />;
  if (share) return <ShareView token={share} />;
  return <SystemModel />;
}
