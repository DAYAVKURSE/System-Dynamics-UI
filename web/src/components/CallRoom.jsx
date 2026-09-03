import React, { useCallback, useEffect, useRef, useState } from "react";
import { C, OK, BAD, ACC, S, btn } from "./ui.jsx";
import {
  RECORDER_OPTS, callLink, getIce, getLocalStream, getMeeting, getScreenStream, pollSignals,
  recorderMime, screenShareSupported, sendSignal,
} from "../calls.js";
import { MAX_UPLOAD_REPORT_BYTES, putReportFile, reportsAvailable } from "../storage.js";

/* ════════════════════════════════════════════════════════════════
   ОКНО СОВЕЩАНИЯ

   Соединение — WebRTC, у каждого участника своё соединение с каждым, но
   медиа всегда идёт через сервер: iceTransportPolicy «relay» запрещает
   прямые пути между устройствами, и весь звук и видео ретранслирует
   coturn на этом же сервере. Так один и тот же механизм работает для
   двоих и для десяти, и не бывает «с одним соединилось, с другим нет из-за
   NAT»: путь до сервера у всех один.

   Без сервера ретрансляции звонок не начинается — об этом говорится
   словами, а не тишиной.

   Кто из пары делает предложение соединения, решает порядок id: иначе оба
   предлагают одновременно и соединение разваливается на «glare».

   Предел в 20 участников — предел комнаты. Каждый участник отдаёт по
   потоку на каждого другого; на телефоне после пятерых частота кадров
   падает. Сервер-микшер (SFU), который берёт один поток и раздаёт всем,
   — следующий шаг, он в роадмапе.
   ════════════════════════════════════════════════════════════════ */

export const MAX_PEERS = 20;

// Запас до предела загрузки: последний кусок записи прилетает уже после
// команды «стоп», и его тоже надо уместить.
export const MAX_RECORDING_BYTES = MAX_UPLOAD_REPORT_BYTES - 2 * 1024 * 1024;

