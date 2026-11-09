import './styles.css';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { I, hydrateIcons } from './icons.js';
import { openStore, storageEstimate } from './storage.js';
import { makeSample } from './sample.js';
import {
  COLORS, COLOR_NAMES, HL, INK, TYPE_LABEL, slug, sortAnnots, annotY,
  download, toMarkdown, annotatedPdf, blobToBase64, base64ToBlob,
} from './exporters.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
const PDF_OPTS = {
  isEvalSupported: false,
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
};

/* =========================================================
   Helpers
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 20);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (n) => Math.round(n * 10) / 10;
const debounce = (fn, ms) => {
  let t;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
};
const ls = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};
const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const fmtBytes = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
function relTime(t) {
  if (!t) return 'never opened';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    toast('Copy is blocked in this browser. Select the text and copy it manually.', true);
  }
}

function toast(msg, err = false, ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

/* =========================================================
   State
   ========================================================= */
const STATUS = { 'to-read': 'To read', reading: 'Reading', done: 'Finished' };
const TOOLS = [
  { id: 'select', icon: 'cursor', key: 'v', label: 'Select', hint: 'Select text to highlight or comment. Click a mark to edit it.' },
  { id: 'highlight', icon: 'highlight', key: 'h', label: 'Highlight', hint: 'Drag across text to highlight it.' },
  { id: 'underline', icon: 'underline', key: 'u', label: 'Underline', hint: 'Drag across text to underline it.' },
  { id: 'strike', icon: 'strike', key: 's', label: 'Strikethrough', hint: 'Drag across text to strike it through.' },
  { id: 'pen', icon: 'pen', key: 'p', label: 'Pen', hint: 'Draw freely on the page.' },
  { id: 'note', icon: 'note', key: 'n', label: 'Sticky note', hint: 'Click anywhere on a page to pin a note.' },
  { id: 'text', icon: 'text', key: 't', label: 'Text box', hint: 'Click on a page to type text onto it.' },
  { id: 'eraser', icon: 'eraser', key: 'e', label: 'Eraser', hint: 'Click or drag over any mark to remove it.' },
];
const THEMES = ['paper', 'sepia', 'night'];
const THEME_ICON = { paper: 'sun', sepia: 'sepia', night: 'moon' };
const THEME_LABEL = { paper: 'Paper', sepia: 'Sepia', night: 'Night' };

const S = {
  store: null,
  docs: [],
  shelf: 'all',
  tag: null,
  q: '',
  sort: ls.get('mg.sort', 'recent'),
  view: 'library',
  // reader
  doc: null,
  pdf: null,
  bytes: null,
  pages: [],
  annots: [],
  scale: 1,
  fit: true,
  cur: 0,
  tool: 'select',
  color: ls.get('mg.color', 'yellow'),
  theme: ls.get('mg.theme', 'paper'),
  undo: [],
  sideOpen: ls.get('mg.side', window.innerWidth > 860),
  sideTab: 'notes',
  noteColor: null,
  commentsOnly: false,
  text: [],
  hitQuery: '',
  pop: null,
  activeId: null,
  openToken: 0,
};

/* =========================================================
   Persistence (serialized per key, debounced where needed)
   ========================================================= */
const queues = new Map();
function serial(key, fn) {
  const p = (queues.get(key) || Promise.resolve()).catch(() => {}).then(fn);
  queues.set(key, p);
  return p.catch((e) => {
    console.error(e);
    if (/quota/i.test(String(e?.name || e?.message))) toast('Your browser storage is full. Delete some PDFs to make room.', true, 6000);
    else toast('Could not save a change. Check that site storage is allowed.', true);
  });
}
const docTimers = new Map();
function saveDoc(d, delay = 0) {
  clearTimeout(docTimers.get(d.id));
  if (!delay) return serial('doc:' + d.id, () => S.store.putDoc(d));
  docTimers.set(d.id, setTimeout(() => serial('doc:' + d.id, () => S.store.putDoc(d)), delay));
}
const annTimers = new Map();
function saveAnnot(a, delay = 0) {
  clearTimeout(annTimers.get(a.id));
  if (!delay) return serial('ann:' + a.id, () => S.store.putAnnot(a));
  annTimers.set(a.id, setTimeout(() => { annTimers.delete(a.id); serial('ann:' + a.id, () => S.store.putAnnot(a)); }, delay));
}
function flushAnnSaves() {
  for (const [id, t] of annTimers) {
    clearTimeout(t);
    const a = S.annots.find((x) => x.id === id);
    if (a) serial('ann:' + id, () => S.store.putAnnot(a));
  }
  annTimers.clear();
}

/* =========================================================
   Library
   ========================================================= */
const prog = (d) => (d.opened && d.pages ? Math.round((((d.maxPage ?? d.lastPage) || 0) + 1) / d.pages * 100) : 0);

function filteredDocs() {
  let l = S.docs.slice();
  if (S.shelf !== 'all') l = l.filter((d) => d.status === S.shelf);
  if (S.tag) l = l.filter((d) => d.tags?.includes(S.tag));
  const q = S.q.trim().toLowerCase();
  if (q) l = l.filter((d) => [d.title, d.author, d.fileName, ...(d.tags || [])].join(' ').toLowerCase().includes(q));
  const by = {
    recent: (a, b) => (b.opened || b.added) - (a.opened || a.added),
    added: (a, b) => b.added - a.added,
    title: (a, b) => a.title.localeCompare(b.title),
    progress: (a, b) => prog(b) - prog(a),
  };
  return l.sort(by[S.sort] || by.recent);
}

function renderLibrary() {
  const counts = { all: S.docs.length, 'to-read': 0, reading: 0, done: 0 };
  S.docs.forEach((d) => counts[d.status]++);
  $('#shelves').innerHTML = [['all', 'All'], ['reading', 'Reading'], ['to-read', 'To read'], ['done', 'Finished']]
    .map(([k, l]) => `<button role="tab" aria-selected="${S.shelf === k}" class="${S.shelf === k ? 'on' : ''}" data-shelf="${k}">${l}<span class="count">${counts[k]}</span></button>`)
    .join('');

  const tags = [...new Set(S.docs.flatMap((d) => d.tags || []))].sort((a, b) => a.localeCompare(b));
  if (S.tag && !tags.includes(S.tag)) S.tag = null;
  $('#tagbar').innerHTML = tags.length
    ? tags.map((t) => `<button class="chip ${S.tag === t ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')
    : '';

  const list = filteredDocs();
  const grid = $('#grid');
  if (!S.docs.length) {
    grid.innerHTML = `<div class="empty">${I.book}<h2>Your shelf is empty</h2>
      <p>Add PDFs from your device or drag them anywhere onto this page. They are stored privately in this browser.</p>
      <div class="row"><button class="btn primary" data-act="upload">${I.upload}Add PDFs</button>
      <button class="btn" data-act="sample">${I.sparkle}Add the sample guide</button></div></div>`;
  } else if (!list.length) {
    grid.innerHTML = `<div class="empty"><h2>Nothing matches</h2><p>No PDFs on this shelf match your search or tag.</p>
      <div class="row"><button class="btn" data-act="clearfilters">Clear filters</button></div></div>`;
  } else {
    grid.innerHTML = list.map(cardHTML).join('');
  }
  updateStorageNote();
}

function cardHTML(d) {
  const p = prog(d);
  return `<article class="card" data-id="${d.id}">
    <button class="cover" data-act="open" aria-label="Open ${esc(d.title)}">
      ${d.thumb ? `<img src="${d.thumb}" alt="" loading="lazy">` : `<div class="cover-ph">PDF</div>`}
    </button>
    <div class="card-body">
      <span class="pill s-${d.status}">${STATUS[d.status]}</span>
      <h3 class="card-title" title="${esc(d.title)}">${esc(d.title)}</h3>
      <p class="card-sub">${d.author ? esc(d.author) + ' · ' : ''}${d.pages} page${d.pages === 1 ? '' : 's'} · ${d.annCount || 0} mark${d.annCount === 1 ? '' : 's'}</p>
      <div class="bar" aria-label="${p}% read"><span style="width:${p}%"></span></div>
      <div class="card-foot"><span>${p}%</span><span>${relTime(d.opened)}</span></div>
      ${d.tags?.length ? `<div class="card-tags">${d.tags.map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
    </div>
    <button class="iconbtn card-more" data-act="edit" aria-label="Edit details for ${esc(d.title)}">${I.more}</button>
  </article>`;
}

async function updateStorageNote() {
  const el = $('#storageNote');
  if (S.store?.kind === 'memory') {
    el.textContent = 'This browser is blocking site storage (private mode?). Your PDFs will be lost when you close the tab.';
    return;
  }
  const est = await storageEstimate();
  const total = S.docs.reduce((n, d) => n + (d.size || 0), 0);
  el.textContent = `${S.docs.length} PDF${S.docs.length === 1 ? '' : 's'} · ${fmtBytes(total)} stored in this browser` +
    (est?.quota ? ` · ${fmtBytes(est.quota - est.usage)} free` : '') +
    '. Use Back up library from the ⋯ menu to keep a copy or move to another device.';
}

/* ---------- adding PDFs ---------- */
async function renderThumb(pdf) {
  const page = await pdf.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: 360 / vp1.width });
  const c = document.createElement('canvas');
  c.width = Math.floor(vp.width);
  c.height = Math.floor(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return c.toDataURL('image/jpeg', 0.75);
}

async function addPdf(bytes, fileName, extra = {}) {
  const loading = pdfjsLib.getDocument({ ...PDF_OPTS, data: bytes.slice() });
  const pdf = await loading.promise;
  try {
    let title = '', author = '';
    try {
      const meta = await pdf.getMetadata();
      title = (meta?.info?.Title || '').trim();
      author = (meta?.info?.Author || '').trim();
    } catch {}
    if (!title || /^untitled|^microsoft word|\.docx?$/i.test(title)) title = fileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ');
    let thumb = '';
    try {
      thumb = await renderThumb(pdf);
    } catch (e) {
      console.warn('thumb failed', e);
    }
    const id = uid();
    const doc = {
      id, fileId: 'f_' + id, title: title.slice(0, 200), author: author.slice(0, 120), fileName, size: bytes.byteLength,
      pages: pdf.numPages, thumb, status: 'to-read', tags: [], lastPage: 0, maxPage: 0, bookmarks: [], annCount: 0,
      added: Date.now(), opened: 0, ...extra,
    };
    await S.store.putFile(doc.fileId, new Blob([bytes], { type: 'application/pdf' }));
    await S.store.putDoc(doc);
    S.docs.push(doc);
    return doc;
  } finally {
    pdf.destroy();
  }
}

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const skipped = fileList.length - files.length;
  if (skipped) toast(`${skipped} file${skipped > 1 ? 's were' : ' was'} skipped. Only PDFs can be added.`, true);
  let added = 0;
  for (const f of files) {
    const t = toast(`Adding “${f.name}”…`, false, 60000);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      await addPdf(bytes, f.name);
      added++;
    } catch (e) {
      console.error(e);
      const msg = e?.name === 'PasswordException' ? 'it is password-protected' : 'it does not look like a valid PDF';
      toast(`Could not add “${f.name}”: ${msg}.`, true, 5000);
    } finally {
      t.remove();
    }
    renderLibrary();
  }
  if (added) toast(`Added ${added} PDF${added > 1 ? 's' : ''} to “To read”.`);
}

