import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import { randomUUID } from 'crypto';
import type { ToolRegistry, ToolResult } from './registry.js';
import { safeFetch } from './ssrf.js';
import { runPymupdf, pymupdfAvailable } from './pymupdf.js';
import { loadConfig } from '../../config/schema.js';
import { isMultimodalModel } from '../../config/catalog.js';

/**
 * Vision tools: let a multimodal model actually *see* images — a figure the user
 * points to, a plot `run_code` just generated, or a page rendered out of a PDF.
 * Images ride back to the model on the tool-result message (see ToolResult /
 * src/agent/loop.ts); only models with the `multimodal` catalog role honor them,
 * so every tool gates on that first and returns a plain "switch model" note
 * otherwise (attaching an image a blind model can't read just wastes context).
 *
 * The pure helpers (sniffImage, encodeImageResult) are exported for unit tests.
 */

// Base64/context blowup grows with raw bytes; keep a hard ceiling so one giant
// image can't blow the model's context window.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// PDFs are only rendered (not sent whole), so allow a larger download than an image.
const MAX_PDF_BYTES = 50 * 1024 * 1024;

/**
 * Reject an oversized download up front from its Content-Length, so a hostile
 * URL can't force a huge allocation before the post-buffer size check. Returns
 * an error string when the advertised length exceeds the cap, else null.
 */
function overSizeLimit(res: Response, cap = MAX_IMAGE_BYTES): string | null {
  const len = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(len) && len > cap) {
    return `Download is ${Math.round(len / 1024)} KB — over the ${Math.round(
      cap / 1024,
    )} KB limit. Use a smaller image.`;
  }
  return null;
}

export type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp';

/** Detect a supported raster image by magic bytes, or null if it isn't one. */
export function sniffImage(b: Buffer): ImageKind | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return 'png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return 'gif';
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && // R
    b[1] === 0x49 && // I
    b[2] === 0x46 && // F
    b[3] === 0x46 && // F
    b[8] === 0x57 && // W
    b[9] === 0x45 && // E
    b[10] === 0x42 && // B
    b[11] === 0x50 // P
  ) {
    return 'webp';
  }
  return null;
}

/** Wrap image bytes as a ToolResult the loop will forward to the model. */
export function encodeImageResult(
  name: string,
  bytes: Buffer,
  kind: ImageKind,
  note?: string,
): ToolResult {
  const kb = Math.round(bytes.length / 1024);
  const noteLine = note ? ` — ${note}` : '';
  return {
    text:
      `Loaded image ${name} (${kind.toUpperCase()}, ${kb} KB)${noteLine}. ` +
      `It is attached below for you to view — describe or analyze it as the task requires.`,
    images: [bytes.toString('base64')],
  };
}

/**
 * Gate: the active model must be multimodal. Returns an error string to show
 * *instead* of attaching an image, or null when vision is available. Reads the
 * persisted config each call so a mid-session `/model` switch is reflected.
 */
async function requireVisionModel(): Promise<string | null> {
  const config = await loadConfig();
  if (isMultimodalModel(config.backend, config.modelId)) return null;
  return (
    `The active model (${config.modelId}) can't see images. ` +
    `Switch to a vision model first — e.g. \`ollama pull gemma3:4b\` then \`/model\` → gemma3:4b ` +
    `(or gemma3:12b) — and retry.`
  );
}

/** Load raw image bytes from a local path or an SSRF-guarded https URL. */
async function loadImageBytes(
  source: string,
): Promise<{ bytes: Buffer; name: string } | { error: string }> {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    let res: Response;
    try {
      res = await safeFetch(source); // SSRF-guarded on every redirect hop
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    if (!res.ok) return { error: `HTTP ${res.status}: ${res.statusText}` };
    const tooBig = overSizeLimit(res);
    if (tooBig) return { error: tooBig };
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, name: basename(new URL(source).pathname) || 'image' };
  }
  if (!existsSync(source)) return { error: `No such file: ${source}` };
  return { bytes: readFileSync(source), name: basename(source) };
}

/** Validate size + format for a freshly-loaded image, or return an error string. */
function validateImage(bytes: Buffer): { kind: ImageKind } | { error: string } {
  if (bytes.length > MAX_IMAGE_BYTES) {
    return {
      error: `Image is ${Math.round(bytes.length / 1024)} KB — over the ${Math.round(
        MAX_IMAGE_BYTES / 1024,
      )} KB limit. Downscale it (e.g. with run_code) and retry.`,
    };
  }
  const kind = sniffImage(bytes);
  if (!kind) return { error: 'Not a supported image (expected PNG, JPEG, GIF, or WebP).' };
  return { kind };
}

/**
 * Render one PDF page to a PNG via PyMuPDF in an ephemeral uv environment
 * (`uv run --with pymupdf …`) — no persistent project, no system poppler needed.
 * Returns the temp PNG path (caller cleans it up) or an error string.
 */
