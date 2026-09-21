import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { applyCapShift } from "./lib/capShift.js";
import { watchApp } from "./lib/appLog.js";

/* Надпись должна стоять посередине кнопки, а не «как будто выше»
   (владелец, 2026-09-21): поправка меряется шрифтом этого устройства —
   см. lib/capShift.js. Повтор после загрузки шрифтов: до неё меряется
   запасная гарнитура, а у неё выносы свои. */
applyCapShift();
if (typeof document !== "undefined" && document.fonts?.ready) {
  document.fonts.ready.then(() => applyCapShift()).catch(() => {});
}

/* Лента последних действий — для вопроса ассистенту из приложения
   (lib/appLog.js): что нажимали и что меняли перед тем, как спросить. */
watchApp();

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
