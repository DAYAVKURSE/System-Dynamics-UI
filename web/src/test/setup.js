import "@testing-library/jest-dom";
import { vi } from "vitest";

// jsdom не реализует Pointer Events. Без этого события перетаскивания
// приходят без clientX/clientY, и тесты проверяли бы не то, что в браузере.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    constructor(type, props = {}) {
      super(type, props);
      this.pointerId = props.pointerId ?? 1;
      this.pointerType = props.pointerType ?? "mouse";
      this.isPrimary = props.isPrimary ?? true;
    }
  }
  window.PointerEvent = PointerEventPolyfill;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
}

// jsdom не реализует fetch — подстраховка для тестов, которые могут задеть
// код, обращающийся к бэкенду (в самих smoke-тестах он не должен вызываться).
if (!global.fetch) {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    }),
  );
}

/* Сведение записи (recordMix.js) опирается на холст, MediaStream и Web
   Audio. Ни того, ни другого, ни третьего в jsdom нет, поэтому подделки:
   без них любой тест, задевающий запись, падал бы не на своём поведении,
   а на «getContext не реализован». Подделки нарочно тупые — они не
   проверяют картинку и звук, а дают коду доехать до того, что проверяется:
   какой поток ушёл в MediaRecorder и что микшер узнал о новом участнике. */
if (typeof window.MediaStream === "undefined") {
  window.MediaStream = class MediaStream {
    constructor(tracks = []) {
      this.id = `mix${Math.random().toString(36).slice(2)}`;
      this._t = [...tracks];
    }
    getTracks() { return this._t; }
    getVideoTracks() { return this._t.filter((t) => t.kind === "video"); }
    getAudioTracks() { return this._t.filter((t) => t.kind === "audio"); }
    addTrack(t) { this._t.push(t); }
  };
  global.MediaStream = window.MediaStream;
}
// Свой getContext ставим ВСЕГДА: в jsdom он есть, но кричит «не
// реализовано» и отдаёт null — тогда код рисования не выполняется вовсе, и
// проверять в нём было бы нечего.
HTMLCanvasElement.prototype.getContext = function getContext() {
  if (!this._ctx) {
    this._ctx = { fillStyle: "", drawn: [], fillRect() {},
      drawImage(...a) { this.drawn.push(a); } };
  }
  return this._ctx;
};
if (!HTMLCanvasElement.prototype.captureStream) {
  HTMLCanvasElement.prototype.captureStream = function captureStream() {
    return new window.MediaStream([{ kind: "video", stop() {} }]);
  };
}
if (typeof window.AudioContext === "undefined") {
  window.AudioContext = class AudioContext {
    constructor() { this.sources = []; }
    createMediaStreamDestination() {
      return { stream: new window.MediaStream([{ kind: "audio", stop() {} }]) };
    }
    createMediaStreamSource(stream) {
      const node = { stream, connected: true, connect() {}, disconnect() { node.connected = false; } };
      this.sources.push(node);
      return node;
    }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  };
  global.AudioContext = window.AudioContext;
}
