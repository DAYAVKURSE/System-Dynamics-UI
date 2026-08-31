import React, { useEffect } from "react";
import SystemModel from "./components/SystemModel.jsx";
import { initTelegram } from "./telegram.js";

// Тот же тёмный фон, что и в самой модели (C.ink) — Telegram красит им
// системные элементы (шапку, safe area), чтобы WebApp не мигал белым при запуске.
const BG = "#0E1420";

export default function App() {
  useEffect(() => {
    initTelegram(BG);
  }, []);

  return <SystemModel />;
}
