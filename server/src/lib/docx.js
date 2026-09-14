import JSZip from "jszip";
import { parse as parseHtml } from "node-html-parser";

/* ════════════════════════════════════════════════════════════════
   ДОГОВОР В .DOCX — собрать, прочитать, заполнить, подписать

   Договор живёт в том формате, в котором его привыкли открывать и
   печатать, — в Word. Внешних сервисов и конвертеров тут нет и не будет:
   .docx — это обычный zip с XML внутри, а всё, что нам нужно (текст
   абзацев, плейсхолдеры, рамки для подписей, картинка подписи), лежит в
   `word/document.xml`. Поэтому вся библиотека — jszip плюс аккуратная
   работа со строкой XML.

   ─── почему строкой, а не деревом ───

   Разбирать document.xml в DOM и собирать обратно — значит переписать
   файл целиком: потерять неизвестные нам теги (правки, поля, сноски,
   настройки нумерации), которые Word положил и ждёт увидеть назад. Мы
   работаем ТОЧЕЧНО: находим нужный кусок строки и правим только его, а
   всё остальное содержимое zip (стили, шрифты, колонтитулы, картинки)
   переносится как есть. Так чужой договор, открытый и заполненный нами,
   остаётся тем же договором.

   ─── почему плейсхолдер приходится склеивать ───

   Word режет текст на `w:r` («прогоны») где ему вздумается: после
   проверки орфографии, правки, смены языка `[(sum): сумма]` легко
   оказывается в двух-трёх прогонах. Поэтому при заполнении мы смотрим на
   СКЛЕЕННЫЙ текст абзаца, и если плейсхолдер разорван — сливаем текстовые
   прогоны абзаца в один (формат берём у первого) и только потом меняем.
   Абзацы, где всё целое, не трогаем вовсе — меньше правок, меньше риска.

   ─── как договор понимает, где чья подпись ───

   Договорились с владельцем: место подписи первой стороны обведено
   СПЛОШНОЙ рамкой, второй — ПУНКТИРНОЙ. Рамка может быть у абзаца
   (`w:pBdr`) или у ячейки таблицы (`w:tcBorders`) — в вордовских шаблонах
   подписи обычно рисуют таблицей. Word пишет пунктир несколькими словами
   (`dashed`, `dashSmallGap`, `dotted`, `dotDash`) — принимаем все.

   ─── порядок абзацев ───

   Индекс абзаца — это его номер в порядке документа, считая абзацы внутри
   таблиц. Один и тот же порядок у `docxText`, `signatureFrames` и
   `insertSignature` (общая функция `paraSpans`), иначе индексы разошлись
   бы и подпись села не туда.

   ─── почему всё возвращает Promise ───

   jszip 3 умеет собирать zip только асинхронно, поэтому `buildDocx` тоже
   асинхронный: синхронной «сборки в Buffer» в природе не осталось.
   ════════════════════════════════════════════════════════════════ */

/* ─────────────── общее: пространства имён, экранирование ─────────────── */

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
};
const NS_ATTRS = Object.entries(NS).map(([p, u]) => `xmlns:${p}="${u}"`).join(" ");

const IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

/** Сантиметр в EMU — единицах, которыми Word меряет картинки. */
const EMU_PER_CM = 360000;

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");

/** Обратное экранирование: `&amp;` разбираем последним, иначе съедим чужие сущности. */
const unesc = (s) => String(s ?? "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&nbsp;/g, " ")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, "&");

const asBuffer = (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v));

/* ─────────────── разбор XML: границы элементов ─────────────── */

/**
 * Конец элемента `tag`, начинающегося в `start`, с учётом вложенности
 * (в ячейке таблицы бывает ещё таблица). Возвращает индекс ЗА закрывающим тегом.
 */
function endOfEl(xml, tag, start) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*?)?(\\/)?>|<\\/${tag}>`, "g");
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(xml))) {
    if (m[0].startsWith("</")) {
      depth -= 1;
      if (depth <= 0) return re.lastIndex;
    } else if (m[1]) {
      if (depth === 0) return re.lastIndex; // самозакрывающийся <w:p/>
    } else {
      depth += 1;
    }
  }
  return xml.length; // битый XML — дочитываем до конца, лишь бы не зациклиться
}

/** Куски всех элементов `tag` на одном уровне (вложенные одноимённые — пропускаем). */
function elemsOf(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*?)?(\\/)?>`, "g");
  const out = [];
  let m;
  while ((m = re.exec(xml))) {
    const end = m[1] ? re.lastIndex : endOfEl(xml, tag, m.index);
    out.push(xml.slice(m.index, end));
    re.lastIndex = end;
  }
  return out;
}

