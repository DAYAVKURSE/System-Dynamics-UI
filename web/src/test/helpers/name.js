import { fireEvent, screen } from "@testing-library/react";

/* Название формы — надпись, а не поле: правка открывается двойным
   нажатием (владелец, 2026-09-19, `NameField` в `ui.jsx`). Тесты делают то
   же, что человек: раскрывают надпись и пишут. */

export function renameEl(el, value) {
  const box = el.parentElement;
  fireEvent.doubleClick(el);
  const input = box.querySelector("input");
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
  return input;
}

export const rename = (label, value) => renameEl(screen.getByLabelText(label), value);

/** Что написано в названии формы. */
export const nameText = (label) => screen.getByLabelText(label).textContent;

/** Карточка ищется по своему названию — надписи, а не полю. */
export const nameSpan = (text) => [...document.querySelectorAll("[data-name-field]")]
  .find((el) => el.textContent === text);
