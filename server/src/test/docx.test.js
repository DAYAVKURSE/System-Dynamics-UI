import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  PLACEHOLDER_RE, buildDocx, docxText, docxToHtml, fillDocx,
  htmlToDocx, insertSignature, placeholdersOf, signatureFrames,
} from "../lib/docx.js";

/* ДОГОВОР В .DOCX: собрать, прочитать, заполнить, подписать.

   Главная боль — Word режет текст на прогоны где хочет, поэтому половина
   проверок здесь идёт не от `buildDocx`, а от документов, собранных РУКАМИ:
   так воспроизводится разорванный плейсхолдер и рамка подписи в ячейке
   таблицы — то, что приносят из настоящего Word. */

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** Документ, собранный вручную: body отдаём как есть, без помощи библиотеки. */
async function rawDocx(body, extra = {}) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${W_NS}><w:body>${body}</w:body></w:document>`);
  zip.file("word/_rels/document.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer" });
}

const unzip = async (buf) => JSZip.loadAsync(buf);
const partOf = async (buf, name) => (await unzip(buf)).file(name).async("string");
const names = async (buf) => Object.keys((await unzip(buf)).files).filter((n) => !n.endsWith("/"));

/** Абзац с текстом `needle` из document.xml — смотреть, куда именно легла правка. */
const paraWith = (xml, needle) => (xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [])
  .find((p) => p.includes(needle)) || "";

/* Библиотеке от PNG нужен только заголовок IHDR (ширина и высота), поэтому
   пикселей тут нет — сигнатура, IHDR и всё. */
function png(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    Buffer.from([0, 0, 0, 13]), Buffer.from("IHDR"), ihdr, Buffer.from([0, 0, 0, 0]),
    Buffer.from([0, 0, 0, 0]), Buffer.from("IEND"), Buffer.from([0xae, 0x42, 0x60, 0x82]),
  ]);
}

/* Разорванный плейсхолдер: `[(sum)` в одном прогоне, `: сумма]` — в другом. */
const TORN = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Итого [(sum)</w:t></w:r>'
  + '<w:r><w:t xml:space="preserve">: сумма] руб.</w:t></w:r></w:p>';

const CELL = (val, text) => `<w:tbl><w:tr><w:tc><w:tcPr><w:tcBorders>`
  + ["top", "left", "bottom", "right"].map((s) => `<w:${s} w:val="${val}" w:sz="4"/>`).join("")
  + `</w:tcBorders></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;

describe("сборка и чтение", () => {
  it("buildDocx даёт минимальный пакет, docxText читает абзацы по порядку", async () => {
    const buf = await buildDocx([
      "Договор оказания услуг",
      { text: "Пункт 1.\tУслуги\nоказываются", bold: true, italic: true, underline: true },
      "",
    ]);
    expect(await names(buf)).toEqual(expect.arrayContaining([
      "[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels",
    ]));
    expect(await docxText(buf)).toEqual([
      "Договор оказания услуг", "Пункт 1.\tУслуги\nоказываются", "",
    ]);
    const xml = await partOf(buf, "word/document.xml");
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("<w:tab/>");
    expect(xml).toContain("<w:br/>");
  });

  it("docxText берёт и абзацы таблиц, в порядке документа", async () => {
    const buf = await rawDocx("<w:p><w:r><w:t>До</w:t></w:r></w:p>"
      + CELL("single", "В ячейке") + "<w:p><w:r><w:t>После</w:t></w:r></w:p>");
    expect(await docxText(buf)).toEqual(["До", "В ячейке", "После"]);
  });
});

describe("плейсхолдеры", () => {
  it("уникальные по ключу, в порядке первого появления, с пробелами и кириллицей", async () => {
    const text = "[(fio): ФИО] и [( сумма ) :  сколько платим ] и снова [(fio): ФИО заказчика]";
    expect(await placeholdersOf(text)).toEqual([
      { key: "fio", desc: "ФИО" },
      { key: "сумма", desc: "сколько платим" },
    ]);
    expect(PLACEHOLDER_RE.source).toBe(new RegExp(PLACEHOLDER_RE.source, "g").source);
    expect("[(a_1): x]".match(new RegExp(PLACEHOLDER_RE.source))[1]).toBe("a_1");
  });

  it("находит плейсхолдер, разорванный Word'ом между двумя прогонами", async () => {
    const buf = await rawDocx(TORN);
    expect(await docxText(buf)).toEqual(["Итого [(sum): сумма] руб."]);
    expect(await placeholdersOf(buf)).toEqual([{ key: "sum", desc: "сумма" }]);
  });
});

