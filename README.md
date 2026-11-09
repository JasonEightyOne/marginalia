# Marginalia

A personal PDF library and reading room. Store your PDFs, read them comfortably, and mark them up with highlights, comments, sticky notes, drawings and text, then export your notes or an annotated copy.

It is a static web app (Vite + vanilla JavaScript, [pdf.js](https://mozilla.github.io/pdf.js/) for rendering and [pdf-lib](https://pdf-lib.js.org/) for export). There is no server or database to run: everything is stored privately in the reader's own browser (IndexedDB), so it deploys to Vercel with zero configuration.

## Functional requirements

### 1. Library (storing PDFs)
| # | Requirement | Status |
|---|---|---|
| L1 | Add one or many PDFs with a file picker or by dragging them onto the page | ✅ |
| L2 | Store the PDF files and all metadata persistently in the browser (IndexedDB), surviving reloads and restarts | ✅ |
| L3 | Show each PDF as a card with a cover thumbnail, title, author, page count, number of marks, reading progress and last-opened time | ✅ |
| L4 | Read title and author from the PDF's metadata, falling back to the file name | ✅ |
| L5 | Separate documents into shelves: **To read**, **Reading**, **Finished** (opening a "To read" PDF moves it to "Reading" automatically) | ✅ |
| L6 | Tag documents (e.g. `thesis`, `chapter-2`) and filter the shelf by tag | ✅ |
| L7 | Search the library by title, author, file name or tag; sort by recently read, recently added, title or progress | ✅ |
| L8 | Edit a document's title, author, shelf and tags; delete it (with confirmation) along with its annotations | ✅ |
| L9 | Back up the whole library (PDFs and notes) to one `.json` file and restore it on any device or browser | ✅ |
| L10 | A sample guide PDF on first launch so every tool can be tried immediately | ✅ |

### 2. Reading mode
| # | Requirement | Status |
|---|---|---|
| R1 | Continuous vertical scrolling with lazy, high-DPI rendering (only nearby pages are drawn, so long PDFs stay fast) | ✅ |
| R2 | Resume at the page where you left off | ✅ |
| R3 | Page navigation: previous/next, jump to a page number, arrow keys | ✅ |
| R4 | Zoom in/out, fit to width, Ctrl/⌘ + scroll wheel or trackpad pinch | ✅ |
| R5 | Reading themes: **Paper**, **Sepia** and **Night** (inverted pages for low light) | ✅ |
| R6 | Selectable text layer so text can be copied | ✅ |
| R7 | Full-text search inside the PDF with highlighted results and snippets | ✅ |
| R8 | Table of contents from the PDF's outline | ✅ |
| R9 | Bookmarks for pages you want to come back to | ✅ |
| R10 | Works on phones and tablets (touch selection, drawer sidebar) and follows the system light/dark setting | ✅ |

### 3. Annotation (editing, highlighting, commenting)
| # | Requirement | Status |
|---|---|---|
| A1 | Highlight selected text in five colors (yellow, green, blue, pink, graphite) | ✅ |
| A2 | Underline and strikethrough selected text | ✅ |
| A3 | Attach a comment to any highlight; commented highlights show a margin marker | ✅ |
| A4 | Sticky notes pinned anywhere on a page; drag to move | ✅ |
| A5 | Freehand pen for circling, arrows and handwriting | ✅ |
| A6 | Text boxes typed directly onto the page (resizable text, draggable) | ✅ |
| A7 | Eraser that removes any mark it touches | ✅ |
| A8 | Click any mark to recolor it, edit its comment, copy its text or delete it | ✅ |
| A9 | Undo (Ctrl/⌘ + Z) for creating, changing and deleting marks | ✅ |
| A10 | Notes sidebar listing every mark in reading order, filterable by color or "with comments", with click-to-jump | ✅ |
| A11 | Every change is saved automatically | ✅ |

### 4. Export
| # | Requirement | Status |
|---|---|---|
| E1 | Export notes (quotes, comments, bookmarks) as Markdown, ready for Notion or Obsidian | ✅ |
| E2 | Export an annotated PDF with highlights, lines, drawings and text burned in, numbered comment markers, and an appended **Notes** page | ✅ |
| E3 | Download the original PDF | ✅ |

### Keyboard shortcuts
`V` select · `H` highlight · `U` underline · `S` strikethrough · `P` pen · `N` sticky note · `T` text box · `E` eraser · `←/→` page · `+ / − / 0` zoom · `B` bookmark · `[` sidebar · `Ctrl F` search · `Ctrl Z` undo · `Delete` remove selected mark · `?` show all shortcuts

## Where your data lives

Everything stays in the browser you use: nothing is uploaded to a server. This keeps your documents private and means the app needs no backend, but it also means:

- Each browser or device has its own library. Use **⋯ → Back up library** and **Restore from backup** to move or keep a copy.
- Clearing site data for the app's domain deletes the library. The app asks the browser for persistent storage to prevent automatic eviction.
- Browsers typically allow several GB per site. The footer of the library shows how much is used and free.

## Run locally

Requires Node.js 18 or later.

```bash
npm install
```

```bash
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173). To check a production build:

```bash
npm run build && npm run preview
```

## Push to GitHub

Create an empty repository on GitHub (no README or license), then from this folder:

```bash
git remote add origin https://github.com/<your-username>/marginalia.git
```

```bash
git push -u origin main
```

## Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import the GitHub repository.
2. Vercel detects **Vite** automatically. The defaults are correct:
   - Build command: `npm run build`
   - Output directory: `dist`
3. Click **Deploy**. Every push to `main` redeploys.

Or with the CLI: `npx vercel` (preview) and `npx vercel --prod`.

## Project structure

```
index.html                  App shell (library + reader views)
src/main.js                 UI, reader, annotation tools, routing
src/storage.js              IndexedDB persistence (memory fallback)
src/exporters.js            Markdown, annotated PDF and backup helpers
src/sample.js               Generates the first-launch sample PDF
src/icons.js                Inline SVG icons
src/styles.css              Styles and light/dark tokens
scripts/copy-pdfjs-assets.mjs  Copies pdf.js CMaps and fonts (for CJK and other PDFs) into public/
```

## Ideas for later

- **Sync across devices**: add accounts and cloud storage (for example Supabase Auth + Storage, or Vercel Blob + a Postgres table) and save annotations server-side.
- **OCR for scanned PDFs** so image-only pages become searchable and highlightable (Tesseract.js).
- **Collections and reading goals**: group PDFs into projects, track minutes read per day.
- **Flashcards from highlights** for revision.
- **Installable PWA** with offline caching of the app shell.
