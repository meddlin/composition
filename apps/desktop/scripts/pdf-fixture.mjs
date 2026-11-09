// A small PDF for the smoke tests, written by hand so they need nothing installed: Helvetica text on each page, an outline
// of chapters with sections, and page labels (the first three pages are i, ii and iii, and then 1, 2, 3 ...), which is the
// shape of a textbook whose 4th page is "page 1".
//
//   import { makeTestPdf } from "./pdf-fixture.mjs";
//   fs.writeFileSync(file, makeTestPdf({ pages: 12 }));
//   makeTestPdf({ title: "A Title" })         // gives it an Info dictionary with that Title
//   makeTestPdf({ xmpTitle: "A Title" })      // and/or an XMP packet with that dc:title

/** The text of page `n` (1-based), which a test can look for in the reader. */
export const pageText = (n) => `Page ${n} of the test book`;

export function makeTestPdf({ title, xmpTitle, pages = 12, chapters = [["Preface", 1, []], ["Chapter One", 4, [["First section", 5], ["Second section", 6]]], ["Chapter Two", 8, [["Only section", 9]]]] } = {}) {
  const objects = []; // index + 1 is the object number
  const add = (body) => objects.push(body) && objects.length;
  const reserve = () => add(null);
  const set = (id, body) => (objects[id - 1] = body);

  const catalog = reserve();
  const pagesRoot = reserve();
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];
  for (let n = 1; n <= pages; n++) {
    const stream = `BT /F1 24 Tf 72 700 Td (${pageText(n)}) Tj ET\nBT /F1 12 Tf 72 660 Td (Some words to select and search on page ${n}.) Tj ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  set(pagesRoot, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages} >>`);

  // Outline: reserve every item first so siblings can point at each other.
  const outlines = reserve();
  const items = chapters.map(([title, page, sections]) => ({ title, page, id: reserve(), sections: sections.map(([t, p]) => ({ title: t, page: p, id: reserve() })) }));
  const dest = (page) => `/Dest [${pageIds[page - 1]} 0 R /Fit]`;
  items.forEach((chapter, i) => {
    const links = [`/Parent ${outlines} 0 R`, i > 0 ? `/Prev ${items[i - 1].id} 0 R` : "", i < items.length - 1 ? `/Next ${items[i + 1].id} 0 R` : ""];
    if (chapter.sections.length > 0) links.push(`/First ${chapter.sections[0].id} 0 R /Last ${chapter.sections.at(-1).id} 0 R /Count ${chapter.sections.length}`);
    set(chapter.id, `<< /Title (${chapter.title}) ${links.join(" ")} ${dest(chapter.page)} >>`);
    chapter.sections.forEach((section, j) => {
      const sibling = [`/Parent ${chapter.id} 0 R`, j > 0 ? `/Prev ${chapter.sections[j - 1].id} 0 R` : "", j < chapter.sections.length - 1 ? `/Next ${chapter.sections[j + 1].id} 0 R` : ""];
      set(section.id, `<< /Title (${section.title}) ${sibling.join(" ")} ${dest(section.page)} >>`);
    });
  });
  const total = items.reduce((n, c) => n + 1 + c.sections.length, 0);
  set(outlines, `<< /Type /Outlines /First ${items[0].id} 0 R /Last ${items.at(-1).id} 0 R /Count ${total} >>`);

  // The PDF's own title: the Info dictionary's `Title`, and (when asked) an XMP packet's `dc:title`, which is the one read first.
  const info = title === undefined ? null : add(`<< /Title (${title}) >>`);
  const xml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const xmpPacket =
    xmpTitle === undefined
      ? null
      : [
          '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
          '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
          '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">',
          '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">',
          xml(xmpTitle),
          "</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta>",
          '<?xpacket end="w"?>',
        ].join("");
  const xmp = xmpPacket === null ? null : add(`<< /Type /Metadata /Subtype /XML /Length ${xmpPacket.length} >>\nstream\n${xmpPacket}\nendstream`);

  set(catalog, `<< /Type /Catalog /Pages ${pagesRoot} 0 R /Outlines ${outlines} 0 R /PageLabels << /Nums [0 << /S /r >> 3 << /S /D /St 1 >>] >>${xmp === null ? "" : ` /Metadata ${xmp} 0 R`} >>`);

  let out = "%PDF-1.7\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${info === null ? "" : ` /Info ${info} 0 R`} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