describe("заполнение", () => {
  it("fillDocx заменяет разорванный плейсхолдер, слив прогоны абзаца в один", async () => {
    const out = await fillDocx(await rawDocx(TORN), { sum: "1 000" });
    expect(await docxText(out)).toEqual(["Итого 1 000 руб."]);
    const xml = await partOf(out, "word/document.xml");
    expect(xml.match(/<w:r[\s>]/g)).toHaveLength(1);  // прогон остался один
    expect(xml).toContain("<w:b/>");                  // формат взят у первого
    expect(xml).toContain('xml:space="preserve"');
  });

  it("fillDocx заменяет и целый плейсхолдер, не трогая соседние абзацы", async () => {
    const before = await rawDocx('<w:p><w:r><w:t>Заказчик: [(fio): ФИО]</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>Без полей</w:t></w:r></w:p>');
    const out = await fillDocx(before, { fio: "Иванов И. И." });
    expect(await docxText(out)).toEqual(["Заказчик: Иванов И. И.", "Без полей"]);
    const xml = await partOf(out, "word/document.xml");
    expect(paraWith(xml, "Без полей")).toBe("<w:p><w:r><w:t>Без полей</w:t></w:r></w:p>");
  });

  it("значение с & и < экранируется, а читается обратно как есть", async () => {
    const buf = await buildDocx(["Предмет: [(item): что делаем]"]);
    const out = await fillDocx(buf, { item: 'ООО «А & Б» <тариф>' });
    expect(await docxText(out)).toEqual(['Предмет: ООО «А & Б» <тариф>']);
    const xml = await partOf(out, "word/document.xml");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;тариф&gt;");
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#)/);
  });

  it("пустое и отсутствующее значение оставляют плейсхолдер на месте", async () => {
    const buf = await rawDocx(TORN + '<w:p><w:r><w:t>Срок: [(days): дней]</w:t></w:r></w:p>');
    const out = await fillDocx(buf, { sum: "", days: null });
    expect(await docxText(out)).toEqual(["Итого [(sum): сумма] руб.", "Срок: [(days): дней]"]);
    expect(await placeholdersOf(out)).toHaveLength(2);
  });
});

describe("рамки для подписей", () => {
  it("сплошная рамка абзаца — первая сторона, пунктирная — вторая", async () => {
    const buf = await buildDocx([
      "Подписи сторон:",
      { text: "Исполнитель", border: "single" },
      { text: "Заказчик", border: "dashed" },
    ]);
    expect(await signatureFrames(buf)).toEqual({ p1: 1, p2: 2 });
    expect(await signatureFrames(await buildDocx(["без рамок"]))).toEqual({ p1: null, p2: null });
  });

  it("рамка ячейки таблицы считается так же, пунктир Word пишет разными словами", async () => {
    const buf = await rawDocx("<w:p><w:r><w:t>Шапка</w:t></w:r></w:p>"
      + CELL("dashSmallGap", "Сторона 2") + CELL("single", "Сторона 1"));
    expect(await signatureFrames(buf)).toEqual({ p1: 2, p2: 1 });
    const dotted = await rawDocx(CELL("dotted", "Сторона 2"));
    expect((await signatureFrames(dotted)).p2).toBe(0);
  });
});

describe("подпись картинкой", () => {
  it("insertSignature кладёт media, связь, тип png и w:drawing в абзац рамки", async () => {
    const buf = await rawDocx("<w:p><w:r><w:t>Шапка</w:t></w:r></w:p>"
      + CELL("dashed", "Сторона 2")
      + '<w:p><w:pPr><w:pBdr><w:top w:val="single"/></w:pBdr></w:pPr><w:r><w:t>Сторона 1</w:t></w:r></w:p>');
    const out = await insertSignature(await insertSignature(buf, { party: 1, png: png(200, 50) }),
      { party: 2, png: png(100, 100), widthCm: 4 });

    expect(await names(out)).toEqual(expect.arrayContaining(["word/media/sign1.png", "word/media/sign2.png"]));
    const rels = await partOf(out, "word/_rels/document.xml.rels");
    expect(rels.match(/Type="[^"]*\/image" Target="media\/sign[12]\.png"/g)).toHaveLength(2);
    expect(await partOf(out, "[Content_Types].xml")).toContain('<Default Extension="png" ContentType="image/png"/>');

    const xml = await partOf(out, "word/document.xml");
    expect(xml.match(/<w:drawing>/g)).toHaveLength(2);
    const ids = [...xml.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1]);  // id картинок уникальны
    expect(new Set(ids)).toEqual(new Set(["1", "2"]));
    // Подпись — в своём абзаце и после его текста; текст остался нетронутым.
    const p1 = paraWith(xml, "Сторона 1");
    expect(p1).toContain("<w:drawing>");
    expect(p1.indexOf("Сторона 1")).toBeLessThan(p1.indexOf("<w:drawing>"));
    expect(paraWith(xml, "Шапка")).not.toContain("<w:drawing>");
    // 5 см в EMU и высота по пропорции 200×50; у второй — 4 см и квадрат.
    expect(xml).toContain('<wp:extent cx="1800000" cy="450000"/>');
    expect(xml).toContain('<wp:extent cx="1440000" cy="1440000"/>');
    expect(await docxText(out)).toEqual(["Шапка", "Сторона 2", "Сторона 1"]);
  });

  it("без рамки нужной стороны — внятный отказ", async () => {
    const buf = await buildDocx([{ text: "Исполнитель", border: "single" }]);
    await expect(insertSignature(buf, { party: 2, png: png(10, 10) }))
      .rejects.toThrow("в договоре нет рамки для подписи стороны 2");
    await expect(insertSignature(await buildDocx(["пусто"]), { party: 1, png: png(10, 10) }))
      .rejects.toThrow("в договоре нет рамки для подписи стороны 1");
  });
});

