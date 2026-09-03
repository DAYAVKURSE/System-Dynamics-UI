/* ════════════════════════════════════════════════════════════════
   СВЕДЕНИЕ ЗВОНКА В ОДНУ ЗАПИСЬ

   Раньше запись брала свой поток целиком: `new MediaRecorder(local)`. На
   записи оказывались только своя камера и свой голос — то есть ровно то,
   чего на встрече не нужно. Собеседников там не было вовсе.

   Свести несколько потоков в один браузер сам не умеет, поэтому:

   · ВИДЕО — холст. Раз в кадр на него перерисовываются те самые
     <video>, что человек видит на экране, сеткой в том же порядке.
     Читаем именно живые элементы, а не потоки: тогда на записи оказывается
     то же, что и в окне, — включая показ экрана вместо камеры и включая
     тех, кто подключился или ушёл посреди записи. Ничего не надо
     переподписывать: следующий кадр просто увидит другой набор.

   · ЗВУК — микшер Web Audio. Каждый поток становится источником и
     соединяется с одним приёмником; его дорожка и идёт в запись.
     Выключенный микрофон даёт тишину сам по себе — глушить отдельно
     нечего.

   Рисуем по таймеру, а не по requestAnimationFrame: тот засыпает, стоит
   свернуть окно, и запись встала бы кадром ровно тогда, когда человек
   отвлёкся на другое приложение. Таймер браузер тоже придерживает, но
   картинка продолжает обновляться.

   Двенадцать кадров в секунду — не экономия ради экономии: на телефоне
   каждый лишний кадр отнимается у самого звонка, а разговор важнее
   плавности его записи.
   ════════════════════════════════════════════════════════════════ */

const FPS = 12;
const W = 1280;
const H = 720;

/** Сетка под n плиток: как можно ближе к квадрату, как и на экране. */
export function gridFor(n) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, n))));
  return { cols, rows: Math.max(1, Math.ceil(Math.max(1, n) / cols)) };
}

/**
 * Куда вписать кадр видео, сохранив пропорции и заполнив клетку целиком
 * (лишнее срезается по краям — как object-fit: cover на экране).
 */
export function coverBox(vw, vh, x, y, cw, ch) {
  if (!vw || !vh) return { x, y, w: cw, h: ch };
  const s = Math.max(cw / vw, ch / vh);
  const w = vw * s;
  const h = vh * s;
  return { x: x + (cw - w) / 2, y: y + (ch - h) / 2, w, h };
}

/**
 * Начинает сведение.
 *
 * @param grid    функция, возвращающая элемент, внутри которого лежат
 *                видеоплитки; читается на каждый кадр — набор плиток
 *                меняется, пока идёт запись.
 * @param streams функция, возвращающая потоки, чей звук нужно свести.
 * @returns { stream, sync, stop } — `stream` отдаётся в MediaRecorder,
 *          `sync` вызывается, когда список потоков изменился.
 */
export function startMix({ grid, streams, fps = FPS, width = W, height = H, doc = document }) {
  const canvas = doc.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  const draw = () => {
    if (!ctx) return;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    const box = typeof grid === "function" ? grid() : grid;
    // Плитка без кадра (камера выключена, собеседник ещё не отдал видео)
    // рисуется чёрным прямоугольником — это честнее, чем сдвигать сетку
    // и менять расположение людей на записи от кадра к кадру.
    const videos = box ? [...box.querySelectorAll("video")] : [];
    const { cols, rows } = gridFor(videos.length);
    const cw = width / cols;
    const ch = height / rows;
    videos.forEach((v, i) => {
      if (!v.videoWidth || !v.videoHeight) return;
      const at = coverBox(v.videoWidth, v.videoHeight,
        (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
      try { ctx.drawImage(v, at.x, at.y, at.w, at.h); } catch { /* кадра ещё нет */ }
    });
  };

  const timer = setInterval(draw, Math.round(1000 / fps));
  draw();

  const AC = typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null;
  let actx = null;
  let dest = null;
  try {
    if (AC) {
      actx = new AC();
      dest = actx.createMediaStreamDestination();
      // На части клиентов контекст рождается остановленным и оживает
      // только после действия человека. Запись начинают нажатием — момент
      // подходящий, и без этого в записи была бы тишина.
      actx.resume?.().catch(() => {});
    }
  } catch { actx = null; dest = null; }

  const nodes = new Map();          // id потока → источник в микшере
  const sync = () => {
    if (!actx || !dest) return;
    const live = new Set();
    for (const s of (typeof streams === "function" ? streams() : streams) || []) {
      if (!s || !s.getAudioTracks?.().length) continue;
      live.add(s.id);
      if (nodes.has(s.id)) continue;
      try {
        const node = actx.createMediaStreamSource(s);
        node.connect(dest);
        nodes.set(s.id, node);
      } catch { /* поток уже закрыт или без звука — не беда */ }
    }
    for (const [id, node] of [...nodes]) {
      if (live.has(id)) continue;
      try { node.disconnect(); } catch { /* уже отсоединён */ }
      nodes.delete(id);
    }
  };
  sync();

  const video = canvas.captureStream ? canvas.captureStream(fps) : null;
  const stream = new MediaStream([
    ...(video ? video.getVideoTracks() : []),
    ...(dest ? dest.stream.getAudioTracks() : []),
  ]);

  const stop = () => {
    clearInterval(timer);
    for (const [, node] of nodes) { try { node.disconnect(); } catch { /* уже */ } }
    nodes.clear();
    video?.getTracks().forEach((t) => { try { t.stop(); } catch { /* уже */ } });
    try { actx?.close?.(); } catch { /* уже закрыт */ }
  };

  // canvas отдаём наружу ради проверок: холст в документ не вставляется
  // (ему там нечего делать), и добраться до него иначе было бы нечем.
  return { stream, sync, stop, canvas };
}
