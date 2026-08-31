import "@testing-library/jest-dom";
import { vi } from "vitest";

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
