import type { Theme } from "@mui/material/styles";
import { APP_THEMES } from "../theme/appTheme";

export interface MonacoWithDefineTheme {
  editor: {
    defineTheme: (name: string, data: unknown) => void;
  };
}

type MonacoColorConfig = Record<string, string>;

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHexByte(value: number): string {
  return clampByte(value).toString(16).padStart(2, "0");
}

function formatMonacoHex({ r, g, b, a }: RgbaColor): string {
  const alpha = clampByte(a * 255);
  const base = `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
  return alpha === 255 ? base : `${base}${toHexByte(alpha)}`;
}

function parseHexColor(input: string): RgbaColor | null {
  const hex = input.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    const [r, g, b, a = "f"] = hex.split("");
    return parseHexColor(`#${r}${r}${g}${g}${b}${b}${a}${a}`);
  }
  if (hex.length === 6 || hex.length === 8) {
    const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: alpha,
    };
  }
  return null;
}

function parseRgbChannel(value: string): number {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    return (Number(trimmed.slice(0, -1)) / 100) * 255;
  }
  return Number(trimmed);
}

function parseAlphaChannel(value: string): number {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    return Number(trimmed.slice(0, -1)) / 100;
  }
  return Number(trimmed);
}

function parseRgbColor(input: string): RgbaColor | null {
  const match = input.match(/^rgba?\((.+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(",").map((part) => part.trim());
  if (parts.length !== 3 && parts.length !== 4) return null;
  return {
    r: parseRgbChannel(parts[0]),
    g: parseRgbChannel(parts[1]),
    b: parseRgbChannel(parts[2]),
    a: parts[3] ? parseAlphaChannel(parts[3]) : 1,
  };
}

function hueToRgb(p: number, q: number, t: number): number {
  let next = t;
  if (next < 0) next += 1;
  if (next > 1) next -= 1;
  if (next < 1 / 6) return p + (q - p) * 6 * next;
  if (next < 1 / 2) return q;
  if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): Pick<RgbaColor, "r" | "g" | "b"> {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = Math.max(0, Math.min(1, s / 100));
  const light = Math.max(0, Math.min(1, l / 100));

  if (sat === 0) {
    const gray = light * 255;
    return { r: gray, g: gray, b: gray };
  }

  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;

  return {
    r: hueToRgb(p, q, hue + 1 / 3) * 255,
    g: hueToRgb(p, q, hue) * 255,
    b: hueToRgb(p, q, hue - 1 / 3) * 255,
  };
}

function parseHslColor(input: string): RgbaColor | null {
  const match = input.match(/^hsla?\((.+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(",").map((part) => part.trim());
  if (parts.length !== 3 && parts.length !== 4) return null;
  const rgb = hslToRgb(Number(parts[0]), Number(parts[1].replace("%", "")), Number(parts[2].replace("%", "")));
  return {
    ...rgb,
    a: parts[3] ? parseAlphaChannel(parts[3]) : 1,
  };
}

export function toMonacoHex(input: string): string {
  const normalized = input.trim();
  const parsed =
    (normalized.startsWith("#") ? parseHexColor(normalized) : null) ??
    parseRgbColor(normalized) ??
    parseHslColor(normalized);

  return parsed ? formatMonacoHex(parsed) : normalized;
}

function monacoColors(theme: Theme): MonacoColorConfig {
  return {
    "editor.background": toMonacoHex(theme.palette.background.paper),
    "editor.foreground": toMonacoHex(theme.palette.text.primary),
    "editorLineNumber.foreground": toMonacoHex(theme.palette.text.secondary),
    "editorLineNumber.activeForeground": toMonacoHex(theme.palette.text.primary),
    "editorGutter.background": toMonacoHex(theme.palette.background.paper),
    "editorWidget.background": toMonacoHex(theme.palette.background.default),
    "editorWidget.border": toMonacoHex(theme.palette.divider),
    "editor.selectionBackground": toMonacoHex(theme.palette.action.selected),
    "editor.inactiveSelectionBackground": toMonacoHex(theme.palette.action.hover),
  };
}

export function registerDbvMonacoThemes(monaco: MonacoWithDefineTheme): void {
  const lightColors = monacoColors(APP_THEMES.light);
  const darkColors = monacoColors(APP_THEMES.dark);
  monaco.editor.defineTheme("dbv-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: lightColors,
  });
  monaco.editor.defineTheme("dbv-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: darkColors,
  });
}
