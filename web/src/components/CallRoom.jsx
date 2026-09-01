import React, { useCallback, useEffect, useRef, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn } from "./ui.jsx";
import {
  callLink, getIce, getLocalStream, getMeeting, pollSignals, recorderMime, sendSignal,
} from "../calls.js";
import { putReportFile } from "../storage.js";

/* ════════════════════════════════════════════════════════════════
   ОКНО ЗВОНКА

   Соединение — WebRTC: после обмена сигналами видео и звук идут напрямую,
   мимо сервера. Кто звонит первым, решает не человек, а порядок id: тот,
   чей id меньше, делает предложение. Иначе оба предлагают одновременно и
   соединение разваливается на «glare» — классическая ловушка WebRTC,
   которую в интерфейсе не отловить.
   ════════════════════════════════════════════════════════════════ */

const CFG_FALLBACK = { iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }] };

export default function CallRoom({ meetingId, meId, onClose }) {
  const [meeting, setMeeting] = useState(null);
  const [state, setState] = useState("idle");   // idle | asking | waiting | live | ended
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [rec, setRec] = useState(false);
  const [recNote, setRecNote] = useState("");
  const [noTurn, setNoTurn] = useState(false);

  const localRef = useRef(null);
  const remoteRef = useRef(null);
  const pc = useRef(null);
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
    try { pc.current?.close(); } catch { /* уже закрыт */ }
    local.current?.getTracks().forEach((t) => t.stop());
    pc.current = null; local.current = null;
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
  const post = useCallback((data) => sendSignal(meetingId, data).catch(() => {}), [meetingId]);

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

  const onSignal = async (s) => {
    const conn = pc.current;
    if (!conn) return;
    const d = s.data || {};
    if (d.type === "offer") {
      await conn.setRemoteDescription(d.sdp);
      const answer = await conn.createAnswer();
      await conn.setLocalDescription(answer);
      post({ type: "answer", sdp: conn.localDescription });
    } else if (d.type === "answer") {
      if (conn.signalingState !== "stable") await conn.setRemoteDescription(d.sdp);
    } else if (d.type === "ice" && d.candidate) {
      await conn.addIceCandidate(d.candidate).catch(() => {});
    } else if (d.type === "hello") {
      // Пришёл второй: предложение делает тот, чей id меньше.
      if (String(meId) < String(s.from)) await makeOffer();
    } else if (d.type === "bye") {
      setNote("Собеседник вышел.");
      setState("ended");
      stop();
    }
  };

  const makeOffer = async () => {
    const conn = pc.current;
    if (!conn || conn.signalingState !== "stable") return;
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    post({ type: "offer", sdp: conn.localDescription });
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
    if (localRef.current) localRef.current.srcObject = stream;

    let cfg = CFG_FALLBACK;
    try {
      const ice = await getIce();
      cfg = { iceServers: ice.iceServers };
      setNoTurn(!ice.turn);
    } catch { /* без ответа сервера остаётся публичный STUN */ }

    const conn = new RTCPeerConnection(cfg);
    pc.current = conn;
    stream.getTracks().forEach((t) => conn.addTrack(t, stream));
    conn.ontrack = (e) => {
      if (remoteRef.current) remoteRef.current.srcObject = e.streams[0];
      setState("live");
    };
    conn.onicecandidate = (e) => { if (e.candidate) post({ type: "ice", candidate: e.candidate }); };
    conn.onconnectionstatechange = () => {
      if (conn.connectionState === "failed") {
        setErr("Соединение не установилось. Чаще всего это строгий NAT — нужен сервер TURN.");
        setState("ended");
      }
      if (conn.connectionState === "connected") { setState("live"); setNote(""); }
    };

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

  const video = (ref, muted, label) => (
    <div style={{ position: "relative", flex: "1 1 240px", minWidth: 180 }}>
      <video ref={ref} autoPlay playsInline muted={muted}
        style={{ width: "100%", borderRadius: 10, background: "#000",
          aspectRatio: "3 / 4", objectFit: "cover", border: `1px solid ${C.line}` }} />
      <span style={{ position: "absolute", left: 8, bottom: 8, fontSize: 10.5,
        color: C.text, background: "#0009", borderRadius: 4, padding: "2px 6px" }}>
        {label}</span>
    </div>);

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
              {meeting.peers?.length ? ` · в комнате: ${meeting.peers.length}` : " · пока никого"}
            </div>
            {meeting.text && meeting.text !== meeting.title && (
              <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{meeting.text}</div>)}
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
            {err || "Загружаю встречу…"}</div>)}
      </div>

      <div className="flex flex-wrap gap-2" style={{ marginBottom: 10 }}>
        {video(localRef, true, mic ? "вы" : "вы · микрофон выключен")}
        {video(remoteRef, false, state === "live" ? "собеседник" : "ждём собеседника")}
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
          {state === "waiting" && "Жду собеседника. Как только он войдёт, соединение установится само."}
          {state === "live" && "Соединение установлено — видео и звук идут напрямую, мимо сервера."}
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
