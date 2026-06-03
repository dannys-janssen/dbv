import { createTheme } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";
import type { ThemeMode } from "./themeMode";

export const APP_THEMES: Record<ThemeMode, Theme> = {
  light: createTheme({
    palette: {
      mode: "light",
      primary: { main: "hsl(210, 98%, 48%)" },
      secondary: { main: "hsl(220, 20%, 42%)" },
      background: { default: "hsl(0, 0%, 99%)", paper: "hsl(220, 35%, 97%)" },
      text: { primary: "hsl(220, 30%, 6%)", secondary: "hsl(220, 20%, 35%)" },
      divider: "hsla(220, 20%, 80%, 0.4)",
    },
    shape: { borderRadius: 8 },
  }),
  dark: createTheme({
    palette: {
      mode: "dark",
      primary: { main: "hsl(210, 98%, 48%)" },
      secondary: { main: "hsl(220, 20%, 65%)" },
      background: { default: "hsl(220, 35%, 3%)", paper: "hsl(220, 30%, 7%)" },
      text: { primary: "hsl(0, 0%, 100%)", secondary: "hsl(220, 20%, 65%)" },
      divider: "hsla(220, 20%, 35%, 0.6)",
    },
    shape: { borderRadius: 8 },
  }),
};
