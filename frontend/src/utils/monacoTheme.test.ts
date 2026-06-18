import { describe, expect, it } from "vitest";
import { APP_THEMES } from "../theme/appTheme";
import { registerDbvMonacoThemes, toMonacoHex, type MonacoWithDefineTheme } from "./monacoTheme";

describe("monacoTheme", () => {
  it("converts MUI CSS color strings into Monaco-safe hex", () => {
    expect(toMonacoHex(APP_THEMES.light.palette.background.paper)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(toMonacoHex(APP_THEMES.light.palette.action.selected)).toMatch(/^#[0-9a-f]{8}$/i);
    expect(toMonacoHex(APP_THEMES.dark.palette.text.primary)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("registers light and dark Monaco themes with hex color values", () => {
    const themes: Record<string, unknown> = {};
    const monaco: MonacoWithDefineTheme = {
      editor: {
        defineTheme: (name, data) => {
          themes[name] = data;
        },
      },
    };

    registerDbvMonacoThemes(monaco);

    const lightTheme = themes["dbv-light"] as { colors: Record<string, string> };
    const darkTheme = themes["dbv-dark"] as { colors: Record<string, string> };

    expect(lightTheme.colors["editor.background"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(lightTheme.colors["editor.selectionBackground"]).toMatch(/^#[0-9a-f]{8}$/i);
    expect(darkTheme.colors["editor.foreground"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(darkTheme.colors["editorWidget.border"]).toMatch(/^#[0-9a-f]{8}$/i);
  });
});