describe("docx ↔ html", () => {
  it("docxToHtml показывает начертание, рамки, выравнивание и таблицу", async () => {
    const buf = await rawDocx('<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
      + '<w:r><w:rPr><w:b/></w:rPr><w:t>Договор</w:t></w:r>'
      + '<w:r><w:rPr><w:i/><w:u w:val="single"/></w:rPr><w:t>№ 1</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>с</w:t></w:r><w:r><w:tab/><w:br/><w:t>переносом</w:t></w:r></w:p>'
      + CELL("dashed", "Сторона 2")
      + '<w:p><w:pPr><w:pBdr><w:top w:val="single"/></w:pBdr></w:pPr><w:r><w:t>А &amp; Б</w:t></w:r>'
      + '<w:r><w:drawing><wp:inline><a:blip r:embed="rId7"/></wp:inline></w:drawing></w:r></w:p>');
    const html = await docxToHtml(buf);
    expect(html).toContain("<b>Договор</b>");
    expect(html).toContain("<i><u>№ 1</u></i>");
    expect(html).toContain('<p style="text-align:center">');
    expect(html).toContain("&nbsp;&nbsp;&nbsp;&nbsp;<br>переносом");
    expect(html).toContain("<table><tr><td");
    expect(html).toContain("border:1px dashed #000");
    expect(html).toContain("border:1px solid #000");
    expect(html).toContain("А &amp; Б");
    expect(html).toContain('<span data-image="rId7">[изображение]</span>');
  });

  it("htmlToDocx возвращает текст, рамки и жирность обратно в документ", async () => {
    const html = '<div><p>Договор</p>'
      + '<p style="text-align:right">Сумма <b>1 000</b> руб.</p>'
      + '<p style="border:1px solid #000;padding:4px">Сторона 1</p>'
      + '<table><tr><td style="border:1px dashed #000;padding:4px">Сторона 2</td></tr></table></div>';
    const buf = await htmlToDocx(html);
    expect(await docxText(buf)).toEqual(["Договор", "Сумма 1 000 руб.", "Сторона 1", "Сторона 2"]);
    expect(await signatureFrames(buf)).toEqual({ p1: 2, p2: 3 });
    const xml = await partOf(buf, "word/document.xml");
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain('<w:jc w:val="right"/>');
    expect(xml).toContain("<w:tbl>");
    expect(await names(buf)).toEqual(expect.arrayContaining(["[Content_Types].xml", "word/document.xml"]));
  });

  it("правка через html и обратно с base сохраняет остальной пакет", async () => {
    const base = await rawDocx('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Старый текст</w:t></w:r></w:p>'
      + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>',
    { "word/styles.xml": "<w:styles>наши стили</w:styles>", "word/media/image1.png": png(3, 3) });

    const html = (await docxToHtml(base)).replace("Старый текст", "Новый текст");
    const out = await htmlToDocx(html, { base });

    expect(await docxText(out)).toEqual(["Новый текст"]);
    expect(await names(out)).toEqual(expect.arrayContaining([
      "word/styles.xml", "word/media/image1.png", "word/_rels/document.xml.rels",
    ]));
    expect(await partOf(out, "word/styles.xml")).toBe("<w:styles>наши стили</w:styles>");
    const xml = await partOf(out, "word/document.xml");
    expect(xml).toContain('<w:pgSz w:w="11906" w:h="16838"/>'); // настройки страницы уцелели
    expect(xml).toContain("<w:b/>");
    expect(xml).not.toContain("Старый текст");
  });

  it("подпись переживает правку текста через html и сборку с base", async () => {
    const signed = await insertSignature(
      await buildDocx([{ text: "Сторона 1", border: "single" }]),
      { party: 1, png: png(300, 90) },
    );
    const html = (await docxToHtml(signed)).replace("Сторона 1", "Сторона 1, Иванов");
    const out = await htmlToDocx(html, { base: signed });

    expect(await docxText(out)).toEqual(["Сторона 1, Иванов"]);  // слова «[изображение]» в тексте нет
    const xml = await partOf(out, "word/document.xml");
    expect(xml).toContain('<a:blip r:embed="rId1"/>');
    expect(xml).toContain('<wp:extent cx="1800000" cy="540000"/>');   // 5 см и высота по PNG
    expect(await names(out)).toContain("word/media/sign1.png");
    // Без base размеров картинки взять неоткуда — молча выкидываем, текстом не подменяем.
    expect(await docxText(await htmlToDocx(html))).toEqual(["Сторона 1, Иванов"]);
  });
});