/**
 * Границы всех абзацев документа по порядку — включая абзацы в таблицах.
 * Абзац в абзац не вкладывается, поэтому после найденного мы прыгаем за его
 * конец: так не считаем дважды абзацы внутри надписей (`w:txbxContent`).
 */
function paraSpans(xml) {
  const re = /<w:p(?:\s[^>]*?)?(\/)?>/g;
  const out = [];
  let m;
  while ((m = re.exec(xml))) {
    const end = m[1] ? re.lastIndex : endOfEl(xml, "w:p", m.index);
    out.push({ start: m.index, end, xml: xml.slice(m.index, end) });
    re.lastIndex = end;
  }
  return out;
}

/** Первое совпадение или "" — чтобы не городить `?.[0] ?? ""` на каждом шагу. */
const first = (xml, re) => xml.match(re)?.[0] ?? "";

/* ─────────────── текст абзаца ─────────────── */

/* `w:t` — текст, `w:tab` — табуляция, `w:br` — перевод строки. Отличаем
   `<w:t>` от `<w:tab/>`/`<w:tbl>` тем, что после `w:t` обязан идти пробел
   или `>`; свойства абзаца (`w:pPr`) выкидываем заранее — там свой `w:tab`
   в описании табуляторов, и текстом он не является. */
const TEXT_TOKEN = /<w:t(?:\s[^>]*?)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*?\/?>|<w:br\b[^>]*?\/?>/g;

const stripPPr = (p) => p.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, "");

function textOfXml(xml) {
  let out = "";
  for (const m of xml.matchAll(TEXT_TOKEN)) {
    if (m[1] !== undefined) out += unesc(m[1]);
    else if (m[0].startsWith("<w:tab")) out += "\t";
    else out += "\n";
  }
  return out;
}

const paraText = (paraXml) => textOfXml(stripPPr(paraXml));

/* ─────────────── рамки ─────────────── */

const SINGLE_VALS = new Set(["single", "thick", "double"]);
const DASHED_VALS = new Set(["dashed", "dashSmallGap", "dotted", "dotDash", "dashDotStroked"]);

/** «Какая это рамка» по куску `w:pBdr`/`w:tcBorders`: пунктир главнее сплошной. */
function borderKind(frag) {
  if (!frag) return null;
  const vals = [...frag.matchAll(/w:val="([^"]*)"/g)].map((m) => m[1]);
  if (vals.some((v) => DASHED_VALS.has(v))) return "dashed";
  if (vals.some((v) => SINGLE_VALS.has(v))) return "single";
  return null;
}

const paraBorder = (paraXml) => borderKind(first(paraXml, /<w:pBdr>[\s\S]*?<\/w:pBdr>/));

/**
 * Границы всех ячеек таблиц с их рамкой. Вложенные ячейки тоже нужны (таблица
 * в таблице), поэтому после открывающего тега не прыгаем — сканируем дальше.
 * Рамку берём только из СВОЕГО `w:tcPr` (он первый ребёнок ячейки), иначе
 * подцепили бы рамку вложенной таблицы.
 */
function cellSpans(xml) {
  const re = /<w:tc(?:\s[^>]*?)?>/g;
  const out = [];
  let m;
  while ((m = re.exec(xml))) {
    const end = endOfEl(xml, "w:tc", m.index);
    const inner = xml.slice(m.index, end);
    const ownPr = first(inner, /^<w:tc(?:\s[^>]*?)?>\s*<w:tcPr>[\s\S]*?<\/w:tcPr>/);
    out.push({ start: m.index, end, kind: borderKind(first(ownPr, /<w:tcBorders>[\s\S]*?<\/w:tcBorders>/)) });
  }
  return out;
}

/** Рамка абзаца: своя или, если своей нет, — ближайшей объемлющей ячейки. */
function frameKindOf(para, cells) {
  const own = paraBorder(para.xml);
  if (own) return own;
  const around = cells
    .filter((c) => c.start < para.start && para.end <= c.end && c.kind)
    .sort((a, b) => b.start - a.start);
  return around[0]?.kind ?? null;
}

/* ─────────────── сборка кусочков документа ─────────────── */

/** Текст в прогоны: табуляция и перевод строки — отдельными тегами. */
function textXml(text) {
  const norm = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!norm) return "";
  return norm.split(/(\t|\n)/).map((part) => {
    if (part === "\t") return "<w:tab/>";
    if (part === "\n") return "<w:br/>";
    return part ? `<w:t xml:space="preserve">${esc(part)}</w:t>` : "";
  }).join("");
}

