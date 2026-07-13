import type { ToolRegistry } from '../registry.js';
import { safeFetch } from '../ssrf.js';

/**
 * PDF text extraction via pdftotext (poppler). Accepts a local path or a direct
 * URL (downloaded through the SSRF guard to a temp file, cleaned up after).
 * Uses execFileSync (array args, no shell) so a hostile path can't inject.
 */
export function registerPdfTools(registry: ToolRegistry): void {
  registry.register({
    name: 'read_pdf',
    description:
      'Extract text from a PDF — local file path or a direct URL. ' +
      'Requires pdftotext (part of poppler): `brew install poppler` on macOS. ' +
      'Use for reading papers, reports, or any PDF the user provides.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Absolute path to a local PDF file, or a direct PDF URL',
        },
        max_chars: {
          type: 'string',
          description: 'Truncate output to this many characters (default 12000)',
        },
      },
      required: ['source'],
    },
    async execute({ source, max_chars }) {
      const src = String(source);
      const limit = max_chars ? Number(max_chars) : 12_000;
      let localPath = src;
      let tempPath: string | null = null; // set only when we downloaded a URL

      // Download if URL.
      if (src.startsWith('http://') || src.startsWith('https://')) {
        const { tmpdir } = await import('os');
        const { join: pathJoin } = await import('path');
        const { writeFileSync } = await import('fs');
        const { randomUUID } = await import('crypto');
        let res: Response;
        try {
          res = await safeFetch(src); // SSRF-guarded on every redirect hop
        } catch (err) {
          return err instanceof Error ? err.message : String(err);
        }
        if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;
        const buf = await res.arrayBuffer();
        // randomUUID (not Date.now) avoids collisions between concurrent fetches.
        tempPath = pathJoin(tmpdir(), `handoff-pdf-${randomUUID()}.pdf`);
        localPath = tempPath;
        writeFileSync(tempPath, Buffer.from(buf));
      }

      // Use pdftotext (poppler) — widely available on macOS/Linux. execFileSync
      // (array args, no shell) so a path with quotes/spaces/`$()` can't inject.
      try {
        const { execFileSync } = await import('child_process');
        const text = execFileSync('pdftotext', [localPath, '-'], {
          timeout: 30_000,
          encoding: 'utf-8',
          maxBuffer: 8 * 1024 * 1024,
        }) as string;
        return text.length > limit
          ? text.slice(0, limit) + `\n… (truncated at ${limit} chars)`
          : text;
      } catch {
        return (
          'pdftotext not available. Install with: brew install poppler\n' +
          'Then retry — handoff will extract the text directly.'
        );
      } finally {
        // Always clean up a downloaded temp PDF so they don't accumulate in tmp.
        if (tempPath) {
          try {
            const { unlinkSync } = await import('fs');
            unlinkSync(tempPath);
          } catch {
            /* best-effort */
          }
        }
      }
    },
  });
}
