import { FormControl, MenuItem, Select } from "@mui/material";
import { useThemeMode } from "../context/useThemeMode";
import type { ThemeMode } from "../theme/themeMode";

export function ThemeSelector() {
  const { mode, setMode } = useThemeMode();

  return (
    <FormControl size="small" variant="outlined" sx={{ minWidth: 104 }}>
      <Select
        value={mode}
        onChange={(event) => setMode(event.target.value as ThemeMode)}
        inputProps={{ "aria-label": "Select theme" }}
        sx={{
          fontSize: 12,
          height: 28,
          backgroundColor: "background.paper",
        }}
      >
        <MenuItem value="light">Light</MenuItem>
        <MenuItem value="dark">Dark</MenuItem>
      </Select>
    </FormControl>
  );
}
