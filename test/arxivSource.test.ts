import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'zlib';
import {
  parseTar,
  extractSourceArchive,
  pickMainTex,
  texToReadable,
  readableFromArchive,
  type SourceFile,
} from '../src/research/arxivSource.js';

// ── Build a minimal USTAR archive in-memory (for parseTar/extract tests) ─────

function tarHeader(name: string, size: number): Buffer {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, 'utf-8'); // name
  h.write('0000644', 100, 'utf-8'); // mode
  h.write('0000000', 108, 'utf-8'); // uid
  h.write('0000000', 116, 'utf-8'); // gid
  h.write(size.toString(8).padStart(11, '0') + ' ', 124, 'utf-8'); // size (octal)
  h.write('00000000000 ', 136, 'utf-8'); // mtime
  h[156] = '0'.charCodeAt(0); // typeflag = regular file
  h.write('ustar\0', 257, 'utf-8'); // magic
  h.write('00', 263, 'utf-8'); // version
  // checksum: fill with spaces, sum bytes, write octal.
  for (let i = 148; i < 156; i++) h[i] = 0x20;
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'utf-8');
  return h;
}

function makeTar(files: SourceFile[]): Buffer {
  const parts: Buffer[] = [];
  for (const f of files) {
    const data = Buffer.from(f.content, 'utf-8');
    parts.push(tarHeader(f.name, data.length));
    const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
    data.copy(padded);
    parts.push(padded);
  }
  parts.push(Buffer.alloc(1024)); // two zero blocks = end
  return Buffer.concat(parts);
}

// ── parseTar ──────────────────────────────────────────────────────────────

test('parseTar reads regular text files and skips binary', () => {
  const tar = makeTar([
    { name: 'main.tex', content: '\\documentclass{article}\\begin{document}Hi\\end{document}' },
    { name: 'refs.bib', content: '@article{x2020, title={T}}' },
  ]);
  const files = parseTar(tar);
  assert.equal(files.length, 2);
  assert.equal(files[0]!.name, 'main.tex');
  assert.ok(files[0]!.content.includes('documentclass'));
});

// ── extractSourceArchive ────────────────────────────────────────────────────

test('extractSourceArchive handles gzipped tar', () => {
  const tar = makeTar([{ name: 'paper.tex', content: '\\documentclass{article}' }]);
  const gz = gzipSync(tar);
  const files = extractSourceArchive(gz);
  assert.equal(files.length, 1);
  assert.equal(files[0]!.name, 'paper.tex');
});

test('extractSourceArchive handles a gzipped bare .tex (no tar)', () => {
  const gz = gzipSync(Buffer.from('\\documentclass{article}\\begin{document}x\\end{document}', 'utf-8'));
  const files = extractSourceArchive(gz);
  assert.equal(files.length, 1);
  assert.ok(files[0]!.content.includes('documentclass'));
});

// ── pickMainTex ─────────────────────────────────────────────────────────────

test('pickMainTex prefers the file with \\documentclass', () => {
  const files: SourceFile[] = [
    { name: 'appendix.tex', content: 'lots of text '.repeat(100) },
    { name: 'main.tex', content: '\\documentclass{article}\nshort' },
  ];
  assert.equal(pickMainTex(files)!.name, 'main.tex');
});

test('pickMainTex falls back to largest .tex when none declare documentclass', () => {
  const files: SourceFile[] = [
    { name: 'a.tex', content: 'short' },
    { name: 'b.tex', content: 'a much longer body of text here' },
  ];
  assert.equal(pickMainTex(files)!.name, 'b.tex');
});

test('pickMainTex returns null when there are no .tex files', () => {
  assert.equal(pickMainTex([{ name: 'data.csv', content: '1,2,3' }]), null);
});

// ── texToReadable ───────────────────────────────────────────────────────────

test('texToReadable keeps math + sections, drops comments and preamble', () => {
  const tex =
    '\\documentclass{article}\n\\usepackage{amsmath}\n' +
    '\\begin{document}\n' +
    '% this is a comment\n' +
    '\\section{Method}\n' +
    'We define $E = mc^2$ as the energy. \\cite{einstein1905}\n' +
    '\\end{document}\n';
  const out = texToReadable(tex);
  assert.ok(out.includes('## Method'), 'section heading preserved');
  assert.ok(out.includes('$E = mc^2$'), 'inline math preserved');
  assert.ok(out.includes('[cite:einstein1905]'), 'cite compacted');
  assert.ok(!out.includes('this is a comment'), 'comment removed');
  assert.ok(!out.includes('usepackage'), 'preamble dropped');
});

test('texToReadable keeps an equation environment', () => {
  const tex =
    '\\begin{document}\\begin{equation}\\sum_i x_i = 1\\end{equation}\\end{document}';
  const out = texToReadable(tex);
  assert.ok(out.includes('\\sum_i x_i = 1'));
});

// ── end-to-end ──────────────────────────────────────────────────────────────

test('readableFromArchive: gzipped tar → readable main text', () => {
  const tar = makeTar([
    { name: 'refs.bib', content: '@article{x}' },
    {
      name: 'main.tex',
      content: '\\documentclass{article}\\begin{document}\\section{Intro}\nHello $x^2$.\\end{document}',
    },
  ]);
  const result = readableFromArchive(gzipSync(tar));
  assert.ok(result);
  assert.equal(result!.name, 'main.tex');
  assert.ok(result!.text.includes('## Intro'));
  assert.ok(result!.text.includes('$x^2$'));
});
