import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CallRoom, { MAX_RECORDING_BYTES } from "../components/CallRoom.jsx";
import { resetReportsAvailable } from "../storage.js";

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

  it("без TURN на сервере звонок не начинается", async () => {
    // Камера к этому моменту уже включена — её просят на предварительном
    // экране, до входа, и это осознанный размен: человек видит себя и
    // решает, входить ли с камерой, ещё до того как его увидят. А вот
    // соединение без ретрансляции не заводится: звонок идёт только через
    // сервер, и молча делать вид, что вошли, нельзя.
    ice = { ...ice, turn: false };
    await join();
    expect(await screen.findByText(/не настроена ретрансляция/)).toBeInTheDocument();
    expect(pcs).toHaveLength(0);
    expect(await screen.findByText("Войти в звонок")).toBeInTheDocument();
  });

  it("доступ к камере спрашивают ДО входа, и второй раз при входе не спрашивают", async () => {
    render(<CallRoom meetingId="m1" meId="100" myName="Я" fit />);
    // Ещё никуда не входили, а камеру уже спросили — на предварительном экране.
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Войти в звонок")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Войти в звонок"));
    await waitFor(() => expect(screen.getByText(/Жду остальных/)).toBeInTheDocument());
    // Вход забирает тот же поток: второго системного запроса быть не должно.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
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
  beforeEach(() => {
    recorders.length = 0; global.MediaRecorder = FakeRecorder; resetReportsAvailable();
  });

  it("пишет ВСЕХ: в MediaRecorder уходит сведённый поток, а не свой", async () => {
    // Владелец увидел на записи только свой экран и свой голос — в
    // MediaRecorder уходил свой поток целиком. Теперь туда идёт сведённый:
    // холст со всеми плитками и микшер со всеми голосами (recordMix.js).
    await join();
    fireEvent.click(await screen.findByLabelText("запись"));
    await waitFor(() => expect(recorders).toHaveLength(1));
    const got = recorders[0].stream;

    // У своего потока дорожки настоящие, у сведённого — холст и микшер.
    expect(got.getVideoTracks()).toHaveLength(1);
    expect(got.getAudioTracks()).toHaveLength(1);
    expect(got.getTracks().every((t) => !(t instanceof FakeTrack))).toBe(true);
  });

  it("подключившийся во время записи попадает в неё голосом", async () => {
    // Микшер живёт всю запись, а состав меняется: без пересборки у
    // пришедшего позже не было бы звука, и владелец снова услышал бы на
    // записи только себя — уже по другой причине.
    const made = vi.spyOn(window.AudioContext.prototype, "createMediaStreamSource");
    signalsOnce = [hello("200", "Пётр")];
    await join();
    fireEvent.click(await screen.findByLabelText("запись"));
    await waitFor(() => expect(recorders).toHaveLength(1));
    const before = made.mock.calls.length;

    const theirs = fakeStream();
    await waitFor(() => expect(pcs).toHaveLength(1));
    act(() => { pcs[0].ontrack({ streams: [theirs] }); });

    await waitFor(() => expect(made.mock.calls.length).toBeGreaterThan(before));
    expect(made.mock.calls.some(([st]) => st === theirs)).toBe(true);
  });

  it("о записи сообщают собеседникам, а не пишут их молча", async () => {
    // Раньше каждый писал только себя, и предупреждать было не о чем.
    // Теперь запись забирает всех — молчать об этом нельзя.
    signalsOnce = [hello("200", "Пётр")];
    await join();
    fireEvent.click(await screen.findByLabelText("запись"));
    await waitFor(() => expect(posted.some((p) => p.data.type === "rec" && p.data.on)).toBe(true));

    fireEvent.click(screen.getByLabelText("запись"));
    await waitFor(() => expect(posted.some((p) => p.data.type === "rec" && !p.data.on)).toBe(true));
  });

  it("когда пишет собеседник, об этом сказано на экране", async () => {
    await join();
    await waitFor(() => expect(pendingPoll).toBeTruthy());
    act(() => deliver([{ from: "200", data: { type: "rec", on: true } }]));
    expect(await screen.findByText(/звонок записывает/i)).toBeInTheDocument();

    act(() => deliver([{ from: "200", data: { type: "rec", on: false } }]));
    await waitFor(() => expect(screen.queryByText(/звонок записывает/i)).toBeNull());
  });

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

  it("когда сохранять некуда, запись не начинается вовсе", async () => {
    // Иначе сорок минут записи исчезали в момент остановки, и человек
    // узнавал об этом последним — из сообщения, которое до того уверяло,
    // что запись идёт.
    const realFetch = global.fetch;
    global.fetch = vi.fn(async (url, opts) => (String(url).endsWith("/api/health")
      ? ok({ ok: true, reports: false })
      : realFetch(url, opts)));
    await join();
    fireEvent.click(await screen.findByLabelText("запись"));
    expect(await screen.findByText(/Сохранять запись некуда/)).toBeInTheDocument();
    expect(recorders).toHaveLength(0);
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

describe("имя участника", () => {
  it("имя, набранное ДО входа, доходит до тех, кто подключился позже", async () => {
    // Гость печатает имя в поле окна звонка и только потом жмёт «Войти».
    // Цикл опроса запоминал разбор сигналов из первого рендера — вместе с
    // тогдашним пустым именем, — и в ответ «привет» уходила пустота.
    const { rerender } = render(<CallRoom meetingId="m1" meId="100" myName="" />);
    rerender(<CallRoom meetingId="m1" meId="100" myName="Гость Вася" />);
    fireEvent.click(await screen.findByText("Войти в звонок"));
    await waitFor(() => expect(posted.some((p) => p.data.type === "hello")).toBe(true));

    // Кто-то подключается позже и здоровается — мы отвечаем своим именем.
    await waitFor(() => expect(pendingPoll).toBeTruthy());
    act(() => deliver([hello("200", "Пётр")]));
    await waitFor(() => expect(posted.some((p) => p.data.type === "hello-back")).toBe(true));
    expect(posted.find((p) => p.data.type === "hello-back").data.name).toBe("Гость Вася");
  });

  it("переименование во время звонка тоже доходит", async () => {
    const { rerender } = render(<CallRoom meetingId="m1" meId="100" myName="Аня" />);
    fireEvent.click(await screen.findByText("Войти в звонок"));
    await waitFor(() => expect(posted.some((p) => p.data.type === "hello")).toBe(true));
    rerender(<CallRoom meetingId="m1" meId="100" myName="Анна Петровна" />);
    await waitFor(() => expect(pendingPoll).toBeTruthy());
    act(() => deliver([hello("300", "Пётр")]));
    await waitFor(() => expect(posted.some((p) => p.data.type === "hello-back")).toBe(true));
    expect(posted.find((p) => p.data.type === "hello-back").data.name).toBe("Анна Петровна");
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
    render(<CallRoom meetingId="m1" meId="100" fit />);
    const box = await screen.findByTestId("call-fit");
    expect(box.style.height).toBe("100%");
    expect(box.style.display).toBe("flex");
    expect(screen.queryByText(/ссылка на этот звонок/)).toBeNull();
    // Кнопки «⤢ на весь экран» больше нет: окно и так во весь экран, а
    // свернуть его обратно нечем — expand() односторонний.
    expect(screen.queryByLabelText("на весь экран")).toBeNull();
  });

  it("в обычном режиме ссылка на звонок ведёт на отдельную страницу /call", async () => {
    render(<CallRoom meetingId="m1" meId="100" />);
    expect(await screen.findByText(/\/call\?call=m1/)).toBeInTheDocument();
  });
});

/* Ничто не выталкивает кнопки за нижний край окна.

   Замер в настоящем Chromium (окно 360×400): сетка видео отдаёт сообщениям
   место точка в точку — 280 → 229 → 177 → 91 → 56 → 0, — а дойдя до нуля,
   начинала расти вся колонка, и ряд кнопок оказывался на 19 точек ниже
   панели и на 11 ниже окна. Обрезки не было нигде: содержимое существовало,
   но его не было видно и нельзя было нажать, и полосы прокрутки при этом
   не появлялось. Снаружи это ровно та жалоба, с которой всё началось:
   «страница занимает больше, чем есть на экране».

   Разметку в jsdom не посчитать, поэтому проверяем то, на чём держится
   защита: обрезку у корня и у блока сообщений и однострочность текстов. */
describe("ничего не уезжает за нижний край", () => {
  const fitRoot = () => screen.getByTestId("call-fit");

  it("корень компактного окна обрезает лишнее", async () => {
    render(<CallRoom meetingId="m1" meId="100" myName="Я" fit />);
    await screen.findByText("Войти в звонок");
    expect(fitRoot().style.overflow).toBe("hidden");
    expect(fitRoot().style.minHeight).toBe("0");
  });

  it("блок сообщений сжимается и обрезается, а не толкает кнопки", async () => {
    render(<CallRoom meetingId="m1" meId="100" myName="Я" fit />);
    await screen.findByText("Войти в звонок");
    // Блок сообщений — предпоследний ребёнок: заголовок, сетка, сообщения, кнопки.
    const kids = [...fitRoot().children];
    const box = kids[kids.length - 2];
    expect(box.style.overflow).toBe("hidden");
    expect(box.style.minHeight).toBe("0");
    expect(box.style.flex).not.toContain("0 0");   // сжиматься разрешено
  });

  it("длинная ошибка прижата к одной строке", async () => {
    // Тексты ошибок приходят от браузера и от сервера, длину им никто не
    // ограничивает: пятнадцать строк такого текста — 259 точек, ровно на
    // которые и уезжали кнопки. Ошибку добываем настоящую: у встречи, за
    // которую сервер не отдаёт серверы соединения, вход не состоится.
    global.fetch = vi.fn(async (url) => (String(url).endsWith("/api/calls/m1")
      ? ok({ id: "m1", title: "Разбор прогноза", at: "", peers: [] })
      : ok({ error: "Не удалось включить камеру: ".repeat(8) }, 500)));
    render(<CallRoom meetingId="m1" meId="100" myName="Я" fit />);
    fireEvent.click(await screen.findByText("Войти в звонок"));

    // Ищем именно строку ошибки: у неё есть подсказка с полным текстом.
    const line = await waitFor(() => {
      const d = [...screen.getByTestId("call-fit").querySelectorAll("div[title]")]
        .find((x) => /Сервер не отвечает|не настроена|камеру/i.test(x.getAttribute("title") || ""));
      if (!d) throw new Error("ошибки ещё нет");
      return d;
    });
    expect(line.style.whiteSpace).toBe("nowrap");
    expect(line.style.textOverflow).toBe("ellipsis");
    expect(line.title).toBeTruthy();          // целиком — по долгому нажатию
  });
});

/* Чёрный прямоугольник вместо себя — жалоба, с которой всё началось:
   «вместо видео вижу чёрный экран». Причин у него три, и лечатся они
   по-разному, поэтому плитка называет причину словами. */
describe("вместо чёрного прямоугольника — слова", () => {
  it("пока камеру не дали, так и написано", async () => {
    let release;
    getUserMedia.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    render(<CallRoom meetingId="m1" meId="100" myName="Я" fit />);
    expect(await screen.findByText("включаю камеру…")).toBeInTheDocument();
    await act(async () => { release(fakeStream()); });
    await waitFor(() => expect(screen.queryByText("включаю камеру…")).toBeNull());
  });

  it("отказ в доступе назван отказом, а не чёрным экраном", async () => {
    getUserMedia.mockRejectedValueOnce(new Error("Доступ к камере запрещён."));
    render(<CallRoom meetingId="m1" meId="100" myName="Я" fit />);
    expect(await screen.findByText("камеру не дали")).toBeInTheDocument();
    // И войти всё равно можно: звонок без камеры — это звонок.
    expect(screen.getByText("Войти в звонок")).toBeInTheDocument();
  });

  it("выключенная камера тоже подписана", async () => {
    render(<CallRoom meetingId="m1" meId="100" myName="Я" fit />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText("камера"));
    expect(await screen.findByText("камера выключена")).toBeInTheDocument();
  });
});
