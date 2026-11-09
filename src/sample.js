// Builds the sample guide PDF shown on first launch: a short how-to plus
// Francis Bacon's essay "Of Studies" (1625, public domain) to practise on.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const W = 612, H = 792, M = 72;

const OF_STUDIES = `Studies serve for delight, for ornament, and for ability. Their chief use for delight, is in privateness and retiring; for ornament, is in discourse; and for ability, is in the judgment, and disposition of business. For expert men can execute, and perhaps judge of particulars, one by one; but the general counsels, and the plots and marshalling of affairs, come best, from those that are learned. To spend too much time in studies is sloth; to use them too much for ornament, is affectation; to make judgment wholly by their rules, is the humor of a scholar. They perfect nature, and are perfected by experience: for natural abilities are like natural plants, that need proyning, by study; and studies themselves, do give forth directions too much at large, except they be bounded in by experience.
Crafty men contemn studies, simple men admire them, and wise men use them; for they teach not their own use; but that is a wisdom without them, and above them, won by observation. Read not to contradict and confute; nor to believe and take for granted; nor to find talk and discourse; but to weigh and consider. Some books are to be tasted, others to be swallowed, and some few to be chewed and digested; that is, some books are to be read only in parts; others to be read, but not curiously; and some few to be read wholly, and with diligence and attention. Some books also may be read by deputy, and extracts made of them by others; but that would be only in the less important arguments, and the meaner sort of books, else distilled books are like common distilled waters, flashy things.
Reading maketh a full man; conference a ready man; and writing an exact man. And therefore, if a man write little, he had need have a great memory; if he confer little, he had need have a present wit: and if he read little, he had need have much cunning, to seem to know, that he doth not. Histories make men wise; poets witty; the mathematics subtile; natural philosophy deep; moral grave; logic and rhetoric able to contend. Abeunt studia in mores.
Nay, there is no stond or impediment in the wit, but may be wrought out by fit studies; like as diseases of the body, may have appropriate exercises. Bowling is good for the stone and reins; shooting for the lungs and breast; gentle walking for the stomach; riding for the head; and the like. So if a man's wit be wandering, let him study the mathematics; for in demonstrations, if his wit be called away never so little, he must begin again. If his wit be not apt to distinguish or find differences, let him study the Schoolmen; for they are cymini sectores. If he be not apt to beat over matters, and to call up one thing to prove and illustrate another, let him study the lawyers' cases. So every defect of the mind, may have a special receipt.`;

function wrap(text, font, size, maxW) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(t, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

export async function makeSample() {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Of Studies: a sample to read and mark up');
  pdf.setAuthor('Francis Bacon (1625), with a Marginalia guide');
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifIt = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const inkC = rgb(0.1, 0.13, 0.17), mutedC = rgb(0.37, 0.42, 0.48), accent = rgb(0.13, 0.34, 0.48);
  const annots = [];

  // ---- Page 1: guide ----
  let p = pdf.addPage([W, H]);
  let y = H - M;
  p.drawText('SAMPLE GUIDE', { x: M, y, size: 9, font: sansB, color: accent });
  y -= 34;
  p.drawText('Welcome to your reading room', { x: M, y, size: 26, font: serif, color: inkC });
  y -= 30;
  for (const l of wrap('This short PDF is here so you can try every tool before adding your own documents. It lives in your library like any other file. Delete it whenever you like.', serif, 13, W - 2 * M)) {
    p.drawText(l, { x: M, y, size: 13, font: serif, color: mutedC });
    y -= 19;
  }
  y -= 18;
  const steps = [
    ['Highlight', 'Select any text. A small menu appears: pick a color to highlight it, or choose underline or strikethrough.'],
    ['Comment', 'Click a highlight to attach a comment. Highlights with comments show a small marker in the margin.'],
    ['Sticky note', 'Pick the note tool (N) and click anywhere on the page to pin a note. Drag it to move it.'],
    ['Draw', 'The pen tool (P) lets you circle, underline or sketch by hand. The eraser (E) removes any mark you touch.'],
    ['Text box', 'The text tool (T) places typed text on the page, handy for filling in answers or labels.'],
    ['Find your way', 'Use the sidebar for all your notes, full-text search, the table of contents and bookmarks.'],
    ['Export', 'Download your notes as Markdown, or a copy of the PDF with every mark baked in.'],
  ];
  for (const [h, body] of steps) {
    p.drawText(h, { x: M, y, size: 11, font: sansB, color: inkC });
    let yy = y;
    for (const l of wrap(body, sans, 10.5, W - 2 * M - 110)) {
      p.drawText(l, { x: M + 110, y: yy, size: 10.5, font: sans, color: inkC });
      yy -= 15;
    }
    y = Math.min(y - 20, yy - 8);
  }
  y -= 12;
  p.drawText('Turn the page for a classic essay on reading to practise on.', { x: M, y, size: 12, font: serifIt, color: mutedC });
  annots.push({
    type: 'note', page: 0, x: W - M - 10, y: 66, color: 'yellow',
    comment: 'This is a sticky note. Click it to read or edit it, drag it to move it, or delete it from here.',
  });

  // ---- Page 2-3: Of Studies ----
  p = pdf.addPage([W, H]);
  y = H - M;
  p.drawText('Of Studies', { x: M, y: y - 6, size: 28, font: serif, color: inkC });
  y -= 30;
  p.drawText('Francis Bacon · Essays, 1625', { x: M, y: y - 4, size: 11, font: serifIt, color: mutedC });
  y -= 36;
  const size = 12.5, lh = 19;
  let pageIndex = 1;
  const target = 'Read not to contradict';
  for (const para of OF_STUDIES.split('\n')) {
    for (const l of wrap(para, serif, size, W - 2 * M)) {
      if (y < M) {
        p = pdf.addPage([W, H]);
        pageIndex++;
        y = H - M;
      }
      p.drawText(l, { x: M, y, size, font: serif, color: inkC });
      const idx = l.indexOf(target);
      if (idx >= 0 && !annots.some((a) => a.type === 'highlight')) {
        const x0 = M + serif.widthOfTextAtSize(l.slice(0, idx), size);
        const w = serif.widthOfTextAtSize(l.slice(idx), size);
        annots.push({
          type: 'highlight', page: pageIndex, color: 'yellow',
          rects: [[x0, H - y - size * 0.82, w, size * 1.08]],
          text: l.slice(idx),
          comment: 'Bacon’s rule for reading: weigh and consider. Click any highlight to add your own comment.',
        });
      }
      y -= lh;
    }
    y -= 9;
  }
  // footer page numbers
  pdf.getPages().forEach((pg, i) => {
    const s = String(i + 1);
    pg.drawText(s, { x: W / 2 - sans.widthOfTextAtSize(s, 9) / 2, y: 36, size: 9, font: sans, color: mutedC });
  });

  return { bytes: await pdf.save(), annots };
}