function rPrXml({ bold, italic, underline } = {}) {
  const parts = [];
  if (bold) parts.push("<w:b/>");
  if (italic) parts.push("<w:i/>");
  if (underline) parts.push('<w:u w:val="single"/>');
  return parts.length ? `<w:rPr>${parts.join("")}</w:rPr>` : "";
}

const runXml = (run) => `<w:r>${rPrXml(run)}${textXml(run.text)}</w:r>`;

const SIDES = ["top", "left", "bottom", "right"];

/** Рамка абзаца — все четыре стороны одинаковые: так её рисуют в договорах. */
const pBdrXml = (kind) => (kind
  ? `<w:pBdr>${SIDES.map((s) => `<w:${s} w:val="${kind}" w:sz="8" w:space="4" w:color="auto"/>`).join("")}</w:pBdr>`
  : "");

const tcBordersXml = (kind) => (kind
  ? `<w:tcBorders>${SIDES.map((s) => `<w:${s} w:val="${kind}" w:sz="8" w:space="0" w:color="auto"/>`).join("")}</w:tcBorders>`
  : "");

const JC = { center: "center", right: "right", justify: "both", both: "both", left: "left" };

function pPrXml({ border, align } = {}) {
  const parts = [];
  if (align && JC[align]) parts.push(`<w:jc w:val="${JC[align]}"/>`);
  if (border) parts.push(pBdrXml(border));
  return parts.length ? `<w:pPr>${parts.join("")}</w:pPr>` : "";
}

/** Абзац из описания `{ text, bold, italic, underline, border, align }` или строки. */
function paraXml(p) {
  const o = typeof p === "string" ? { text: p } : (p || {});
  const runs = Array.isArray(o.runs) && o.runs.length ? o.runs : [o];
  const body = runs.map((r) => runXml(r)).filter(Boolean).join("");
  return `<w:p>${pPrXml(o)}${body}</w:p>`;
}

const DEFAULT_SECT = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
  + '<w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

const documentXml = (body, sect = DEFAULT_SECT) =>
  `${XML_DECL}<w:document ${NS_ATTRS}><w:body>${body}${sect}</w:body></w:document>`;

const CONTENT_TYPES = `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Default Extension="png" ContentType="image/png"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + "</Types>";

const ROOT_RELS = `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="${DOC_REL}" Target="word/document.xml"/></Relationships>`;

const EMPTY_RELS = `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

/** Общий «скелет» пакета: четыре обязательные части и ничего лишнего. */
async function zipDocx(docXml, files = {}) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("word/document.xml", docXml);
  zip.file("word/_rels/document.xml.rels", EMPTY_RELS);
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Минимальный, но настоящий .docx: Word и LibreOffice открывают его без жалоб.
 * Нужен и сам по себе (когда исходника договора нет), и как основа для тестов.
 *
 * @param {Array<string|{text?:string,bold?:boolean,italic?:boolean,underline?:boolean,
 *   border?:"single"|"dashed",align?:string}>|string} paragraphs
 * @param {{files?:Record<string,string|Buffer>}} [opts] `files` — что ещё положить в zip
 * @returns {Promise<Buffer>}
 */
export async function buildDocx(paragraphs, opts = {}) {
  const list = Array.isArray(paragraphs) ? paragraphs : [paragraphs];
  const body = list.map((p) => paraXml(p)).join("") || "<w:p/>";
  return zipDocx(documentXml(body), opts.files || {});
}

/* ─────────────── чтение ─────────────── */

async function openDocx(buffer) {
  const zip = await JSZip.loadAsync(asBuffer(buffer));
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("это не .docx: внутри нет word/document.xml");
  return { zip, xml: await file.async("string") };
}

/**
 * Текст абзацев по порядку документа — включая абзацы внутри таблиц.
 * @returns {Promise<string[]>}
 */
export async function docxText(buffer) {
  const { xml } = await openDocx(buffer);
  return paraSpans(xml).map((p) => paraText(p.xml));
}

/* ─────────────── плейсхолдеры ─────────────── */

/**
 * `[(ключ): описание]` — так владелец размечает договор: в квадратных скобках
 * сперва ключ в круглых, потом двоеточие и человеческое описание поля.
 * Пробелы вокруг допустимы, ключ — латиница, кириллица, цифры, подчёркивание.
 */
export const PLACEHOLDER_RE = /\[\s*\(\s*([A-Za-z0-9_Ѐ-ӿ]+)\s*\)\s*:\s*([^\]]*?)\s*\]/g;

