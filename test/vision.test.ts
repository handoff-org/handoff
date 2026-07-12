import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshHome } from './helpers.js';

// vision.ts pulls in modules that read homedir() at load time (runner → project),
// so set up an isolated HOME before importing anything.
freshHome();

const { sniffImage, encodeImageResult } = await import('../src/tools/vision.js');
const { ToolRegistry } = await import('../src/tools/registry.js');
const { dropStaleImages } = await import('../src/agent/compaction.js');
const { toOpenAIContent } = await import('../src/agent/model.js');

// ── sniffImage (pure, magic bytes) ───────────────────────────────────────────

test('sniffImage detects PNG / JPEG / GIF / WebP by magic bytes', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  const webp = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  assert.equal(sniffImage(png), 'png');
  assert.equal(sniffImage(jpeg), 'jpeg');
  assert.equal(sniffImage(gif), 'gif');
  assert.equal(sniffImage(webp), 'webp');
});

test('sniffImage rejects non-images and truncated headers', () => {
  assert.equal(sniffImage(Buffer.from('not an image at all')), null);
  assert.equal(sniffImage(Buffer.from([0x25, 0x50, 0x44, 0x46])), null); // %PDF
  assert.equal(sniffImage(Buffer.from([0x89, 0x50])), null); // too short for PNG
});

// ── encodeImageResult (pure) ─────────────────────────────────────────────────

test('encodeImageResult returns text + a single base64 image', () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const res = encodeImageResult('fig.png', bytes, 'png', 'a loss curve');
  assert.match(res.text, /fig\.png/);
  assert.match(res.text, /PNG/);
  assert.match(res.text, /a loss curve/);
  assert.deepEqual(res.images, [bytes.toString('base64')]);
});

// ── ToolRegistry.callFull normalization ──────────────────────────────────────

test('callFull normalizes string, passes ToolResult through, and wraps errors', async () => {
  const reg = new ToolRegistry();
  reg.register({
    name: 'says_text',
    description: 't',
    parameters: { type: 'object', properties: {} },
    execute: async () => 'plain text',
  });
  reg.register({
    name: 'says_image',
    description: 't',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ text: 'here', images: ['QUJD'] }),
  });
  reg.register({
    name: 'throws',
    description: 't',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      throw new Error('boom');
    },
  });

  assert.deepEqual(await reg.callFull('says_text', {}), { text: 'plain text' });
  assert.deepEqual(await reg.callFull('says_image', {}), { text: 'here', images: ['QUJD'] });
  assert.deepEqual(await reg.callFull('throws', {}), { text: 'Error: boom' });
  assert.deepEqual(await reg.callFull('missing', {}), { text: 'Error: unknown tool "missing"' });
  // The text-only `call` convenience still returns a plain string.
  assert.equal(await reg.call('says_image', {}), 'here');
});

// ── dropStaleImages (pure) ───────────────────────────────────────────────────

test('dropStaleImages keeps the current turn images, strips older ones', () => {
  // Images ride on synthetic `user` messages injected right after a tool result.
  const msgs = [
    { role: 'system' as const, content: 'sys' },
    { role: 'user' as const, content: 'first' }, // turn 1 (image-less anchor)
    { role: 'assistant' as const, content: '', tool_calls: [] },
    { role: 'tool' as const, content: 'loaded', tool_call_id: 'a' },
    { role: 'user' as const, content: '[image attached from view_image]', images: ['OLD'] },
    { role: 'assistant' as const, content: 'saw it' },
    { role: 'user' as const, content: 'second' }, // turn 2 — the current image-less anchor
    { role: 'tool' as const, content: 'loaded', tool_call_id: 'b' },
    { role: 'user' as const, content: '[image attached from view_image]', images: ['NEW'] },
  ];
  const out = dropStaleImages(msgs);
  // The injected image-user message from turn 1 (before the last plain user msg) is stripped…
  assert.equal(out[4]!.images, undefined);
  // …while the current turn's injected image survives (it's after the anchor).
  assert.deepEqual(out[8]!.images, ['NEW']);
  // Original array untouched (pure).
  assert.deepEqual(msgs[4]!.images, ['OLD']);
});

test('dropStaleImages anchors on an image-LESS user message, not an injected one', () => {
  // Only image-bearing user messages exist after the real prompt — the injected
  // ones must not become the anchor, so all current-turn images are kept.
  const msgs = [
    { role: 'user' as const, content: 'real prompt' },
    { role: 'tool' as const, content: 't1', tool_call_id: '1' },
    { role: 'user' as const, content: '[image]', images: ['A'] },
    { role: 'tool' as const, content: 't2', tool_call_id: '2' },
    { role: 'user' as const, content: '[image]', images: ['B'] },
  ];
  const out = dropStaleImages(msgs);
  assert.deepEqual(out[2]!.images, ['A']);
  assert.deepEqual(out[4]!.images, ['B']);
});

test('dropStaleImages is a no-op before any plain user message', () => {
  const msgs = [{ role: 'system' as const, content: 'sys' }];
  assert.deepEqual(dropStaleImages(msgs), msgs);
});

// ── toOpenAIContent (message serialization) ──────────────────────────────────

test('toOpenAIContent passes text-only messages through unchanged', () => {
  const m = { role: 'user' as const, content: 'hello' };
  assert.equal(toOpenAIContent(m), m);
});

test('toOpenAIContent builds a content array with a data-URI image', () => {
  const m = { role: 'tool' as const, content: 'look', tool_call_id: 'x', images: ['/9j/abc'] };
  const out = toOpenAIContent(m) as {
    role: string;
    content: Array<{ type: string; text?: string; image_url?: { url: string } }>;
    tool_call_id?: string;
  };
  assert.equal(out.role, 'tool');
  assert.equal(out.tool_call_id, 'x');
  assert.equal(out.content[0]!.type, 'text');
  assert.equal(out.content[0]!.text, 'look');
  assert.equal(out.content[1]!.type, 'image_url');
  // Leading `/9j/` → JPEG mime in the data URI.
  assert.equal(out.content[1]!.image_url!.url, 'data:image/jpeg;base64,/9j/abc');
});

test('toOpenAIContent omits the text block when content is empty', () => {
  const m = { role: 'user' as const, content: '', images: ['iVBORw0KGgo'] };
  const out = toOpenAIContent(m) as {
    content: Array<{ type: string; image_url?: { url: string } }>;
  };
  assert.equal(out.content.length, 1);
  assert.equal(out.content[0]!.type, 'image_url');
  // Default/PNG prefix → image/png.
  assert.match(out.content[0]!.image_url!.url, /^data:image\/png;base64,/);
});