function renderPdfPageToPng(
  pdfPath: string,
  page1: number,
  dpi: number,
): { png: string } | { error: string } {
  const out = join(tmpdir(), `handoff-pdfpage-${randomUUID()}.png`);
  const script =
    'import sys, fitz\n' +
    'doc = fitz.open(sys.argv[1])\n' +
    'n = doc.page_count\n' +
    'i = int(sys.argv[2])\n' +
    'if i < 0 or i >= n:\n' +
    '    sys.stderr.write(f"page out of range: {i+1} not in 1..{n}")\n' +
    '    sys.exit(2)\n' +
    'pix = doc[i].get_pixmap(dpi=int(sys.argv[3]))\n' +
    'pix.save(sys.argv[4])\n';
  const r = runPymupdf(script, [pdfPath, String(page1 - 1), String(dpi), out]);
  if ('error' in r) {
    // pymupdf may have created a partial file before failing — don't leak it.
    try {
      if (existsSync(out)) unlinkSync(out);
    } catch {
      /* best-effort */
    }
    return { error: `PDF render failed: ${r.error}` };
  }
  return { png: out };
}

/**
 * Detect which inline-image terminal protocol is available.
 * Returns 'iterm2', 'kitty', or null (unsupported).
 */
function detectTerminalImageSupport(): 'iterm2' | 'kitty' | null {
  if (process.env['ITERM_SESSION_ID']) return 'iterm2';
  if (process.env['TERM'] === 'xterm-kitty' || process.env['TERM_PROGRAM'] === 'WezTerm') {
    return 'kitty';
  }
  return null;
}

/**
 * Write an iTerm2 inline image escape sequence directly to stdout.
 * The image appears inline in the terminal immediately, independently of the
 * tool result the model sees.
 */
function displayItermImage(bytes: Buffer, name: string): void {
  const b64 = bytes.toString('base64');
  const seq =
    `\x1b]1337;File=inline=1;size=${bytes.length};` +
    `name=${Buffer.from(name).toString('base64')};` +
    `width=80%;preserveAspectRatio=1:${b64}\x07`;
  process.stdout.write(seq);
}

/**
 * Write a kitty terminal graphics escape sequence (simplest chunked form).
 * Sends the full image in one APC chunk with format=100 (PNG raw).
 */
function displayKittyImage(bytes: Buffer): void {
  const b64 = bytes.toString('base64');
  // a=T = display directly, f=100 = PNG format, m=0 = no more chunks
  const seq = `\x1b_Ga=T,f=100,m=0;${b64}\x1b\\`;
  process.stdout.write(seq + '\n');
}