/* Своя копия на каждый проход: у регулярки с `g` есть `lastIndex`, и общая
   на всех она бы «помнила» чужой поиск. */
const re = () => new RegExp(PLACEHOLDER_RE.source, "g");

/**
 * Плейсхолдеры документа или текста — уникальные по ключу, в порядке первого
 * появления.
 * @param {string|Buffer} textOrBuffer
 * @returns {Promise<Array<{key:string,desc:string}>>}
 */
export async function placeholdersOf(textOrBuffer) {
  const text = typeof textOrBuffer === "string"
    ? textOrBuffer
    : (await docxText(textOrBuffer)).join("\n");
  const seen = new Map();
  for (const m of text.matchAll(re())) {
    if (!seen.has(m[1])) seen.set(m[1], { key: m[1], desc: m[2] });
  }
  return [...seen.values()];
}

/** Пустое значение — не значение: плейсхолдер остаётся ждать своего часа. */
const fillText = (text, values) => text.replace(re(), (whole, key) => {
  const v = values?.[key];
  return v === undefined || v === null || String(v) === "" ? whole : String(v);
});

/**
 * Заполнить договор значениями `{ ключ: строка }`.
 *
 * Абзацы без плейсхолдеров не трогаем совсем. Там, где плейсхолдер разорван
 * между прогонами, сливаем текстовые прогоны абзаца в один — с `w:rPr`
 * первого из них, — и меняем уже в склеенном тексте.
 * @returns {Promise<Buffer>}
 */
