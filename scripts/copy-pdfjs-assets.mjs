// Copies pdf.js character maps and standard fonts into public/ so PDFs that use
// CJK encodings or non-embedded standard fonts render correctly.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('pdfjs-dist/package.json'));
const dest = join(process.cwd(), 'public', 'pdfjs');
mkdirSync(dest, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts']) {
  const src = join(root, dir);
  if (existsSync(src)) cpSync(src, join(dest, dir), { recursive: true });
}
console.log('pdf.js assets copied to public/pdfjs');
