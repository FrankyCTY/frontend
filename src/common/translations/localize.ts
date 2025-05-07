import type { IntlMessageFormat } from "intl-messageformat";
import type { HTMLTemplateResult } from "lit";
import { polyfillLocaleData } from "../../resources/polyfills/locale-data-polyfill";
import type { Resources, TranslationDict } from "../../types";
import { fireEvent } from "../dom/fire_event";

// Exclude some patterns from key type checking for now
// These are intended to be removed as errors are fixed
// Fixing component category will require tighter definition of types from backend and/or web socket
export type LocalizeKeys =
  | FlattenObjectKeys<Omit<TranslationDict, "supervisor">>
  | `panel.${string}`
  | `ui.card.alarm_control_panel.${string}`
  | `ui.card.weather.attributes.${string}`
  | `ui.card.weather.cardinal_direction.${string}`
  | `ui.card.lawn_mower.actions.${string}`
  | `ui.components.calendar.event.rrule.${string}`
  | `ui.components.selectors.file.${string}`
  | `ui.components.logbook.messages.detected_device_classes.${string}`
  | `ui.components.logbook.messages.cleared_device_classes.${string}`
  | `ui.dialogs.entity_registry.editor.${string}`
  | `ui.dialogs.more_info_control.lawn_mower.${string}`
  | `ui.dialogs.more_info_control.vacuum.${string}`
  | `ui.dialogs.quick-bar.commands.${string}`
  | `ui.dialogs.unhealthy.reason.${string}`
  | `ui.dialogs.unsupported.reason.${string}`
  | `ui.panel.config.${string}.${"caption" | "description"}`
  | `ui.panel.config.dashboard.${string}`
  | `ui.panel.config.zha.${string}`
  | `ui.panel.config.zwave_js.${string}`
  | `ui.panel.lovelace.card.${string}`
  | `ui.panel.lovelace.editor.${string}`
  | `ui.panel.page-authorize.form.${string}`
  | `component.${string}`;

export type LandingPageKeys = FlattenObjectKeys<
  TranslationDict["landing-page"]
>;

// Tweaked from https://www.raygesualdo.com/posts/flattening-object-keys-with-typescript-types
export type FlattenObjectKeys<
  T extends Record<string, any>,
  Key extends keyof T = keyof T,
> = Key extends string
  ? T[Key] extends Record<string, unknown>
    ? `${Key}.${FlattenObjectKeys<T[Key]>}`
    : `${Key}`
  : never;

// Later, don't return string when HTML is passed, and don't allow undefined
export type LocalizeFunc<Keys extends string = LocalizeKeys> = (
  key: Keys,
  values?: Record<
    string,
    string | number | HTMLTemplateResult | null | undefined
  >
) => string;

type FormatType = Record<string, any>;
export interface FormatsType {
  number: FormatType;
  date: FormatType;
  time: FormatType;
}

/**
 * Adapted from Polymer app-localize-behavior.
 *
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

/**
 * Optional dictionary of user defined formats, as explained here:
 * http://formatjs.io/guides/message-syntax/#custom-formats
 *
 * For example, a valid dictionary of formats would be:
 * this.formats = {
 *    number: { USD: { style: 'currency', currency: 'USD' } }
 * }
 */

/**
 * LLM: Computes a localization function for translating UI strings.
 *
 * Purpose: Creates a function that can translate keys into localized strings using IntlMessageFormat.
 *
 * Caveats & Side Effects:
 * - Clears the localization cache on each call
 * - Requires loading IntlMessageFormat and locale data
 * - Handles translation errors gracefully
 * - Caches formatted messages for performance
 *
 * Role in Scope: Core function that enables dynamic translation of UI strings with proper formatting.
 *
 * Flow when used in translation system:
 * 1. Loads IntlMessageFormat and locale data
 * 2. Clears existing cache to ensure fresh translations
 * 3. Returns a function that can translate keys with proper formatting
 * 4. Caches formatted messages for repeated use
 */
export const computeLocalize = async <Keys extends string = LocalizeKeys>(
  // USERNOTE: Hass element that will store the cache of formatted messages
  cache: HTMLElement & {
    // USERNOTE: Cache of formatter: It stores the compiled IntlMessageFormat objects that takes the ICU string and parses it.
    // Key: (key + translatedValue) | Value: IntlMessageFormat object
    _localizationCache?: Record<string, IntlMessageFormat>;
  },
  language: string,
  resources: Resources,
  formats?: FormatsType
): Promise<LocalizeFunc<Keys>> => {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { IntlMessageFormat } = await import("intl-messageformat");
  // USERNOTE: Set up polyfills Intl formatters for the language
  await polyfillLocaleData(language);

  // Every time any of the parameters change, invalidate the strings cache.
  // USERNOTE: Invalidate the cache (or create it if it doesn't exist)
  cache._localizationCache = {};

  // USERNOTE: Actual "localize" function
  return (key, ...args) => {
    // USERNOTE: Validate that we have all required parameters
    if (!key || !resources || !language || !resources[language]) {
      return "";
    }

    // Cache the key/value pairs for the same language, so that we don't
    // do extra work if we're just reusing strings across an application.
    // USERNOTE: Cache of translated value by key. Could be in ICU format for later IntlMessageFormat formatting.
    const translatedValue = resources[language][key];

    if (!translatedValue) {
      return "";
    }

    // USERNOTE: Create a unique cache key by combining the translation key and its value
    // This ensures we cache different versions of the same key if translations change
    const messageKey = key + translatedValue;
    let translatedMessage = cache._localizationCache![messageKey] as
      | IntlMessageFormat
      | undefined;

    if (!translatedMessage) {
      try {
        // USERNOTE: Create a new IntlMessageFormat instance for this translation
        // This will handle the actual formatting of the message with placeholders
        translatedMessage = new IntlMessageFormat(
          translatedValue,
          language,
          formats
        );
      } catch (err: any) {
        return "Translation error: " + err.message;
      }
      // USERNOTE: Cache the formatted message for future use for this key, and it's corresponding translated value (e.g. ICU string)
      cache._localizationCache![messageKey] = translatedMessage;
    }

    // USERNOTE: Handle different argument formats
    // Supports both object format: { name: "User" }
    // And legacy key-value pairs: "name", "User"
    let argObject = {};
    if (args.length === 1 && typeof args[0] === "object") {
      argObject = args[0];
    } else {
      for (let i = 0; i < args.length; i += 2) {
        // @ts-expect-error in some places the old format (key, value, key, value) is used
        argObject[args[i]] = args[i + 1];
      }
    }

    try {
      // USERNOTE: Format the message with the provided arguments
      // This will replace placeholders in the translation (ICU string) with actual values
      return translatedMessage.format<string>(argObject) as string;
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error("Translation error", key, language, err);
      // USERNOTE: Log the error and notify the application
      fireEvent(cache, "write_log", {
        level: "error",
        message: `Failed to format translation for key '${key}' in language '${language}'. ${err}`,
      });
      return "Translation " + err;
    }
  };
};
