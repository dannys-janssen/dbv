import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import da from './locales/da.json';
import es from './locales/es.json';
import it from './locales/it.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';

export const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'da', label: 'Dansk', flag: '🇩🇰' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'zh-CN', label: '中文', flag: '🇨🇳' },
];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
      fr: { translation: fr },
      da: { translation: da },
      es: { translation: es },
      it: { translation: it },
      ja: { translation: ja },
      'zh-CN': { translation: zhCN },
    },
    fallbackLng: 'en',
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'dbv-language',
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
