import { PDFDocument, StandardFonts, rgb, BlendMode, LineCapStyle } from 'pdf-lib';

// Highlight fills (translucent marker) and ink tones (pen, underline, text).
export const COLORS = ['yellow', 'green', 'blue', 'pink', 'ink'];
export const COLOR_NAMES = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink', ink: 'Graphite' };
export const HL = { yellow: '#F6CF3B', green: '#6CCB86', blue: '#6AAEEE', pink: '#F08DBB', ink: '#A3ADB8' };
export const INK = { yellow: '#B88A00', green: '#23824A', blue: '#1E62B0', pink: '#BF3F7C', ink: '#1C2129' };
export const TYPE_LABEL = {
  highlight: 'Highlight',
  underline: 'Underline',
  strike: 'Strikethrough',
  ink: 'Drawing',
  note: 'Sticky note',
  text: 'Text box',
};

export const slug = (s) =>
  String(s || 'document')
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'document';

export function annotY(a) {
  if (a.rects?.length) return a.rects[0][1];
  if (a.pts?.length) return a.pts[1];
  return a.y ?? 0;
}
export const sortAnnots = (list) =>
  list.slice().sort((a, b) => a.page - b.page || annotY(a) - annotY(b) || (a.created || 0) - (b.created || 0));

// Trigger a browser download for generated data.
export function download(filename, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------- Markdown notes ----------
export function toMarkdown(doc, annots) {
  const lines = [`# ${doc.title}`, ''];
  if (doc.author) lines.push(`*${doc.author}*`, '');
  lines.push(`Notes exported from Marginalia on ${new Date().toLocaleDateString()}. ${annots.length} annotation${annots.length === 1 ? '' : 's'}.`, '');
  let page = -1;
  for (const a of sortAnnots(annots)) {
    if (a.page !== page) {
      page = a.page;
      lines.push(`## Page ${page + 1}`, '');
    }
    const tag = `**${TYPE_LABEL[a.type] || a.type}** · ${COLOR_NAMES[a.color] || a.color}`;
    if (a.text && a.type !== 'text') {
      lines.push(`> ${a.text.replace(/\s+/g, ' ').trim()}`, '');
      lines.push(tag + (a.comment ? `: ${a.comment.trim()}` : ''), '');
    } else if (a.type === 'text') {
      lines.push(`${tag}: ${(a.text || '').trim()}`, '');
    } else {
      lines.push(tag + (a.comment ? `: ${a.comment.trim()}` : ''), '');
    }
  }
  if (doc.bookmarks?.length) {
    lines.push('## Bookmarks', '', ...doc.bookmarks.slice().sort((a, b) => a - b).map((p) => `- Page ${p + 1}`), '');
  }
  return lines.join('\n');
}

// ---------- Annotated PDF ----------
const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const safeText = (s) =>
  String(s || '')
    .replace(/\t/g, '    ')
    .split('')
    .map((c) => {
      const code = c.charCodeAt(0);
      if (c === '\n') return c;
      if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRA.includes(c)) return c;
      return '?';
    })
    .join('');

