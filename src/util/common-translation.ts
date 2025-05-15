import type { FrontendLocaleData } from "../data/translation";
import { translationMetadata } from "../resources/translations-metadata";

const BASE_URL = `${__STATIC_PATH__}translations`;
const STORAGE = window.localStorage || {};

// Store loaded translations in memory so translations are available immediately
// when DOM is created. Even a cache lookup creates noticeable latency.
// USERNOTE: Even if translation data were stored in a browser cache (like IndexedDB, localStorage, or disk cache from network), retrieving it:
// - Requires async calls.
// - May cause a frame delay or reflow.
// - Can delay critical DOM rendering (especially first-paint UX).
// USERNOTE: This is a promise cache, and any consumer can await this promise to get the translation data by fingerprint (key of fragment).
// - In JS, Promises remember their resolved value and do not re-execute.
const translations = {};

async function fetchTranslation(fingerprint: string) {
  // USERNOTE: Fetch translation from the server
  // Path: /static/translations/{fingerprint} -> http://localhost:8123/static/translations/config/en-GB-dev.json
  const response = await fetch(`${BASE_URL}/${fingerprint}`, {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(
      `Fail to fetch translation ${fingerprint}: HTTP response status is ${response.status}`
    );
  }
  return response.json();
}

// Chinese locales need map to Simplified or Traditional Chinese
const LOCALE_LOOKUP = {
  "zh-cn": "zh-Hans",
  "zh-sg": "zh-Hans",
  "zh-my": "zh-Hans",
  "zh-tw": "zh-Hant",
  "zh-hk": "zh-Hant",
  "zh-mo": "zh-Hant",
  zh: "zh-Hant", // all other Chinese locales map to Traditional Chinese
};

/**
 * Search for a matching translation from most specific to general
 */
export function findAvailableLanguage(language: string) {
  // In most case, the language has the same format with our translation meta data
  if (language in translationMetadata.translations) {
    return language;
  }

  // Perform case-insensitive comparison since browser isn't required to
  // report languages with specific cases.
  const langLower = language.toLowerCase();

  if (langLower in LOCALE_LOOKUP) {
    return LOCALE_LOOKUP[langLower];
  }

  const translation = Object.keys(translationMetadata.translations).find(
    (lang) => lang.toLowerCase() === langLower
  );
  if (translation) {
    return translation;
  }

  if (language.includes("-")) {
    return findAvailableLanguage(language.split("-")[0]);
  }

  return undefined;
}

/**
 * Get user selected locale data from backend
 */
export async function getUserLocale(
  data: FrontendLocaleData | null
): Promise<Partial<FrontendLocaleData>> {
  const language = data?.language;
  const number_format = data?.number_format;
  const time_format = data?.time_format;
  const date_format = data?.date_format;
  const time_zone = data?.time_zone;
  const first_weekday = data?.first_weekday;
  if (language) {
    const availableLanguage = findAvailableLanguage(language);
    if (availableLanguage) {
      return {
        language: availableLanguage,
        number_format,
        time_format,
        date_format,
        time_zone,
        first_weekday,
      };
    }
  }
  return {
    number_format,
    time_format,
    date_format,
    time_zone,
    first_weekday,
  };
}

/**
 * Get browser specific language
 */
export function getLocalLanguage() {
  let language = null;
  if (STORAGE.selectedLanguage) {
    try {
      const stored = JSON.parse(STORAGE.selectedLanguage);
      if (stored) {
        language = findAvailableLanguage(stored);
        if (language) {
          return language;
        }
      }
    } catch (_err: any) {
      // Ignore parsing error.
    }
  }
  if (navigator.languages) {
    for (const locale of navigator.languages) {
      language = findAvailableLanguage(locale);
      if (language) {
        return language;
      }
    }
  }
  language = findAvailableLanguage(navigator.language);
  if (language) {
    return language;
  }
  // Final fallback
  return "en";
}

/**
 * LLM: Fetches translations for a specific fragment and language.
 *
 * Purpose: Loads translation data from the server for a specific UI fragment and language.
 *
 * Caveats & Side Effects:
 * - Caches translations in memory to avoid repeated fetches
 * - Falls back to English if requested language is not available
 * - Throws error if language not found in metadata and no fallback available
 * - Maintains in-memory cache of loaded translations
 *
 * Role in Scope: Core function for loading and caching translations, used by the translation mixin.
 *
 * Flow when loading config panel translations:
 * 1. Checks if language exists in translation metadata
 * 2. Constructs fingerprint for translation file
 * 3. Checks memory cache for existing translation
 * 4. If not cached, fetches from server
 * 5. Falls back to English if needed
 * 6. Returns promise with translation data
 */
export async function getTranslation(
  fragment: string | null,
  language: string,
  fallback = true
) {
  // LLM: Check if the requested language exists in our translation metadata
  const metadata = translationMetadata.translations[language];
  if (!metadata?.hash) {
    // LLM: If language not found and fallback enabled, try English
    if (fallback && language !== "en") {
      return getTranslation(fragment, "en");
    }
    throw new Error(`Language '${language}' is not found in metadata`);
  }

  // nl-abcd.jon or logbook/nl-abcd.json
  // LLM: Construct the fingerprint for the translation file
  // Format: fragment/language-hash.json or language-hash.json
  // Example: config/en-GB-dev.json
  const fingerprint = `${fragment ? fragment + "/" : ""}${language}-${
    metadata.hash
  }.json`;

  // Fetch translation from the server
  // LLM: Check memory cache first to avoid unnecessary server requests
  if (!translations[fingerprint]) {
    // LLM: If not in cache, fetch from server and store in cache
    // USERNOTE: Assign promise to cache to avoid duplicate fetches. The promise will be resolved, and consumer can await this promise to get the translation data.
    translations[fingerprint] = fetchTranslation(fingerprint)
      .then((data) => ({ language, data }))
      .catch((error) => {
        // LLM: Remove failed translation from cache
        delete translations[fingerprint];
        if (language !== "en") {
          // Couldn't load selected translation. Try a fall back to en before failing.
          // LLM: If fetch failed and not already trying English, fall back to English
          return getTranslation(fragment, "en");
        }
        return Promise.reject(error);
      });
  }
  // USERNOTE: Return the cached promise for consumer to await to get the translation data.
  // - In JS, Promises remember their resolved value and do not re-execute.
  return translations[fingerprint];
}