export async function fillDocx(buffer, values = {}) {
  const { zip, xml } = await openDocx(buffer);
  let out = "";
  let at = 0;
  for (const p of paraSpans(xml)) {
    const filled = fillPara(p.xml, values);
    if (filled === p.xml) continue;
    out += xml.slice(at, p.start) + filled;
    at = p.end;
  }
  if (!at) return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  zip.file("word/document.xml", out + xml.slice(at));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

const RUN_RE = /<w:r(?:\s[^>]*?)?>[\s\S]*?<\/w:r>/g;

function fillPara(para, values) {
  const runs = [...para.matchAll(RUN_RE)]
    .map((m) => ({ xml: m[0], start: m.index, end: m.index + m[0].length }));
  const textRuns = runs.filter((r) => /<w:t[\s>]/.test(r.xml) || /<w:(tab|br)\b/.test(r.xml));
  if (!textRuns.length) return para;

  const texts = textRuns.map((r) => textOfXml(r.xml));
  const joined = texts.join("");
  const matches = [...joined.matchAll(re())].filter((m) => {
    const v = values?.[m[1]];
    return v !== undefined && v !== null && String(v) !== "";
  });
  if (!matches.length) return para;

  /* Правим по смещениям, а не поиском-заменой по строке: одинаковых прогонов в
     абзаце бывает много, и `replace` попал бы не в тот. */
  let out = "";
  let at = 0;

  // Плейсхолдер целиком внутри прогона — меняем на месте, правка минимальна.
  if (!matches.some((m) => !texts.some((t) => t.includes(m[0])))) {
    for (const r of textRuns) {
      const fixed = r.xml.replace(/(<w:t(?:\s[^>]*?)?>)([\s\S]*?)(<\/w:t>)/g,
        (_, open, inner, close) => `${open}${esc(fillText(unesc(inner), values))}${close}`);
      if (fixed === r.xml) continue;
      out += para.slice(at, r.start) + fixed;
      at = r.end;
    }
    return at ? out + para.slice(at) : para;
  }

  // Разорван между прогонами — сливаем текстовые в один, формат от первого.
  const merged = `<w:r>${first(textRuns[0].xml, /<w:rPr>[\s\S]*?<\/w:rPr>/)}`
    + `${textXml(fillText(joined, values))}</w:r>`;
  textRuns.forEach((r, i) => {
    out += para.slice(at, r.start) + (i === 0 ? merged : "");
    at = r.end;
  });
  return out + para.slice(at);
}

/* ─────────────── рамки для подписей ─────────────── */

/**
 * Где в договоре расписываются стороны: индексы абзацев, обведённых рамкой.
 * Сплошная — первая сторона, пунктирная — вторая. Берём первый абзац каждого
 * вида: рамка может охватывать несколько абзацев, подписывать нужно в начале.
 * @returns {Promise<{p1:number|null,p2:number|null}>}
 */
export async function signatureFrames(buffer) {
  const { xml } = await openDocx(buffer);
  return framesOfXml(xml);
}

function framesOfXml(xml) {
  const cells = cellSpans(xml);
  const res = { p1: null, p2: null };
  paraSpans(xml).forEach((p, i) => {
    const kind = frameKindOf(p, cells);
    if (kind === "single" && res.p1 === null) res.p1 = i;
    if (kind === "dashed" && res.p2 === null) res.p2 = i;
  });
  return res;
}

/* ─────────────── подпись картинкой ─────────────── */

/** Ширина и высота PNG — из заголовка IHDR, он всегда первым чанком. */
function pngSize(png) {
  const b = asBuffer(png);
  if (b.length < 24 || b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("подпись должна быть картинкой PNG");
  }
  if (b.subarray(12, 16).toString("latin1") !== "IHDR") {
    throw new Error("испорченный PNG: нет заголовка IHDR");
  }
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  if (!w || !h) throw new Error("испорченный PNG: нулевой размер");
  return { w, h };
}

/** Дописать в корень document.xml недостающие пространства имён (картинке нужны wp/a/pic). */
function ensureNs(xml) {
  const open = first(xml, /<w:document(?:\s[^>]*?)?>/);
  if (!open) return xml;
  let fixed = open;
  for (const [p, u] of Object.entries(NS)) {
    if (!new RegExp(`xmlns:${p}\\s*=`).test(fixed)) fixed = fixed.replace(/>$/, ` xmlns:${p}="${u}">`);
  }
  return fixed === open ? xml : xml.replace(open, fixed);
}

const drawingXml = ({ rid, id, name, cx, cy }) => `<w:r><w:drawing>`
  + `<wp:inline distT="0" distB="0" distL="0" distR="0">`
  + `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`
  + `<wp:docPr id="${id}" name="${escAttr(name)}"/>`
  + `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`
  + `<a:graphic><a:graphicData uri="${NS.pic}">`
  + `<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${escAttr(name)}"/><pic:cNvPicPr/></pic:nvPicPr>`
  + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
  + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
  + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
  + `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

/**
 * Вставить подпись стороны в её рамку — отдельным прогоном после текста абзаца.
 * Картинка ложится в `word/media`, связь — в rels документа, тип png — в
 * `[Content_Types].xml` (если его там ещё нет).
 *
 * @param {Buffer} buffer договор
 * @param {{party:1|2,png:Buffer,widthCm?:number}} opts
 * @returns {Promise<Buffer>}
 */
export async function insertSignature(buffer, { party, png, widthCm = 5 } = {}) {
  const side = Number(party);
  if (side !== 1 && side !== 2) throw new Error("сторона подписи бывает 1 или 2");
  if (!png) throw new Error("нет картинки подписи");

  const { zip, xml } = await openDocx(buffer);
  const frames = framesOfXml(xml);
  const index = side === 1 ? frames.p1 : frames.p2;
  if (index === null) throw new Error(`в договоре нет рамки для подписи стороны ${side}`);

  const { w, h } = pngSize(png);
  const cx = Math.round(Number(widthCm) * EMU_PER_CM);
  const cy = Math.round((cx * h) / w);

  // Имя файла — по стороне; занято (подписали второй раз) — берём следующее.
  let name = `sign${side}.png`;
  for (let n = 2; zip.file(`word/media/${name}`); n += 1) name = `sign${side}-${n}.png`;
  zip.file(`word/media/${name}`, asBuffer(png));

  const relsPath = "word/_rels/document.xml.rels";
  const relsXml = (await zip.file(relsPath)?.async("string")) || EMPTY_RELS;
  const usedIds = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  const rid = `rId${Math.max(0, ...usedIds) + 1}`;
  zip.file(relsPath, relsXml.replace(/<\/Relationships>\s*$/,
    `<Relationship Id="${rid}" Type="${IMAGE_REL}" Target="media/${name}"/></Relationships>`));

  const ctPath = "[Content_Types].xml";
  const ct = (await zip.file(ctPath)?.async("string")) || CONTENT_TYPES;
  if (!/<Default[^>]*Extension="png"/i.test(ct)) {
    zip.file(ctPath, ct.replace(/(<Types(?:\s[^>]*?)?>)/,
      '$1<Default Extension="png" ContentType="image/png"/>'));
  }

  // `docPr id` должен быть уникален на весь документ, иначе Word ругается на файл.
  const ids = [...xml.matchAll(/<wp:docPr[^>]*\sid="(\d+)"/g)].map((m) => Number(m[1]));
  const docPrId = Math.max(0, ...ids) + 1;
  const run = drawingXml({ rid, id: docPrId, name: `Подпись стороны ${side}`, cx, cy });

  const span = paraSpans(xml)[index];
  const para = span.xml.endsWith("/>")
    ? `${span.xml.slice(0, -2)}>${run}</w:p>`               // был пустой <w:p/>
    : `${span.xml.slice(0, -"</w:p>".length)}${run}</w:p>`;
  zip.file("word/document.xml", ensureNs(xml.slice(0, span.start) + para + xml.slice(span.end)));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/* ─────────────── docx → html ─────────────── */

/** Блоки одного уровня по порядку: абзацы и таблицы. */
function blocksOf(xml) {
  const re2 = /<w:(p|tbl)(?:\s[^>]*?)?(\/)?>/g;
  const out = [];
  let m;
  while ((m = re2.exec(xml))) {
    const end = m[2] ? re2.lastIndex : endOfEl(xml, `w:${m[1]}`, m.index);
    out.push({ type: m[1], xml: xml.slice(m.index, end) });
    re2.lastIndex = end;
  }
  return out;
}

/** Включено ли свойство прогона: `<w:b/>` — да, `<w:b w:val="0"/>` — нет. */
function flagOn(rPr, tag) {
  const m = rPr.match(new RegExp(`<w:${tag}(?:\\s([^>]*?))?\\/?>`));
  if (!m) return false;
  const v = m[1]?.match(/w:val="([^"]*)"/)?.[1];
  return !(v === "0" || v === "false" || v === "none");
}

const RUN_TOKEN = /<w:t(?:\s[^>]*?)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*?\/?>|<w:br\b[^>]*?\/?>|<w:drawing\b[\s\S]*?<\/w:drawing>/g;

const TAB_HTML = "&nbsp;&nbsp;&nbsp;&nbsp;";

function runsHtml(xml) {
  let html = "";
  for (const m of xml.matchAll(RUN_RE)) {
    const run = m[0];
    const rPr = first(run, /<w:rPr>[\s\S]*?<\/w:rPr>/);
    let inner = "";
    for (const t of run.matchAll(RUN_TOKEN)) {
      if (t[1] !== undefined) inner += esc(unesc(t[1]));
      else if (t[0].startsWith("<w:tab")) inner += TAB_HTML;
      else if (t[0].startsWith("<w:br")) inner += "<br>";
      else {
        // Картинку в HTML не вытаскиваем: она останется в .docx, а правка идёт текстом.
        const rid = t[0].match(/r:embed="([^"]*)"/)?.[1] || "";
        inner += `<span data-image="${escAttr(rid)}">[изображение]</span>`;
      }
    }
    if (!inner) continue;
    if (flagOn(rPr, "u")) inner = `<u>${inner}</u>`;
    if (flagOn(rPr, "i")) inner = `<i>${inner}</i>`;
    if (flagOn(rPr, "b")) inner = `<b>${inner}</b>`;
    html += inner;
  }
  return html;
}

const BORDER_CSS = { single: "border:1px solid #000;padding:4px", dashed: "border:1px dashed #000;padding:4px" };
const ALIGN_CSS = { center: "text-align:center", right: "text-align:right", both: "text-align:justify" };

function styleAttr(parts) {
  const css = parts.filter(Boolean).join(";");
  return css ? ` style="${escAttr(css)}"` : "";
}

function paraHtml(xml) {
  const pPr = first(xml, /<w:pPr>[\s\S]*?<\/w:pPr>/);
  const jc = pPr.match(/<w:jc\s[^>]*w:val="([^"]*)"/)?.[1];
  const style = styleAttr([BORDER_CSS[paraBorder(xml)], ALIGN_CSS[jc]]);
  return `<p${style}>${runsHtml(stripPPr(xml))}</p>`;
}

function tableHtml(xml) {
  const rows = elemsOf(xml, "w:tr").map((tr) => {
    const cells = elemsOf(tr, "w:tc").map((tc) => {
      const ownPr = first(tc, /^<w:tc(?:\s[^>]*?)?>\s*<w:tcPr>[\s\S]*?<\/w:tcPr>/);
      const kind = borderKind(first(ownPr, /<w:tcBorders>[\s\S]*?<\/w:tcBorders>/));
      const inner = tc.replace(/^<w:tc(?:\s[^>]*?)?>/, "").replace(/<\/w:tc>$/, "");
      return `<td${styleAttr([BORDER_CSS[kind]])}>${blocksHtml(inner)}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<table>${rows}</table>`;
}

const blocksHtml = (xml) => blocksOf(xml)
  .map((b) => (b.type === "p" ? paraHtml(b.xml) : tableHtml(b.xml))).join("");

/**
 * Простой HTML — показать договор в браузере и дать поправить руками.
 * Нарочно беден: абзацы, начертание, рамки, выравнивание, таблицы. Всё
 * остальное (стили, колонтитулы, картинки) остаётся в .docx и переживает
 * правку, если собирать обратно через `htmlToDocx` с `base`.
 * @returns {Promise<string>}
 */
export async function docxToHtml(buffer) {
  const { xml } = await openDocx(buffer);
  const body = first(xml, /<w:body>[\s\S]*<\/w:body>/) || xml;
  return blocksHtml(body.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/g, ""));
}

/* ─────────────── html → docx ─────────────── */

const BLOCK_TAGS = new Set(["p", "div", "table", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "section", "article", "header", "footer", "tr", "td", "th", "tbody", "thead"]);

const tagOf = (node) => (node.rawTagName || "").toLowerCase();
const isEl = (node) => node.nodeType === 1;

/** Разметка стиля, которую мы понимаем: рамка и выравнивание. */
function styleOf(el) {
  const st = (el.getAttribute?.("style") || "").toLowerCase();
  const border = /border[^:;]*:[^;]*dashed/.test(st) ? "dashed"
    : /border[^:;]*:[^;]*(solid|double)/.test(st) ? "single" : null;
  const align = st.match(/text-align\s*:\s*(center|right|justify|left)/)?.[1] || null;
  return { border, align };
}

/* Пробелы в HTML — форматирование, а не текст: схлопываем их, но неразрывный
   пробел (им мы рисуем табуляцию) не трогаем. */
const collapse = (s) => s.replace(/[ \t\r\n]+/g, " ");

function inlineRuns(node, fmt, out) {
  for (const ch of node.childNodes) {
    if (!isEl(ch)) {
      const t = collapse(unesc(ch.rawText ?? ""));
      if (t) out.push({ ...fmt, text: t });
      continue;
    }
    const tag = tagOf(ch);
    if (tag === "br") { out.push({ ...fmt, text: "\n" }); continue; }
    const rid = ch.getAttribute?.("data-image");
    if (rid) { out.push({ image: rid }); continue; }
    inlineRuns(ch, {
      bold: fmt.bold || tag === "b" || tag === "strong",
      italic: fmt.italic || tag === "i" || tag === "em",
      underline: fmt.underline || tag === "u",
    }, out);
  }
}

/** Прогоны абзаца: пустые по краям пробелы убираем — в Word они видны как дырки. */
function runsOf(el) {
  const runs = [];
  inlineRuns(el, { bold: false, italic: false, underline: false }, runs);
  const texts = runs.filter((r) => !r.image);
  if (texts.length) {
    texts[0].text = texts[0].text.replace(/^[ \t]+/, "");
    texts[texts.length - 1].text = texts[texts.length - 1].text.replace(/[ \t]+$/, "");
  }
  return runs.filter((r) => r.image || r.text !== "");
}

/**
 * Прогон из HTML: обычный текст или картинка, оставшаяся от `docxToHtml`
 * (`<span data-image="rIdN">`). Картинку возвращаем на место ТОЛЬКО когда
 * знаем её размер из `base` — иначе выкидываем: лучше пусто, чем слово
 * «[изображение]» вместо подписи.
 */
function htmlRunXml(run, ctx) {
  if (!run.image) return runXml(run);
  const size = ctx.images?.[run.image];
  if (!size) return "";
  ctx.docPrId += 1;
  return drawingXml({ rid: run.image, id: ctx.docPrId, name: `Картинка ${ctx.docPrId}`, ...size });
}

function htmlParaXml(el, inherited = {}, ctx = EMPTY_CTX) {
  const st = styleOf(el);
  const border = st.border || inherited.border || null;
  const align = st.align || inherited.align || null;
  const body = runsOf(el).map((r) => htmlRunXml(r, ctx)).join("");
  return `<w:p>${pPrXml({ border, align })}${body}</w:p>`;
}

const EMPTY_CTX = { images: null, docPrId: 0 };

const hasBlockChild = (el) => el.childNodes.some((ch) => isEl(ch) && BLOCK_TAGS.has(tagOf(ch)));

function htmlCellXml(td, tableBorder, ctx) {
  const st = styleOf(td);
  const kind = st.border || tableBorder || null;
  const inner = hasBlockChild(td)
    ? td.childNodes.filter(isEl).map((ch) => htmlParaXml(ch, {}, ctx)).join("")
    : htmlParaXml(td, {}, ctx);
  return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${tcBordersXml(kind)}</w:tcPr>${inner || "<w:p/>"}</w:tc>`;
}