function wrapLines(text, font, size, maxWidth) {
  const out = [];
  for (const para of safeText(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        out.push(line);
        line = w;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

/**
 * Bake annotations into a copy of the PDF.
 * @param {Uint8Array} bytes original file
 * @param {object[]} annots annotations in viewport space (scale 1, top-left origin)
 * @param {object[]} viewports pdf.js viewports at scale 1, one per page (for coordinate conversion)
 */
export async function annotatedPdf(bytes, annots, viewports, title) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();
  const comments = [];

  const marker = (page, x, y, n, color) => {
    page.drawCircle({ x, y, size: 6.5, color: hex(INK[color] || INK.ink) });
    const label = String(n);
    page.drawText(label, { x: x - bold.widthOfTextAtSize(label, 7) / 2, y: y - 2.5, size: 7, font: bold, color: rgb(1, 1, 1) });
  };

  for (const a of sortAnnots(annots)) {
    const page = pages[a.page];
    const vp = viewports[a.page];
    if (!page || !vp) continue;
    const P = (x, y) => vp.convertToPdfPoint(x, y);
    const box = ([x, y, w, h]) => {
      const [x1, y1] = P(x, y);
      const [x2, y2] = P(x + w, y + h);
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    };
    const ink = hex(INK[a.color] || INK.ink);

    if (a.type === 'highlight') {
      for (const r of a.rects) {
        const b = box(r);
        page.drawRectangle({ x: b.x, y: b.y, width: b.w, height: b.h, color: hex(HL[a.color] || HL.yellow), opacity: 0.45, blendMode: BlendMode.Multiply });
      }
    } else if (a.type === 'underline' || a.type === 'strike') {
      for (const [x, y, w, h] of a.rects) {
        const yy = a.type === 'underline' ? y + h - 0.6 : y + h * 0.55;
        const [sx, sy] = P(x, yy);
        const [ex, ey] = P(x + w, yy);
        page.drawLine({ start: { x: sx, y: sy }, end: { x: ex, y: ey }, thickness: 1.2, color: ink });
      }
    } else if (a.type === 'ink' && a.pts?.length >= 2) {
      const p = a.pts;
      if (p.length === 2) {
        const [cx, cy] = P(p[0], p[1]);
        page.drawCircle({ x: cx, y: cy, size: (a.w || 2) / 2, color: ink });
      }
      for (let k = 0; k + 3 < p.length; k += 2) {
        const [sx, sy] = P(p[k], p[k + 1]);
        const [ex, ey] = P(p[k + 2], p[k + 3]);
        page.drawLine({ start: { x: sx, y: sy }, end: { x: ex, y: ey }, thickness: a.w || 2, color: ink, lineCap: LineCapStyle.Round });
      }
    } else if (a.type === 'text' && a.text) {
      const size = a.size || 14;
      const lines = safeText(a.text).split('\n');
      lines.forEach((ln, i) => {
        const [tx, ty] = P(a.x + 2, a.y + 2 + size * 0.85 + i * size * 1.25);
        page.drawText(ln, { x: tx, y: ty, size, font, color: ink });
      });
    }

    const hasComment = (a.comment || '').trim();
    if (a.type === 'note' || hasComment) {
      const n = comments.length + 1;
      let mx, my;
      if (a.type === 'note') [mx, my] = P(a.x + 7, a.y + 7);
      else if (a.rects?.length) {
        const [x, y, w] = a.rects[a.rects.length - 1];
        [mx, my] = P(x + w + 6, y);
      } else if (a.pts?.length) [mx, my] = P(a.pts[0], a.pts[1] - 8);
      else [mx, my] = P(a.x, a.y - 8);
      marker(page, mx, my, n, a.color);
      comments.push({ n, a });
    }
  }

  // Append a "Notes" page listing every comment with its number.
  if (comments.length) {
    const W = 612, H = 792, M = 56;
    let page = pdf.addPage([W, H]);
    let y = H - M;
    const newPage = () => {
      page = pdf.addPage([W, H]);
      y = H - M;
    };
    page.drawText('Notes', { x: M, y: y - 18, size: 22, font: bold, color: rgb(0.1, 0.13, 0.17) });
    y -= 34;
    page.drawText(safeText(title || ''), { x: M, y: y - 10, size: 10, font, color: rgb(0.36, 0.4, 0.46) });
    y -= 34;
    for (const { n, a } of comments) {
      const head = `${n}.  Page ${a.page + 1} · ${TYPE_LABEL[a.type] || a.type}`;
      const quote = a.text && a.type !== 'text' ? wrapLines('"' + a.text.replace(/\s+/g, ' ').trim() + '"', font, 9.5, W - 2 * M - 18) : [];
      const body = wrapLines(a.comment || '(empty note)', font, 11, W - 2 * M - 18);
      const need = 18 + quote.length * 13 + body.length * 15 + 14;
      if (y - need < M) newPage();
      page.drawText(safeText(head), { x: M, y, size: 10, font: bold, color: hex(INK[a.color] || INK.ink) });
      y -= 16;
      for (const q of quote) {
        page.drawText(q, { x: M + 18, y, size: 9.5, font, color: rgb(0.38, 0.42, 0.48) });
        y -= 13;
      }
      for (const b of body) {
        page.drawText(b, { x: M + 18, y, size: 11, font, color: rgb(0.1, 0.13, 0.17) });
        y -= 15;
      }
      y -= 14;
    }
  }
  return pdf.save();
}

// ---------- Backup helpers ----------
export const blobToBase64 = (blob) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });

export function base64ToBlob(b64, type = 'application/pdf') {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}
