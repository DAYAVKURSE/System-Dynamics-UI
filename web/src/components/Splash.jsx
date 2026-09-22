import React from "react";
import { C, Logo } from "./ui.jsx";

/* ─────── ОКНО ЗАГРУЗКИ (владелец, 2026-09-22) ───────

   Пока сервер не ответил, кто мы (SystemModel, `splash`), — тёмный экран
   и логотип в движении: `public/loader.svg`, который собирает
   `scripts/logo-loader.mjs` (там же описано, что и как крутится). Это
   SMIL-файл в <img>: ни скрипта, ни перерисовок React на каждый кадр.
   Системная настройка «меньше движения» — неподвижный `Logo`. */
/* Сколько окно держится самое меньшее: сервер отвечает за доли секунды,
   и без этого логотип мелькал бы, не успев повернуться. Оборот и первые
   упавшие яблоки укладываются в это время (владелец, 2026-09-22). */
export const SPLASH_MS = 3400;

const reduced = () => typeof window !== "undefined" && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Splash({ size = 128 }) {
  return (
    <div aria-label="загрузка" role="status"
      style={{ background: C.ink, minHeight: "100%", height: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center" }}>
      {reduced()
        ? <Logo size={size} />
        : <img src="/loader.svg" width={size} height={size} alt="" data-testid="logo-loader"
            style={{ display: "block", flex: "0 0 auto" }} />}
    </div>);
}