function htmlTableXml(table, ctx) {
  const tableBorder = styleOf(table).border;
  const rows = table.querySelectorAll("tr");
  let cols = 1;
  const trs = rows.map((tr) => {
    const tds = tr.childNodes.filter((ch) => isEl(ch) && ["td", "th"].includes(tagOf(ch)));
    cols = Math.max(cols, tds.length || 1);
    return `<w:tr>${(tds.length ? tds : [tr]).map((td) => htmlCellXml(td, tableBorder, ctx)).join("")}</w:tr>`;
  }).join("");
  const grid = `<w:tblGrid>${'<w:gridCol w:w="4675"/>'.repeat(cols)}</w:tblGrid>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${grid}${trs}</w:tbl>`;
}

function htmlBlocksXml(node, inherited = {}, ctx = EMPTY_CTX) {
  let out = "";
  for (const ch of node.childNodes) {
    if (!isEl(ch)) {
      const t = collapse(unesc(ch.rawText ?? "")).trim();
      if (t) out += paraXml({ text: t, ...inherited });
      continue;
    }
    const tag = tagOf(ch);
    if (tag === "table") { out += htmlTableXml(ch, ctx); continue; }
    if (tag === "br") { out += "<w:p/>"; continue; }
    // Обёртка (div вокруг абзацев, body, ul) — идём внутрь, неся её рамку и выравнивание.
    if (hasBlockChild(ch)) {
      const st = styleOf(ch);
      out += htmlBlocksXml(ch, { border: st.border || inherited.border, align: st.align || inherited.align }, ctx);
      continue;
    }
    out += htmlParaXml(ch, inherited, ctx);
  }
  return out;
}

