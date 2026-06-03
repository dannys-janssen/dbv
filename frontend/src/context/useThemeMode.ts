import { useContext } from "react";
import { ThemeModeContext } from "./ThemeModeContext";

export const useThemeMode = () => useContext(ThemeModeContext);
