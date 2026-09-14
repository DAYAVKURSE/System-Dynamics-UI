import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { addPoint, isEnough, newSignature, signatureRecord, signatureStats }
  from "../lib/signature.js";
import SignaturePad from "../components/SignaturePad.jsx";
import FramedField from "../components/FramedField.jsx";

/* ПОДПИСЬ: правила, поле подписи и поле в рамке.

   Проверяется не «рисуется ли линия» — рисование в jsdom всё равно
   заглушено, — а то, ради чего подпись вообще собирают траекторией:
   отличается ли росчерк от тычка, считается ли длина и время, связывает ли
   хеш подпись с подписантом и документом. */

// Росчерк: `n` точек через `step` пикселей и `ms` миллисекунд; `wig` — на
// сколько линия виляет вверх-вниз (виляние добавляет длины, поэтому в
// проверке короткого штриха оно нулевое).
const scribble = (n = 16, step = 20, ms = 25, wig = 10, index = 0) => {
  let sig = newSignature();
  for (let i = 0; i < n; i += 1) {
    sig = addPoint(sig, index, { x: i * step, y: 40 + (i % 2) * wig, t: i * ms });
  }
  return sig;
};

describe("что считается подписью", () => {
  it("точка — не подпись: одно касание без движения", () => {
    const dot = addPoint(newSignature(), 0, { x: 10, y: 10, t: 0 });
    expect(isEnough(dot)).toBe(false);
    expect(signatureStats(dot).length).toBe(0);
  });

  it("один короткий штрих — не подпись, даже если точек и времени хватает", () => {
    // 14 точек за 390 мс, но вся линия — 65 пикселей: чёрточка, а не росчерк.
    const short = scribble(14, 5, 30, 0);
    const st = signatureStats(short);
    expect(st.points).toBe(14);
    expect(st.durationMs).toBe(390);
    expect(st.length).toBeLessThan(120);
    expect(isEnough(short)).toBe(false);
  });

  it("длинный штрих — подпись; два штриха — подпись и без длины", () => {
    expect(isEnough(scribble(16, 20, 25))).toBe(true);
    // Два коротких штриха: так выглядят инициалы с росчерком.
    let two = scribble(8, 5, 40, 0);
    for (let i = 0; i < 8; i += 1) two = addPoint(two, 1, { x: i * 5, y: 80, t: 320 + i * 40 });
    expect(signatureStats(two).strokes).toBe(2);
    expect(isEnough(two)).toBe(true);
  });

  it("быстрый росчерк не проходит: рука не расписывается за 100 мс", () => {
    expect(isEnough(scribble(16, 20, 6, 0))).toBe(false); // длина 300, время 90 мс
  });
});

describe("сводка по траектории", () => {
  it("длина считается внутри штриха, перелёт между штрихами в неё не входит", () => {
    let sig = newSignature();
    sig = addPoint(sig, 0, { x: 0, y: 0, t: 0 });
    sig = addPoint(sig, 0, { x: 30, y: 40, t: 100 });   // отрезок 50
    sig = addPoint(sig, 1, { x: 1000, y: 1000, t: 200 }); // перелёт — не линия
    sig = addPoint(sig, 1, { x: 1000, y: 1010, t: 300 }); // отрезок 10
    const st = signatureStats(sig);
    expect(st.length).toBe(60);
    expect(st.strokes).toBe(2);
    expect(st.points).toBe(4);
    expect(st.durationMs).toBe(300);
  });

  it("bbox — прямоугольник по крайним точкам всех штрихов", () => {
    let sig = newSignature();
    sig = addPoint(sig, 0, { x: 10, y: 50, t: 0 });
    sig = addPoint(sig, 0, { x: 90, y: 20, t: 50 });
    sig = addPoint(sig, 1, { x: 40, y: 70, t: 90 });
    expect(signatureStats(sig).bbox).toEqual({ x: 10, y: 20, w: 80, h: 50 });
  });

  it("нажим: свой у стилуса, 0.5 у пальца и мыши", () => {
    const s = addPoint(addPoint(newSignature(), 0, { x: 0, y: 0, t: 0, p: 0.8 }),
      0, { x: 1, y: 1, t: 10 });
    expect(s.strokes[0][0].p).toBe(0.8);
    expect(s.strokes[0][1].p).toBe(0.5);
    // Ноль от браузера — это «нажима не знаю», а не «пера не касались».
    expect(addPoint(newSignature(), 0, { x: 0, y: 0, t: 0, p: 0 }).strokes[0][0].p).toBe(0.5);
  });
});

