import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { applyCapShift } from "./lib/capShift.js";

/* Надпись должна стоять посередине кнопки, а не «как будто выше»
   (владелец, 2026-09-21): поправка меряется шрифтом этого устройства —
   см. lib/capShift.js. Повтор после загрузки шрифтов: до неё меряется
   запасная гарнитура, а у неё выносы свои. */
applyCapShift();
if (typeof document !== "undefined" && document.fonts?.ready) {
  document.fonts.ready.then(() => applyCapShift()).catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
