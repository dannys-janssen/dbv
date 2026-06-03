import { FormControl, MenuItem, Select } from "@mui/material";
import { useTranslation } from "react-i18next";
import { LANGUAGES } from "../i18n";

export function LanguageSelector() {
  const { i18n, t } = useTranslation();

  return (
    <FormControl size="small" variant="outlined" sx={{ minWidth: 120 }}>
      <Select
        value={i18n.language}
        onChange={(event) => void i18n.changeLanguage(event.target.value)}
        inputProps={{ "aria-label": t("language.label") }}
        sx={{ fontSize: 12, height: 28, backgroundColor: "background.paper" }}
      >
        {LANGUAGES.map((lang) => (
          <MenuItem key={lang.code} value={lang.code}>
            {lang.flag} {lang.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