const mb = (n) => `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;

/* ════════════════════════════════════════════════════════════════
   ПЛИТКА С ВИДЕО

   Объявлена ЗДЕСЬ, а не внутри CallRoom, и это не вкусовщина. Функция,
   объявленная в теле компонента, на каждый рендер новая — для React это
   новый тип компонента, поэтому он не обновляет старое дерево, а сносит
   его и создаёт заново вместе с <video>. Картинка при этом гаснет и
   загорается снова.

   Пока в комнате ничего не меняется, это незаметно. А во время записи
   MediaRecorder отдаёт кусок раз в секунду, счётчик размера обновляет
   состояние — и экран моргал ровно раз в секунду. Отсюда же и memo:
   поток у плитки меняется редко, и перерисовывать её из-за чужого
   счётчика незачем.
   ════════════════════════════════════════════════════════════════ */
const Tile = React.memo(function Tile({ stream, muted, label: text, mirror, fit }) {
  const ref = useRef(null);
  // srcObject присваивается, только когда поток ДРУГОЙ: повторное
  // присваивание того же потока перезапускает воспроизведение и даёт то же
  // моргание, что и пересоздание элемента.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Поток ушёл — гасим: иначе после выхода из звонка в плитке навсегда
    // остаётся последний кадр с камеры, будто она ещё работает.
    if (!stream) { el.srcObject = null; return; }
    if (el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);
  return (
    <div style={{ position: "relative", minHeight: 0, minWidth: 0, borderRadius: 10,
      overflow: "hidden", background: "#000", border: `1px solid ${C.line}`,
      aspectRatio: fit ? undefined : "3 / 4" }}>
      <video ref={ref} autoPlay playsInline muted={muted}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block",
          transform: mirror ? "scaleX(-1)" : undefined }} />
      <span style={{ position: "absolute", left: 6, bottom: 6, fontSize: 10,
        color: C.text, background: "#0009", borderRadius: 4, padding: "2px 5px",
        maxWidth: "90%", overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap" }}>{text}</span>
    </div>);
});

export default function CallRoom({
  meetingId, meId, myName = "", onClose, nameOf, fit = false, onExpand = null,
  canRecord = true,
}) {
  const [meeting, setMeeting] = useState(null);
  const [state, setState] = useState("idle");   // idle | asking | waiting | live | ended
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [rec, setRec] = useState(false);
  const [recNote, setRecNote] = useState("");
  const [recBytes, setRecBytes] = useState(0);
  const [names, setNames] = useState({});          // id собеседника → имя из его «привет»

  const peers = useRef(new Map());        // id собеседника → RTCPeerConnection
  const [streams, setStreams] = useState({});   // id собеседника → MediaStream
  const cfgRef = useRef(null);
  const local = useRef(null);             // камера и микрофон
  const screen = useRef(null);            // экран, пока он транслируется
  const outVideo = useRef(null);          // видеодорожка, которую сейчас отдаём
  const recorder = useRef(null);
  const chunks = useRef([]);
  const bytes = useRef(0);
  const abort = useRef(null);
  const since = useRef(0);
  // Всегда свежий разбор сигналов для цикла опроса — см. listen().
  const onSignalRef = useRef(null);
  const stopped = useRef(false);
  // Отложенная уборка плиток — по таймеру на собеседника, чтобы их можно
  // было отменить и чтобы ни один не сработал после закрытия окна.
  const dropTimers = useRef(new Map());

  const stop = useCallback(() => {
    stopped.current = true;
    dropTimers.current.forEach((t) => clearTimeout(t));
    dropTimers.current.clear();
    try { abort.current?.abort(); } catch { /* уже закрыт */ }
    try { recorder.current?.state === "recording" && recorder.current.stop(); } catch { /* нет записи */ }
    peers.current.forEach((c) => { try { c.close(); } catch { /* уже закрыт */ } });
    peers.current.clear();
    setStreams({});
    screen.current?.getTracks().forEach((t) => t.stop());
    screen.current = null;
    outVideo.current = null;
    setSharing(false);
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);

  // Как нас зовут внутри комнаты. Сервер отдаёт псевдоним: номеров Telegram
  // участники друг о друге не узнают (см. aliasFor в lib/callStore.js).
  // Пока встреча не загрузилась, обходимся своим id — до «привет» он всё
  // равно никуда не уходит.
  const myId = useRef(String(meId));
  const aliased = useRef(false);

  const learnMe = useCallback((m) => {
    if (!m?.me) return m;
    myId.current = String(m.me);
    aliased.current = true;
    return m;
  }, []);

  useEffect(() => {
    let live = true;
    getMeeting(meetingId)
      .then((m) => { if (live) setMeeting(learnMe(m)); })
      .catch((e) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [meetingId, learnMe]);

  /* ─── сигналинг ─── */
  const post = useCallback((data, to = null) =>
    sendSignal(meetingId, data, to).catch(() => {}), [meetingId]);

  const listen = useCallback(async () => {
    while (!stopped.current) {
      abort.current = new AbortController();
      let out = null;
      try {
        out = await pollSignals(meetingId, since.current, abort.current.signal);
      } catch {
        if (stopped.current) return;
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      if (!out) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      since.current = out.seq;
      for (const s of out.signals || []) {
        // Через ссылку, а не напрямую: цикл опроса живёт весь звонок и
        // запомнил бы разбор сигналов из ПЕРВОГО рендера — вместе с тогдашним
        // именем. Гость печатает имя до входа, и в ответ «привет» уходило
        // пустое: подключившиеся позже видели безымянного участника.
        try { await onSignalRef.current(s); } catch { /* один битый сигнал не рвёт звонок */ }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  /** Соединение с одним собеседником — создаётся при первом сигнале от него. */
  const peerFor = (id) => {
    if (peers.current.has(id)) return peers.current.get(id);
    if (peers.current.size >= MAX_PEERS - 1) return null;
    const conn = new RTCPeerConnection(cfgRef.current);
    peers.current.set(id, conn);
    const audio = local.current?.getAudioTracks()[0];
    if (audio) conn.addTrack(audio, local.current);
    // Видео — то, что отдаём сейчас: экран, если он показывается, иначе камера.
    const video = outVideo.current || local.current?.getVideoTracks()[0];
    if (video) conn.addTrack(video, local.current);
    conn.ontrack = (e) => {
      // Тот же поток приходит дважды — на звук и на видео. Переписывать им
      // состояние второй раз значит перерисовать всё окно на ровном месте,
      // и как раз в самый шумный момент: когда участник входит.
      setStreams((p) => (p[id] === e.streams[0] ? p : { ...p, [id]: e.streams[0] }));
      setState("live");
    };
    conn.onicecandidate = (e) => { if (e.candidate) post({ type: "ice", candidate: e.candidate }, id); };
    conn.onconnectionstatechange = () => {
      if (conn.connectionState === "connected") { setState("live"); setNote(""); }
      if (conn.connectionState === "failed") {
        setNote((n) => n || "С одним из участников соединение не установилось: у него не открылся"
          + " путь до сервера ретрансляции (порт 3478). Пусть попробует другую сеть.");
      }
      if (conn.connectionState === "connected") {
        // Соединение вернулось — отменяем уборку, иначе она уберёт живого.
        clearTimeout(dropTimers.current.get(id));
        dropTimers.current.delete(id);
      }
      if (["closed", "disconnected", "failed"].includes(conn.connectionState)) {
        // Собеседник ушёл — убираем его окно, остальные продолжают. Таймер
        // на собеседника ровно один: на плохой сети соединение прыгает
        // «отвалилось → вернулось» несколько раз подряд, и без отмены
        // накапливалась очередь уборщиков — плитка выпадала и появлялась
        // снова уже у живого участника.
        clearTimeout(dropTimers.current.get(id));
        const t = setTimeout(() => {
          dropTimers.current.delete(id);
          if (peers.current.get(id) === conn && conn.connectionState !== "connected") {
            peers.current.delete(id);
            setStreams((p) => { const n = { ...p }; delete n[id]; return n; });
          }
        }, 3000);
        dropTimers.current.set(id, t);
      }
    };
    return conn;
  };

  const makeOffer = async (id) => {
    const conn = peerFor(id);
    if (!conn || conn.signalingState !== "stable") return;
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    post({ type: "offer", sdp: conn.localDescription }, id);
  };

  const onSignal = async (s) => {
    const d = s.data || {};
    const from = String(s.from);
    if (d.name) setNames((p) => (p[from] === d.name ? p : { ...p, [from]: d.name }));
    if (d.type === "hello") {
      // Пришёл новый: предложение делает тот, чей id меньше. Отвечаем
      // «привет» адресно, чтобы новичок узнал обо всех, кто уже здесь.
      post({ type: "hello-back", name: myName }, from);
      if (myId.current < from) await makeOffer(from);
      return;
    }
    if (d.type === "hello-back") {
      if (myId.current < from) await makeOffer(from);
      return;
    }
    if (d.type === "bye") {
      const conn = peers.current.get(from);
      try { conn?.close(); } catch { /* уже закрыт */ }
      peers.current.delete(from);
      setStreams((p) => { const n = { ...p }; delete n[from]; return n; });
      if (!peers.current.size) { setNote("Все вышли."); }
      return;
    }
    const conn = peerFor(from);
    if (!conn) return;
    if (d.type === "offer") {
      await conn.setRemoteDescription(d.sdp);
      const answer = await conn.createAnswer();
      await conn.setLocalDescription(answer);
      post({ type: "answer", sdp: conn.localDescription }, from);
    } else if (d.type === "answer") {
      if (conn.signalingState !== "stable") await conn.setRemoteDescription(d.sdp);
    } else if (d.type === "ice" && d.candidate) {
      await conn.addIceCandidate(d.candidate).catch(() => {});
    }
  };
  // Цикл опроса берёт разбор отсюда, поэтому ссылка обновляется на каждый
  // рендер: иначе в звонке навсегда осталось бы состояние первого.
  onSignalRef.current = onSignal;

  /* ─── вход в звонок ─── */
  const join = async () => {
    setErr(""); setNote(""); setState("asking");
    // Как нас зовут в комнате, знает сервер. Если встреча с первого раза не
    // загрузилась, спрашиваем ещё раз: без псевдонима непонятно, кому из
    // пары делать предложение соединения, и оба сделают его разом.
    if (!aliased.current) {
      try { setMeeting(learnMe(await getMeeting(meetingId))); }
      catch { /* скажем ниже: серверов соединения мы тоже не получим */ }
    }
    // Сначала — сервер ретрансляции: без него звонка не будет, и включать
    // камеру, чтобы потом извиниться, незачем.
    let ice;
    try {
      ice = await getIce(meetingId);
    } catch {
      setErr("Сервер не отвечает — звонок без него невозможен."); setState("idle"); return;
    }
    if (!ice.turn) {
      setErr("На сервере не настроена ретрансляция (TURN), а звонок идёт только через"
        + " сервер. Настройка — в docs/DEPLOYMENT.md, раздел 6.6.");
      setState("idle"); return;
    }
    cfgRef.current = { iceServers: ice.iceServers, iceTransportPolicy: "relay" };

    let stream;
    try {
      stream = await getLocalStream({ video: true, audio: true });
    } catch (e) {
      setErr(e.message); setState("idle"); return;
    }
    local.current = stream;
    // Выбор, сделанный до входа: если камеру или микрофон выключили на
    // экране ожидания, они и должны остаться выключенными.
    stream.getAudioTracks().forEach((t) => { t.enabled = mic; });
    stream.getVideoTracks().forEach((t) => { t.enabled = cam; });

    stopped.current = false;
    setState("waiting");
    listen();
    // «Привет» зовёт тех, кто уже в комнате, начать соединение; имя — чтобы
    // они подписали плитку.
    post({ type: "hello", name: myName });
  };

  const leave = () => {
    post({ type: "bye" });
    stop();
    setState("ended");
    setNote("Вы вышли из звонка.");
  };

  /* ─── микрофон, камера, экран ─── */
  const toggleMic = () => {
    const on = !mic;
    local.current?.getAudioTracks().forEach((t) => { t.enabled = on; });
    setMic(on);
  };
  const toggleCam = () => {
    const on = !cam;
    local.current?.getVideoTracks().forEach((t) => { t.enabled = on; });
    setCam(on);
  };

  // Подменяет видеодорожку во всех соединениях, не пересобирая их: собеседники
  // просто видят другую картинку.
  const swapVideo = async (track) => {
    await Promise.all([...peers.current.values()].map(async (conn) => {
      const sender = conn.getSenders().find((s) => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(track).catch(() => {});
      else if (track) conn.addTrack(track, local.current);
    }));
  };
  const stopShare = async () => {
    screen.current?.getTracks().forEach((t) => t.stop());
    screen.current = null;
    outVideo.current = null;
    setSharing(false);
    await swapVideo(local.current?.getVideoTracks()[0] || null);
  };
  const shareScreen = async () => {
    if (sharing) return stopShare();
    let s;
    try { s = await getScreenStream(); } catch (e) { setNote(e.message); return; }
    const track = s.getVideoTracks()[0];
    if (!track) return;
    screen.current = s;
    outVideo.current = track;
    setSharing(true);
    // Кнопка «остановить» в системной плашке браузера тоже завершает показ.
    track.onended = () => { if (screen.current === s) stopShare(); };
    await swapVideo(track);
  };

  /* ─── запись ─── */
  const startRec = async () => {
    const mime = recorderMime();
    if (!mime) { setRecNote("Этот клиент не умеет записывать — записи не будет."); return; }
    if (!local.current) { setRecNote("Сначала войдите в звонок."); return; }
    // Проверяем ДО начала, а не после: иначе сорок минут записи исчезали
    // в момент остановки, и человек узнавал об этом последним.
    if (!(await reportsAvailable())) {
      setRecNote("Сохранять запись некуда: сервер файлов недоступен. Записывать не начинаю,"
        + " чтобы не потерять её в конце.");
      return;
    }
    try {
      // Пишем свою дорожку: сведение всех видео в одно требует холста и
      // микшера звука, а на телефоне это съедает батарею и роняет частоту
      // кадров у самого звонка. Каждый пишет свою сторону сам.
      chunks.current = [];
      bytes.current = 0;
      setRecBytes(0);
      const r = new MediaRecorder(local.current, { mimeType: mime, ...RECORDER_OPTS });
      r.ondataavailable = (e) => {
        if (!e.data?.size) return;
        chunks.current.push(e.data);
        bytes.current += e.data.size;
        // Показываем десятые доли мегабайта — значит и в состояние кладём
        // столько же. Обновлять его на каждый кусок значит перерисовывать
        // окно раз в секунду ради цифры, которая не изменилась.
        setRecBytes((was) => (mb(bytes.current) === mb(was) ? was : bytes.current));
        // Предел размера — предел загрузки на сервер. Останавливаемся сами,
        // пока запись ещё можно сохранить, а не после того, как сервер откажет.
        if (bytes.current >= MAX_RECORDING_BYTES && r.state === "recording") {
          setRecNote("Запись достигла предела размера — сохраняю.");
          r.stop(); setRec(false);
        }
      };
      r.onstop = async () => {
        const blob = new Blob(chunks.current, { type: mime });
        setRecNote(`Сохраняю запись (${mb(blob.size)})…`);
        try {
          // В имени — встреча и время: за день их бывает несколько, и
          // «звонок-2026-09-03T10-30» друг от друга не отличить.
          const when = new Date().toISOString().slice(0, 16).replace(":", "-");
          const about = meeting?.title ? ` — ${meeting.title}` : "";
          const name = `звонок-${when}${about}`.slice(0, 120)
            + (mime.includes("mp4") ? ".mp4" : ".webm");
          const file = new File([blob], name, { type: mime });
          const saved = await putReportFile(file, { kind: "call" });
          setRecNote(saved.url
            ? `Запись сохранена: ${saved.name} (${mb(blob.size)})`
            : `Запись готова (${mb(blob.size)}), но сервера нет — она осталась только здесь.`);
        } catch (e) {
          const why = /413/.test(e.message)
            ? `файл (${mb(blob.size)}) больше, чем принимает сервер`
            : e.message;
          setRecNote(`Запись не сохранилась: ${why}`);
        }
      };
      r.start(1000);
      recorder.current = r;
      setRec(true); setRecNote("Идёт запись вашей дорожки.");
    } catch (e) {
      setRecNote(`Запись не началась: ${e.message}`);
    }
  };
  const stopRec = () => {
    try { recorder.current?.stop(); } catch { /* уже остановлена */ }
    setRec(false);
  };

  /* ─── вид ─── */
  const others = Object.entries(streams);
  const n = others.length + 1;
  // Сетка: столбцов столько, чтобы все влезли в экран без прокрутки.
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const label = (id) => names[id] || (nameOf && nameOf(id)) || "участник";
  const inCall = state !== "idle" && state !== "ended";
  const status = state === "asking" ? "Спрашиваю доступ к камере и микрофону…"
    : state === "waiting" ? "Жду остальных · соединение через сервер"
      : state === "live" ? `Через сервер · ${others.length} участник${others.length === 1 ? "" : others.length < 5 ? "а" : "ов"} кроме вас`
        : "";

  const ctl = (on, col, extra = {}) => ({
    ...btn(on, col), ...(fit ? { padding: "8px 10px", fontSize: 15, lineHeight: 1 } : {}), ...extra,
  });

  /* Микрофон и камера — кнопки, которые есть ВСЕГДА, в том числе до входа.
     Человек должен решить, войдёт он с камерой или без, до того как его
     увидят, а не гасить её потом на глазах у собеседников. Выбор,
     сделанный до входа, применяется к дорожкам сразу при получении
     доступа (см. join). */
  const micCam = (
    <>
      <button aria-label="микрофон" title={mic ? "выключить микрофон" : "включить микрофон"}
        style={ctl(mic, mic ? OK : BAD)} onClick={toggleMic}>
        {fit ? (mic ? "🎙" : "🔇") : (mic ? "🎙 микрофон вкл" : "🔇 микрофон выкл")}</button>
      <button aria-label="камера" title={cam ? "выключить камеру" : "включить камеру"}
        style={ctl(cam, cam ? OK : BAD)} onClick={toggleCam}>
        {fit ? (cam ? "🎥" : "🚫") : (cam ? "🎥 камера вкл" : "🚫 камера выкл")}</button>
    </>);

  const controls = state === "idle" || state === "ended" ? (
    <>
      {micCam}
      <button style={ctl(true, OK, fit ? { fontSize: 13, padding: "10px 16px", flex: 1 } : {})}
        onClick={join}>
        {state === "ended" ? "Войти снова" : "Войти в звонок"}</button>
    </>
  ) : (
    <>
      {micCam}
      {screenShareSupported() && (
        <button aria-label="экран" title={sharing ? "прекратить показ экрана" : "показать экран"}
          style={ctl(sharing, ACC)} onClick={shareScreen}>
          {fit ? "🖥" : (sharing ? "🖥 экран показывается" : "🖥 показать экран")}</button>)}
      {/* Запись ложится в хранилище отчётов, а туда пускают только по
          подписи Telegram: гостю, вошедшему по ссылке, кнопку не рисуем —
          лучше её отсутствие, чем отказ сервера после сорока минут. */}
      {canRecord && (rec
        ? <button aria-label="запись" title="остановить запись" style={ctl(true, BAD)} onClick={stopRec}>
          {fit ? "⏹" : "⏹ остановить запись"}</button>
        : <button aria-label="запись" title="записать" style={ctl(false)} onClick={startRec}>
          {fit ? "⏺" : "⏺ записать"}</button>)}
      <button aria-label="выйти" title="выйти из звонка"
        style={ctl(false, null, { color: BAD, borderColor: "#5A2436" })} onClick={leave}>
        {fit ? "✕" : "Выйти"}</button>
    </>);

  const header = (
    <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
      <span style={{ fontSize: fit ? 12.5 : 14, fontWeight: 700, flex: 1, minWidth: 0,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {meeting ? meeting.title : (err ? "Звонок" : "Загружаю встречу…")}</span>
      {meeting && (
        <span style={{ fontSize: 10.5, color: C.muted, whiteSpace: "nowrap" }}>
          {inCall ? `${n} из ${MAX_PEERS}` : (meeting.at || "")}</span>)}
      {onExpand && <button aria-label="на весь экран" title="на весь экран"
        style={ctl(false)} onClick={onExpand}>⤢</button>}
      {onClose && <button aria-label="закрыть" style={ctl(false)}
        onClick={() => { stop(); onClose(); }}>✕</button>}
    </div>);

  const tiles = (
    <>
      <Tile stream={sharing ? screen.current : local.current} muted mirror={!sharing} fit={fit}
        label={sharing ? "ваш экран" : (mic ? "вы" : "вы · микрофон выключен")} />
      {others.map(([id, st]) => (
        <Tile key={id} stream={st} muted={false} label={label(id)} fit={fit} />))}
      {!others.length && inCall && (
        <div style={{ minHeight: 0, borderRadius: 10, border: `1px dashed ${C.line}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, color: C.muted, aspectRatio: fit ? undefined : "3 / 4" }}>
          ждём остальных</div>)}
    </>);

  const messages = (
    <>
      {(status || note) && (
        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5,
          ...(fit ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : {}) }}
          title={`${status} ${note}`.trim()}>
          {status}{status && note ? " · " : ""}{note}</div>)}
      {err && <div style={{ fontSize: 11.5, color: BAD, lineHeight: 1.5 }}>{err}</div>}
      {/* В компактном окне эта строка — единственная, что не была прижата к
          одной строке. Счётчик рос («9,9 МБ» → «10,0 МБ»), строка
          переносилась, и сетка видео теряла полтора десятка пикселей —
          снаружи это выглядит как ещё одно моргание, уже не от React. */}
      {recNote && <div style={{ fontSize: 11, color: rec ? BAD : ACC, lineHeight: 1.5,
        ...(fit ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : {}) }}
        title={recNote}>
        {recNote}{rec && recBytes ? ` · ${mb(recBytes)} из ${mb(MAX_RECORDING_BYTES)}` : ""}</div>}
    </>);

  if (fit) {
    // Всё окно — в экран: заголовок, растущая сетка видео, строка статуса,
    // кнопки. Ничего не прокручивается, видео ужимается, а не уезжает вниз.
    return (
      <div data-testid="call-fit" style={{ display: "flex", flexDirection: "column",
        height: "100%", minHeight: 0, gap: 6 }}>
        {header}
        <div style={{ flex: 1, minHeight: 0, display: "grid", gap: 6,
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridAutoRows: "minmax(0, 1fr)" }}>
          {tiles}
        </div>
        <div style={{ flex: "0 0 auto" }}>{messages}</div>
        <div className="flex gap-2" style={{ flex: "0 0 auto", justifyContent: "center",
          flexWrap: "wrap" }}>{controls}</div>
      </div>);
  }

  return (
    <div>
      <div style={{ ...S.card, marginBottom: 10 }}>
        {header}
        {meeting && (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>
            {meeting.at || "время не задано"}
            {meeting.peers?.length ? ` · в комнате: ${meeting.peers.length} из ${MAX_PEERS}` : " · пока никого"}
          </div>)}
        {meeting?.text && meeting.text !== meeting.title && (
          <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{meeting.text}</div>)}
      </div>

      <div style={{ display: "grid", gap: 8, marginBottom: 10,
        gridTemplateColumns: `repeat(${Math.min(cols, 3)}, minmax(0, 1fr))` }}>
        {tiles}
      </div>

      <div style={{ ...S.card, marginBottom: 10 }}>
        <div className="flex flex-wrap gap-2">{controls}</div>
        <div style={{ marginTop: 8, display: "grid", gap: 4 }}>{messages}</div>
      </div>

      {meeting && (
        <div style={{ ...S.card }}>
          <div style={S.lbl}>ссылка на этот звонок</div>
          <div style={{ fontSize: 11, color: ACC, marginTop: 6, wordBreak: "break-all",
            fontFamily: "ui-monospace, Menlo, monospace" }}>
            {callLink(meeting.id)}</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
            Кому дали ссылку — тот и войдёт. Приглашение удобнее отправлять из
            чата: наберите имя бота и время встречи — у собеседника звонок откроется
            отдельным окном на пол-экрана.
          </div>
        </div>)}
    </div>);
}
