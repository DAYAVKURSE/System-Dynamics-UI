/* ════════════════════════════════════════════════════════════════
   ПСЕВДОНИМ ИЗ ДВУХ СЛОВ (владелец, 2026-09-20)

   На «Рынке услуг» автор, с которым смотрящий вместе не работает,
   представляется не именем, а двумя словами — так же, как названы руки в
   тексте технологического процесса («wise oyster»; `newHandName` в
   `web/src/lib/hands.js`). Вместо лица у него знак приложения.

   Слово выбирается ПО ИДЕНТИФИКАТОРУ, а не наугад: один и тот же человек
   должен читаться одинаково и завтра, и у другого смотрящего — иначе
   «wise oyster» из вчерашнего заказа сегодня оказался бы кем-то другим.

   Списки слов — копия тех, что в `hands.js`: сервер в код приложения не
   заглядывает, а одно слово на две стороны того не стоит. Меняются они
   вместе.
   ════════════════════════════════════════════════════════════════ */

const ADJ = ["brave", "calm", "clever", "cosmic", "curious", "eager", "fancy", "funny", "gentle", "golden", "happy", "honest", "jolly", "kind",
  "lucky", "merry", "mighty", "noble", "polite", "proud", "quick", "quiet", "rapid", "royal", "shiny", "silent", "smart", "solar", "space",
  "steady", "sunny", "swift", "tidy", "vivid", "warm", "wise", "witty", "zesty", "amber", "coral", "ivory", "jade", "lunar", "misty", "olive"];
const NOUN = ["bear", "donut", "falcon", "otter", "panda", "comet", "maple", "river", "harbor", "lantern", "meadow", "orbit", "pebble", "pixel",
  "rocket", "saddle", "tulip", "walrus", "yeti", "zebra", "acorn", "badger", "canoe", "dolphin", "ember", "fjord", "garden", "heron", "island",
  "jigsaw", "kettle", "lemur", "mango", "nebula", "oyster", "parrot", "quartz", "raven", "sparrow", "tundra", "violet", "wagon", "beacon", "cactus"];

/* Два независимых перемешивания одной строки: если брать оба слова из
   одного числа, соседние идентификаторы дали бы соседние пары — «wise
   oyster» и «wise parrot» у двух подряд позванных людей. */
const hash = (s, seed) => {
  let n = seed;
  const str = String(s);
  for (let i = 0; i < str.length; i += 1) n = (n * 131 + str.charCodeAt(i)) % 1000003;
  return n;
};

/** Псевдоним человека — два слова, одни и те же при каждом чтении. */
export const aliasOf = (id) => {
  const key = String(id ?? "");
  return `${ADJ[hash(key, 7) % ADJ.length]} ${NOUN[hash(key, 8191) % NOUN.length]}`;
};
