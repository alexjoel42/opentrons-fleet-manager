import i18n from 'i18next';
import HttpBackend from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LANGUAGES = ['en', 'zh-CN'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const LANGUAGE_STORAGE_KEY = 'opentrons-fleet-language';

function savedLanguage(): SupportedLanguage {
  const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return saved === 'zh-CN' ? 'zh-CN' : 'en';
}

function applyDocumentLanguage(language: string) {
  document.documentElement.lang = language === 'zh-CN' ? 'zh-CN' : 'en';
}

void i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    lng: savedLanguage(),
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    load: 'currentOnly',
    backend: {
      loadPath: `${import.meta.env.BASE_URL}locales/{{lng}}.json`,
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: true,
    },
  });

applyDocumentLanguage(i18n.language);
i18n.on('languageChanged', (language) => {
  const supported: SupportedLanguage = language === 'zh-CN' ? 'zh-CN' : 'en';
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, supported);
  applyDocumentLanguage(supported);
});

export default i18n;
