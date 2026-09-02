import React, { useCallback, useEffect, useRef, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn } from "./ui.jsx";
import {
  callLink, getIce, getLocalStream, getMeeting, pollSignals, recorderMime, sendSignal,
} from "../calls.js";
import { putReportFile } from "../storage.js";

/* ════════════════════════════════════════════════════════════════
   ОКНО СОВЕЩАНИЯ

   Соединение — WebRTC, сетка «каждый с каждым»: у каждого участника своё
   соединение с каждым другим, видео идёт напрямую, мимо сервера. Кто из
   пары делает предложение, решает не человек, а порядок id: иначе оба
   предлагают одновременно и соединение разваливается на «glare».

   Предел в 20 участников — предел комнаты, а не телефона. Сетка на N
   человек — это N−1 исходящих видеопотоков с каждого устройства; на
   телефоне после пятерых частота кадров падает, а батарея греется.
   Честное решение для двадцати — сервер-микшер (SFU); он в роадмапе, а
   здесь сетка, которая на пятерых работает хорошо и на двадцати — работает.
   ════════════════════════════════════════════════════════════════ */

export const MAX_PEERS = 20;

const CFG_FALLBACK = { iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }] };

export default function CallRoom({ meetingId, meId, onClose, nameOf }) {
  const [meeting, setMeeting] = useState(null);
  const [state, setState] = useState("idle");   // idle | asking | waiting | live | ended
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [rec, setRec] = useState(false);
  const [recNote, setRecNote] = useState("");
  const [noTurn, setNoTurn] = useState(false);

  const peers = useRef(new Map());        // id собеседника → RTCPeerConnection
  const [streams, setStreams] = useState({});   // id собеседника → MediaStream
  const cfgRef = useRef(CFG_FALLBACK);
  const local = useRef(null);
  const recorder = useRef(null);
  const chunks = useRef([]);
  const abort = useRef(null);
  const since = useRef(0);
  const stopped = useRef(false);

  const stop = useCallback(() => {
    stopped.current = true;
    try { abort.current?.abort(); } catch { /* уже закрыт */ }
    try { recorder.current?.state === "recording" && recorder.current.stop(); } catch { /* нет записи */ }
    peers.current.forEach((c) => { try { c.close(); } catch { /* уже закрыт */ } });
    peers.current.clear();
    setStreams({});
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);

  useEffect(() => {
    let live = true;
    getMeeting(meetingId)
      .then((m) => { if (live) setMeeting(m); })
      .catch((e) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [meetingId]);

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
        try { await onSignal(s); } catch { /* один битый сигнал не рвёт звонок */ }
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
    local.current?.getTracks().forEach((t) => conn.addTrack(t, local.current));
    conn.ontrack = (e) => {
      setStreams((p) => ({ ...p, [id]: e.streams[0] }));
      setState("live");
    };
    conn.onicecandidate = (e) => { if (e.candidate) post({ type: "ice", candidate: e.candidate }, id); };
    conn.onconnectionstatechange = () => {
      if (conn.connectionState === "connected") { setState("live"); setNote(""); }
      if (conn.connectionState === "failed") {
        setNote((n) => n || "С одним из участников соединение не установилось — строгий NAT, нужен TURN.");
      }
      if (["closed", "disconnected", "failed"].includes(conn.connectionState)) {
        // Собеседник ушёл — убираем его окно, остальные продолжают.
        setTimeout(() => {
          if (peers.current.get(id) === conn && conn.connectionState !== "connected") {
            peers.current.delete(id);
            setStreams((p) => { const n = { ...p }; delete n[id]; return n; });
          }
        }, 3000);
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
    if (d.type === "hello") {
      // Пришёл новый: предложение делает тот, чей id меньше. Отвечаем
      // «привет» адресно, чтобы новичок узнал обо всех, кто уже здесь.
      post({ type: "hello-back" }, from);
      if (String(meId) < from) await makeOffer(from);
      return;
    }
    if (d.type === "hello-back") {
      if (String(meId) < from) await makeOffer(from);
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

  /* ─── вход в звонок ─── */
  const join = async () => {
    setErr(""); setNote(""); setState("asking");
    let stream;
    try {
      stream = await getLocalStream({ video: true, audio: true });
    } catch (e) {
      setErr(e.message); setState("idle"); return;
    }
    local.current = stream;

    try {
      const ice = await getIce();
      cfgRef.current = { iceServers: ice.iceServers };
      setNoTurn(!ice.turn);
    } catch { /* без ответа сервера остаётся публичный STUN */ }

    stopped.current = false;
    setState("waiting");
    listen();
    // «Привет» зовёт того, кто уже в комнате, начать соединение.
    post({ type: "hello" });
  };

  const leave = () => {
    post({ type: "bye" });
    stop();
    setState("ended");
    setNote("Вы вышли из звонка.");
  };

  /* ─── микрофон, камера, запись ─── */
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

  const startRec = () => {
    const mime = recorderMime();
    if (!mime) { setRecNote("Этот клиент не умеет записывать — записи не будет."); return; }
    if (!local.current) { setRecNote("Сначала войдите в звонок."); return; }
    try {
      // Пишем свою дорожку: сведение двух видео в одну требует холста и
      // микшера звука, а на телефоне это съедает батарею и роняет частоту
      // кадров у самого звонка. Собеседник пишет свою сторону сам.
      chunks.current = [];
      const r = new MediaRecorder(local.current, { mimeType: mime });
      r.ondataavailable = (e) => { if (e.data?.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        const blob = new Blob(chunks.current, { type: mime });
        setRecNote("Сохраняю запись…");
        try {
          const name = `звонок-${new Date().toISOString().slice(0, 16).replace(":", "-")}`
            + (mime.includes("mp4") ? ".mp4" : ".webm");
          const file = new File([blob], name, { type: mime });
          const saved = await putReportFile(file);
          setRecNote(saved.url
            ? `Запись сохранена: ${saved.name}`
            : `Запись готова (${Math.round(blob.size / 1024)} КБ), но сервера нет — она осталась только здесь.`);
        } catch (e) {
          setRecNote(`Запись не сохранилась: ${e.message}`);
        }
      };
      r.start(1000);
      recorder.current = r;
      setRec(true); setRecNote("Идёт запись.");
    } catch (e) {
      setRecNote(`Запись не началась: ${e.message}`);
    }
  };
  const stopRec = () => {
    try { recorder.current?.stop(); } catch { /* уже остановлена */ }
    setRec(false);
  };

  // Сетка окон: своё и по одному на каждого собеседника. Чем больше людей,
  // тем меньше окно — двадцать окон по 240px на телефон не влезут.
  const n = Object.keys(streams).length + 1;
  const cell = n <= 2 ? "1 1 240px" : n <= 6 ? "1 1 160px" : "1 1 110px";
  const Tile = ({ stream, muted, label }) => {
    const ref = useRef(null);
    useEffect(() => { if (ref.current && stream) ref.current.srcObject = stream; }, [stream]);
    return (
      <div style={{ position: "relative", flex: cell, minWidth: n <= 6 ? 140 : 100 }}>
        <video ref={ref} autoPlay playsInline muted={muted}
          style={{ width: "100%", borderRadius: 10, background: "#000",
            aspectRatio: "3 / 4", objectFit: "cover", border: `1px solid ${C.line}` }} />
        <span style={{ position: "absolute", left: 6, bottom: 6, fontSize: 10,
          color: C.text, background: "#0009", borderRadius: 4, padding: "2px 5px",
          maxWidth: "90%", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap" }}>{label}</span>
      </div>);
  };

  return (
    <div>
      <div style={{ ...S.card, marginBottom: 10 }}>
        <div className="flex items-center gap-2">
          <span style={S.lbl}>звонок</span>
          <span style={{ flex: 1 }} />
          {onClose && <button style={btn(false)} onClick={() => { stop(); onClose(); }}>✕</button>}
        </div>
        {meeting ? (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{meeting.title}</div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>
              {meeting.at || "время не задано"}
              {meeting.peers?.length ? ` · в комнате: ${meeting.peers.length} из ${MAX_PEERS}` : " · пока никого"}
            </div>
            {meeting.text && meeting.text !== meeting.title && (
              <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{meeting.text}</div>)}
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
            {err || "Загружаю встречу…"}</div>)}
      </div>

      <div className="flex flex-wrap gap-2" style={{ marginBottom: 10 }}>
        <Tile stream={local.current} muted label={mic ? "вы" : "вы · микрофон выключен"} />
        {Object.entries(streams).map(([id, st]) => (
          <Tile key={id} stream={st} muted={false} label={nameOf ? nameOf(id) : `участник ${id}`} />))}
        {!Object.keys(streams).length && state !== "idle" && state !== "ended" && (
          <div style={{ flex: cell, minWidth: 140, borderRadius: 10, border: `1px dashed ${C.line}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, color: C.muted, aspectRatio: "3 / 4" }}>
            ждём остальных</div>)}
      </div>

      <div style={{ ...S.card, marginBottom: 10 }}>
        <div className="flex flex-wrap gap-2">
          {state === "idle" || state === "ended" ? (
            <button style={btn(true, OK)} onClick={join}>
              {state === "ended" ? "Войти снова" : "Войти в звонок"}</button>
          ) : (
            <>
              <button style={btn(mic, mic ? OK : BAD)} onClick={toggleMic}>
                {mic ? "🎙 микрофон вкл" : "🔇 микрофон выкл"}</button>
              <button style={btn(cam, cam ? OK : BAD)} onClick={toggleCam}>
                {cam ? "🎥 камера вкл" : "🚫 камера выкл"}</button>
              {rec
                ? <button style={btn(true, BAD)} onClick={stopRec}>⏹ остановить запись</button>
                : <button style={btn(false)} onClick={startRec}>⏺ записать</button>}
              <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                onClick={leave}>Выйти</button>
            </>)}
        </div>

        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>
          {state === "asking" && "Спрашиваю доступ к камере и микрофону…"}
          {state === "waiting" && "Жду остальных. Кто войдёт по ссылке — подключится сам."}
          {state === "live" && `Соединение установлено с ${Object.keys(streams).length} участник${Object.keys(streams).length === 1 ? "ом" : "ами"} — видео идёт напрямую, мимо сервера.`}
          {note}
        </div>
        {err && <div style={{ fontSize: 11.5, color: BAD, marginTop: 6, lineHeight: 1.6 }}>
          {err}</div>}
        {recNote && <div style={{ fontSize: 11.5, color: rec ? BAD : ACC, marginTop: 6 }}>
          {recNote}</div>}
        {noTurn && state !== "idle" && (
          <div style={{ fontSize: 10.5, color: WARN, marginTop: 6, lineHeight: 1.5 }}>
            TURN-сервер не настроен: если оба собеседника за строгим NAT,
            соединение может не установиться. Настраивается в TURN_URL.
          </div>)}
      </div>

      {meeting && (
        <div style={{ ...S.card }}>
          <div style={S.lbl}>ссылка на этот звонок</div>
          <div style={{ fontSize: 11, color: ACC, marginTop: 6, wordBreak: "break-all",
            fontFamily: "ui-monospace, Menlo, monospace" }}>
            {callLink(meeting.id)}</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
            Кому дали ссылку — тот и войдёт. Приглашение удобнее отправлять из
            чата: наберите имя бота и время встречи.
          </div>
        </div>)}
    </div>);
}