export function registerVisionTools(registry: ToolRegistry): void {
  // ── view_image ─────────────────────────────────────────────────────────────
  registry.register({
    name: 'view_image',
    description:
      'Look at an image so you can describe or reason about its contents — a local ' +
      'file path or a direct image URL (PNG, JPEG, GIF, WebP). Use for figures, plots, ' +
      'diagrams, screenshots, or any image the user references or that run_code produced. ' +
      'Requires a multimodal model (e.g. gemma3).',
    // Reads an arbitrary local file (or fetches a URL) and sends the bytes to the
    // model — gate it behind approval like other file/network tools.
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Absolute/relative path to a local image, or a direct image URL',
        },
        note: {
          type: 'string',
          description: 'Optional context to record alongside the image (what to look for)',
        },
      },
      required: ['source'],
    },
    async execute({ source, note }): Promise<string | ToolResult> {
      const gate = await requireVisionModel();
      if (gate) return gate;
      const src = String(source ?? '').trim();
      if (!src) return 'Provide a `source` (image path or URL).';

      const loaded = await loadImageBytes(src);
      if ('error' in loaded) return loaded.error;
      const checked = validateImage(loaded.bytes);
      if ('error' in checked) return checked.error;
      return encodeImageResult(
        loaded.name,
        loaded.bytes,
        checked.kind,
        note ? String(note) : undefined,
      );
    },
  });

  // ── preview_figure ─────────────────────────────────────────────────────────
  registry.register({
    name: 'preview_figure',
    description:
      'Render a figure or PDF page inline in the terminal (iTerm2/kitty/WezTerm). ' +
      'Displays the image directly in the terminal window without consuming model context. ' +
      'Accepts a local image path (PNG/JPEG), a PDF path with an optional page number, ' +
      'or a URL. Falls back gracefully in unsupported terminals with path + size info. ' +
      'Does NOT send the image to the model — use view_image for that.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Local path to an image or PDF, or an image URL',
        },
        page: {
          type: 'string',
          description: 'Page number to render for PDFs, 1-based (default 1)',
        },
      },
      required: ['source'],
    },
    async execute({ source, page }) {
      const src = String(source ?? '').trim();
      if (!src) return 'Provide a `source` (image path, PDF path, or URL).';

      const isPdf = /\.pdf$/i.test(src.split('?')[0]!);
      let imageBytes: Buffer;
      let imageName: string;

      if (isPdf) {
        if (!pymupdfAvailable()) {
          return (
            'uv is required to render PDF pages (PyMuPDF). ' +
            'Install: https://docs.astral.sh/uv/\n' +
            `File: ${src}`
          );
        }
        let pdfPath = src;
        let tempPdf: string | null = null;
        if (src.startsWith('http://') || src.startsWith('https://')) {
          let res: Response;
          try {
            res = await safeFetch(src);
          } catch (err) {
            return err instanceof Error ? err.message : String(err);
          }
          if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;
          tempPdf = join(tmpdir(), `handoff-pdfprev-${randomUUID()}.pdf`);
          writeFileSync(tempPdf, Buffer.from(await res.arrayBuffer()));
          pdfPath = tempPdf;
        }
        const page1 = Math.max(1, Math.floor(Number(page ?? 1)) || 1);
        let pngPath: string | null = null;
        try {
          const rendered = renderPdfPageToPng(pdfPath, page1, 150);
          if ('error' in rendered) return rendered.error;
          pngPath = rendered.png;
          imageBytes = readFileSync(pngPath);
          imageName = `${basename(src)} p.${page1}`;
        } finally {
          for (const p of [tempPdf, pngPath]) {
            if (p && existsSync(p)) {
              try {
                unlinkSync(p);
              } catch {
                /* best-effort */
              }
            }
          }
        }
      } else {
        const loaded = await loadImageBytes(src);
        if ('error' in loaded) return loaded.error;
        imageBytes = loaded.bytes;
        imageName = loaded.name;
      }

      const protocol = detectTerminalImageSupport();

      if (!protocol) {
        return (
          `Terminal inline images not supported (need iTerm2, kitty, or WezTerm).\n` +
          `File: ${src}  (${Math.round(imageBytes.length / 1024)} KB)\n` +
          `To view: open "${src}"`
        );
      }

      if (protocol === 'iterm2') {
        displayItermImage(imageBytes, imageName);
      } else {
        const checked = validateImage(imageBytes);
        if ('error' in checked) return checked.error;
        displayKittyImage(imageBytes);
      }

      return `Displayed "${imageName}" (${Math.round(imageBytes.length / 1024)} KB) via ${protocol} protocol.`;
    },
  });

  // ── view_pdf_page ────────────────────────────────────────────────────────
  registry.register({
    name: 'view_pdf_page',
    description:
      'Render a single PDF page to an image and view it — for reading figures, tables, ' +
      'equations, or layout that flat text extraction (read_pdf) loses. Local path or a ' +
      'direct PDF URL. Renders with PyMuPDF via uv (auto-installed). Requires a multimodal model.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Absolute path to a local PDF, or a direct PDF URL',
        },
        page: { type: 'string', description: 'Page number to render, 1-based (default 1)' },
        dpi: { type: 'string', description: 'Render resolution in DPI (default 150, max 400)' },
      },
      required: ['source'],
    },
    async execute({ source, page, dpi }): Promise<string | ToolResult> {
      const gate = await requireVisionModel();
      if (gate) return gate;
      if (!pymupdfAvailable()) {
        return 'uv is required to render PDF pages (PyMuPDF). Install it: https://docs.astral.sh/uv/';
      }
      const src = String(source ?? '').trim();
      if (!src) return 'Provide a `source` (PDF path or URL).';
      const page1 = Math.max(1, Math.floor(Number(page ?? 1)) || 1);
      const dpiN = Math.min(400, Math.max(36, Math.floor(Number(dpi ?? 150)) || 150));

      // Resolve the PDF to a local path (download URLs to a temp file first).
      let pdfPath = src;
      let tempPdf: string | null = null;
      if (src.startsWith('http://') || src.startsWith('https://')) {
        let res: Response;
        try {
          res = await safeFetch(src); // SSRF-guarded on every redirect hop
        } catch (err) {
          return err instanceof Error ? err.message : String(err);
        }
        if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;
        const tooBig = overSizeLimit(res, MAX_PDF_BYTES);
        if (tooBig) return tooBig;
        tempPdf = join(tmpdir(), `handoff-pdf-${randomUUID()}.pdf`);
        writeFileSync(tempPdf, Buffer.from(await res.arrayBuffer()));
        pdfPath = tempPdf;
      } else if (!existsSync(src)) {
        return `No such file: ${src}`;
      }

      let pngPath: string | null = null;
      try {
        const rendered = renderPdfPageToPng(pdfPath, page1, dpiN);
        if ('error' in rendered) return rendered.error;
        pngPath = rendered.png;
        const bytes = readFileSync(pngPath);
        if (bytes.length > MAX_IMAGE_BYTES) {
          return `Rendered page is ${Math.round(
            bytes.length / 1024,
          )} KB — over the limit. Retry with a lower dpi.`;
        }
        return encodeImageResult(
          `${basename(src)} p.${page1}`,
          bytes,
          'png',
          `rendered at ${dpiN} dpi`,
        );
      } finally {
        for (const p of [tempPdf, pngPath]) {
          if (p && existsSync(p)) {
            try {
              unlinkSync(p);
            } catch {
              /* best-effort temp cleanup */
            }
          }
        }
      }
    },
  });
}