/** Размеры картинок документа по их связям: rId → размер в EMU (ширина 5 см). */
async function imageSizes(zip) {
  const rels = (await zip.file("word/_rels/document.xml.rels")?.async("string")) || "";
  const out = {};
  for (const m of rels.matchAll(/<Relationship\s[^>]*>/g)) {
    if (!m[0].includes(IMAGE_REL)) continue;
    const id = m[0].match(/Id="([^"]*)"/)?.[1];
    const target = m[0].match(/Target="([^"]*)"/)?.[1];
    if (!id || !target || /^https?:/i.test(target)) continue;
    const file = zip.file(`word/${target.replace(/^\.?\//, "")}`);
    const cx = 5 * EMU_PER_CM;
    let cy = cx;
    try {
      const { w, h } = pngSize(await file.async("nodebuffer"));
      cy = Math.round((cx * h) / w);
    } catch { /* не PNG или нет файла — оставим квадрат, лишь бы картинка не пропала */ }
    if (file) out[id] = { cx, cy };
  }
  return out;
}

/**
 * Собрать .docx из простого HTML — обратный ход к `docxToHtml`.
 *
 * С `base` берём готовый договор и меняем в нём ТОЛЬКО `word/document.xml`:
 * стили, настройки, шрифты, картинки и их связи остаются на месте. Так правка
 * текста в браузере не стирает оформление исходного файла.
 * @param {string} html
 * @param {{base?:Buffer}} [opts]
 * @returns {Promise<Buffer>}
 */
export async function htmlToDocx(html, { base } = {}) {
  const root = parseHtml(String(html ?? ""));
  const body = root.querySelector("body") || root;

  if (!base) return zipDocx(documentXml(htmlBlocksXml(body) || "<w:p/>"));

  const zip = await JSZip.loadAsync(asBuffer(base));
  const ctx = { images: await imageSizes(zip), docPrId: 0 };
  const inner = htmlBlocksXml(body, {}, ctx) || "<w:p/>";
  const old = (await zip.file("word/document.xml")?.async("string")) || "";
  const open = first(old, /<w:document(?:\s[^>]*?)?>/) || `<w:document ${NS_ATTRS}>`;
  // Настройки страницы (`w:sectPr` в конце тела) — это поля и формат листа, их бережём.
  const sect = old.match(/(<w:sectPr(?:\s[^>]*?)?>[\s\S]*?<\/w:sectPr>|<w:sectPr(?:\s[^>]*?)?\/>)\s*<\/w:body>/)?.[1]
    || DEFAULT_SECT;
  zip.file("word/document.xml", ensureNs(`${XML_DECL}${open}<w:body>${inner}${sect}</w:body></w:document>`));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
