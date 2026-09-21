/* ════════════════════════════════════════════════════════════════
   ПЛАНЫ И СПОСОБЫ ОПЛАТЫ

   План — то, что человек выбрал при регистрации (владелец, 2026-09-21):
   free, pro, max. Что именно открывает каждый, решает приложение
   (`web/src/plans.js`, `server/src/lib/plans.js`); здесь — только их
   имена и цены, потому что платят сюда.

   Оплата ПОКА ЗАМОКАНА: способ выбирается, а сам платёж считается
   полученным сразу. Способы — те, для которых не нужны ни юрлицо, ни
   проверка личности: кошелёк принимает перевод напрямую.
   ════════════════════════════════════════════════════════════════ */
export const PLANS = ["free", "pro", "max"];
/* Цена в месяц, в долларах — общая мера для всех способов; в валюту
   способа пересчитывает сам способ по курсу на момент оплаты. */
export const PRICE = { free: 0, pro: 10, max: 30 };
export const METHODS = ["usdt", "ton", "stars"];

export const planOf = (v) => (PLANS.includes(String(v)) ? String(v) : null);
export const methodOf = (v) => (METHODS.includes(String(v)) ? String(v) : null);

/* Платёж. Сейчас — запись о том, что платить было нужно и что это
   считается сделанным; когда появится настоящий приём, здесь будет
   ожидание перевода. Бесплатному плану платёж не нужен вовсе. */
export function pay({ plan, method }) {
  const price = PRICE[plan] ?? 0;
  if (!price) return { status: "paid", method: null, amount: 0, at: new Date().toISOString() };
  return { status: "paid", method, amount: price, mocked: true, at: new Date().toISOString() };
}
