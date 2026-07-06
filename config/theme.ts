import type { SelectOption } from '../ui/Select.js';
import { hexToRgb } from '../ui/color.js';

export interface Theme {
  name: string;
  user: string;
  assistant: string;
  tool: string;
  toolResult: string;
  note: string;
  error: string;
  mascot: string;
  border: string;
  borderActive: string;
}

export const THEMES: Record<string, Theme> = {
  aurora: {
    name: 'aurora',
    user: '#22c55e',
    assistant: '#d946ef',
    tool: '#eab308',
    toolResult: '#22c55e',
    note: '#22d3ee',
    error: '#ef4444',
    mascot: '#2dd4bf',
    border: '#22d3ee',
    borderActive: '#22c55e',
  },
  sunset: {
    name: 'sunset',
    user: '#f59e0b',
    assistant: '#ec4899',
    tool: '#f97316',
    toolResult: '#fb923c',
    note: '#fbbf24',
    error: '#ef4444',
    mascot: '#ef4444',
    border: '#f59e0b',
    borderActive: '#f97316',
  },
  matrix: {
    name: 'matrix',
    user: '#4ade80',
    assistant: '#22c55e',
    tool: '#a3e635',
    toolResult: '#86efac',
    note: '#86efac',
    error: '#ef4444',
    mascot: '#16a34a',
    border: '#22c55e',
    borderActive: '#4ade80',
  },
  ocean: {
    name: 'ocean',
    user: '#38bdf8',
    assistant: '#818cf8',
    tool: '#22d3ee',
    toolResult: '#38bdf8',
    note: '#7dd3fc',
    error: '#fb7185',
    mascot: '#0ea5e9',
    border: '#0ea5e9',
    borderActive: '#38bdf8',
  },
  mono: {
    name: 'mono',
    user: '#e5e7eb',
    assistant: '#d1d5db',
    tool: '#9ca3af',
    toolResult: '#d1d5db',
    note: '#9ca3af',
    error: '#ef4444',
    mascot: '#9ca3af',
    border: '#9ca3af',
    borderActive: '#e5e7eb',
  },
  dracula: {
    name: 'dracula',
    user: '#50fa7b',
    assistant: '#bd93f9',
    tool: '#f1fa8c',
    toolResult: '#8be9fd',
    note: '#8be9fd',
    error: '#ff5555',
    mascot: '#ff79c6',
    border: '#bd93f9',
    borderActive: '#ff79c6',
  },
  nord: {
    name: 'nord',
    user: '#a3be8c',
    assistant: '#b48ead',
    tool: '#ebcb8b',
    toolResult: '#8fbcbb',
    note: '#88c0d0',
    error: '#bf616a',
    mascot: '#88c0d0',
    border: '#81a1c1',
    borderActive: '#88c0d0',
  },
  gruvbox: {
    name: 'gruvbox',
    user: '#b8bb26',
    assistant: '#d3869b',
    tool: '#fabd2f',
    toolResult: '#8ec07c',
    note: '#83a598',
    error: '#fb4934',
    mascot: '#fe8019',
    border: '#fabd2f',
    borderActive: '#fe8019',
  },
  rosepine: {
    name: 'rosepine',
    user: '#9ccfd8',
    assistant: '#c4a7e7',
    tool: '#f6c177',
    toolResult: '#ebbcba',
    note: '#9ccfd8',
    error: '#eb6f92',
    mascot: '#ebbcba',
    border: '#31748f',
    borderActive: '#c4a7e7',
  },
  solarized: {
    name: 'solarized',
    user: '#859900',
    assistant: '#6c71c4',
    tool: '#b58900',
    toolResult: '#2aa198',
    note: '#268bd2',
    error: '#dc322f',
    mascot: '#2aa198',
    border: '#268bd2',
    borderActive: '#2aa198',
  },
  synthwave: {
    name: 'synthwave',
    user: '#05d9e8',
    assistant: '#d300c5',
    tool: '#f9f871',
    toolResult: '#05d9e8',
    note: '#05d9e8',
    error: '#ff2a6d',
    mascot: '#ff2a6d',
    border: '#d300c5',
    borderActive: '#05d9e8',
  },
  forest: {
    name: 'forest',
    user: '#90a955',
    assistant: '#52b788',
    tool: '#d4e09b',
    toolResult: '#90a955',
    note: '#a7c957',
    error: '#bc4749',
    mascot: '#52b788',
    border: '#52796f',
    borderActive: '#90a955',
  },
  coffee: {
    name: 'coffee',
    user: '#c8a27a',
    assistant: '#b08968',
    tool: '#ddb892',
    toolResult: '#d4a373',
    note: '#e6ccb2',
    error: '#bc6c25',
    mascot: '#a47148',
    border: '#7f5539',
    borderActive: '#b08968',
  },
};

export const DEFAULT_THEME = 'synthwave';

/**
 * Mute a color toward a matte look: desaturate toward its own luminance-gray
 * and darken slightly, so the palette reads softer and less neon.
 */
function matte(hex: string, desat = 0.42, darken = 0.08): string {
  if (!hex.startsWith('#')) return hex;
  const [r, g, b] = hexToRgb(hex);
  const gray = 0.3 * r + 0.59 * g + 0.11 * b;
  const mix = (c: number) => {
    const desaturated = c + (gray - c) * desat;
    return Math.round(desaturated * (1 - darken));
  };
  return `#${[mix(r), mix(g), mix(b)]
    .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
    .join('')}`;
}

const MATTE_CACHE = new Map<string, Theme>();

export function getTheme(name: string | undefined): Theme {
  const key = name ?? DEFAULT_THEME;
  const cached = MATTE_CACHE.get(key);
  if (cached) return cached;
  const base = THEMES[key] ?? THEMES[DEFAULT_THEME]!;
  const muted: Theme = {
    name: base.name,
    user: matte(base.user),
    assistant: matte(base.assistant),
    tool: matte(base.tool),
    toolResult: matte(base.toolResult),
    note: matte(base.note),
    error: matte(base.error),
    mascot: matte(base.mascot),
    border: matte(base.border),
    borderActive: matte(base.borderActive),
  };
  MATTE_CACHE.set(key, muted);
  return muted;
}

export const THEME_OPTIONS: SelectOption<string>[] = Object.values(THEMES).map(
  (t) => ({ label: t.name, value: t.name, hint: t.mascot }),
);
