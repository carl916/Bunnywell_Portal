import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const source = path.join(root, "docs", "bunnywell-portal-system-guide.md");
const output = path.join(root, "docs", "bunnywell-portal-system-guide.pdf");

const markdown = fs.readFileSync(source, "utf8");
const doc = new jsPDF({ unit: "pt", format: "a4" });

const page = {
  width: doc.internal.pageSize.getWidth(),
  height: doc.internal.pageSize.getHeight(),
  marginX: 48,
  marginTop: 54,
  marginBottom: 48,
};

let y = page.marginTop;
let pageNumber = 1;
let inCode = false;
let codeBuffer = [];

function stripMarkdown(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)");
}

function footer() {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor("#617169");
  doc.text("Bunnywell Portal System Guide", page.marginX, page.height - 24);
  doc.text(`Page ${pageNumber}`, page.width - page.marginX, page.height - 24, { align: "right" });
}

function newPage() {
  footer();
  doc.addPage();
  pageNumber += 1;
  y = page.marginTop;
}

function ensureSpace(height) {
  if (y + height > page.height - page.marginBottom) newPage();
}

function writeWrapped(text, options = {}) {
  const {
    size = 10,
    font = "normal",
    color = "#24352E",
    indent = 0,
    before = 0,
    after = 6,
    lineHeight = size + 4,
    bullet = false,
  } = options;
  const maxWidth = page.width - page.marginX * 2 - indent;
  const cleanText = stripMarkdown(text);
  doc.setFont("helvetica", font);
  doc.setFontSize(size);
  doc.setTextColor(color);
  const lines = doc.splitTextToSize(cleanText, maxWidth - (bullet ? 12 : 0));
  ensureSpace(before + lines.length * lineHeight + after);
  y += before;
  if (bullet) {
    doc.text("-", page.marginX + indent, y);
    doc.text(lines, page.marginX + indent + 12, y);
  } else {
    doc.text(lines, page.marginX + indent, y);
  }
  y += lines.length * lineHeight + after;
}

function writeCode() {
  if (codeBuffer.length === 0) return;
  doc.setFont("courier", "normal");
  doc.setFontSize(8);
  doc.setTextColor("#24352E");
  const lineHeight = 11;
  const lines = codeBuffer.flatMap((line) => doc.splitTextToSize(line || " ", page.width - page.marginX * 2 - 16));
  ensureSpace(lines.length * lineHeight + 18);
  doc.setDrawColor("#D9DED6");
  doc.setFillColor("#FBFAF6");
  doc.roundedRect(page.marginX, y, page.width - page.marginX * 2, lines.length * lineHeight + 12, 4, 4, "FD");
  doc.text(lines, page.marginX + 8, y + 14);
  y += lines.length * lineHeight + 20;
  codeBuffer = [];
}

for (const rawLine of markdown.split(/\r?\n/)) {
  const line = rawLine.trimEnd();

  if (line.startsWith("```")) {
    if (inCode) writeCode();
    inCode = !inCode;
    continue;
  }

  if (inCode) {
    codeBuffer.push(line);
    continue;
  }

  if (!line.trim()) {
    y += 4;
    continue;
  }

  if (line.startsWith("# ")) {
    writeWrapped(line.slice(2), { size: 24, font: "bold", color: "#0F3D2E", after: 10, lineHeight: 29 });
  } else if (line.startsWith("## ")) {
    writeWrapped(line.slice(3), { size: 15, font: "bold", color: "#0F3D2E", before: 8, after: 5, lineHeight: 19 });
  } else if (line.startsWith("### ")) {
    writeWrapped(line.slice(4), { size: 12, font: "bold", color: "#0F3D2E", before: 5, after: 4, lineHeight: 16 });
  } else if (line.startsWith("- ")) {
    writeWrapped(line.slice(2), { size: 9.5, indent: 10, bullet: true, after: 3, lineHeight: 13 });
  } else if (/^\|.*\|$/.test(line)) {
    writeWrapped(line.replace(/\|/g, "  "), { size: 8.5, font: "normal", after: 3, lineHeight: 12 });
  } else {
    writeWrapped(line, { size: 9.5, after: 5, lineHeight: 13 });
  }
}

writeCode();
footer();
doc.save(output);
console.log(`Wrote ${output}`);
