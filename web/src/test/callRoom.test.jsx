import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CallRoom, { MAX_RECORDING_BYTES } from "../components/CallRoom.jsx";

/* Окно звонка: медиа только через сервер, имена в «привете», показ экрана,
   запись с пределом размера, компактная раскладка. WebRTC и камера —
   подделки: проверяется, что окно с ними делает, а не сами они. */

class FakeTrack {
  constructor(kind) { this.kind = kind; this.enabled = true; this.stopped = false; }
  stop() { this.stopped = true; }
}
const fakeStream = (kinds = ["audio", "video"]) => {
  const tracks = kinds.map((k) => new FakeTrack(k));
  return {
    id: `s${Math.random()}`,
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  };
};

const pcs = [];
class FakePC {
  constructor(cfg) {
    this.cfg = cfg; this.senders = []; this.signalingState = "stable";
    this.connectionState = "new"; pcs.push(this);
  }
  addTrack(track, stream) {
    const s = { track, stream, replaceTrack: vi.fn(async (t) => { s.track = t; }) };
    this.senders.push(s); return s;
  }
  getSenders() { return this.senders; }
  async createOffer() { return { type: "offer", sdp: "o" }; }
  async createAnswer() { return { type: "answer", sdp: "a" }; }
  async setLocalDescription(d) {
    this.localDescription = d;
    this.signalingState = d.type === "offer" ? "have-local-offer" : "stable";
  }
  async setRemoteDescription(d) { this.remoteDescription = d; this.signalingState = "stable"; }
  async addIceCandidate() {}
  close() { this.connectionState = "closed"; }
}

let ice, signalsOnce, posted, reportStatus, getUserMedia, getDisplayMedia, pendingPoll, seq;
// Доставить сигналы в висящий длинный опрос — как это делает сервер.
const deliver = (signals) => {
  const r = pendingPoll; pendingPoll = null;
  r?.(ok({ seq: ++seq, signals, peers: [] }));
};
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  pcs.length = 0;
  posted = [];
  signalsOnce = [];
  pendingPoll = null; seq = 0;
  reportStatus = 200;
  ice = { iceServers: [{ urls: ["stun:s"] }, { urls: ["turn:t"], username: "u", credential: "c" }],
    turn: true, maxPeers: 20 };
  getUserMedia = vi.fn(async () => fakeStream());
  getDisplayMedia = null;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    get: () => ({ getUserMedia, ...(getDisplayMedia ? { getDisplayMedia } : {}) }),
  });
  global.RTCPeerConnection = FakePC;
  delete global.MediaRecorder;
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    // Серверы соединения выдаются под конкретную встречу: знание её id —
    // то же право, что и войти в комнату.
    if (u.endsWith("/api/calls/m1/ice")) return ok(ice);
    if (/\/api\/calls\/m1\/signal\?since=/.test(u)) {
      if (signalsOnce.length) { const s = signalsOnce; signalsOnce = []; return ok({ seq: ++seq, signals: s, peers: [] }); }
      return new Promise((res) => { pendingPoll = res; });   // длинный опрос: ждём deliver()
    }
    if (u.endsWith("/api/calls/m1/signal")) { posted.push(JSON.parse(opts.body)); return ok({ n: 1 }); }
    if (u.endsWith("/api/calls/m1")) return ok({ id: "m1", title: "Разбор прогноза", at: "завтра 15:00", peers: [] });
    if (u.endsWith("/api/health")) return ok({ ok: true, reports: true, scenarios: true });
    if (u.endsWith("/api/reports")) return ok({ id: "r1", name: "звонок.webm", url: "/api/reports/r1" }, reportStatus);
    return ok({}, 404);
  });
});
afterEach(() => { vi.restoreAllMocks(); });

const join = async (props = {}) => {
  const ui = render(<CallRoom meetingId="m1" meId="100" myName="Я" {...props} />);
  fireEvent.click(await screen.findByText("Войти в звонок"));
  return ui;
};
const hello = (from, name) => ({ from, to: null, data: { type: "hello", name } });

