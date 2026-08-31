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
