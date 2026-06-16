import type { Theme } from "@mui/material/styles";
import { APP_THEMES } from "../theme/appTheme";

export interface MonacoWithDefineTheme {
  editor: {
    defineTheme: (name: string, data: unknown) => void;
  };
}

type MonacoColorConfig = Record<string, string>;

function monacoColors(theme: Theme): MonacoColorConfig {
  return {
    "editor.background": theme.palette.background.paper,
    "editor.foreground": theme.palette.text.primary,
    "editorLineNumber.foreground": theme.palette.text.secondary,
    "editorLineNumber.activeForeground": theme.palette.text.primary,
    "editorGutter.background": theme.palette.background.paper,
    "editorWidget.background": theme.palette.background.default,
    "editorWidget.border": theme.palette.divider,
    "editor.selectionBackground": theme.palette.action.selected,
    "editor.inactiveSelectionBackground": theme.palette.action.hover,
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