async function addSample() {
  const t = toast('Creating the sample guide…', false, 30000);
  try {
    const { bytes, annots } = await makeSample();
    const doc = await addPdf(bytes, 'of-studies-sample.pdf', {
      title: 'Of Studies: a sample to read and mark up', author: 'Francis Bacon, 1625', tags: ['example'], annCount: annots.length,
    });
    for (const a of annots) await S.store.putAnnot({ id: uid(), docId: doc.id, created: Date.now(), comment: '', ...a });
    renderLibrary();
    return doc;
  } catch (e) {
    console.error(e);
    toast('Could not create the sample guide.', true);
  } finally {
    t.remove();
  }
}

/* ---------- details / delete ---------- */
function openModal(html) {
  $('#sheet').innerHTML = html;
  $('#modal').hidden = false;
  hydrateIcons($('#sheet'));
  setTimeout(() => $('#sheet').querySelector('input, button')?.focus(), 30);
}
function closeModal() {
  $('#modal').hidden = true;
  $('#sheet').innerHTML = '';
}

function editDetails(d) {
  openModal(`<h2>Edit details</h2>
    <form id="detailsForm" class="field" style="gap:14px">
      <label class="field"><span>Title</span><input id="fTitle" value="${esc(d.title)}" maxlength="200" required></label>
      <label class="field"><span>Author</span><input id="fAuthor" value="${esc(d.author || '')}" maxlength="120" placeholder="Optional"></label>
      <div class="field"><span>Shelf</span><div class="seg">
        ${Object.entries(STATUS).map(([k, l]) => `<label><input type="radio" name="fStatus" value="${k}" ${d.status === k ? 'checked' : ''}>${l}</label>`).join('')}
      </div></div>
      <label class="field"><span>Tags</span><input id="fTags" value="${esc((d.tags || []).join(', '))}" placeholder="e.g. thesis, chapter 2, to-cite">
        <span class="hint" style="text-transform:none;letter-spacing:0;font-weight:400">Separate tags with commas. Tags appear as filters on your shelf.</span></label>
      <p class="hint">${esc(d.fileName || '')} · ${fmtBytes(d.size || 0)} · added ${new Date(d.added).toLocaleDateString()}</p>
      <div class="sheet-actions">
        <button type="button" class="btn ghost left" data-act="askdelete" style="color:var(--danger)">${I.trash}Delete</button>
        <button type="button" class="btn" data-act="close">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>`);
  $('#detailsForm').onsubmit = (e) => {
    e.preventDefault();
    d.title = $('#fTitle').value.trim() || d.title;
    d.author = $('#fAuthor').value.trim();
    d.status = $('input[name=fStatus]:checked').value;
    d.tags = [...new Set($('#fTags').value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    saveDoc(d);
    closeModal();
    renderLibrary();
    if (S.doc === d) $('#rtitle').textContent = d.title;
    toast('Saved');
  };
  $('#sheet').querySelector('[data-act=askdelete]').onclick = () => confirmDelete(d);
}

function confirmDelete(d) {
  openModal(`<h2>Delete “${esc(d.title)}”?</h2>
    <p>This removes the PDF and its ${d.annCount || 0} annotation${d.annCount === 1 ? '' : 's'} from this browser. It cannot be undone.</p>
    <div class="sheet-actions"><button class="btn" data-act="close">Keep it</button>
    <button class="btn danger" id="doDelete">${I.trash}Delete</button></div>`);
  $('#doDelete').onclick = async () => {
    closeModal();
    if (S.doc === d) closeReader();
    S.docs = S.docs.filter((x) => x !== d);
    await serial('doc:' + d.id, () => S.store.deleteDoc(d));
    renderLibrary();
    toast(`Deleted “${d.title}”.`);
  };
}

/* ---------- backup ---------- */
async function backupLibrary() {
  if (!S.docs.length) return toast('Your library is empty, so there is nothing to back up yet.');
  const t = toast('Preparing backup…', false, 120000);
  try {
    const docs = [];
    for (const d of S.docs) {
      const blob = await S.store.getFileBlob(d.fileId);
      docs.push({ ...d, file: blob ? await blobToBase64(blob) : null });
    }
    const annots = await S.store.allAnnots();
    const data = JSON.stringify({ app: 'marginalia', version: 1, exported: new Date().toISOString(), docs, annots });
    download(`marginalia-backup-${new Date().toISOString().slice(0, 10)}.json`, data, 'application/json');
    toast('Backup downloaded. Keep it somewhere safe.');
  } catch (e) {
    console.error(e);
    toast('Could not create the backup.', true);
  } finally {
    t.remove();
  }
}

async function restoreLibrary(file) {
  const t = toast('Restoring backup…', false, 120000);
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'marginalia' || !Array.isArray(data.docs)) throw new Error('Not a Marginalia backup');
    const have = new Set(S.docs.map((d) => d.id));
    let n = 0;
    for (const d of data.docs) {
      if (have.has(d.id) || !d.file) continue;
      const { file: b64, ...meta } = d;
      await S.store.putFile(meta.fileId, base64ToBlob(b64));
      await S.store.putDoc(meta);
      S.docs.push(meta);
      for (const a of data.annots || []) if (a.docId === meta.id) await S.store.putAnnot(a);
      n++;
    }
    renderLibrary();
    toast(n ? `Restored ${n} PDF${n > 1 ? 's' : ''}.` : 'Everything in that backup is already in your library.');
  } catch (e) {
    console.error(e);
    toast('That file is not a Marginalia backup, or it is damaged.', true);
  } finally {
    t.remove();
  }
}

/* =========================================================
   Reader: open / layout / render
   ========================================================= */
const stage = $('#stage');
const pagesEl = $('#pages');
let io;

async function openReader(id) {
  const d = S.docs.find((x) => x.id === id);
  if (!d) {
    location.hash = '';
    return;
  }
  const token = ++S.openToken;
  closePop();
  if (S.pdf) teardownReader();
  S.view = 'reader';
  S.doc = d;
  $('#libraryView').hidden = true;
  $('#readerView').hidden = false;
  $('#rtitle').textContent = d.title;
  document.title = `${d.title} · Marginalia`;
  pagesEl.innerHTML = '';
  $('#readerLoading').hidden = false;
  $('#loadingText').textContent = 'Opening…';
  applyTheme();
  applySide();
  try {
    const bytes = await S.store.getFile(d.fileId);
    if (!bytes) throw new Error('File missing from storage');
    const pdf = await pdfjsLib.getDocument({ ...PDF_OPTS, data: bytes.slice() }).promise;
    if (token !== S.openToken) return pdf.destroy();
    S.bytes = bytes;
    S.pdf = pdf;
    S.annots = await S.store.annots(d.id);
    S.undo = [];
    S.text = [];
    S.hitQuery = '';
    S.pages = [];
    for (let i = 0; i < pdf.numPages; i++) {
      if (i % 25 === 0) $('#loadingText').textContent = `Laying out page ${i + 1} of ${pdf.numPages}…`;
      const page = await pdf.getPage(i + 1);
      if (token !== S.openToken) return;
      const vp = page.getViewport({ scale: 1 });
      S.pages.push({ page, vp, w: vp.width, h: vp.height, el: null, rendered: 0, rendering: false });
    }
    S.fit = true;
    S.scale = fitScale();
    buildPages();
    $('#readerLoading').hidden = true;
    $('#pageTotal').textContent = `/ ${pdf.numPages}`;
    goPage(clamp(d.lastPage || 0, 0, pdf.numPages - 1), false);
    updateZoomLabel();
    d.opened = Date.now();
    if (d.status === 'to-read') d.status = 'reading';
    if (d.annCount !== S.annots.length) d.annCount = S.annots.length;
    saveDoc(d);
    renderSide();
    loadOutline();
    $('#searchResults').innerHTML = '';
    $('#searchInput').value = '';
    setTool('select');
    updateBookmarkBtn();
  } catch (e) {
    console.error(e);
    $('#readerLoading').hidden = true;
    pagesEl.innerHTML = `<div class="empty" style="margin:40px auto;max-width:420px;background:var(--surface)"><h2>This PDF could not be opened</h2>
      <p>${e?.name === 'PasswordException' ? 'It is password-protected.' : 'The file may be damaged or missing from browser storage.'}</p>
      <div class="row"><button class="btn" id="errBack">Back to library</button></div></div>`;
    $('#errBack').onclick = () => (location.hash = '');
  }
}