describe("медиа только через сервер", () => {
  it("соединение создаётся с iceTransportPolicy relay и серверами с /ice", async () => {
    signalsOnce = [hello("200", "Пётр")];
    await join();
    await waitFor(() => expect(pcs).toHaveLength(1));
    expect(pcs[0].cfg.iceTransportPolicy).toBe("relay");
    expect(pcs[0].cfg.iceServers).toEqual(ice.iceServers);
    // Тот, чей id меньше, делает предложение.
    await waitFor(() => expect(posted.some((p) => p.data.type === "offer" && p.to === "200")).toBe(true));
  });

  it("без TURN на сервере звонок не начинается и камера не включается", async () => {
    ice = { ...ice, turn: false };
    await join();
    expect(await screen.findByText(/не настроена ретрансляция/)).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(await screen.findByText("Войти в звонок")).toBeInTheDocument();
  });

  it("статус говорит «через сервер», а не «напрямую»", async () => {
    signalsOnce = [hello("200", "Пётр")];
    await join();
    await waitFor(() => expect(pcs).toHaveLength(1));
    act(() => { pcs[0].connectionState = "connected"; pcs[0].onconnectionstatechange(); });
    act(() => { pcs[0].ontrack({ streams: [fakeStream()] }); });
    expect(await screen.findByText(/Через сервер · 1 участник кроме вас/)).toBeInTheDocument();
    expect(screen.queryByText(/напрямую/)).toBeNull();
  });

  it("сбой соединения объясняется путём до сервера, а не «нужен TURN»", async () => {
    signalsOnce = [hello("200", "Пётр")];
    await join();
    await waitFor(() => expect(pcs).toHaveLength(1));
    act(() => { pcs[0].connectionState = "failed"; pcs[0].onconnectionstatechange(); });
    expect(await screen.findByText(/до сервера ретрансляции/)).toBeInTheDocument();
    expect(screen.queryByText(/нужен TURN/)).toBeNull();
  });
});

describe("имена", () => {
  it("«привет» несёт имя, а плитка собеседника подписывается его именем", async () => {
    signalsOnce = [hello("200", "Пётр")];
    await join();
    await waitFor(() => expect(posted[0]?.data).toEqual({ type: "hello", name: "Я" }));
    await waitFor(() => expect(pcs).toHaveLength(1));
    // Ответный «привет» тоже с именем — новичок должен подписать нас.
    const back = posted.find((p) => p.data.type === "hello-back");
    expect(back.to).toBe("200");
    expect(back.data.name).toBe("Я");
    act(() => { pcs[0].ontrack({ streams: [fakeStream()] }); });
    expect(await screen.findByText("Пётр")).toBeInTheDocument();
  });
});

