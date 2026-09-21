/* ════════════════════════════════════════════════════════════════
   НАДПИСЬ ПОСЕРЕДИНЕ КНОПКИ (владелец, 2026-09-21: «сами надписи должны
   быть чётко посередине, они как будто смещены вверх»).

   Браузер центрирует не буквы, а СТРОКУ — коробку высотой от верхнего
   выноса шрифта до нижнего. Выносы несимметричны (у системного шрифта
   ascent 11, descent 4 при кегле 13), и у надписи без букв с хвостами —
   «Схема», «Анкета» — чернила оказываются выше середины на полтора
   пикселя. Математически всё верно, глазом — «смещено вверх».

   Поправка: опустить строку на столько, чтобы посередине оказалась
   полоса от базовой линии до верха прописной, — то, что глаз и считает
   надписью. Величина зависит от шрифта, а шрифт у нас системный и на
   каждом устройстве свой, поэтому она не вписана числом, а МЕРЯЕТСЯ один
   раз на старте и кладётся в `--text-nudge`. Кнопка тратит её на верхний
   отступ и на столько же укорачивает нижний — высота не меняется.

   Не померили (jsdom, старый браузер, шрифт ещё не дошёл) — ноль, и всё
   остаётся как было.
   ════════════════════════════════════════════════════════════════ */

/** Буква без хвоста и с прописной высотой: по ней и меряем. */
const SAMPLE = "Н";
export const VAR = "--text-nudge";

/** На сколько опустить строку, чтобы прописная встала посередине. */
export function capShift(font, sample = SAMPLE) {
  try {
    const cv = document.createElement("canvas").getContext("2d");
    if (!cv || typeof cv.measureText !== "function") return 0;
    cv.font = font;
    const m = cv.measureText(sample);
    const cap = Number(m.actualBoundingBoxAscent);
    const up = Number(m.fontBoundingBoxAscent);
    const down = Number(m.fontBoundingBoxDescent);
    if (!(cap > 0) || !(up > 0) || !(down >= 0)) return 0;
    const shift = cap / 2 - (up - down) / 2;
    // Сдвиг больше пары пикселей — это не поправка, а ошибка измерения.
    return Math.abs(shift) > 2.5 ? 0 : Math.round(shift * 100) / 100;
  } catch { return 0; }
}

/** Померить шрифтом кнопки и положить поправку в корень документа. */
export function applyCapShift(root = typeof document === "undefined" ? null : document.documentElement) {
  if (!root) return 0;
  const cs = typeof getComputedStyle === "function" ? getComputedStyle(root) : null;
  const family = (cs?.getPropertyValue("--font-sans") || "").trim() || "system-ui, sans-serif";
  const shift = capShift(`600 13px ${family}`);
  root.style.setProperty(VAR, `${shift}px`);
  return shift;
}
