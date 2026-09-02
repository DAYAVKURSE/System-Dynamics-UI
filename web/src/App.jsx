import React, { useEffect, useMemo } from "react";
import SystemModel from "./components/SystemModel.jsx";
import CallApp from "./components/CallApp.jsx";
import { initTelegram } from "./telegram.js";
import { callFromLocation } from "./calls.js";

// Тот же тёмный фон, что и в самой модели (C.ink) — Telegram красит им
// системные элементы (шапку, safe area), чтобы WebApp не мигал белым при запуске.
const BG = "#0E1420";

export default function App() {
  // Ссылка на звонок открывает окно звонка, а не модель с вкладками: у звонка
  // свой вход (/call), но если открыли через главное мини-приложение
  // (t.me/<бот>?startapp=call_…) — показываем то же окно и здесь.
  const call = useMemo(() => callFromLocation(), []);
  useEffect(() => {
    if (!call) initTelegram(BG);
  }, [call]);

  return call ? <CallApp /> : <SystemModel />;
}
