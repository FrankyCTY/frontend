import { atLeastVersion } from "../common/config/version";
import { fireEvent } from "../common/dom/fire_event";
import type { LocalizeFunc } from "../common/translations/localize";
import { computeLocalize } from "../common/translations/localize";
import {
  computeRTLDirection,
  setDirectionStyles,
} from "../common/util/compute_rtl";
import { debounce } from "../common/util/debounce";
import type {
  DateFormat,
  FirstWeekday,
  NumberFormat,
  TimeFormat,
  TimeZone,
  TranslationCategory,
} from "../data/translation";
import {
  getHassTranslations,
  getHassTranslationsPre109,
  saveTranslationPreferences,
  subscribeTranslationPreferences,
} from "../data/translation";
import { translationMetadata } from "../resources/translations-metadata";
import type { Constructor, HomeAssistant } from "../types";
import {
  getLocalLanguage,
  getTranslation,
  getUserLocale,
} from "../util/common-translation";
import { storeState } from "../util/ha-pref-storage";
import type { HassBaseEl } from "./hass-base-mixin";

/**
 * LLM: Event interface for translation-related DOM events.
 *
 * Purpose: Defines the structure of events that can be fired to update translation preferences.
 *
 * Caveats & Side Effects:
 * - Used for language, number format, time format, date format, time zone, and first weekday selection
 * - Events trigger updates to both frontend and backend
 *
 * Role in Scope: Provides type safety for translation-related events.
 */
declare global {
  // for fire event
  interface HASSDomEvents {
    "hass-language-select": {
      language: string;
    };
    "hass-number-format-select": {
      number_format: NumberFormat;
    };
    "hass-time-format-select": {
      time_format: TimeFormat;
    };
    "hass-date-format-select": {
      date_format: DateFormat;
    };
    "hass-time-zone-select": {
      time_zone: TimeZone;
    };
    "hass-first-weekday-select": {
      first_weekday: FirstWeekday;
    };
    "translations-updated": undefined;
  }
}

/**
 * LLM: Interface for tracking loaded translation categories.
 *
 * Purpose: Maintains state about which translations have been loaded for each category.
 *
 * Caveats & Side Effects:
 * - Tracks individual integrations loaded for each category
 * - Tracks whether setup translations are loaded
 * - Tracks whether config flow translations are loaded
 *
 * Role in Scope: Prevents duplicate loading of translations and manages translation state.
 */
interface LoadedTranslationCategory {
  // individual integrations loaded for this category
  integrations: string[];
  // if integrations that have been set up for this category are loaded
  setup: boolean;
  // if config flow translations are loaded
  configFlow: boolean;
}

let updateResourcesIteration = 0;

/**
 * LLM: Mixin that provides translation functionality to Home Assistant elements.
 *
 * Purpose: Manages loading and applying translations for the Home Assistant frontend.
 *
 * Caveats & Side Effects:
 * - Requires superClass to have `this.hass` and `this._updateHass`
 * - Manages translation loading and caching
 * - Handles language and locale preferences
 *
 * Role in Scope: Provides translation support to all Home Assistant elements.
 */
