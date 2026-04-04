import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../i18n';

const FONT = "'Inter', 'Segoe UI', sans-serif";

export function LanguageSelector() {
  const { i18n } = useTranslation();

  return (
    <select
      value={i18n.language}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
      style={{
        background: '#1e293b',
        color: '#94a3b8',
        border: '1px solid #334155',
        borderRadius: 4,
        padding: '2px 6px',
        fontSize: 13,
        fontFamily: FONT,
        cursor: 'pointer',
      }}
      aria-label="Select language"
    >
      {LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.flag} {lang.label}
        </option>
      ))}
    </select>
  );
}