describe("показ экрана", () => {
  it("без getDisplayMedia кнопки нет — на телефоне её нечем выполнить", async () => {
    await join();
    await waitFor(() => expect(screen.getByLabelText("микрофон")).toBeInTheDocument());
    expect(screen.queryByLabelText("экран")).toBeNull();
  });

  it("с ним — подменяет видеодорожку у собеседников и возвращает камеру", async () => {
    const screenStream = fakeStream(["video"]);
    getDisplayMedia = vi.fn(async () => screenStream);
    signalsOnce = [hello("200", "Пётр")];
    await join();
    await waitFor(() => expect(pcs).toHaveLength(1));
    const videoSender = pcs[0].senders.find((s) => s.track.kind === "video");
    const camTrack = videoSender.track;

    fireEvent.click(screen.getByLabelText("экран"));
    await waitFor(() => expect(videoSender.replaceTrack).toHaveBeenCalledWith(screenStream.getVideoTracks()[0]));
    expect(getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(await screen.findByText("ваш экран")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("экран"));
    await waitFor(() => expect(videoSender.replaceTrack).toHaveBeenLastCalledWith(camTrack));
    expect(screenStream.getVideoTracks()[0].stopped).toBe(true);
    await waitFor(() => expect(screen.queryByText("ваш экран")).toBeNull());
  });

  it("новый собеседник получает экран, а не камеру, пока экран показывается", async () => {
    const screenStream = fakeStream(["video"]);
    getDisplayMedia = vi.fn(async () => screenStream);
    await join();
    await waitFor(() => expect(screen.getByLabelText("экран")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("экран"));
    await screen.findByText("ваш экран");
    await waitFor(() => expect(pendingPoll).toBeTruthy());
    act(() => deliver([hello("200", "Пётр")]));
    await waitFor(() => expect(pcs).toHaveLength(1));
    const video = pcs[0].senders.find((s) => s.track.kind === "video");
    expect(video.track).toBe(screenStream.getVideoTracks()[0]);
  });
});

describe("запись", () => {
  const recorders = [];
  class FakeRecorder {
    constructor(stream, opts) {
      this.stream = stream; this.opts = opts; this.state = "inactive"; recorders.push(this);
    }
    static isTypeSupported() { return true; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.onstop?.(); }
  }
  beforeEach(() => { recorders.length = 0; global.MediaRecorder = FakeRecorder; });

  it("пишется умеренный битрейт, а у предела размера запись останавливается сама", async () => {
    await join();
    fireEvent.click(await screen.findByLabelText("запись"));
    await waitFor(() => expect(recorders).toHaveLength(1));
    expect(recorders[0].opts.videoBitsPerSecond).toBe(300000);
    expect(recorders[0].state).toBe("recording");
    act(() => { recorders[0].ondataavailable({ data: { size: MAX_RECORDING_BYTES } }); });
    // Остановилась сама и сразу ушла на сервер — без нажатия «стоп».
    expect(recorders[0].state).toBe("inactive");
    expect(await screen.findByText(/Запись сохранена/)).toBeInTheDocument();
    expect(global.fetch.mock.calls.some(([u, o]) => String(u).endsWith("/api/reports") && o?.method === "POST"))
      .toBe(true);
    expect(screen.getByLabelText("запись").title).toBe("записать");
  });

  it("во время записи картинка не пересоздаётся — экран не моргает", async () => {
    // Пока Tile был объявлен внутри компонента, каждый рендер был для React
    // НОВЫМ типом: он сносил <video> и создавал заново, и картинка гасла.
    // Во время записи кусок приходит раз в секунду — экран моргал ровно с
    // этой частотой.
    const { container } = await join();
    const videoBefore = container.querySelector("video");
    fireEvent.click(await screen.findByLabelText("запись"));
    await waitFor(() => expect(recorders).toHaveLength(1));
    for (const size of [400000, 400000, 400000]) {
      act(() => { recorders[0].ondataavailable({ data: { size } }); });
    }
    expect(container.querySelector("video")).toBe(videoBefore);
  });

  it("413 от сервера объясняется размером, а не кодом", async () => {
    reportStatus = 413;
    await join();
    fireEvent.click(await screen.findByLabelText("запись"));
    await waitFor(() => expect(recorders).toHaveLength(1));
    act(() => { recorders[0].ondataavailable({ data: { size: 5 * 1024 * 1024 } }); });
    fireEvent.click(screen.getByLabelText("запись"));
    expect(await screen.findByText(/больше, чем принимает сервер/)).toBeInTheDocument();
  });
});

describe("до входа в звонок", () => {
  it("камеру и микрофон можно выключить ДО входа, и они остаются выключенными", async () => {
    render(<CallRoom meetingId="m1" meId="100" myName="Я" />);
    // Кнопки есть сразу, а не после входа: решать, войти ли с камерой,
    // человек должен до того, как его увидят.
    const camBtn = await screen.findByLabelText("камера");
    const micBtn = screen.getByLabelText("микрофон");
    expect(screen.getByText("Войти в звонок")).toBeInTheDocument();

    fireEvent.click(camBtn);
    fireEvent.click(micBtn);
    expect(screen.getByLabelText("камера").title).toBe("включить камеру");
    expect(screen.getByLabelText("микрофон").title).toBe("включить микрофон");

    fireEvent.click(screen.getByText("Войти в звонок"));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    const stream = await getUserMedia.mock.results[0].value;
    await waitFor(() => expect(stream.getVideoTracks()[0].enabled).toBe(false));
    expect(stream.getAudioTracks()[0].enabled).toBe(false);
  });
});

describe("компактный режим", () => {
  it("окно не прокручивается: колонка на всю высоту, без карточки со ссылкой", async () => {
    render(<CallRoom meetingId="m1" meId="100" fit onExpand={() => {}} />);
    const box = await screen.findByTestId("call-fit");
    expect(box.style.height).toBe("100%");
    expect(box.style.display).toBe("flex");
    expect(screen.queryByText(/ссылка на этот звонок/)).toBeNull();
    expect(screen.getByLabelText("на весь экран")).toBeInTheDocument();
  });

  it("в обычном режиме ссылка на звонок ведёт на отдельную страницу /call", async () => {
    render(<CallRoom meetingId="m1" meId="100" />);
    expect(await screen.findByText(/\/call\?call=m1/)).toBeInTheDocument();
  });
});