function teardownReader() {
  flushAnnSaves();
  if (S.doc) saveDoc(S.doc);
  io?.disconnect();
  try {
    S.pdf?.destroy();
  } catch {}
  S.pdf = null;
  S.bytes = null;
  S.pages = [];
  S.annots = [];
}

function closeReader() {
  S.openToken++;
  closePop();
  teardownReader();
  S.doc = null;
  S.view = 'library';
  $('#readerView').hidden = true;
  $('#libraryView').hidden = false;
  document.title = 'Marginalia';
  if (location.hash.startsWith('#read/')) history.replaceState(null, '', location.pathname + location.search);
  renderLibrary();
}

function fitScale() {
  const maxW = Math.max(...S.pages.map((p) => p.w), 1);
  const avail = stage.clientWidth - (window.innerWidth < 640 ? 16 : 56);
  return clamp(avail / maxW, 0.3, 3);
}

function buildPages() {
  io?.disconnect();
  io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        const i = +en.target.dataset.i;
        if (en.isIntersecting) renderPage(i);
        else if (Math.abs(i - S.cur) > 5) unrenderPage(i);
      }
    },
    { root: stage, rootMargin: '900px 0px' },
  );
  pagesEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  S.pages.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.i = i;
    el.innerHTML = `<canvas></canvas><svg class="ann" viewBox="0 0 ${p.w} ${p.h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"></svg><div class="textLayer"></div><div class="hann"></div><div class="draw"></div><span class="pnum">${i + 1}</span>`;
    p.el = el;
    sizePage(p);
    frag.append(el);
  });
  pagesEl.append(frag);
  S.pages.forEach((p, i) => {
    io.observe(p.el);
    drawAnnots(i);
  });
}

function sizePage(p) {
  p.el.style.width = `${Math.floor(p.w * S.scale)}px`;
  p.el.style.height = `${Math.floor(p.h * S.scale)}px`;
  p.el.style.setProperty('--scale-factor', S.scale);
}

async function renderPage(i) {
  const p = S.pages[i];
  if (!p || p.rendering || p.rendered === S.scale) return;
  p.rendering = true;
  const sc = S.scale;
  const pdfRef = S.pdf;
  try {
    const vp = p.page.getViewport({ scale: sc });
    let dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const maxPx = 16e6;
    if (vp.width * vp.height * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (vp.width * vp.height));
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width * dpr);
    c.height = Math.floor(vp.height * dpr);
    await p.page.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
    if (pdfRef !== S.pdf) return;
    p.el.querySelector('canvas').replaceWith(c);
    if (!p.textOk) {
      const tl = p.el.querySelector('.textLayer');
      tl.innerHTML = '';
      const tc = await p.page.getTextContent();
      if (pdfRef !== S.pdf) return;
      await pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp, textDivs: [] }).promise;
      p.textOk = true;
      markHits(i);
    }
    p.rendered = sc;
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') console.warn('render failed', i, e);
  } finally {
    p.rendering = false;
  }
  if (S.pdf === pdfRef && p.rendered !== S.scale && isNear(i)) renderPage(i);
}

function unrenderPage(i) {
  const p = S.pages[i];
  if (!p || p.rendering || !p.rendered) return;
  const c = document.createElement('canvas');
  p.el.querySelector('canvas').replaceWith(c);
  p.el.querySelector('.textLayer').innerHTML = '';
  p.textOk = false;
  p.rendered = 0;
}

function isNear(i) {
  const r = S.pages[i].el.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  return r.bottom > s.top - 900 && r.top < s.bottom + 900;
}
function renderVisible() {
  S.pages.forEach((p, i) => isNear(i) && renderPage(i));
}

const pageTop = (i) => S.pages[i].el.offsetTop;

function goPage(i, smooth = true) {
  if (!S.pages.length) return;
  i = clamp(i, 0, S.pages.length - 1);
  stage.scrollTo({ top: pageTop(i) - 12, behavior: smooth ? 'smooth' : 'auto' });
  if (!smooth) setCur(i);
}

function setScale(sc, fromFit = false) {
  sc = clamp(sc, 0.3, 4);
  if (!S.pages.length || Math.abs(sc - S.scale) < 0.002) return;
  closePop();
  const i = S.cur;
  const rel = (stage.scrollTop - pageTop(i)) / (S.pages[i].h * S.scale);
  const relX = stage.scrollWidth > stage.clientWidth ? (stage.scrollLeft + stage.clientWidth / 2) / stage.scrollWidth : 0.5;
  S.scale = sc;
  S.fit = fromFit;
  S.pages.forEach(sizePage);
  stage.scrollTop = pageTop(i) + rel * S.pages[i].h * sc;
  stage.scrollLeft = relX * stage.scrollWidth - stage.clientWidth / 2;
  updateZoomLabel();
  renderVisible();
}
const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
function zoomStep(dir) {
  const cur = S.scale;
  const next = dir > 0 ? ZOOMS.find((z) => z > cur + 0.01) : [...ZOOMS].reverse().find((z) => z < cur - 0.01);
  setScale(next ?? cur);
}
function updateZoomLabel() {
  $('#zoomLabel').textContent = `${Math.round(S.scale * 100)}%`;
  $('#zoomLabel').title = S.fit ? 'Fitted to width' : 'Fit to width (0)';
}

function setCur(i) {
  S.cur = i;
  if (document.activeElement !== $('#pageInput')) $('#pageInput').value = i + 1;
  $('#prevBtn').disabled = i <= 0;
  $('#nextBtn').disabled = i >= S.pages.length - 1;
  updateBookmarkBtn();
  const d = S.doc;
  if (d && (d.lastPage !== i || i > (d.maxPage || 0))) {
    d.lastPage = i;
    d.maxPage = Math.max(d.maxPage || 0, i);
    saveDoc(d, 1200);
  }
}

let scrollRaf = 0;
stage.addEventListener('scroll', () => {
  if (S.pop && S.pop.kind !== 'menu' && !$('#pop').contains(document.activeElement)) closePop();
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    if (!S.pages.length) return;
    const mid = stage.scrollTop + stage.clientHeight * 0.35;
    let lo = 0, hi = S.pages.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (pageTop(m) <= mid) lo = m;
      else hi = m - 1;
    }
    setCur(lo);
  });
}, { passive: true });

stage.addEventListener('wheel', (e) => {
  if (!e.ctrlKey || !S.pages.length) return;
  e.preventDefault();
  setScale(S.scale * Math.exp(-e.deltaY * 0.0045));
}, { passive: false });

const onResize = debounce(() => {
  if (S.view === 'reader' && S.fit && S.pages.length) setScale(fitScale(), true);
}, 150);
window.addEventListener('resize', onResize);

/* =========================================================
   Annotations: drawing
   ========================================================= */
