import { deflateRawSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [inputFile, outputFile] = process.argv.slice(2);
if (!inputFile || !outputFile) {
  console.error("Usage: node scripts/html-to-docx.mjs input.html output.docx");
  process.exit(1);
}

const html = readFileSync(inputFile, "utf8");

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'");
}

function cleanText(value) {
  return decodeEntities(String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim());
}

function runsFromHtml(value) {
  const parts = [];
  const source = String(value || "").replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`");
  let index = 0;
  const boldPattern = /<strong>([\s\S]*?)<\/strong>/gi;
  let match;

  while ((match = boldPattern.exec(source))) {
    const before = cleanText(source.slice(index, match.index));
    if (before) parts.push({ text: before, bold: false });
    const bold = cleanText(match[1]);
    if (bold) parts.push({ text: bold, bold: true });
    index = match.index + match[0].length;
  }

  const after = cleanText(source.slice(index));
  if (after) parts.push({ text: after, bold: false });
  if (!parts.length) parts.push({ text: cleanText(source), bold: false });
  return parts.filter((part) => part.text);
}

function paragraph(content, style = "Normal", prefix = "") {
  const runs = runsFromHtml(content);
  if (prefix) runs.unshift({ text: prefix, bold: false });
  const styleXml = style !== "Normal" ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${styleXml}${runs.map((run) => `<w:r>${run.bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${xmlEscape(run.text)}</w:t></w:r>`).join("")}</w:p>`;
}

function table(tableHtml) {
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)];
    return `<w:tr>${cells.map((cellMatch) => {
      const text = cleanText(cellMatch[1]);
      return `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${paragraph(text || " ")}</w:tc>`;
    }).join("")}</w:tr>`;
  }).join("");

  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tblBorders></w:tblPr>${rows}</w:tbl>`;
}

function processNonTable(chunk) {
  const blocks = [];
  const blockPattern = /<(h1|h2|h3|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let number = 1;
  let match;

  while ((match = blockPattern.exec(chunk))) {
    const tag = match[1].toLowerCase();
    const content = match[2];
    const text = cleanText(content);
    if (!text) continue;

    if (tag === "h1") blocks.push(paragraph(content, "Title"));
    if (tag === "h2") blocks.push(paragraph(content, "Heading1"));
    if (tag === "h3") blocks.push(paragraph(content, "Heading2"));
    if (tag === "p") blocks.push(paragraph(content));
    if (tag === "li") {
      const before = chunk.slice(Math.max(0, match.index - 20), match.index).toLowerCase();
      const isNumbered = before.includes("<ol") || chunk.slice(0, match.index).lastIndexOf("<ol") > chunk.slice(0, match.index).lastIndexOf("<ul");
      blocks.push(paragraph(content, "Normal", isNumbered ? `${number++}. ` : "- "));
    }
  }

  return blocks.join("");
}

function documentBody(sourceHtml) {
  const body = sourceHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || sourceHtml;
  const parts = [];
  let cursor = 0;
  const tablePattern = /<table[^>]*>[\s\S]*?<\/table>/gi;
  let match;

  while ((match = tablePattern.exec(body))) {
    parts.push(processNonTable(body.slice(cursor, match.index)));
    parts.push(table(match[0]));
    cursor = match.index + match[0].length;
  }
  parts.push(processNonTable(body.slice(cursor)));

  return parts.join("");
}

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${documentBody(html)}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="900" w:bottom="1080" w:left="900" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="23"/></w:rPr><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="0F172A"/><w:sz w:val="40"/></w:rPr><w:pPr><w:spacing w:after="180"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="0F766E"/><w:sz w:val="30"/></w:rPr><w:pPr><w:spacing w:before="260" w:after="120"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="334155"/><w:sz w:val="25"/></w:rPr><w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr></w:style>
</w:styles>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  for (const file of files) {
    const name = Buffer.from(file.name);
    const source = Buffer.from(file.content);
    const compressed = deflateRawSync(source);
    const crc = crc32(source);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(source.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralOffset = offset;
  const centralSize = centrals.reduce((size, item) => size + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, ...centrals, end]);
}

const docx = makeZip([
  { name: "[Content_Types].xml", content: contentTypes },
  { name: "_rels/.rels", content: rels },
  { name: "word/document.xml", content: documentXml },
  { name: "word/_rels/document.xml.rels", content: documentRels },
  { name: "word/styles.xml", content: stylesXml }
]);

writeFileSync(outputFile, docx);
console.log(`Created ${basename(outputFile)} from ${basename(inputFile)}`);