describe("запись подписи", () => {
  it("хеш — 64 шестнадцатеричных знака, и запись несёт штрихи и сводку", async () => {
    const sig = scribble();
    const rec = await signatureRecord(sig, { by: "И. Петров", docHash: "doc1",
      png: "data:image/png;base64,AA", ua: "jsdom" });
    expect(rec.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.by).toBe("И. Петров");
    expect(rec.docHash).toBe("doc1");
    expect(rec.strokes[0]).toHaveLength(16);
    expect(rec.strokes[0][3]).toEqual({ x: 60, y: 50, t: 75, p: 0.5 });
    expect(rec.stats.points).toBe(16);
    expect(new Date(rec.at).toISOString()).toBe(rec.at);
  });

  it("другой подписант или другой документ — другой хеш при той же траектории", async () => {
    const sig = scribble();
    const a = await signatureRecord(sig, { by: "И. Петров", docHash: "doc1" });
    const b = await signatureRecord(sig, { by: "С. Сидоров", docHash: "doc1" });
    const c = await signatureRecord({ ...sig }, { by: "И. Петров", docHash: "doc2" });
    expect(b.hash).not.toBe(a.hash);
    expect(c.hash).not.toBe(a.hash);
    // Та же связка и тот же момент — тот же хеш: проверка на сервере сойдётся.
    expect(await (async () => {
      const { sha256Hex } = await import("../lib/signature.js");
      return sha256Hex(JSON.stringify({ by: a.by, at: a.at, docHash: a.docHash,
        strokes: a.strokes }));
    })()).toBe(a.hash);
  });
});

/* ─────── ПОЛЕ ПОДПИСИ ───────
   Время в поле берётся из performance.now(): подменяем его своими часами,
   иначе шестнадцать событий подряд уложатся в пару миллисекунд, и подпись
   останется «слишком короткой» по длительности — тест проверял бы скорость
   машины, а не правило. */
let clock = 0;
beforeEach(() => {
  clock = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});
afterEach(() => { vi.restoreAllMocks(); });

const sign = (canvas, { n = 16, step = 20, ms = 25 } = {}) => {
  fireEvent.pointerDown(canvas, { clientX: 0, clientY: 40, pointerId: 1 });
  for (let i = 1; i < n; i += 1) {
    clock += ms;
    fireEvent.pointerMove(canvas, { clientX: i * step, clientY: 40 + (i % 2) * 10, pointerId: 1 });
  }
  fireEvent.pointerUp(canvas, { pointerId: 1 });
};

describe("поле подписи", () => {
  it("«Готово» заблокирована, пока подписи нет, и рядом сказано почему", () => {
    render(<SignaturePad by="И. Петров" docHash="doc1" onDone={() => {}} onCancel={() => {}}/>);
    expect(screen.getByRole("dialog", { name: "подпись" })).toBeInTheDocument();
    expect(screen.getByLabelText("поле подписи")).toBeInTheDocument();
    expect(screen.getByText(/Распишитесь пальцем или стилусом/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Готово" })).toBeDisabled();
    expect(screen.getByText("слишком коротко для подписи")).toBeInTheDocument();
  });

  it("после росчерка кнопка оживает, и «Готово» отдаёт запись с траекторией и хешем", async () => {
    const onDone = vi.fn();
    render(<SignaturePad by="И. Петров" docHash="doc1" onDone={onDone} onCancel={() => {}}/>);
    sign(screen.getByLabelText("поле подписи"));
    const ok = screen.getByRole("button", { name: "Готово" });
    await waitFor(() => expect(ok).toBeEnabled());
    expect(screen.queryByText("слишком коротко для подписи")).toBeNull();
    fireEvent.click(ok);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const rec = onDone.mock.calls[0][0];
    expect(rec.by).toBe("И. Петров");
    expect(rec.docHash).toBe("doc1");
    expect(rec.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.strokes).toHaveLength(1);
    expect(rec.strokes[0]).toHaveLength(16);
    // Время идёт от первой точки, а не от открытия окна.
    expect(rec.strokes[0][0].t).toBe(0);
    expect(rec.stats.durationMs).toBe(375);
    expect(rec.stats.length).toBeGreaterThan(120);
  });

  it("«Очистить» возвращает поле в начало", async () => {
    render(<SignaturePad by="И. Петров" docHash="doc1" onDone={() => {}} onCancel={() => {}}/>);
    sign(screen.getByLabelText("поле подписи"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Готово" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Очистить" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Готово" })).toBeDisabled());
    expect(screen.getByText("слишком коротко для подписи")).toBeInTheDocument();
  });

  it("«Отмена» зовёт onCancel и ничего не подписывает", () => {
    const onCancel = vi.fn(), onDone = vi.fn();
    render(<SignaturePad by="И. Петров" docHash="doc1" onDone={onDone} onCancel={onCancel}/>);
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("поле в рамке", () => {
  it("рамка с врезанной подписью: fieldset и legend с текстом", () => {
    const { container } = render(
      <FramedField label="Телефон"><input aria-label="телефон" defaultValue="+7"/></FramedField>);
    const set = container.querySelector("fieldset");
    expect(set).not.toBeNull();
    expect(set.getAttribute("aria-label")).toBe("Телефон");
    const leg = set.querySelector("legend");
    expect(leg.textContent).toBe("Телефон");
    expect(set.style.border).toContain("1px solid");
    expect(screen.getByLabelText("телефон")).toBeInTheDocument();
  });

  it("обязательное поле помечено звёздочкой, необязательное — нет", () => {
    const { container, rerender } = render(
      <FramedField label="Фамилия" required><input aria-label="фамилия"/></FramedField>);
    const star = container.querySelector("legend span");
    expect(star.textContent.trim()).toBe("*");
    // Читалке звёздочка не нужна: обязательность — дело проверки при отправке.
    expect(star.getAttribute("aria-hidden")).toBe("true");
    rerender(<FramedField label="Фамилия"><input aria-label="фамилия"/></FramedField>);
    expect(container.querySelector("legend span")).toBeNull();
  });
});
