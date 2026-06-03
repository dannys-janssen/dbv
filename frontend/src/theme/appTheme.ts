import { createTheme } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";
import type { ThemeMode } from "./themeMode";

export const APP_THEMES: Record<ThemeMode, Theme> = {
  light: createTheme({
    palette: {
      mode: "light",
      primary: { main: "#1976d2" },
      secondary: { main: "#7b1fa2" },
      background: { default: "#f5f7fa", paper: "#ffffff" },
    },
    shape: { borderRadius: 10 },
  }),
  dark: createTheme({
    palette: {
      mode: "dark",
      primary: { main: "#90caf9" },
      secondary: { main: "#ce93d8" },
      background: { default: "#101828", paper: "#1e293b" },
    },
    shape: { borderRadius: 10 },
  }),
};