export default <T extends Constructor<HassBaseEl>>(superClass: T) =>
  class extends superClass {
    // eslint-disable-next-line: variable-name
    // USERNOTE: Tracks the core language being loaded.
    // Help avoid duplicated loading of alreadying being loaded core translations.
    private __coreProgress?: string;

    private __loadedFragmentTranslations = new Set<string>();

    private __loadedTranslations: Record<string, LoadedTranslationCategory> =
      {};

    /**
     * LLM: Initializes translation event listeners and loads core translations.
     *
     * Purpose: Sets up translation-related event handlers and loads initial translations.
     *
     * Caveats & Side Effects:
     * - Registers event listeners for all translation preference changes
     * - Loads core translations for the local language
     *
     * Role in Scope: Sets up the translation system when the element is first updated.
     */
    protected firstUpdated(changedProps) {
      super.firstUpdated(changedProps);
      this.addEventListener("hass-language-select", (e) => {
        this._selectLanguage((e as CustomEvent).detail, true);
      });
      this.addEventListener("hass-number-format-select", (e) => {
        this._selectNumberFormat((e as CustomEvent).detail, true);
      });
      this.addEventListener("hass-time-format-select", (e) => {
        this._selectTimeFormat((e as CustomEvent).detail, true);
      });
      this.addEventListener("hass-date-format-select", (e) => {
        this._selectDateFormat((e as CustomEvent).detail, true);
      });
      this.addEventListener("hass-time-zone-select", (e) => {
        this._selectTimeZone((e as CustomEvent).detail, true);
      });
      this.addEventListener("hass-first-weekday-select", (e) => {
        this._selectFirstWeekday((e as CustomEvent).detail, true);
      });
      this._loadCoreTranslations(getLocalLanguage());
    }

    /**
     * LLM: Handles updates to the hass object and loads fragment translations.
     *
     * Purpose: Loads panel-specific translations when the panels change.
     *
     * Caveats & Side Effects:
     * - Only processes changes to the hass object
     * - Loads fragment translations for the current panel
     *
     * Role in Scope: Ensures panel-specific translations are loaded when needed.
     */
    protected updated(changedProps) {
      super.updated(changedProps);
      if (!changedProps.has("hass")) {
        return;
      }
      const oldHass = changedProps.get("hass") as HomeAssistant | undefined;
      if (
        this.hass?.panels &&
        (!oldHass || oldHass.panels !== this.hass.panels)
      ) {
        this._loadFragmentTranslations(this.hass.language, this.hass.panelUrl);
      }
    }

    /**
     * LLM: Sets up translation-related functionality when the WebSocket connection is established.
     *
     * Purpose: Initializes translations and sets up event listeners for component loading.
     *
     * Caveats & Side Effects:
     * - Loads user locale preferences
     * - Sets up component loading event listener
     * - Applies initial translations
     *
     * Role in Scope: Completes translation setup after WebSocket connection is established.
     */
    protected hassConnected() {
      super.hassConnected();

      subscribeTranslationPreferences(this.hass!, async ({ value }) => {
        const locale = await getUserLocale(value);

        if (locale?.language && this.hass!.language !== locale.language) {
          // We just got language from backend, no need to save back
          this._selectLanguage(locale.language, false);
        }
        if (
          locale?.number_format &&
          this.hass!.locale.number_format !== locale.number_format
        ) {
          // We just got number_format from backend, no need to save back
          this._selectNumberFormat(locale.number_format, false);
        }
        if (
          locale?.time_format &&
          this.hass!.locale.time_format !== locale.time_format
        ) {
          // We just got time_format from backend, no need to save back
          this._selectTimeFormat(locale.time_format, false);
        }
        if (
          locale?.date_format &&
          this.hass!.locale.date_format !== locale.date_format
        ) {
          // We just got date_format from backend, no need to save back
          this._selectDateFormat(locale.date_format, false);
        }
        if (
          locale?.time_zone &&
          this.hass!.locale.time_zone !== locale.time_zone
        ) {
          // We just got time_zone from backend, no need to save back
          this._selectTimeZone(locale.time_zone, false);
        }
        if (
          locale?.first_weekday &&
          this.hass!.locale.first_weekday !== locale.first_weekday
        ) {
          // We just got first_weekday from backend, no need to save back
          this._selectFirstWeekday(locale.first_weekday, false);
        }
      });

      this.hass!.connection.subscribeEvents(
        debounce(() => {
          this._refetchCachedHassTranslations(false, false);
        }, 500),
        "component_loaded"
      );
      this._applyTranslations(this.hass!);
    }

    /**
     * LLM: Handles reconnection to the WebSocket server.
     *
     * Purpose: Refreshes translations and reapplies them after reconnection.
     *
     * Caveats & Side Effects:
     * - Refetches cached translations
     * - Reapplies translations to the UI
     *
     * Role in Scope: Ensures translations are up to date after reconnection.
     */
    protected hassReconnected() {
      super.hassReconnected();
      this._refetchCachedHassTranslations(true, false);
      this._applyTranslations(this.hass!);
    }

    /**
     * LLM: Handles panel URL changes and loads associated translations.
     *
     * Purpose: Loads translations specific to the new panel when the user navigates.
     *
     * Caveats & Side Effects:
     * - May be triggered before hassConnected
     * - Loads fragment translations for the new panel
     * - Clears and reloads translations for the new panel
     *
     * Role in Scope: Ensures panel-specific translations are loaded when navigating between panels.
     */
    protected panelUrlChanged(newPanelUrl: string) {
      super.panelUrlChanged(newPanelUrl);
      // this may be triggered before hassConnected
      // USERNOTE: Loads & Updates translation resources and computes new localization function for the new panel.
      this._loadFragmentTranslations(
        this.hass ? this.hass.language : getLocalLanguage(),
        newPanelUrl
      );
    }

    private _selectNumberFormat(
      number_format: NumberFormat,
      saveToBackend: boolean
    ) {
      this._updateHass({
        locale: { ...this.hass!.locale, number_format: number_format },
      });
      if (saveToBackend) {
        saveTranslationPreferences(this.hass!, this.hass!.locale);
      }
    }

    private _selectTimeFormat(time_format: TimeFormat, saveToBackend: boolean) {
      this._updateHass({
        locale: { ...this.hass!.locale, time_format: time_format },
      });
      if (saveToBackend) {
        saveTranslationPreferences(this.hass!, this.hass!.locale);
      }
    }

    private _selectDateFormat(date_format: DateFormat, saveToBackend: boolean) {
      this._updateHass({
        locale: {
          ...this.hass!.locale,
          date_format: date_format,
        },
      });
      if (saveToBackend) {
        saveTranslationPreferences(this.hass!, this.hass!.locale);
      }
    }

    private _selectTimeZone(time_zone: TimeZone, saveToBackend: boolean) {
      this._updateHass({
        locale: { ...this.hass!.locale, time_zone },
      });
      if (saveToBackend) {
        saveTranslationPreferences(this.hass!, this.hass!.locale);
      }
    }

    private _selectFirstWeekday(
      first_weekday: FirstWeekday,
      saveToBackend: boolean
    ) {
      this._updateHass({
        locale: { ...this.hass!.locale, first_weekday: first_weekday },
      });
      if (saveToBackend) {
        saveTranslationPreferences(this.hass!, this.hass!.locale);
      }
    }

    private _selectLanguage(language: string, saveToBackend: boolean) {
      if (!this.hass) {
        // should not happen, do it to avoid use this.hass!
        return;
      }

      // update selectedLanguage so that it can be saved to local storage
      this._updateHass({
        locale: { ...this.hass!.locale, language: language },
        language: language,
        selectedLanguage: language,
      });
      storeState(this.hass);
      if (saveToBackend) {
        saveTranslationPreferences(this.hass, this.hass.locale);
      }
      this._applyTranslations(this.hass);
      this._refetchCachedHassTranslations(true, true);
    }

    private _applyTranslations(hass: HomeAssistant) {
      document.querySelector("html")!.setAttribute("lang", hass.language);
      this._applyDirection(hass);
      this._loadCoreTranslations(hass.language);
      this.__loadedFragmentTranslations = new Set();
      this._loadFragmentTranslations(hass.language, hass.panelUrl);
    }

    private _applyDirection(hass: HomeAssistant) {
      const direction = computeRTLDirection(hass);
      setDirectionStyles(direction, this);
    }

    /**
     * Load translations from the backend
     * @param language language to fetch
     * @param category category to fetch
     * @param integration optional, if having to fetch for specific integration
     * @param configFlow optional, if having to fetch for all integrations with a config flow
     * @param force optional, load even if already cached
     */
    /**
     * LLM: Core translation loading function that manages fetching and caching of translations
     *
     * Purpose:
     * - Fetches translations from backend for specified category and optional integrations
     * - Manages translation caching to prevent duplicate loading
     * - Handles backwards compatibility for older Home Assistant versions
     * - Supports both single and multiple integration translations
     *
     * Caveats & Side Effects:
     * - Requires hass connection to be established
     * - May return early if translations are already cached
     * - Handles race conditions with language changes
     * - May trigger UI updates through _updateResources
     *
     * Role in Scope:
     * - Central translation loading mechanism for the frontend
     * - Integrates with backend translation system
     * - Manages translation lifecycle and caching
     * - Supports both core and integration-specific translations
     */
    private async _loadHassTranslations(
      language: string,
      category: Parameters<typeof getHassTranslations>[2],
      integration?: Parameters<typeof getHassTranslations>[3],
      configFlow?: Parameters<typeof getHassTranslations>[4],
      force = false
    ): Promise<LocalizeFunc> {
      // LLM: Backward compatibility check for older Home Assistant versions
      // This ensures the system works with older versions that don't support the new translation system
      if (
        __BACKWARDS_COMPAT__ &&
        !atLeastVersion(this.hass!.connection.haVersion, 0, 109)
      ) {
        // LLM: For older versions, only state category is supported
        // This is a limitation of the legacy translation system
        if (category !== "state") {
          return this.hass!.localize;
        }
        // LLM: Use legacy translation loading method for older versions
        // This ensures compatibility with pre-0.109 versions
        const resources = await getHassTranslationsPre109(this.hass!, language);

        // LLM: Race condition check - ignore response if language changed during fetch
        // This prevents applying outdated translations if user changed language during the async operation
        if (this.hass!.language !== language) {
          return this.hass!.localize;
        }

        return this._updateResources(language, resources);
      }

      // LLM: Get or create cache entry for this translation category
      // This prevents duplicate loading of the same translations
      let alreadyLoaded: LoadedTranslationCategory;

      // LLM: Check if category exists in cache, create new entry if not
      // This ensures we have a valid cache entry for tracking loaded translations
      if (category in this.__loadedTranslations) {
        alreadyLoaded = this.__loadedTranslations[category];
      } else {
        alreadyLoaded = this.__loadedTranslations[category] = {
          integrations: [],
          setup: false,
          configFlow: false,
        };
      }

      let integrationsToLoad: string[] = [];

      // LLM: Skip cache check if force=true, otherwise check if translations are already loaded
      // This allows forcing a refresh of translations when needed
      if (!force) {
        // LLM: Handle array of integrations - filter out already loaded ones
        // This prevents duplicate loading of the same integration translations
        if (integration && Array.isArray(integration)) {
          integrationsToLoad = integration.filter(
            (i) => !alreadyLoaded.integrations.includes(i)
          );
          // LLM: Return early if all integrations are already loaded
          // This optimizes performance by avoiding unnecessary network requests
          if (!integrationsToLoad.length) {
            return this.hass!.localize;
          }
        } else if (integration) {
          // LLM: Single integration case - check if already loaded
          // This handles the simpler case of loading a single integration's translations
          if (alreadyLoaded.integrations.includes(integration)) {
            return this.hass!.localize;
          }
          integrationsToLoad = [integration];
        } else if (
          // LLM: No specific integration - check if requested setup/configFlow already loaded
          // This handles the case of loading general setup or config flow translations
          configFlow ? alreadyLoaded.configFlow : alreadyLoaded.setup
        ) {
          return this.hass!.localize;
        }
      }

      // LLM: Update cache with new translations to be loaded
      // This ensures we don't try to load the same translations again
      if (integrationsToLoad.length) {
        // LLM: Add new integrations to cache to prevent future duplicate loading
        // This maintains the cache state for future translation requests
        alreadyLoaded.integrations.push(...integrationsToLoad);
      } else {
        // LLM: Mark integrations (setup flag) & configFlow as loaded in cache
        // This tracks the loading state of general translations
        alreadyLoaded.setup = true;
        if (configFlow) {
          alreadyLoaded.configFlow = true;
        }
      }

      // LLM: Fetch translations from backend with current parameters
      // This is the actual network request to get the translations
      const resources = await getHassTranslations(
        this.hass!,
        language,
        category,
        integrationsToLoad.length ? integrationsToLoad : undefined,
        configFlow
      );

      // LLM: Race condition check - ignore response if language changed during fetch
      // This prevents applying outdated translations if user changed language during the async operation
      // USERNOTE: As something might have invoked _updateResources() already.
      if (this.hass!.language !== language) {
        return this.hass!.localize;
      }

      // LLM: Merge new translations with existing ones and update UI
      // This ensures all translations are properly combined and applied
      return this._updateResources(language, resources);
    }

    /**
     * LLM: Loads translations for a specific panel fragment.
     *
     * Purpose: Fetches and applies translations specific to a panel's UI elements.
     *
     * Caveats & Side Effects:
     * - Returns undefined if panelUrl is empty
     * - Checks if translations are already loaded to avoid duplicates
     * - Updates resources with new translations
     *
     * Role in Scope: Manages panel-specific translation loading and caching.
     *
     * Flow for /config panel:
     * 1. Checks if panelUrl is valid
     * 2. Gets panel component name from hass.panels
     * 3. Verifies if panel is in translationMetadata.fragments
     * 4. If already loaded, returns existing localize function
     * 5. Otherwise loads new translations and updates resources
     */
    private async _loadFragmentTranslations(
      language: string,
      panelUrl: string
    ) {
      if (!panelUrl) {
        return undefined;
      }

      // LLM: Get the component name for the config panel from hass.panels
      const panelComponent = this.hass?.panels?.[panelUrl]?.component_name;

      // If it's the first call we don't have panel info yet to check the component.
      // USERNOTE: Checks if this panel/component is listed in translationMetadata.fragments.
      // If so, considers it a valid fragment to load.
      const fragment = translationMetadata.fragments.includes(
        panelComponent || panelUrl
      )
        ? panelComponent || panelUrl
        : undefined;

      if (!fragment) {
        return undefined;
      }

      // LLM: Check if we already loaded translations for this fragment to avoid duplicate loading
      if (this.__loadedFragmentTranslations.has(fragment)) {
        // USERNOTE: If we already loaded translations for this fragment, return the existing localize function to avoid unnecessary reloading.
        return this.hass!.localize;
      }
      // USERNOTE: Marks the fragment as loaded.
      this.__loadedFragmentTranslations.add(fragment);
      // USERNOTE: Fetch the translation data for the fragment and language.
      const result = await getTranslation(fragment, language);
      return this._updateResources(language, result.data);
    }

    private async _loadCoreTranslations(language: string) {
      // Check if already in progress
      // Necessary as we call this in firstUpdated and hassConnected
      if (this.__coreProgress === language) {
        return;
      }
      this.__coreProgress = language;
      try {
        const result = await getTranslation(null, language);
        // USERNOTE: Updates translation resources and computes new localization function.
        await this._updateResources(language, result.data);
      } finally {
        this.__coreProgress = undefined;
      }
    }

    /**
     * LLM: Updates translation resources and computes new localization function.
     *
     * Purpose: Merges new translations with existing ones and updates the UI.
     *
     * Caveats & Side Effects:
     * - Increments updateResourcesIteration to track changes
     * - Merges new translations with existing ones
     * - Updates HTML lang attribute
     * - Fires translations-updated event
     * - Handles race conditions with pending hass state
     *
     * Role in Scope: Manages the merging and application of new translations.
     *
     * Flow for config panel translations:
     * 1. Increments iteration counter to track updates
     * 2. Merges new config panel translations with existing ones
     * 3. Updates hass resources with merged translations
     * 4. Computes new localize function
     * 5. Updates hass with new localize function
     * 6. Fires event to notify components of translation updates
     */
    private async _updateResources(
      language: string,
      data: any
    ): Promise<LocalizeFunc> {
      // LLM: Track update iterations to handle race conditions
      updateResourcesIteration++;
      const i = updateResourcesIteration;

      // Update the language in hass, and update the resources with the newly
      // loaded resources. This merges the new data on top of the old data for
      // this language, so that the full translation set can be loaded across
      // multiple fragments.
      //
      // Beware of a subtle race condition: it is possible to get here twice
      // before this.hass is even created. In this case our base state comes
      // from this._pendingHass instead. Otherwise the first set of strings is
      // overwritten when we call _updateHass the second time!

      // Allow hass to be updated

      // USERNOTE: This delay allows any pending hass updates to complete before we proceed
      // This is crucial because we might be in a race condition where hass is being updated
      // while we're trying to update translations
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });

      // LLM: Check if language changed during the delay
      if (language !== (this.hass ?? this._pendingHass).language) {
        // the language was changed, abort
        // USERNOTE: If language changed, abort to prevent applying outdated translations
        return (this.hass ?? this._pendingHass).localize!;
      }

      // LLM: Merge new translations with existing ones
      const resources = {
        [language]: {
          ...(this.hass ?? this._pendingHass)?.resources?.[language],
          ...data,
        },
      };

      // Update resources immediately, so when a new update comes in we don't miss values
      // USERNOTE: Update resources immediately to prevent missing values in subsequent updates
      // This ensures that even if multiple updates happen in quick succession,
      // we don't lose any translation data
      this._updateHass({ resources });

      // LLM: Compute new localization function with merged resources
      const localize = await computeLocalize(this, language, resources);

      // USERNOTE: Check if we're still in the same update iteration and language
      // This prevents applying stale translations if multiple updates happened
      // USERNOTE: Especially we have suspension point (await) in the _updateResources function, meaning it could be paused and another concurrent _updateResources could be called.
      if (
        updateResourcesIteration !== i ||
        language !== (this.hass ?? this._pendingHass).language
      ) {
        // if a new iteration has started or the language changed, abort
        return localize;
      }

      // LLM: Update hass with new localization function
      this._updateHass({
        localize,
      });

      // USERNOTE: Notify all components that translations have been updated
      // This allows components to re-render with new translations
      fireEvent(this, "translations-updated");

      return localize;
    }

    private _refetchCachedHassTranslations(
      includeConfigFlow: boolean,
      clearIntegrations: boolean
    ) {
      for (const [category, cache] of Object.entries(
        this.__loadedTranslations
      )) {
        if (clearIntegrations) {
          cache.integrations = [];
        }
        if (cache.setup) {
          this._loadHassTranslations(
            this.hass!.language,
            category as TranslationCategory,
            undefined,
            includeConfigFlow && cache.configFlow,
            true
          );
        }
      }
    }
  };

// Load selected translation into memory immediately so it is ready when the app
// initializes.
getTranslation(null, getLocalLanguage());
