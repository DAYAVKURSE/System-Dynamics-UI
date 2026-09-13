/* ═══════════════ АНКЕТА ИЗ ТЕКСТА ═══════════════
   Владелец: «помимо ручного добавления полей должна быть кнопка
   «Загрузить анкету». Анкета должна приниматься в виде пронумерованного
   списка вопросов». Разбор строгий и простой: вопрос начинается строкой
   «N. текст» (или «N) текст», «N: текст»); строка без номера продолжает
   предыдущий вопрос — длинный вопрос переносят на следующую строку, а не
   нумеруют заново. Текст без единого номера — не анкета, и об этом
   говорится словами, а не пустым списком. */

const NUMBERED = /^(\d{1,3})\s*[.)\]:]\s*(.+)$/;
export const NEED_NUMBERS = "Нужен пронумерованный список: «1. вопрос», «2. вопрос»…";

/** @returns {{questions: string[], error: string}} */
export function parseNumbered(text) {
  const lines = String(text || "").split(/\r?\n/);
  const questions = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(NUMBERED);
    if (m) { questions.push(m[2].trim()); continue; }
    if (!questions.length) return { questions: [], error: NEED_NUMBERS };
    questions[questions.length - 1] += ` ${line}`;
  }
  if (!questions.length) return { questions: [], error: String(text || "").trim() ? NEED_NUMBERS : "" };
  return { questions, error: "" };
}
