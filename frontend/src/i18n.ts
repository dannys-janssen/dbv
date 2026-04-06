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
import nl from './locales/nl.json';
import ar from './locales/ar.json';
import pt from './locales/pt.json';
import hi from './locales/hi.json';
import el from './locales/el.json';
import ko from './locales/ko.json';
import pl from './locales/pl.json';
import uk from './locales/uk.json';
import ru from './locales/ru.json';
import ur from './locales/ur.json';

export const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'da', label: 'Dansk', flag: '🇩🇰' },
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', label: 'Português', flag: '🇧🇷' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
  { code: 'el', label: 'Ελληνικά', flag: '🇬🇷' },
  { code: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'pl', label: 'Polski', flag: '🇵🇱' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'uk', label: 'Українська', flag: '🇺🇦' },
  { code: 'ur', label: 'اردو', flag: '🇵🇰' },
  { code: 'zh-CN', label: '中文', flag: '🇨🇳' },
];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en:    { translation: en },
      de:    { translation: de },
      fr:    { translation: fr },
      da:    { translation: da },
      nl:    { translation: nl },
      es:    { translation: es },
      it:    { translation: it },
      pt:    { translation: pt },
      ar:    { translation: ar },
      el:    { translation: el },
      hi:    { translation: hi },
      ja:    { translation: ja },
      ko:    { translation: ko },
      pl:    { translation: pl },
      ru:    { translation: ru },
      uk:    { translation: uk },
      ur:    { translation: ur },
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