function drawAnnots(i) {
  const p = S.pages[i];
  if (!p?.el) return;
  const svg = p.el.querySelector('svg.ann');
  const hann = p.el.querySelector('.hann');
  let s = '', h = '';
  for (const a of S.annots) {
    if (a.page !== i) continue;
    const act = a.id === S.activeId ? ' a-active' : '';
    const hl = HL[a.color] || HL.yellow, ink = INK[a.color] || INK.ink;
    if (a.type === 'highlight') {
      s += a.rects.map(([x, y, w, hh]) => `<rect data-id="${a.id}" class="${act}" x="${x}" y="${y}" width="${w}" height="${hh}" rx="1.2" style="fill:${hl};fill-opacity:.55"/>`).join('');
    } else if (a.type === 'underline' || a.type === 'strike') {
      s += a.rects.map(([x, y, w, hh]) => {
        const yy = a.type === 'underline' ? y + hh - 0.6 : y + hh * 0.55;
        return `<line data-id="${a.id}" class="${act}" x1="${x}" y1="${yy}" x2="${x + w}" y2="${yy}" style="stroke:${ink}" stroke-width="1.3" stroke-linecap="round"/>`;
      }).join('');
    } else if (a.type === 'ink') {
      const pt = a.pts;
      let d = `M${pt[0]} ${pt[1]}`;
      for (let k = 2; k < pt.length; k += 2) d += `L${pt[k]} ${pt[k + 1]}`;
      if (pt.length === 2) d += `L${pt[0] + 0.01} ${pt[1]}`;
      s += `<path data-id="${a.id}" class="${act}" d="${d}" fill="none" style="stroke:${ink}" stroke-width="${a.w}" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else if (a.type === 'note') {
      h += `<button class="note-pin${a.id === S.activeId ? ' active' : ''}" data-id="${a.id}" style="--c:${hl};left:${(a.x / p.w) * 100}%;top:${(a.y / p.h) * 100}%" aria-label="Sticky note${a.comment ? ': ' + esc(a.comment.slice(0, 60)) : ''}">${I.note}</button>`;
    } else if (a.type === 'text') {
      h += `<div class="tbox${a.id === S.activeId ? ' active' : ''}" data-id="${a.id}" style="--c:${ink};left:${(a.x / p.w) * 100}%;top:${(a.y / p.h) * 100}%;font-size:calc(var(--scale-factor) * ${a.size || 14}px)">${esc(a.text)}</div>`;
    }
    if (a.rects && (a.comment || '').trim()) {
      const [x, y, w] = a.rects[a.rects.length - 1];
      h += `<button class="cmark" data-id="${a.id}" style="--c:${ink};left:${((x + w) / p.w) * 100}%;top:${(y / p.h) * 100}%" aria-label="Show comment">${I.comment}</button>`;
    }
  }
  svg.innerHTML = s;
  // keep a text box that is being edited
  const editing = hann.querySelector('[contenteditable=true]');
  hann.innerHTML = h;
  if (editing) {
    const fresh = hann.querySelector(`[data-id="${editing.dataset.id}"]`);
    if (fresh) fresh.replaceWith(editing);
  }
}
const redrawAnnot = (a) => drawAnnots(a.page);

function flashAnnot(a) {
  const el = S.pages[a.page]?.el;
  if (!el) return;
  el.querySelectorAll(`[data-id="${a.id}"]`).forEach((n) => {
    n.classList.remove('a-flash', 'flash');
    void n.getBoundingClientRect();
    n.classList.add(n.closest('svg') ? 'a-flash' : 'flash');
  });
}

function setActive(id) {
  const prev = S.annots.find((a) => a.id === S.activeId);
  S.activeId = id;
  if (prev) redrawAnnot(prev);
  const a = S.annots.find((x) => x.id === id);
  if (a && a !== prev) redrawAnnot(a);
  $$('.note-item').forEach((n) => n.classList.toggle('active', n.dataset.goto === id));
}

/* =========================================================
   Annotations: create / update / delete / undo
   ========================================================= */
function touchDocCount() {
  if (!S.doc) return;
  S.doc.annCount = S.annots.length;
  saveDoc(S.doc, 800);
}

function addAnnot(a, recordUndo = true) {
  a.id ||= uid();
  a.docId = S.doc.id;
  a.created ||= Date.now();
  a.comment ??= '';
  S.annots.push(a);
  redrawAnnot(a);
  saveAnnot(a);
  if (recordUndo) S.undo.push({ op: 'add', a: structuredClone(a) });
  touchDocCount();
  renderNotes();
  return a;
}

function removeAnnot(a, recordUndo = true) {
  const idx = S.annots.findIndex((x) => x.id === a.id);
  if (idx < 0) return;
  S.annots.splice(idx, 1);
  clearTimeout(annTimers.get(a.id));
  annTimers.delete(a.id);
  if (S.activeId === a.id) S.activeId = null;
  redrawAnnot(a);
  serial('ann:' + a.id, () => S.store.deleteAnnot(a.id));
  if (recordUndo) S.undo.push({ op: 'del', a: structuredClone(a) });
  touchDocCount();
  renderNotes();
}

function updateAnnot(a, patch, { undo = true, delay = 0 } = {}) {
  if (undo) S.undo.push({ op: 'upd', id: a.id, before: structuredClone(a) });
  Object.assign(a, patch, { updated: Date.now() });
  redrawAnnot(a);
  saveAnnot(a, delay);
  renderNotesSoon();
}

function undo() {
  const u = S.undo.pop();
  if (!u) return toast('Nothing to undo');
  closePop();
  if (u.op === 'add') {
    const a = S.annots.find((x) => x.id === u.a.id);
    if (a) removeAnnot(a, false);
  } else if (u.op === 'del') {
    addAnnot(structuredClone(u.a), false);
  } else if (u.op === 'upd') {
    const a = S.annots.find((x) => x.id === u.id);
    if (a) {
      const oldPage = a.page;
      Object.keys(a).forEach((k) => delete a[k]);
      Object.assign(a, u.before);
      if (oldPage !== a.page) drawAnnots(oldPage);
      redrawAnnot(a);
      saveAnnot(a);
      renderNotes();
    }
  }
}

/* ---------- from text selection ---------- */
function pageAtPoint(x, y) {
  for (let i = Math.max(0, S.cur - 3); i < Math.min(S.pages.length, S.cur + 6); i++) {
    const r = S.pages[i].el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { i, r };
  }
  for (let i = 0; i < S.pages.length; i++) {
    const r = S.pages[i].el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { i, r };
  }
  return null;
}

function selectionGroups(range) {
  const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 2);
  const byPage = new Map();
  for (const r of rects) {
    const hit = pageAtPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit) continue;
    const { i, r: pr } = hit;
    const p = S.pages[i];
    const x = (r.left - pr.left) / S.scale, y = (r.top - pr.top) / S.scale, w = r.width / S.scale, h = r.height / S.scale;
    if (w > p.w * 0.97 && h > p.h * 0.5) continue; // container rects
    if (!byPage.has(i)) byPage.set(i, []);
    byPage.get(i).push([x, y, w, h]);
  }
  const out = [];
  for (const [i, list] of byPage) {
    list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const lines = [];
    for (const r of list) {
      const ln = lines.find((l) => Math.abs((l[1] + l[3] / 2) - (r[1] + r[3] / 2)) < Math.min(l[3], r[3]) * 0.6 && r[0] <= l[0] + l[2] + Math.max(l[3], r[3]) * 1.5 && r[0] + r[2] >= l[0] - Math.max(l[3], r[3]) * 1.5);
      if (ln) {
        const x1 = Math.min(ln[0], r[0]), y1 = Math.min(ln[1], r[1]);
        const x2 = Math.max(ln[0] + ln[2], r[0] + r[2]), y2 = Math.max(ln[1] + ln[3], r[1] + r[3]);
        ln[0] = x1; ln[1] = y1; ln[2] = x2 - x1; ln[3] = y2 - y1;
      } else lines.push([...r]);
    }
    out.push({ page: i, rects: lines.map((l) => l.map(r1)) });
  }
  return out.sort((a, b) => a.page - b.page);
}

function createFromGroups(type, groups, text, color = S.color) {
  let first = null;
  for (const g of groups) {
    const a = addAnnot({ type, page: g.page, color, rects: g.rects, text: text.replace(/\s+/g, ' ').trim().slice(0, 4000) });
    first ||= a;
  }
  if (groups.length > 1) {
    // merge the undo entries of a multi-page selection into one step
    const ops = S.undo.splice(-groups.length);
    S.undo.push({ op: 'multi', ops });
  }
  return first;
}
// support multi-step undo
const _undo = undo;
function undoAll() {
  const top = S.undo[S.undo.length - 1];
  if (top?.op === 'multi') {
    S.undo.pop();
    for (const o of top.ops.reverse()) {
      S.undo.push(o);
      _undo();
    }
    return;
  }
  _undo();
}

let pointerIsDown = false;
let lastPointerType = 'mouse';
document.addEventListener('pointerdown', (e) => {
  pointerIsDown = true;
  lastPointerType = e.pointerType;
}, true);
document.addEventListener('pointerup', () => {
  pointerIsDown = false;
  if (S.view === 'reader') setTimeout(onSelectionDone, 10);
}, true);
document.addEventListener('selectionchange', debounce(() => {
  if (!pointerIsDown && S.view === 'reader' && lastPointerType !== 'mouse') onSelectionDone();
}, 450));

function onSelectionDone() {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    if (S.pop?.kind === 'sel') closePop();
    return;
  }
  const range = sel.getRangeAt(0);
  if (!pagesEl.contains(range.commonAncestorContainer)) return;
  const text = sel.toString();
  if (!text.trim()) return;
  const groups = selectionGroups(range);
  if (!groups.length) return;
  if (['highlight', 'underline', 'strike'].includes(S.tool) && lastPointerType === 'mouse') {
    createFromGroups(S.tool, groups, text);
    sel.removeAllRanges();
    return;
  }
  showSelPop(range.getBoundingClientRect(), groups, text);
}

/* =========================================================
   Popovers
   ========================================================= */
const pop = $('#pop');
function openPop(html, anchor, kind, data = {}, cls = '') {
  if (S.pop) S.pop.onClose?.();
  pop.className = 'pop ' + cls;
  pop.innerHTML = html;
  pop.hidden = false;
  S.pop = { kind, ...data };
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = anchor.left + anchor.width / 2 - pw / 2;
  x = clamp(x, 8, vw - pw - 8);
  let y = anchor.bottom + 8;
  if (y + ph > vh - 8) y = anchor.top - ph - 8;
  if (y < 8) y = clamp(anchor.bottom + 8, 8, vh - ph - 8);
  pop.style.left = `${x}px`;
  pop.style.top = `${y}px`;
}
function closePop() {
  if (!S.pop) return;
  S.pop.onClose?.();
  S.pop = null;
  pop.hidden = true;
  pop.innerHTML = '';
  if (S.activeId) setActive(null);
}

const swatches = (attr, current, fill = HL) =>
  COLORS.map((c) => `<button class="sw ${c === current ? 'on' : ''}" ${attr}="${c}" style="--c:${fill[c]}" aria-label="${COLOR_NAMES[c]}" title="${COLOR_NAMES[c]}"></button>`).join('');

function showSelPop(anchor, groups, text) {
  openPop(`<div class="pop-row">${swatches('data-sel-color', null)}</div>
    <div class="pop-row">
      <button class="pbtn" data-sel="underline" title="Underline">${I.underline}</button>
      <button class="pbtn" data-sel="strike" title="Strikethrough">${I.strike}</button>
      <button class="pbtn" data-sel="comment">${I.comment}Comment</button>
      <button class="pbtn" data-sel="copy">${I.copy}Copy</button>
    </div>`, anchor, 'sel', { groups, text });
}

function annAnchor(a) {
  const el = S.pages[a.page]?.el;
  if (!el) return new DOMRect(innerWidth / 2, innerHeight / 2, 0, 0);
  const pr = el.getBoundingClientRect();
  const sc = S.scale;
  let x1, y1, x2, y2;
  if (a.rects) {
    x1 = Math.min(...a.rects.map((r) => r[0])); y1 = Math.min(...a.rects.map((r) => r[1]));
    x2 = Math.max(...a.rects.map((r) => r[0] + r[2])); y2 = Math.max(...a.rects.map((r) => r[1] + r[3]));
  } else if (a.pts) {
    const xs = a.pts.filter((_, k) => k % 2 === 0), ys = a.pts.filter((_, k) => k % 2 === 1);
    x1 = Math.min(...xs); x2 = Math.max(...xs); y1 = Math.min(...ys); y2 = Math.max(...ys);
  } else {
    const n = el.querySelector(`.hann [data-id="${a.id}"]`);
    if (n) return n.getBoundingClientRect();
    x1 = x2 = a.x; y1 = y2 = a.y;
  }
  return new DOMRect(pr.left + x1 * sc, pr.top + y1 * sc, (x2 - x1) * sc, (y2 - y1) * sc);
}

function showAnnPop(a, focusComment = false) {
  setActive(a.id);
  const isText = a.type === 'text';
  const hasComment = a.type !== 'ink' && !isText;
  const fill = a.rects && a.type === 'highlight' || a.type === 'note' ? HL : INK;
  openPop(`<div class="pop-head" style="--c:${HL[a.color]}"><span>${TYPE_LABEL[a.type]} · p. ${a.page + 1}</span><span class="grow"></span>
      <button class="iconbtn sm" data-ann="close" aria-label="Close">${I.close}</button></div>
    ${a.text && !isText ? `<blockquote style="--c:${HL[a.color]}">${esc(a.text)}</blockquote>` : ''}
    <div class="pop-row">${swatches('data-ann-color', a.color, fill)}</div>
    ${hasComment ? `<textarea id="annComment" placeholder="${a.type === 'note' ? 'Write your note…' : 'Add a comment…'}" maxlength="5000">${esc(a.comment || '')}</textarea>` : ''}
    <div class="pop-row end">
      <div class="pop-row">
        ${isText ? `<button class="pbtn" data-ann="edit">${I.edit}Edit</button><button class="pbtn" data-ann="smaller" title="Smaller">A−</button><button class="pbtn" data-ann="bigger" title="Bigger">A+</button>` : ''}
        ${a.text && !isText ? `<button class="pbtn" data-ann="copy">${I.copy}Copy</button>` : ''}
      </div>
      <button class="pbtn danger" data-ann="delete">${I.trash}Delete</button>
    </div>`, annAnchor(a), 'ann', { id: a.id });
  const ta = $('#annComment');
  if (ta) {
    let pushed = false;
    ta.addEventListener('input', () => {
      if (!pushed) {
        S.undo.push({ op: 'upd', id: a.id, before: structuredClone(a) });
        pushed = true;
      }
      updateAnnot(a, { comment: ta.value }, { undo: false, delay: 500 });
    });
    S.pop.onClose = () => {
      const fresh = a._fresh;
      delete a._fresh;
      flushAnnSaves();
      if (a.type === 'note' && !a.comment.trim() && fresh && S.annots.includes(a)) removeAnnot(a, false);
    };
    if (focusComment) setTimeout(() => ta.focus(), 20);
  }
}

pop.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('textarea, input')) e.preventDefault(); // keep text selection alive
});
pop.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !S.pop) return;
  const P = S.pop;
  if (P.kind === 'sel') {
    const sel = getSelection();
    if (b.dataset.selColor) {
      S.color = b.dataset.selColor;
      ls.set('mg.color', S.color);
      renderColors();
      createFromGroups('highlight', P.groups, P.text, S.color);
      sel.removeAllRanges();
      closePop();
    } else if (b.dataset.sel === 'underline' || b.dataset.sel === 'strike') {
      createFromGroups(b.dataset.sel, P.groups, P.text, S.color === 'yellow' ? 'ink' : S.color);
      sel.removeAllRanges();
      closePop();
    } else if (b.dataset.sel === 'comment') {
      const a = createFromGroups('highlight', P.groups, P.text, S.color);
      sel.removeAllRanges();
      closePop();
      showAnnPop(a, true);
    } else if (b.dataset.sel === 'copy') {
      copyText(P.text);
      closePop();
    }
    return;
  }
  if (P.kind === 'ann') {
    const a = S.annots.find((x) => x.id === P.id);
    if (!a) return closePop();
    if (b.dataset.annColor) {
      updateAnnot(a, { color: b.dataset.annColor });
      $$('.sw', pop).forEach((s) => s.classList.toggle('on', s === b));
    } else if (b.dataset.ann === 'delete') {
      closePop();
      removeAnnot(a);
      toast('Deleted. Press Ctrl+Z to undo.');
    } else if (b.dataset.ann === 'copy') copyText(a.text);
    else if (b.dataset.ann === 'close') closePop();
    else if (b.dataset.ann === 'edit') {
      closePop();
      editTextBox(a);
    } else if (b.dataset.ann === 'smaller' || b.dataset.ann === 'bigger') {
      updateAnnot(a, { size: clamp((a.size || 14) + (b.dataset.ann === 'bigger' ? 2 : -2), 6, 72) });
    }
    return;
  }
  if (P.kind === 'menu') {
    const act = b.dataset.menu;
    closePop();
    P.actions[act]?.();
  }
});

document.addEventListener('pointerdown', (e) => {
  if (!S.pop) return;
  if (pop.contains(e.target)) return;
  if (e.target.closest('[data-keep-pop]')) return;
  if (S.pop.kind === 'sel' && e.target.closest('.textLayer')) {
    closePop();
    return;
  }
  closePop();
});

function openMenu(anchorEl, items, actions) {
  const html = items
    .map((it) => (it === '-' ? '<hr>' : `<button data-menu="${it.id}">${I[it.icon] || ''}<span>${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`))
    .join('');
  const r = anchorEl.getBoundingClientRect();
  openPop(html, new DOMRect(r.right - 115, r.top, 230, r.height), 'menu', { actions }, 'menu');
}

/* =========================================================
   Page interactions: tools, clicks, drags
   ========================================================= */
function pagePoint(i, e) {
  const r = S.pages[i].el.getBoundingClientRect();
  return [r1((e.clientX - r.left) / S.scale), r1((e.clientY - r.top) / S.scale)];
}

function hitTest(i, x, y, tol = 3) {
  const list = S.annots.filter((a) => a.page === i).reverse();
  for (const a of list) {
    if (a.rects) {
      if (a.rects.some(([rx, ry, rw, rh]) => x >= rx - tol && x <= rx + rw + tol && y >= ry - tol && y <= ry + rh + tol)) return a;
    } else if (a.type === 'ink') {
      const p = a.pts;
      if (p.length === 2 && Math.hypot(x - p[0], y - p[1]) <= tol + a.w) return a;
      for (let k = 0; k + 3 < p.length; k += 2) if (segDist(x, y, p[k], p[k + 1], p[k + 2], p[k + 3]) <= tol + a.w / 2) return a;
    } else if (a.type === 'note') {
      const s = 22 / S.scale;
      if (x >= a.x - tol && x <= a.x + s + tol && y >= a.y - tol && y <= a.y + s + tol) return a;
    } else if (a.type === 'text') {
      const el = S.pages[i].el.querySelector(`.tbox[data-id="${a.id}"]`);
      if (el) {
        const w = el.offsetWidth / S.scale, h = el.offsetHeight / S.scale;
        if (x >= a.x - tol && x <= a.x + w + tol && y >= a.y - tol && y <= a.y + h + tol) return a;
      }
    }
  }
  return null;
}

let drawing = null;
let dragging = null;

pagesEl.addEventListener('pointerdown', (e) => {
  const pageEl = e.target.closest('.page');
  if (!pageEl || e.button > 0) return;
  const i = +pageEl.dataset.i;

  // Tools that use the capture layer
  if (e.target.classList.contains('draw')) {
    const [x, y] = pagePoint(i, e);
    if (S.tool === 'pen') {
      e.preventDefault();
      e.target.setPointerCapture(e.pointerId);
      const svg = pageEl.querySelector('svg.ann');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const w = r1(clamp(2 / Math.sqrt(S.scale), 1.2, 3));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-width', w);
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.style.stroke = INK[S.color];
      svg.append(path);
      drawing = { i, pts: [x, y], path, w, target: e.target };
      path.setAttribute('d', `M${x} ${y}L${x + 0.01} ${y}`);
    } else if (S.tool === 'note') {
      e.preventDefault();
      const a = addAnnot({ type: 'note', page: i, x: r1(x - 4), y: r1(y - 4), color: S.color === 'ink' ? 'yellow' : S.color, comment: '' });
      Object.defineProperty(a, '_fresh', { value: true, configurable: true, enumerable: false, writable: true });
      setTool('select');
      setTimeout(() => showAnnPop(a, true), 0);
    } else if (S.tool === 'text') {
      e.preventDefault();
      const a = addAnnot({ type: 'text', page: i, x: r1(x), y: r1(y - 8), color: S.color === 'yellow' ? 'ink' : S.color, size: 14, text: '' });
      setTool('select');
      setTimeout(() => editTextBox(a, true), 0);
    } else if (S.tool === 'eraser') {
      e.preventDefault();
      e.target.setPointerCapture(e.pointerId);
      drawing = { i, erase: true, target: e.target, erased: 0 };
      eraseAt(i, x, y);
    }
    return;
  }

  // Dragging notes and text boxes in select mode
  const item = e.target.closest('.hann [data-id]');
  if (item && !item.isContentEditable && !item.classList.contains('cmark')) {
    const a = S.annots.find((x) => x.id === item.dataset.id);
    if (!a) return;
    e.preventDefault();
    item.setPointerCapture(e.pointerId);
    dragging = { a, item, i, sx: e.clientX, sy: e.clientY, ox: a.x, oy: a.y, moved: false };
  }
});

pagesEl.addEventListener('pointermove', (e) => {
  if (drawing && !drawing.erase) {
    const [x, y] = pagePoint(drawing.i, e);
    const p = drawing.pts;
    if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < 1.2 / S.scale + 0.4) return;
    p.push(x, y);
    let d = `M${p[0]} ${p[1]}`;
    for (let k = 2; k < p.length; k += 2) d += `L${p[k]} ${p[k + 1]}`;
    drawing.path.setAttribute('d', d);
  } else if (drawing?.erase) {
    const [x, y] = pagePoint(drawing.i, e);
    eraseAt(drawing.i, x, y);
  } else if (dragging) {
    const dx = (e.clientX - dragging.sx) / S.scale, dy = (e.clientY - dragging.sy) / S.scale;
    if (!dragging.moved && Math.hypot(dx, dy) * S.scale < 4) return;
    dragging.moved = true;
    const p = S.pages[dragging.i];
    const nx = clamp(dragging.ox + dx, 0, p.w - 10), ny = clamp(dragging.oy + dy, 0, p.h - 10);
    dragging.item.style.left = `${(nx / p.w) * 100}%`;
    dragging.item.style.top = `${(ny / p.h) * 100}%`;
    dragging.nx = nx;
    dragging.ny = ny;
  }
});

function endPointer(e) {
  if (drawing && !drawing.erase) {
    const { i, pts, path, w } = drawing;
    path.remove();
    drawing = null;
    addAnnot({ type: 'ink', page: i, color: S.color, w, pts: simplify(pts, 0.35) });
  } else if (drawing?.erase) {
    drawing = null;
  } else if (dragging) {
    const g = dragging;
    dragging = null;
    if (g.moved) updateAnnot(g.a, { x: r1(g.nx), y: r1(g.ny) });
    else if (e.type === 'pointerup') {
      if (g.a.type === 'text') showAnnPop(g.a);
      else showAnnPop(g.a, g.a.type === 'note');
    }
  }
}
pagesEl.addEventListener('pointerup', endPointer);
pagesEl.addEventListener('pointercancel', endPointer);

function eraseAt(i, x, y) {
  const a = hitTest(i, x, y, 4 / S.scale + 1);
  if (a) removeAnnot(a);
}

// Ramer–Douglas–Peucker on a flat [x,y,...] array
function simplify(flat, eps) {
  if (flat.length <= 4) return flat.map(r1);
  const pts = [];
  for (let k = 0; k < flat.length; k += 2) pts.push([flat[k], flat[k + 1]]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, t] = stack.pop();
    let max = 0, idx = -1;
    for (let k = s + 1; k < t; k++) {
      const d = segDist(pts[k][0], pts[k][1], pts[s][0], pts[s][1], pts[t][0], pts[t][1]);
      if (d > max) { max = d; idx = k; }
    }
    if (max > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, t]);
    }
  }
  const out = [];
  pts.forEach((p, k) => keep[k] && out.push(r1(p[0]), r1(p[1])));
  return out;
}

// Click on a highlight / comment marker in select mode
pagesEl.addEventListener('click', (e) => {
  if (S.tool !== 'select' && S.tool !== 'highlight' && S.tool !== 'underline' && S.tool !== 'strike') return;
  const cm = e.target.closest('.cmark');
  if (cm) {
    const a = S.annots.find((x) => x.id === cm.dataset.id);
    if (a) showAnnPop(a, true);
    return;
  }
  if (e.target.closest('.hann [data-id]')) return;
  const sel = getSelection();
  if (sel && !sel.isCollapsed) return;
  const pageEl = e.target.closest('.page');
  if (!pageEl) return;
  const i = +pageEl.dataset.i;
  const [x, y] = pagePoint(i, e);
  const a = hitTest(i, x, y, 1);
  if (a && a.type !== 'note' && a.type !== 'text') showAnnPop(a);
});

pagesEl.addEventListener('dblclick', (e) => {
  const tb = e.target.closest('.tbox');
  if (!tb) return;
  const a = S.annots.find((x) => x.id === tb.dataset.id);
  if (a) {
    closePop();
    editTextBox(a);
  }
});

function editTextBox(a, fresh = false) {
  const el = S.pages[a.page]?.el.querySelector(`.tbox[data-id="${a.id}"]`);
  if (!el) return;
  el.contentEditable = 'true';
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
  const finish = () => {
    el.removeEventListener('blur', finish);
    el.removeEventListener('keydown', onKey);
    el.contentEditable = 'false';
    const text = el.innerText.replace(/ /g, ' ').replace(/\n$/, '');
    if (!text.trim()) {
      if (fresh) removeAnnot(a, false);
      else removeAnnot(a);
      return;
    }
    if (text !== a.text) {
      if (fresh) {
        Object.assign(a, { text });
        redrawAnnot(a);
        saveAnnot(a);
        renderNotes();
      } else updateAnnot(a, { text });
    }
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey))) {
      ev.preventDefault();
      el.blur();
    }
  };
  el.addEventListener('blur', finish);
  el.addEventListener('keydown', onKey);
}

/* =========================================================
   Toolbar
   ========================================================= */
function renderTools() {
  $('#tools').innerHTML = TOOLS.map((t) => `<button class="iconbtn tool ${S.tool === t.id ? 'on' : ''}" data-tool="${t.id}" aria-pressed="${S.tool === t.id}" aria-label="${t.label} (${t.key.toUpperCase()})" title="${t.label} (${t.key.toUpperCase()})">${I[t.icon]}</button>`).join('');
}
function renderColors() {
  const fill = ['pen', 'text', 'underline', 'strike'].includes(S.tool) ? INK : HL;
  $('#colors').innerHTML = COLORS.map((c) => `<button class="sw ${S.color === c ? 'on' : ''}" role="radio" aria-checked="${S.color === c}" data-color="${c}" style="--c:${fill[c]}" aria-label="${COLOR_NAMES[c]}" title="${COLOR_NAMES[c]}"></button>`).join('');
}
function setTool(t) {
  S.tool = t;
  stage.className = stage.className.replace(/\btool-\S+/g, '').trim() + ' tool-' + t;
  renderTools();
  renderColors();
  $('#toolHint').textContent = TOOLS.find((x) => x.id === t)?.hint || '';
}
$('#tools').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]');
  if (b) setTool(S.tool === b.dataset.tool && b.dataset.tool !== 'select' ? 'select' : b.dataset.tool);
});
$('#colors').addEventListener('click', (e) => {
  const b = e.target.closest('[data-color]');
  if (!b) return;
  S.color = b.dataset.color;
  ls.set('mg.color', S.color);
  renderColors();
});

function applyTheme() {
  stage.classList.remove(...THEMES.map((t) => 'theme-' + t));
  stage.classList.add('theme-' + S.theme);
  $('#themeBtn').innerHTML = I[THEME_ICON[S.theme]];
  $('#themeBtn').title = `Reading theme: ${THEME_LABEL[S.theme]}`;
}
function applySide() {
  $('#side').classList.toggle('closed', !S.sideOpen);
  $('#sideBtn').setAttribute('aria-pressed', S.sideOpen);
}
function toggleBookmark() {
  const d = S.doc;
  if (!d) return;
  d.bookmarks ||= [];
  const i = S.cur;
  const has = d.bookmarks.includes(i);
  d.bookmarks = has ? d.bookmarks.filter((x) => x !== i) : [...d.bookmarks, i].sort((a, b) => a - b);
  saveDoc(d);
  updateBookmarkBtn();
  renderMarks();
  toast(has ? `Removed bookmark on page ${i + 1}` : `Bookmarked page ${i + 1}`);
}
function updateBookmarkBtn() {
  const on = !!S.doc?.bookmarks?.includes(S.cur);
  $('#bookmarkBtn').setAttribute('aria-pressed', on);
  $('#bookmarkBtn svg')?.setAttribute('fill', on ? 'currentColor' : 'none');
}

/* =========================================================
   Sidebar: notes, search, contents, bookmarks
   ========================================================= */
function renderSide() {
  $$('.side-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.sideTab));
  $$('.side-panel').forEach((p) => (p.hidden = p.dataset.panel !== S.sideTab));
  renderNotes();
  renderMarks();
}
function openSide(tab) {
  S.sideTab = tab;
  S.sideOpen = true;
  applySide();
  renderSide();
}

function renderNotes() {
  $('#noteCount').textContent = S.annots.length;
  if (!S.doc) return;
  const used = new Set(S.annots.map((a) => a.color));
  $('#noteFilters').innerHTML = S.annots.length
    ? `<button class="chip ${!S.noteColor ? 'on' : ''}" data-ncolor="">All</button>` +
      COLORS.filter((c) => used.has(c)).map((c) => `<button class="sw ${S.noteColor === c ? 'on' : ''}" data-ncolor="${c}" style="--c:${HL[c]}" aria-label="Only ${COLOR_NAMES[c]}" title="Only ${COLOR_NAMES[c]}"></button>`).join('') +
      `<span class="spacer"></span><button class="chip ${S.commentsOnly ? 'on' : ''}" data-ncomments="1">With comments</button>`
    : '';
  let list = sortAnnots(S.annots);
  if (S.noteColor) list = list.filter((a) => a.color === S.noteColor);
  if (S.commentsOnly) list = list.filter((a) => (a.comment || '').trim() || (a.type === 'text' && a.text));
  $('#noteList').innerHTML = list.length
    ? list.map((a) => `<button class="note-item ${a.id === S.activeId ? 'active' : ''}" data-goto="${a.id}" style="--c:${a.type === 'ink' || a.type === 'text' || a.type === 'underline' || a.type === 'strike' ? INK[a.color] : HL[a.color]}">
        <span class="ni-dot"></span>
        <span class="ni-body">
          <span class="ni-meta"><span>${TYPE_LABEL[a.type]}</span><span>p. ${a.page + 1}</span></span>
          ${a.text ? `<span class="ni-quote">${esc(a.text)}</span>` : ''}
          ${(a.comment || '').trim() ? `<span class="ni-comment">${I.comment}<span>${esc(a.comment)}</span></span>` : ''}
          ${!a.text && !(a.comment || '').trim() ? `<span class="ni-comment" style="color:var(--muted)">${a.type === 'ink' ? 'Hand-drawn mark' : 'Empty note'}</span>` : ''}
        </span></button>`).join('')
    : `<p class="side-empty">${S.annots.length ? 'No marks match this filter.' : 'No marks yet. Select text to highlight it, or pick a tool in the toolbar.'}</p>`;
}
const renderNotesSoon = debounce(renderNotes, 250);

$('#noteFilters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if ('ncolor' in b.dataset) S.noteColor = b.dataset.ncolor || null;
  if (b.dataset.ncomments) S.commentsOnly = !S.commentsOnly;
  renderNotes();
});
$('#noteList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-goto]');
  if (!b) return;
  const a = S.annots.find((x) => x.id === b.dataset.goto);
  if (a) gotoAnnot(a);
});

function gotoAnnot(a) {
  const y = annotY(a);
  stage.scrollTo({ top: pageTop(a.page) + y * S.scale - stage.clientHeight * 0.3, behavior: 'smooth' });
  setActive(a.id);
  setTimeout(() => flashAnnot(a), 350);
  if (window.innerWidth <= 860) {
    S.sideOpen = false;
    applySide();
  }
}

/* ---------- search ---------- */
async function pageText(i) {
  if (S.text[i] != null) return S.text[i];
  const tc = await S.pages[i].page.getTextContent();
  S.text[i] = tc.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join('').replace(/\s+/g, ' ');
  return S.text[i];
}

let searchToken = 0;
async function runSearch(q) {
  q = q.trim();
  const box = $('#searchResults');
  if (!q) {
    box.innerHTML = '';
    S.hitQuery = '';
    S.pages.forEach((_, i) => markHits(i));
    return;
  }
  const token = ++searchToken;
  box.innerHTML = `<p class="side-empty">Searching…</p>`;
  const ql = q.toLowerCase();
  const results = [];
  let pagesWithHits = 0;
  for (let i = 0; i < S.pages.length; i++) {
    const t = await pageText(i);
    if (token !== searchToken) return;
    const tl = t.toLowerCase();
    let idx = tl.indexOf(ql), n = 0;
    if (idx >= 0) pagesWithHits++;
    while (idx >= 0 && results.length < 300) {
      results.push({ i, idx, t });
      n++;
      idx = tl.indexOf(ql, idx + ql.length);
    }
  }
  S.hitQuery = ql;
  S.pages.forEach((_, i) => markHits(i));
  if (!results.length) {
    box.innerHTML = `<p class="side-empty">No matches for “${esc(q)}”. Scanned PDFs without a text layer can’t be searched.</p>`;
    return;
  }
  box.innerHTML = `<p class="hint" style="margin:0 0 4px">${results.length}${results.length >= 300 ? '+' : ''} match${results.length === 1 ? '' : 'es'} on ${pagesWithHits} page${pagesWithHits === 1 ? '' : 's'}</p>` +
    results.map((r) => {
      const s = Math.max(0, r.idx - 40), e = Math.min(r.t.length, r.idx + q.length + 60);
      return `<button class="result" data-page="${r.i}"><span class="pg">Page ${r.i + 1}</span><span>${s > 0 ? '…' : ''}${esc(r.t.slice(s, r.idx))}<mark>${esc(r.t.slice(r.idx, r.idx + q.length))}</mark>${esc(r.t.slice(r.idx + q.length, e))}${e < r.t.length ? '…' : ''}</span></button>`;
    }).join('');
}
function markHits(i) {
  const el = S.pages[i]?.el;
  if (!el) return;
  const q = S.hitQuery;
  el.querySelectorAll('.textLayer span').forEach((sp) => {
    const t = sp.textContent.toLowerCase();
    sp.classList.toggle('hit', !!q && t.length > 0 && (t.includes(q) || (q.includes(t.trim()) && t.trim().length > 3)));
  });
}
$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch($('#searchInput').value);
});
$('#searchInput').addEventListener('input', debounce((e) => {
  if (e.target.value.trim().length >= 3 || !e.target.value.trim()) runSearch(e.target.value);
}, 400));
$('#searchResults').addEventListener('click', (e) => {
  const b = e.target.closest('[data-page]');
  if (!b) return;
  goPage(+b.dataset.page);
  if (window.innerWidth <= 860) {
    S.sideOpen = false;
    applySide();
  }
});

/* ---------- outline ---------- */
async function loadOutline() {
  const box = $('#outline');
  box.innerHTML = '';
  let outline = null;
  try {
    outline = await S.pdf.getOutline();
  } catch {}
  if (!outline?.length) {
    box.innerHTML = `<p class="side-empty">This PDF has no table of contents. Use bookmarks (B) to mark pages you want to return to.</p>`;
    return;
  }
  const items = [];
  const build = (list) => `<ul>${list.map((it) => {
    const k = items.push(it) - 1;
    return `<li><button data-o="${k}">${esc(it.title)}</button>${it.items?.length ? build(it.items) : ''}</li>`;
  }).join('')}</ul>`;
  box.innerHTML = build(outline);
  box.onclick = async (e) => {
    const b = e.target.closest('[data-o]');
    if (!b) return;
    const it = items[+b.dataset.o];
    try {
      let dest = it.dest;
      if (typeof dest === 'string') dest = await S.pdf.getDestination(dest);
      if (!Array.isArray(dest)) return;
      const ref = dest[0];
      const idx = typeof ref === 'number' ? ref : await S.pdf.getPageIndex(ref);
      goPage(idx);
      if (window.innerWidth <= 860) {
        S.sideOpen = false;
        applySide();
      }
    } catch (err) {
      console.warn(err);
    }
  };
}

/* ---------- bookmarks ---------- */
async function renderMarks() {
  const box = $('#markList');
  const d = S.doc;
  if (!d) return;
  const marks = d.bookmarks || [];
  if (!marks.length) {
    box.innerHTML = `<p class="side-empty">No bookmarks yet. Press B or the bookmark button to mark the current page.</p>`;
    return;
  }
  box.innerHTML = marks.map((p) => `<div class="mark-item"><button class="result" data-page="${p}"><span class="pg">Page ${p + 1}</span><span class="snip" data-snip="${p}"></span></button>
    <button class="iconbtn sm" data-unmark="${p}" aria-label="Remove bookmark on page ${p + 1}">${I.close}</button></div>`).join('');
  for (const p of marks) {
    if (!S.pages[p]) continue;
    pageText(p).then((t) => {
      const el = box.querySelector(`[data-snip="${p}"]`);
      if (el) el.textContent = t.trim().slice(0, 90) || '(no text on this page)';
    }).catch(() => {});
  }
}
$('#markList').addEventListener('click', (e) => {
  const un = e.target.closest('[data-unmark]');
  if (un) {
    S.doc.bookmarks = S.doc.bookmarks.filter((x) => x !== +un.dataset.unmark);
    saveDoc(S.doc);
    renderMarks();
    updateBookmarkBtn();
    return;
  }
  const b = e.target.closest('[data-page]');
  if (b) goPage(+b.dataset.page);
});
$$('.side-tabs button').forEach((b) => b.addEventListener('click', () => {
  S.sideTab = b.dataset.tab;
  renderSide();
  if (S.sideTab === 'search') setTimeout(() => $('#searchInput').focus(), 20);
}));

/* =========================================================
   Export
   ========================================================= */
async function exportMarkdown() {
  flushAnnSaves();
  if (!S.annots.length && !S.doc.bookmarks?.length) return toast('There are no notes to export yet.');
  download(`${slug(S.doc.title)}-notes.md`, toMarkdown(S.doc, S.annots), 'text/markdown');
  toast('Notes downloaded as Markdown.');
}
async function exportAnnotated() {
  const t = toast('Building annotated PDF…', false, 120000);
  try {
    const bytes = await annotatedPdf(S.bytes, S.annots, S.pages.map((p) => p.vp), S.doc.title);
    download(`${slug(S.doc.title)}-annotated.pdf`, new Blob([bytes], { type: 'application/pdf' }));
    toast('Annotated PDF downloaded.');
  } catch (e) {
    console.error(e);
    toast('This PDF could not be rewritten (it may be encrypted). Export your notes as Markdown instead.', true, 6000);
  } finally {
    t.remove();
  }
}
function exportOriginal() {
  download(S.doc.fileName || `${slug(S.doc.title)}.pdf`, new Blob([S.bytes], { type: 'application/pdf' }));
}

/* =========================================================
   Shortcuts dialog
   ========================================================= */
function showShortcuts() {
  const rows = [
    ['V H U S', 'Select, highlight, underline, strikethrough'],
    ['P N T E', 'Pen, sticky note, text box, eraser'],
    ['← →', 'Previous / next page'],
    ['+ − 0', 'Zoom in, zoom out, fit to width'],
    ['B', 'Bookmark the current page'],
    ['[', 'Show or hide the sidebar'],
    ['Ctrl F', 'Search this PDF'],
    ['Ctrl Z', 'Undo'],
    ['Delete', 'Delete the selected mark'],
    ['Esc', 'Close menus, back to Select'],
  ];
  openModal(`<h2>Keyboard shortcuts</h2><div class="keys">${rows.map(([k, l]) => `<span>${k.split(' ').map((x) => `<kbd>${x}</kbd>`).join(' ')}</span><span>${l}</span>`).join('')}</div>
    <div class="sheet-actions"><button class="btn primary" data-act="close">Done</button></div>`);
}

/* =========================================================
   Wiring
   ========================================================= */
hydrateIcons();

$('#uploadBtn').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = (e) => {
  addFiles(e.target.files);
  e.target.value = '';
};
$('#restoreInput').onchange = (e) => {
  if (e.target.files[0]) restoreLibrary(e.target.files[0]);
  e.target.value = '';
};
$('#q').addEventListener('input', (e) => {
  S.q = e.target.value;
  renderLibrary();
});
$('#sort').value = S.sort;
$('#sort').onchange = (e) => {
  S.sort = e.target.value;
  ls.set('mg.sort', S.sort);
  renderLibrary();
};
$('#shelves').addEventListener('click', (e) => {
  const b = e.target.closest('[data-shelf]');
  if (!b) return;
  S.shelf = b.dataset.shelf;
  renderLibrary();
});
$('#tagbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tag]');
  if (!b) return;
  S.tag = S.tag === b.dataset.tag ? null : b.dataset.tag;
  renderLibrary();
});
$('#grid').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const card = b.closest('.card');
  const d = card && S.docs.find((x) => x.id === card.dataset.id);
  const act = b.dataset.act;
  if (act === 'open' && d) location.hash = 'read/' + d.id;
  else if (act === 'edit' && d) editDetails(d);
  else if (act === 'upload') $('#fileInput').click();
  else if (act === 'sample') {
    const doc = await addSample();
    if (doc) location.hash = 'read/' + doc.id;
  } else if (act === 'clearfilters') {
    S.q = '';
    $('#q').value = '';
    S.tag = null;
    S.shelf = 'all';
    renderLibrary();
  }
});
$('#libMenuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  openMenu($('#libMenuBtn'), [
    { id: 'sample', icon: 'sparkle', label: 'Add the sample guide', sub: 'A short PDF to try every tool' },
    '-',
    { id: 'backup', icon: 'backup', label: 'Back up library', sub: 'Download all PDFs and notes as one file' },
    { id: 'restore', icon: 'restore', label: 'Restore from backup', sub: 'Adds PDFs from a backup file' },
  ], {
    sample: addSample,
    backup: backupLibrary,
    restore: () => $('#restoreInput').click(),
  });
});
$('#libMenuBtn').setAttribute('data-keep-pop', '');

$('#modal').addEventListener('click', (e) => {
  if (e.target === $('#modal') || e.target.closest('[data-act=close]')) closeModal();
});

// drag & drop onto the library
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || S.view !== 'library') return;
  e.preventDefault();
  dragDepth++;
  $('#dropzone').hidden = false;
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $('#dropzone').hidden = true;
  }
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#dropzone').hidden = true;
  if (S.view === 'library') addFiles(e.dataTransfer.files);
});

// reader chrome
$('#backBtn').onclick = () => (location.hash = '');
$('#sideBtn').onclick = () => {
  S.sideOpen = !S.sideOpen;
  ls.set('mg.side', S.sideOpen);
  applySide();
  if (S.fit) setTimeout(() => setScale(fitScale(), true), 0);
};
$('#prevBtn').onclick = () => goPage(S.cur - 1);
$('#nextBtn').onclick = () => goPage(S.cur + 1);
$('#pageInput').addEventListener('change', (e) => {
  const n = parseInt(e.target.value, 10);
  if (n >= 1) goPage(n - 1, false);
  e.target.value = S.cur + 1;
});
$('#pageInput').addEventListener('focus', (e) => e.target.select());
$('#zoomIn').onclick = () => zoomStep(1);
$('#zoomOut').onclick = () => zoomStep(-1);
$('#zoomLabel').onclick = () => setScale(fitScale(), true);
$('#themeBtn').onclick = () => {
  S.theme = THEMES[(THEMES.indexOf(S.theme) + 1) % THEMES.length];
  ls.set('mg.theme', S.theme);
  applyTheme();
  toast(`Reading theme: ${THEME_LABEL[S.theme]}`, false, 1400);
};
$('#undoBtn').onclick = undoAll;
$('#bookmarkBtn').onclick = toggleBookmark;
$('#exportBtn').setAttribute('data-keep-pop', '');
$('#exportBtn').addEventListener('click', () => {
  openMenu($('#exportBtn'), [
    { id: 'md', icon: 'file', label: 'Notes as Markdown', sub: 'Highlights, comments and bookmarks (.md)' },
    { id: 'pdf', icon: 'highlight', label: 'Annotated PDF', sub: 'A copy with every mark drawn in' },
    { id: 'orig', icon: 'download', label: 'Original PDF', sub: 'The file exactly as you added it' },
    '-',
    { id: 'details', icon: 'edit', label: 'Edit details', sub: 'Title, shelf and tags' },
    { id: 'keys', icon: 'more', label: 'Keyboard shortcuts' },
  ], {
    md: exportMarkdown,
    pdf: exportAnnotated,
    orig: exportOriginal,
    details: () => editDetails(S.doc),
    keys: showShortcuts,
  });
});

document.addEventListener('keydown', (e) => {
  if (!$('#modal').hidden) {
    if (e.key === 'Escape') closeModal();
    return;
  }
  if (S.view !== 'reader') return;
  if (isTyping(e.target)) {
    if (e.key === 'Escape' && e.target.tagName === 'TEXTAREA') closePop();
    return;
  }
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z' && !e.shiftKey) {
    e.preventDefault();
    undoAll();
    return;
  }
  if (mod && k === 'f') {
    e.preventDefault();
    openSide('search');
    setTimeout(() => $('#searchInput').focus(), 20);
    return;
  }
  if (mod || e.altKey) return;
  if (e.key === 'Escape') {
    if (S.pop) closePop();
    else setTool('select');
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.activeId) {
    const a = S.annots.find((x) => x.id === S.activeId);
    closePop();
    if (a) removeAnnot(a);
    return;
  }
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goPage(S.cur + 1); return; }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goPage(S.cur - 1); return; }
  if (e.key === '+' || e.key === '=') return zoomStep(1);
  if (e.key === '-') return zoomStep(-1);
  if (e.key === '0') return setScale(fitScale(), true);
  if (k === 'b') return toggleBookmark();
  if (e.key === '[') return $('#sideBtn').click();
  if (e.key === '?') return showShortcuts();
  const tool = TOOLS.find((t) => t.key === k);
  if (tool) setTool(tool.id);
});

window.addEventListener('beforeunload', () => {
  flushAnnSaves();
  if (S.doc) S.store?.putDoc(S.doc);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushAnnSaves();
    if (S.doc) saveDoc(S.doc);
  }
});

/* ---------- routing ---------- */
function route() {
  const m = location.hash.match(/^#read\/([\w-]+)/);
  if (m) {
    if (S.doc?.id !== m[1]) openReader(m[1]);
  } else if (S.view === 'reader') closeReader();
}
window.addEventListener('hashchange', route);

/* ---------- boot ---------- */
(async function boot() {
  $('#grid').innerHTML = `<div class="empty"><div class="spinner"></div><p>Opening your library…</p></div>`;
  S.store = await openStore();
  try {
    S.docs = await S.store.allDocs();
  } catch (e) {
    console.error(e);
    S.docs = [];
  }
  setTool('select');
  renderColors();
  applyTheme();
  applySide();
  // First visit: add the sample guide so the reader opens with something to try.
  try {
    if (!S.docs.length && !(await S.store.kvGet('seeded'))) {
      await S.store.kvSet('seeded', true);
      await addSample();
    }
  } catch (e) {
    console.warn(e);
  }
  renderLibrary();
  route();
})();
