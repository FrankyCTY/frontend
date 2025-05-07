/**
 * LLM: Loads locale-specific data for internationalization features.
 *
 * Purpose: Ensures proper formatting of dates, numbers, and other locale-sensitive data.
 *
 * Caveats & Side Effects:
 * - Only loads data once per language
 * - Requires polyfilled Intl constructors
 * - Loads data asynchronously from static files
 * - Handles missing locale data gracefully
 *
 * Role in Scope: Provides necessary locale data for proper formatting in translations.
 *
 * Flow when used in translation system:
 * 1. Checks if locale data is already loaded
 * 2. Loads data for each Intl constructor
 * 3. Adds data to Intl constructors if polyfilled
 * 4. Caches loaded locales to prevent duplicate loading
 */

// Loads the static locale data for a given language from FormatJS
// Parents need to load polyfills first; they are not imported here to avoid a circular reference

// USERNOTE: List of Intl constructors that need locale data
// These are the features that require locale-specific formatting rules
const INTL_POLYFILLS = [
  "DateTimeFormat", // For date/time formatting
  "DisplayNames", // For localized names of languages, regions, etc.
  "ListFormat", // For formatting lists (e.g., "a, b, and c")
  "NumberFormat", // For number formatting (decimal, currency, etc.)
  "RelativeTimeFormat", // For relative time (e.g., "2 days ago")
] as const satisfies readonly (keyof typeof Intl)[];

// USERNOTE: Track which locales we've already loaded to avoid duplicate loading
const loadedLocales = new Set<string>();

/**
 * LLM: Adds locale data to a specific Intl constructor.
 *
 * Purpose: Loads and applies locale data for a specific formatting feature.
 *
 * Caveats & Side Effects:
 * - Only works if constructor is polyfilled
 * - Silently ignores missing locale data
 * - Loads data asynchronously
 *
 * Role in Scope: Helper function for loading locale data for individual Intl features.
 */
const addData = async (
  obj: (typeof INTL_POLYFILLS)[number],
  language: string,
  // USERNOTE: __addLocalData is a non-standard method added by polyfill libraries (like @formatjs/intl-displaynames) to let you dynamically inject locale-specific formatting rules into the polyfilled Intl constructor.
  // USERNOTE: Example: Intl.DisplayNames.__addLocaleData(require("./displaynames-en_GB.json"));
  addFunc = "__addLocaleData"
) => {
  // Add function will only exist if constructor is polyfilled
  // USERNOTE: Check if the Intl constructor is polyfilled and has the add function
  if (typeof (Intl[obj] as any)?.[addFunc] === "function") {
    // USERNOTE: Fetch locale data from static files
    // Example: http://localhost:8123/static/locale-data/intl-datetimeformat/en.json
    const result = await fetch(
      `${__STATIC_PATH__}locale-data/intl-${obj.toLowerCase()}/${language}.json`
    );
    // Ignore if polyfill data does not exist for language
    // USERNOTE: Only add data if the file exists
    if (result.ok) {
      // USERNOTE: Calling __addLocaleData(...) on a polyfilled Intl constructor modifies or enhances its internal behavior by injecting locale-specific rules,
      (Intl[obj] as any)[addFunc](await result.json());
    }
  }
};

/**
 * LLM: Loads all necessary locale data for a language.
 *
 * Purpose: Ensures all Intl features have proper locale data for formatting.
 *
 * Caveats & Side Effects:
 * - Only loads data once per language
 * - Loads data for all Intl features in parallel
 * - Caches loaded locales
 *
 * Role in Scope: Main function for loading complete locale data set.
 */
export const polyfillLocaleData = async (language: string) => {
  // USERNOTE: Skip if we've already loaded this locale
  if (loadedLocales.has(language)) {
    return;
  }
  // USERNOTE: Add the locale to the set of loaded locales
  loadedLocales.add(language);
  // USERNOTE: Load data for all Intl features in parallel
  await Promise.all(INTL_POLYFILLS.map((obj) => addData(obj, language)));
};

/**
 * LLM: Loads timezone data for date formatting.
 *
 * Purpose: Ensures proper timezone handling in date formatting.
 *
 * Caveats & Side Effects:
 * - Only works with DateTimeFormat
 * - Loads all timezone data at once
 *
 * Role in Scope: Specialized function for timezone data loading.
 */
export const polyfillTimeZoneData = () =>
  addData("DateTimeFormat", "add-all-tz", "__addTZData");
