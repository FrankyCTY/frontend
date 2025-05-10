import type { ActionDetail } from "@material/mwc-list";
import { mdiFilterVariant, mdiPlus } from "@mdi/js";
import type { IFuseOptions } from "fuse.js";
import Fuse from "fuse.js";
import type { UnsubscribeFunc } from "home-assistant-js-websocket";
import type { CSSResultGroup, PropertyValues } from "lit";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators";
import { ifDefined } from "lit/directives/if-defined";
import memoizeOne from "memoize-one";
import { isComponentLoaded } from "../../../common/config/is_component_loaded";
import {
  PROTOCOL_INTEGRATIONS,
  protocolIntegrationPicked,
} from "../../../common/integrations/protocolIntegrationPicked";
import { navigate } from "../../../common/navigate";
import { caseInsensitiveStringCompare } from "../../../common/string/compare";
import { extractSearchParam } from "../../../common/url/search-params";
import { nextRender } from "../../../common/util/render-status";
import "../../../components/ha-button-menu";
import "../../../components/ha-check-list-item";
import "../../../components/ha-checkbox";
import "../../../components/ha-fab";
import "../../../components/ha-icon-button";
import "../../../components/ha-svg-icon";
import "../../../components/search-input";
import "../../../components/search-input-outlined";
import type { ConfigEntry } from "../../../data/config_entries";
import { getConfigEntries } from "../../../data/config_entries";
import { fetchDiagnosticHandlers } from "../../../data/diagnostics";
import type { EntityRegistryEntry } from "../../../data/entity_registry";
import { subscribeEntityRegistry } from "../../../data/entity_registry";
import { fetchEntitySourcesWithCache } from "../../../data/entity_sources";
import type {
  IntegrationLogInfo,
  IntegrationManifest,
} from "../../../data/integration";
import {
  domainToName,
  fetchIntegrationManifest,
  fetchIntegrationManifests,
  subscribeLogInfo,
} from "../../../data/integration";
import {
  findIntegration,
  getIntegrationDescriptions,
} from "../../../data/integrations";
import { scanUSBDevices } from "../../../data/usb";
import { showConfigFlowDialog } from "../../../dialogs/config-flow/show-dialog-config-flow";
import {
  showAlertDialog,
  showConfirmationDialog,
} from "../../../dialogs/generic/show-dialog-box";
import type { ImprovDiscoveredDevice } from "../../../external_app/external_messaging";
import "../../../layouts/hass-loading-screen";
import "../../../layouts/hass-tabs-subpage";
import { KeyboardShortcutMixin } from "../../../mixins/keyboard-shortcut-mixin";
import { SubscribeMixin } from "../../../mixins/subscribe-mixin";
import { haStyle } from "../../../resources/styles";
import type { HomeAssistant, Route } from "../../../types";
import { configSections } from "../ha-panel-config";
import { isHelperDomain } from "../helpers/const";
import "./ha-config-flow-card";
import type { DataEntryFlowProgressExtended } from "./ha-config-integrations";
import "./ha-disabled-config-entry-card";
import "./ha-ignored-config-entry-card";
import "./ha-integration-card";
import type { HaIntegrationCard } from "./ha-integration-card";
import "./ha-integration-overflow-menu";
import { showAddIntegrationDialog } from "./show-add-integration-dialog";

export interface ConfigEntryExtended extends Omit<ConfigEntry, "entry_id"> {
  entry_id?: string;
  localized_domain_name?: string;
}

/**
 * LLM: Groups config entries by their integration domain.
 *
 * Purpose: Organizes configuration entries into a map where the keys are
 * integration domains and the values are arrays of config entries for that domain.
 *
 * @param entries - The configuration entries to group
 * @returns A Map with domains as keys and arrays of config entries as values
 */
const groupByIntegration = (
  entries: ConfigEntryExtended[]
): Map<string, ConfigEntryExtended[]> => {
  const result = new Map();
  entries.forEach((entry) => {
    if (result.has(entry.domain)) {
      result.get(entry.domain).push(entry);
    } else {
      result.set(entry.domain, [entry]);
    }
  });
  return result;
};

/**
 * LLM: Dashboard component for managing Home Assistant integrations.
 *
 * Purpose: Displays all configured integrations, provides UI for adding new integrations,
 * and shows integrations that are in the process of being set up. Allows filtering,
 * searching, and viewing detailed information about each integration.
 *
 * Role in Scope: Main content component for the integrations section of the Home Assistant
 * configuration UI. Handles the presentation and interaction with integration data.
 *
 * Features:
 * - Lists all configured integrations grouped by domain
 * - Shows in-progress setup flows
 * - Provides search and filtering capabilities
 * - Integration with Improv and USB device discovery
 * - Keyboard shortcuts for common actions
 *
 * Caveats & Side Effects:
 * - Makes multiple API calls to fetch integration manifests, entity sources, etc.
 * - Subscribes to entity registry and log info updates
 * - Listens for Improv device discovery events
 */
@customElement("ha-config-integrations-dashboard")
class HaConfigIntegrationsDashboard extends KeyboardShortcutMixin(
  SubscribeMixin(LitElement)
) {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ type: Boolean, reflect: true }) public narrow = false;

  @property({ attribute: "is-wide", type: Boolean }) public isWide = false;

  @property({ attribute: false }) public showAdvanced = false;

  @property({ attribute: false }) public route!: Route;

  @property({ attribute: false }) public configEntries?: ConfigEntryExtended[];

  // USERNOTE: An in-progress config flow represents a partially completed integration setup process. It could be triggered by:
  // - Automatic discovery (e.g., mDNS, DHCP, USB)
  // - User action (clicked "Add Integration")
  // - External triggers (e.g., BLE Improv detection)
  @property({ attribute: false })
  public configEntriesInProgress?: DataEntryFlowProgressExtended[];

  // USERNOTE: Track discovered Improv devices which are devices discovered via Bluetooth Improv scanning on mobile or browser.
  @state() private _improvDiscovered = new Map<
    string,
    ImprovDiscoveredDevice
  >();

  @state()
  private _entityRegistryEntries: EntityRegistryEntry[] = [];

  @state()
  private _manifests: Record<string, IntegrationManifest> = {};

  @state() private _domainEntities: Record<string, string[]> = {};

  // USERNOTE: Track which manifests have already been fetched
  private _extraFetchedManifests?: Set<string>;

  @state() private _showIgnored = false;

  @state() private _showDisabled = false;

  @state() private _searchParms = new URLSearchParams(
    window.location.hash.substring(1)
  );

  @state() private _filter: string = history.state?.filter || "";

  @state() private _diagnosticHandlers?: Record<string, boolean>;

  @state() private _logInfos?: Record<string, IntegrationLogInfo>;

  @query("search-input-outlined") private _searchInput!: HTMLElement;

  /**
   * LLM: Cleanup when component is removed from DOM.
   *
   * Removes event listeners for Improv device discovery to prevent memory leaks.
   */
  public disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener(
      "improv-discovered-device",
      this._handleImprovDiscovered
    );
    window.removeEventListener(
      "improv-device-setup-done",
      this._reScanImprovDevices
    );
  }

  /**
   * LLM: Sets up subscriptions to track entity registry entries and integration log info.
   *
   * Purpose: Keeps the component updated with the latest entity registry data and
   * integration log information, which are used to display entity counts and log
   * status for each integration.
   *
   * Returns an array of unsubscribe functions that will be called when the component
   * is unmounted.
   */
  public hassSubscribe(): (UnsubscribeFunc | Promise<UnsubscribeFunc>)[] {
    return [
      subscribeEntityRegistry(this.hass.connection, (entries) => {
        this._entityRegistryEntries = entries;
      }),
      subscribeLogInfo(this.hass.connection, (log_infos) => {
        const logInfoLookup: Record<string, IntegrationLogInfo> = {};
        for (const log_info of log_infos) {
          logInfoLookup[log_info.domain] = log_info;
        }
        this._logInfos = logInfoLookup;
      }),
    ];
  }

  /**
   * LLM: Filters and organizes config entries for display.
   *
   * Purpose: Processes all config entries to:
   * 1. Include YAML-configured integrations without config entries
   * 2. Filter entries based on search text
   * 3. Separate entries into regular, ignored, and disabled categories
   *
   * The memoizeOne wrapper ensures this expensive computation only runs when inputs change.
   *
   * @returns A tuple containing:
   * - Grouped entries by domain (for display)
   * - Ignored entries (for display in ignored section)
   * - Disabled entries (for display in disabled section)
   */
  private _filterConfigEntries = memoizeOne(
    (
      components: string[],
      manifests: Record<string, IntegrationManifest>,
      configEntries: ConfigEntryExtended[],
      entityEntries: EntityRegistryEntry[],
      localize: HomeAssistant["localize"],
      filter?: string
    ): [
      // USERNOTE: Normal config entries [ [domain, entries[]], [domain, entries[]], ... ]
      [string, ConfigEntryExtended[]][],
      // USERNOTE: Ignored config entries
      ConfigEntryExtended[],
      // USERNOTE: Disabled config entries
      ConfigEntryExtended[],
    ] => {
      // LLM: Create a set of domains that already have config entries
      const entryDomains = new Set(configEntries.map((entry) => entry.domain));

      // USERNOTE: YAML-configured integrations (Bad variable name here?)
      // Defined in YAML, which historically does not create config entries in the HA core, but we still need to create them in UI to align with latest practice
      const domains = new Set<string>();

      // USERNOTE: Classify integrations that are manually defined in YAML (no config flow), and need synthetic entries for UI representation.
      // - Loaded components that don't have config entries AND
      // - Does not require config flow AND
      // - Must be one of integration types: device, hub, service, integration
      for (const component of components) {
        const componentDomain = component.split(".")[0];
        if (
          // Exclude if the component has config entries
          !entryDomains.has(componentDomain) &&
          // Exclude if the component has a config flow
          manifests[componentDomain] &&
          !manifests[componentDomain].config_flow &&
          // Exclude if the component is not one of the integration types that need synthetic entries
          (!manifests[componentDomain].integration_type ||
            ["device", "hub", "service", "integration"].includes(
              manifests[componentDomain].integration_type!
            ))
        ) {
          domains.add(componentDomain);
        }
      }

      // LLM: Create fake config entries for YAML-configured integrations
      const nonConfigEntry: ConfigEntryExtended[] = [...domains].map(
        (domain) => ({
          domain,
          localized_domain_name: domainToName(localize, domain),
          title: domain,
          // USERNOTE: YAML-configured integrations
          source: "yaml",
          state: "loaded",
          supports_options: false,
          supports_remove_device: false,
          supports_unload: false,
          supports_reconfigure: false,
          supported_subentry_types: {},
          num_subentries: 0,
          pref_disable_new_entities: false,
          pref_disable_polling: false,
          disabled_by: null,
          reason: null,
          error_reason_translation_key: null,
          error_reason_translation_placeholders: null,
        })
      );

      // LLM: Combine real config entries and YAML-configured ones, filtering out hardware
      // integrations without entities to avoid cluttering the UI
      const allEntries = [
        // USERNOTE: Integrations with config entries
        ...configEntries.filter(
          (entry) =>
            entry.supports_options ||
            this._manifests[entry.domain]?.integration_type !== "hardware" ||
            // FIXME: Why is it OR condition? Isn't we want to ensure they have config entries?
            // USERNOTE: Only include integrations that have config entri(es)
            entityEntries.some(
              (entity) => entity.config_entry_id === entry.entry_id
            )
        ),
        // USERNOTE: Integration without config entry (YAML-configured integrations)
        ...nonConfigEntry,
      ];

      let filteredConfigEntries: ConfigEntryExtended[];
      const ignored: ConfigEntryExtended[] = [];
      const disabled: ConfigEntryExtended[] = [];
      const integrations: ConfigEntryExtended[] = [];

      // LLM: Apply text filtering if a search term is provided
      if (filter) {
        const options: IFuseOptions<ConfigEntryExtended> = {
          keys: ["domain", "localized_domain_name", "title"],
          isCaseSensitive: false,
          minMatchCharLength: Math.min(filter.length, 2),
          threshold: 0.2,
        };
        const fuse = new Fuse(allEntries, options);
        filteredConfigEntries = fuse
          .search(filter)
          .map((result) => result.item);
      } else {
        filteredConfigEntries = allEntries;
      }

      // LLM: Categorize entries into ignored, disabled, and active integrations
      for (const entry of filteredConfigEntries) {
        if (entry.source === "ignore") {
          ignored.push(entry);
        } else if (entry.disabled_by !== null) {
          disabled.push(entry);
        } else {
          integrations.push(entry);
        }
      }

      // LLM: Return entries grouped by domain and sorted alphabetically by localized name
      return [
        // USERNOTE: groupByIntegration -> { [domain]: [entries of that domain] }
        // USERNOTE: Array.from({...}) -> [ [domain, entries[]], [domain, entries[]], ... ]
        Array.from(groupByIntegration(integrations)).sort((groupA, groupB) =>
          // USERNOTE: Sorts the array of [domain, entries[]] by the localized name of each integration, so that they appear alphabetically in the UI, based on human-readable names (not internal domains).
          caseInsensitiveStringCompare(
            // USERNOTE: From each group, find the name using the order of:
            // - 1. Domain's 1st entry's localized_domain_name
            // - 2. Domain's name
            groupA[1][0].localized_domain_name || groupA[0],
            groupB[1][0].localized_domain_name || groupB[0],
            this.hass.locale.language
          )
        ),
        ignored,
        disabled,
      ];
    }
  );

  /**
   * LLM: Filters and processes in-progress configuration flows, including Improv device discovery.
   *
   * Purpose: Manages the display of configuration flows by:
   * - Filtering out duplicate flows between mobile and local Bluetooth discovery
   * - Adding mobile-discovered Improv devices to the flow list
   * - Applying text search filtering if specified
   * - Sorting flows alphabetically by localized title
   *
   * Role in Scope: Acts as a coordinator between device discovery systems
   * (Improv, mobile, local) and the UI, ensuring a consistent view of
   * available configuration flows.
   *
   * Caveats & Side Effects:
   * - May modify the list of in-progress flows
   * - Handles special cases for Improv device discovery
   * - Uses fuzzy search for text filtering
   * - Affects UI rendering through sorting and filtering
   *
   * @param configEntriesInProgress - Current list of in-progress configuration flows
   * @param improvDiscovered - Map of discovered Improv devices
   * @param filter - Optional search text to filter flows
   * @returns Filtered and sorted list of configuration flows
   */
  private _filterConfigEntriesInProgress = memoizeOne(
    (
      configEntriesInProgress: DataEntryFlowProgressExtended[],
      improvDiscovered: Map<string, ImprovDiscoveredDevice>,
      filter?: string
    ): DataEntryFlowProgressExtended[] => {
      // LLM: Start with a copy of current in-progress flows
      let inProgress = [...configEntriesInProgress];

      // LLM: Get array of discovered Improv devices for easier processing
      const improvDiscoveredArray = Array.from(improvDiscovered.values());

      // USERNOTE: This block ensures that when a device is discovered both via the backend (native discovery) and via Improv BLE (frontend Bluetooth scan), only the Improv version is shown in the UI.
      // - Improv BLE setup (via mobile/browser) offers a better user experience for certain ESP-based devices.
      if (improvDiscoveredArray.length) {
        // filter out native flows that have been discovered by both mobile and local bluetooth
        // USERNOTE: Removes any duplicate flows that have duplicated discvoery, we will re-add them as synthetic Improv BLE flows below
        inProgress = inProgress.filter(
          (flow) =>
            !improvDiscoveredArray.some(
              (discovered) => discovered.name === flow.localized_title
            )
        );

        // add mobile flows to the list
        // USERNOTE: Adds synthetic Improv BLE flows.
        // - Synthetic as they are discovered from mobile/browser app, not from backend
        improvDiscovered.forEach((discovered) => {
          inProgress.push({
            flow_id: "external",
            handler: "improv_ble",
            context: {
              title_placeholders: {
                name: discovered.name,
              },
            },
            step_id: "bluetooth_confirm",
            localized_title: discovered.name,
          });
        });
      }

      // LLM: Apply text search filtering if a filter is provided
      let filteredEntries: DataEntryFlowProgressExtended[];
      if (filter) {
        // LLM: Configure fuzzy search for better matching
        const options: IFuseOptions<DataEntryFlowProgressExtended> = {
          keys: ["handler", "localized_title"],
          isCaseSensitive: false,
          minMatchCharLength: Math.min(filter.length, 2),
          threshold: 0.2,
          ignoreDiacritics: true,
        };
        const fuse = new Fuse(inProgress, options);
        filteredEntries = fuse.search(filter).map((result) => result.item);
      } else {
        filteredEntries = inProgress;
      }

      // LLM: Sort flows alphabetically by localized title
      // Uses case-insensitive comparison and respects the user's locale
      return filteredEntries.sort((a, b) =>
        caseInsensitiveStringCompare(
          // USERNOTE: handler: The domain name of the handler of the flow
          a.localized_title || a.handler,
          b.localized_title || b.handler,
          this.hass.locale.language
        )
      );
    }
  );

  /**
   * LLM: Lifecycle method that runs after the component is first updated.
   *
   * Purpose: Initializes the component by:
   * - Fetching integration manifests and entity sources
   * - Handling initial route if it's the add integration page
   * - Scanning for USB and Improv devices
   * - Loading diagnostic handlers if diagnostics component is available
   *
   * Side Effects:
   * - Makes multiple API calls
   * - Sets up device scanning
   * - Updates component state
   */
  protected firstUpdated(changed: PropertyValues) {
    super.firstUpdated(changed);
    // USERNOTE: Fetch all relevant? manifests
    this._fetchManifests();
    // USERNOTE: Fetch all relevant? entity sources
    this._fetchEntitySources();
    if (this.route.path === "/add") {
      this._handleAdd();
    }
    // USERNOTE: Scan for USB devices (device discovery workflows)
    this._scanUSBDevices();
    // USERNOTE: Scan for Improv devices (device discovery workflows)
    // - Improv: A protocol developed by the Home Assistant community to make it easier to provision and onboard Wi-Fi-enabled microcontrollers
    this._scanImprovDevices();
    // USERNOTE: Fetch diagnostic handlers
    if (isComponentLoaded(this.hass, "diagnostics")) {
      fetchDiagnosticHandlers(this.hass).then((infos) => {
        const handlers = {};
        for (const info of infos) {
          handlers[info.domain] = info.handlers.config_entry;
        }
        this._diagnosticHandlers = handlers;
      });
    }
  }

  /**
   * LLM: Lifecycle method that handles post-update tasks for the integrations dashboard.
   *
   * Purpose: Processes component updates to maintain UI state and data consistency:
   * - Handles deep linking to specific integrations via URL parameters
   * - Ensures integration manifests are loaded for new configurations
   * - Manages state updates for configuration flows and entries
   *
   * Role in Scope: Acts as a coordinator between URL state, configuration data,
   * and UI presentation. Ensures the dashboard stays in sync with the backend
   * state and user navigation.
   *
   * Caveats & Side Effects:
   * - May trigger UI updates through _highlightEntry()
   * - Makes API calls to fetch integration manifests
   * - Updates component state through _fetchIntegrationManifests()
   * - Affects UI rendering through state changes
   */
  protected updated(changed: PropertyValues) {
    super.updated(changed);

    // LLM: Handle deep linking to specific integration entries
    // Checks if URL contains config_entry or domain parameters and if config entries are loaded
    if (
      (this._searchParms.has("config_entry") ||
        this._searchParms.has("domain")) &&
      changed.has("configEntries") &&
      !changed.get("configEntries") &&
      this.configEntries
    ) {
      this._highlightEntry();
    }

    // LLM: Load manifests for new configuration flows
    // Ensures we have manifest data for any in-progress configuration flows
    if (
      changed.has("configEntriesInProgress") &&
      this.configEntriesInProgress
    ) {
      // USERNOTE: Fetch manifests for new configuration flows only if they are not already in the extraFetchedManifests set
      this._fetchIntegrationManifests(
        this.configEntriesInProgress.map((flow) => flow.handler)
      );
    }

    // LLM: Load manifests for new configuration entries
    // Ensures we have manifest data for any newly added integrations
    if (changed.has("configEntries") && this.configEntries) {
      // USERNOTE: Fetch manifests for new configuration entries only if they are not already in the extraFetchedManifests set
      this._fetchIntegrationManifests(
        this.configEntries.map((entry) => entry.domain)
      );
    }
  }

  /**
   * LLM: Main render method for the integrations dashboard.
   *
   * Purpose: Renders the complete UI for the integrations dashboard, including:
   * - Loading screen if data isn't ready
   * - Search and filter controls
   * - Sections for discovered, ignored, disabled, and configured integrations
   * - Add integration FAB button
   *
   * The UI is organized into sections:
   * 1. Ignored integrations (if shown)
   * 2. Discovered integrations (in-progress flows)
   * 3. Disabled integrations (if shown)
   * 4. Configured integrations
   *
   * Each section uses appropriate card components to display the integrations
   * and their status.
   */
  protected render() {
    if (!this.configEntries || !this.configEntriesInProgress) {
      return html`<hass-loading-screen
        .hass=${this.hass}
        .narrow=${this.narrow}
      ></hass-loading-screen>`;
    }
    const [integrations, ignoredConfigEntries, disabledConfigEntries] =
      this._filterConfigEntries(
        this.hass.config.components,
        this._manifests,
        this.configEntries,
        this._entityRegistryEntries,
        this.hass.localize,
        this._filter
      );
    const configEntriesInProgress = this._filterConfigEntriesInProgress(
      this.configEntriesInProgress,
      this._improvDiscovered,
      this._filter
    );

    const filterMenu = html`
      <div slot=${ifDefined(this.narrow ? "toolbar-icon" : undefined)}>
        <div class="menu-badge-container">
          ${!this._showDisabled && this.narrow && disabledConfigEntries.length
            ? html`<span class="badge">${disabledConfigEntries.length}</span>`
            : ""}
          <ha-button-menu
            multi
            @action=${this._handleMenuAction}
            @click=${this._preventDefault}
          >
            <ha-icon-button
              slot="trigger"
              .label=${this.hass.localize("ui.common.menu")}
              .path=${mdiFilterVariant}
            >
            </ha-icon-button>
            <ha-check-list-item left .selected=${this._showIgnored}>
              ${this.hass.localize(
                "ui.panel.config.integrations.ignore.show_ignored"
              )}
            </ha-check-list-item>
            <ha-check-list-item left .selected=${this._showDisabled}>
              ${this.hass.localize(
                "ui.panel.config.integrations.disable.show_disabled"
              )}
            </ha-check-list-item>
          </ha-button-menu>
        </div>
        ${this.narrow
          ? html`
              <ha-integration-overflow-menu
                .hass=${this.hass}
                slot="toolbar-icon"
              ></ha-integration-overflow-menu>
            `
          : ""}
      </div>
    `;

    return html`
      <hass-tabs-subpage
        .hass=${this.hass}
        .narrow=${this.narrow}
        back-path="/config"
        .route=${this.route}
        .tabs=${configSections.devices}
      >
        ${this.narrow
          ? html`
              <div slot="header" class="header">
                <search-input-outlined
                  .hass=${this.hass}
                  .filter=${this._filter}
                  @value-changed=${this._handleSearchChange}
                  .label=${this.hass.localize(
                    "ui.panel.config.integrations.search"
                  )}
                >
                </search-input-outlined>
              </div>
              ${filterMenu}
            `
          : html`
              <ha-integration-overflow-menu
                .hass=${this.hass}
                slot="toolbar-icon"
              ></ha-integration-overflow-menu>
              <div class="search">
                <search-input-outlined
                  .hass=${this.hass}
                  .filter=${this._filter}
                  @value-changed=${this._handleSearchChange}
                  .label=${this.hass.localize(
                    "ui.panel.config.integrations.search"
                  )}
                >
                </search-input-outlined>
                <div class="filters">
                  ${!this._showDisabled && disabledConfigEntries.length
                    ? html`<div
                        class="active-filters"
                        @click=${this._preventDefault}
                      >
                        ${this.hass.localize(
                          "ui.panel.config.integrations.disable.disabled_integrations",
                          { number: disabledConfigEntries.length }
                        )}
                        <mwc-button
                          @click=${this._toggleShowDisabled}
                          .label=${this.hass.localize(
                            "ui.panel.config.integrations.disable.show"
                          )}
                        ></mwc-button>
                      </div>`
                    : ""}
                  ${filterMenu}
                </div>
              </div>
            `}
        ${this._showIgnored
          ? html`<h1>
                ${this.hass.localize(
                  "ui.panel.config.integrations.ignore.ignored"
                )}
              </h1>
              <div class="container">
                ${ignoredConfigEntries.length > 0
                  ? ignoredConfigEntries.map(
                      (entry: ConfigEntryExtended) => html`
                        <ha-ignored-config-entry-card
                          .hass=${this.hass}
                          .manifest=${this._manifests[entry.domain]}
                          .entry=${entry}
                          @change=${this._handleFlowUpdated}
                        ></ha-ignored-config-entry-card>
                      `
                    )
                  : html`${this.hass.localize(
                      "ui.panel.config.integrations.no_ignored_integrations"
                    )}`}
              </div>`
          : ""}
        ${configEntriesInProgress.length
          ? html`<h1>
                ${this.hass.localize("ui.panel.config.integrations.discovered")}
              </h1>
              <div class="container">
                ${configEntriesInProgress.map(
                  (flow: DataEntryFlowProgressExtended) => html`
                    <ha-config-flow-card
                      .hass=${this.hass}
                      .manifest=${this._manifests[flow.handler]}
                      .flow=${flow}
                      @change=${this._handleFlowUpdated}
                    ></ha-config-flow-card>
                  `
                )}
              </div>`
          : ""}
        ${this._showDisabled
          ? html`<h1>
                ${this.hass.localize("ui.panel.config.integrations.disabled")}
              </h1>
              <div class="container">
                ${disabledConfigEntries.length > 0
                  ? disabledConfigEntries.map(
                      (entry: ConfigEntryExtended) => html`
                        <ha-disabled-config-entry-card
                          .hass=${this.hass}
                          .entry=${entry}
                          .manifest=${this._manifests[entry.domain]}
                          .entityRegistryEntries=${this._entityRegistryEntries}
                        ></ha-disabled-config-entry-card>
                      `
                    )
                  : html`${this.hass.localize(
                      "ui.panel.config.integrations.no_disabled_integrations"
                    )}`}
              </div>`
          : ""}
        ${configEntriesInProgress.length ||
        this._showDisabled ||
        this._showIgnored
          ? html`<h1>
              ${this.hass.localize("ui.panel.config.integrations.configured")}
            </h1>`
          : ""}
        <div class="container">
          ${integrations.length
            ? integrations.map(
                ([domain, items]) =>
                  html`<ha-integration-card
                    data-domain=${domain}
                    .hass=${this.hass}
                    .domain=${domain}
                    .items=${items}
                    .manifest=${this._manifests[domain]}
                    .entityRegistryEntries=${this._entityRegistryEntries}
                    .domainEntities=${this._domainEntities[domain] || []}
                    .supportsDiagnostics=${this._diagnosticHandlers
                      ? this._diagnosticHandlers[domain]
                      : false}
                    .logInfo=${this._logInfos
                      ? this._logInfos[domain]
                      : nothing}
                  ></ha-integration-card>`
              )
            : this._filter &&
                !configEntriesInProgress.length &&
                !integrations.length &&
                this.configEntries.length
              ? html`
                  <div class="empty-message">
                    <h1>
                      ${this.hass.localize(
                        "ui.panel.config.integrations.none_found"
                      )}
                    </h1>
                    <p>
                      ${this.hass.localize(
                        "ui.panel.config.integrations.none_found_detail"
                      )}
                    </p>
                    <mwc-button
                      @click=${this._createFlow}
                      unelevated
                      .label=${this.hass.localize(
                        "ui.panel.config.integrations.add_integration"
                      )}
                    ></mwc-button>
                  </div>
                `
              : // If we have a filter, never show a card
                this._filter
                ? ""
                : // If we're showing 0 cards, show empty state text
                  (!this._showIgnored || ignoredConfigEntries.length === 0) &&
                    (!this._showDisabled ||
                      disabledConfigEntries.length === 0) &&
                    integrations.length === 0
                  ? html`
                      <div class="empty-message">
                        <h1>
                          ${this.hass.localize(
                            "ui.panel.config.integrations.none"
                          )}
                        </h1>
                        <p>
                          ${this.hass.localize(
                            "ui.panel.config.integrations.no_integrations"
                          )}
                        </p>
                        <mwc-button
                          @click=${this._createFlow}
                          unelevated
                          .label=${this.hass.localize(
                            "ui.panel.config.integrations.add_integration"
                          )}
                        ></mwc-button>
                      </div>
                    `
                  : ""}
        </div>
        <ha-fab
          slot="fab"
          .label=${this.hass.localize(
            "ui.panel.config.integrations.add_integration"
          )}
          extended
          @click=${this._createFlow}
        >
          <ha-svg-icon slot="icon" .path=${mdiPlus}></ha-svg-icon>
        </ha-fab>
      </hass-tabs-subpage>
    `;
  }

  private _preventDefault(ev) {
    ev.preventDefault();
  }

  /**
   * LLM: Scans for USB devices that can be integrated.
   *
   * Purpose: Initiates a scan for USB devices that can be integrated into Home Assistant.
   * Only runs if the USB component is loaded.
   *
   * Side Effects:
   * - Makes API call to scan USB devices
   * - May trigger discovery of new integrations
   *
   * USERNOTE: Example:
   * - Zigbee Dongles, Z-Wave Controllers, USB-to-Ethernet bridges, RF or Bluetooth dongles	 e.g.
   */
  private async _scanUSBDevices() {
    if (!isComponentLoaded(this.hass, "usb")) {
      return;
    }
    await scanUSBDevices(this.hass);
  }

  /**
   * LLM: Initiates scanning for Improv devices.
   *
   * Purpose: Sets up event listeners and starts scanning for Improv-compatible
   * devices that can be integrated. Only runs if the external auth config
   * supports Improv setup.
   *
   * Side Effects:
   * - Adds event listeners for device discovery
   * - Sends message to external auth to start scanning
   */
  private _scanImprovDevices() {
    if (!this.hass.auth.external?.config.canSetupImprov) {
      return;
    }

    window.addEventListener(
      "improv-discovered-device",
      this._handleImprovDiscovered
    );

    window.addEventListener(
      "improv-device-setup-done",
      this._reScanImprovDevices
    );

    this.hass.auth.external!.fireMessage({
      type: "improv/scan",
    });
  }

  /**
   * LLM: Rescans for Improv devices after setup completion.
   *
   * Purpose: Clears existing discovered devices and initiates a new scan
   * after a device setup is completed.
   *
   * Side Effects:
   * - Clears _improvDiscovered state
   * - Triggers new device scan
   */
  private _reScanImprovDevices = () => {
    if (!this.hass.auth.external?.config.canSetupImprov) {
      return;
    }
    this._improvDiscovered = new Map();
    this.hass.auth.external!.fireMessage({
      type: "improv/scan",
    });
  };

  /**
   * LLM: Handles discovery of new Improv devices.
   *
   * Purpose: Processes newly discovered Improv devices and updates the UI
   * to show them as available for integration.
   *
   * Side Effects:
   * - Updates _improvDiscovered state
   * - May trigger manifest fetching for new device type
   */
  private _handleImprovDiscovered = (ev) => {
    this._fetchManifests(["improv_ble"]);
    this._improvDiscovered.set(ev.detail.name, ev.detail);
    // copy for memoize and reactive updates
    this._improvDiscovered = new Map(Array.from(this._improvDiscovered));
  };

  /**
   * LLM: Fetches entity sources to determine which entities belong to which integration.
   *
   * Purpose: Maps entity IDs to their source domains to determine which entities
   * are provided by this integration, even if their entity_id has a different domain prefix.
   *
   * Side Effects:
   * - Updates _domainEntities state with mapping of domains to entity IDs
   */
  private async _fetchEntitySources() {
    const entitySources = await fetchEntitySourcesWithCache(this.hass);

    const entitiesByDomain = {};

    for (const [entity, source] of Object.entries(entitySources)) {
      if (!(source.domain in entitiesByDomain)) {
        entitiesByDomain[source.domain] = [];
      }
      // USERNOTE: Group entities by domain
      // {[domain]: [entities...]}
      entitiesByDomain[source.domain].push(entity);
    }

    this._domainEntities = entitiesByDomain;
  }

  /**
   * LLM: Fetches integration manifests for specified integrations.
   *
   * Purpose: Loads manifest data for integrations, which contains metadata like
   * version, documentation URL, and integration type.
   *
   * Side Effects:
   * - Updates _manifests state with new manifest data
   * - May trigger UI updates to show integration details
   */
  private async _fetchManifests(integrations?: string[]) {
    const fetched = await fetchIntegrationManifests(this.hass, integrations);
    // Make a copy so we can keep track of previously loaded manifests
    // for discovered flows (which are not part of these results)
    const manifests = { ...this._manifests };
    for (const manifest of fetched) {
      manifests[manifest.domain] = manifest;
    }
    this._manifests = manifests;
  }

  /**
   * LLM: Fetches integration manifests for a list of integrations, avoiding duplicate fetches.
   *
   * Purpose: Efficiently loads manifest data for integrations by:
   * - Tracking which manifests have already been fetched
   * - Only requesting manifests that haven't been loaded yet
   * - Maintaining a cache of previously fetched manifests
   *
   * Role in Scope: Acts as a manifest cache manager, ensuring we have the necessary
   * metadata for integrations while minimizing redundant API calls.
   *
   * Caveats & Side Effects:
   * - Makes API calls to fetch missing manifests
   * - Updates _manifests state with new manifest data
   * - Maintains _extraFetchedManifests set to track fetched manifests
   * - May trigger UI updates through state changes
   *
   * @param integrations - Array of integration domains to fetch manifests for
   */
  private async _fetchIntegrationManifests(integrations: string[]) {
    // LLM: Track which manifests we need to fetch
    const manifestsToFetch: string[] = [];

    // LLM: Filter out integrations that already have manifests
    for (const integration of integrations) {
      // Skip if manifest is already in _manifests
      if (integration in this._manifests) {
        continue;
      }

      if (this._extraFetchedManifests) {
        // LLM: Skip if manifest was already fetched in a previous call
        if (this._extraFetchedManifests.has(integration)) {
          continue;
        }
      } else {
        // LLM: Initialize tracking set if it doesn't exist
        this._extraFetchedManifests = new Set();
      }

      // LLM: Add to tracking set and fetch list
      this._extraFetchedManifests.add(integration);
      manifestsToFetch.push(integration);
    }

    // LLM: Only make API call if we have manifests to fetch
    if (manifestsToFetch.length) {
      await this._fetchManifests(manifestsToFetch);
    }
  }

  /**
   * LLM: Handles updates to integration flows.
   *
   * Purpose: Refreshes the list of in-progress configuration flows
   * when a flow is updated or completed.
   *
   * Side Effects:
   * - Fetches updated list of config entries in progress
   */
  private _handleFlowUpdated() {
    this._reScanImprovDevices();
    // USERNOTE: Fetch all relevant? manifests
    this._fetchManifests();
  }

  // USERNOTE: Handles the add integration flow reqeust from button click event
  private _createFlow() {
    showAddIntegrationDialog(this, {
      // USERNOTE: Pass the search filter to the dialog search input
      initialFilter: this._filter,
    });
  }

  private _handleMenuAction(ev: CustomEvent<ActionDetail>) {
    switch (ev.detail.index) {
      case 0:
        this._showIgnored = !this._showIgnored;
        break;
      case 1:
        this._toggleShowDisabled();
        break;
    }
  }

  private _toggleShowDisabled() {
    this._showDisabled = !this._showDisabled;
  }

  private _handleSearchChange(ev: CustomEvent) {
    this._filter = ev.detail.value;
    history.replaceState({ filter: this._filter }, "");
  }

  private async _highlightEntry() {
    // USERNOTE: Wait for next render to ensure DOM is updated (after 1+ frames and also is at least 2 event loop ticks)
    await nextRender();
    const entryId = this._searchParms.get("config_entry");
    let domain: string | null;
    if (entryId) {
      const configEntry = this.configEntries!.find(
        (entry) => entry.entry_id === entryId
      );
      if (!configEntry) {
        return;
      }
      domain = configEntry.domain;
    } else {
      domain = this._searchParms.get("domain");
    }
    const card: HaIntegrationCard = this.shadowRoot!.querySelector(
      `[data-domain=${domain}]`
    ) as HaIntegrationCard;
    if (card) {
      card.scrollIntoView({
        block: "center",
      });
      card.classList.add("highlight");
    }
  }

  /**
   * LLM: Handles the add integration flow.
   *
   * Purpose: Processes the add integration request, which can be triggered by:
   * - Direct navigation to /add
   * - Clicking the add integration button
   * - Brand-specific deep links
   *
   * The method handles various cases:
   * - Brand-specific integration flows
   * - Domain-specific integration flows
   * - Helper domain flows
   * - Error cases for unsupported integrations
   *
   * Side Effects:
   * - May show various dialogs
   * - May navigate to different routes
   * - May trigger integration setup flows
   */
  private async _handleAdd() {
    const brand = extractSearchParam("brand");
    const domain = extractSearchParam("domain");
    navigate("/config/integrations", { replace: true });

    if (brand) {
      showAddIntegrationDialog(this, {
        brand,
      });
      return;
    }
    if (!domain) {
      return;
    }

    const descriptions = await getIntegrationDescriptions(this.hass);
    const integrations = {
      ...descriptions.core.integration,
      ...descriptions.custom.integration,
    };

    const integration = findIntegration(integrations, domain);

    if (integration?.config_flow) {
      if (integration.single_config_entry) {
        const configEntries = await getConfigEntries(this.hass, { domain });
        if (configEntries.length > 0) {
          const localize = await this.hass.loadBackendTranslation(
            "title",
            integration.name
          );
          showAlertDialog(this, {
            title: this.hass.localize(
              "ui.panel.config.integrations.config_flow.single_config_entry_title"
            ),
            text: this.hass.localize(
              "ui.panel.config.integrations.config_flow.single_config_entry",
              {
                integration_name: domainToName(localize, integration.name!),
              }
            ),
          });
          return;
        }
      }

      // Integration exists, so we can just create a flow
      const localize = await this.hass.loadBackendTranslation(
        "title",
        domain,
        false
      );
      if (
        await showConfirmationDialog(this, {
          title: localize("ui.panel.config.integrations.confirm_new", {
            integration: integration.name || domainToName(localize, domain),
          }),
        })
      ) {
        showAddIntegrationDialog(this, {
          domain,
        });
      }
      return;
    }

    if (integration?.supported_by) {
      // Integration is an alias, so we can just create a flow
      const localize = await this.hass.loadBackendTranslation(
        "title",
        domain,
        false
      );
      const supportedIntegration = findIntegration(
        integrations,
        integration.supported_by
      );

      if (!supportedIntegration) {
        return;
      }

      showConfirmationDialog(this, {
        text: this.hass.localize(
          "ui.panel.config.integrations.config_flow.supported_brand_flow",
          {
            supported_brand: integration.name || domainToName(localize, domain),
            flow_domain_name:
              supportedIntegration.name ||
              domainToName(localize, integration.supported_by),
          }
        ),
        confirm: async () => {
          if (
            (PROTOCOL_INTEGRATIONS as readonly string[]).includes(
              integration.supported_by!
            )
          ) {
            protocolIntegrationPicked(
              this,
              this.hass,
              integration.supported_by!
            );
            return;
          }
          showConfigFlowDialog(this, {
            dialogClosedCallback: () => {
              this._handleFlowUpdated();
            },
            startFlowHandler: integration.supported_by,
            manifest: await fetchIntegrationManifest(
              this.hass,
              integration.supported_by!
            ),
            showAdvanced: this.hass.userData?.showAdvanced,
          });
        },
      });
      return;
    }

    // If not an integration or supported brand, try helper else show alert
    if (isHelperDomain(domain)) {
      navigate(`/config/helpers/add?domain=${domain}`, {
        replace: true,
      });
      return;
    }
    const helpers = {
      ...descriptions.core.helper,
      ...descriptions.custom.helper,
    };
    const helper = findIntegration(helpers, domain);
    if (helper) {
      navigate(`/config/helpers/add?domain=${domain}`, {
        replace: true,
      });
      return;
    }
    showAlertDialog(this, {
      title: this.hass.localize(
        "ui.panel.config.integrations.config_flow.error"
      ),
      text: this.hass.localize(
        "ui.panel.config.integrations.config_flow.no_config_flow"
      ),
    });
  }

  protected supportedShortcuts(): SupportedShortcuts {
    return {
      f: () => this._searchInput.focus(),
    };
  }

  static get styles(): CSSResultGroup {
    return [
      haStyle,
      css`
        :host([narrow]) hass-tabs-subpage {
          --main-title-margin: 0;
        }
        ha-button-menu {
          margin-left: 8px;
          margin-inline-start: 8px;
          margin-inline-end: initial;
          direction: var(--direction);
        }
        .container {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          grid-gap: 8px 8px;
          padding: 8px 16px 16px;
        }
        .container:last-of-type {
          margin-bottom: 64px;
        }
        .empty-message {
          margin: auto;
          text-align: center;
          grid-column-start: 1;
          grid-column-end: -1;
        }
        .empty-message h1 {
          margin: 0;
        }
        search-input-outlined {
          flex: 1;
        }
        .header {
          display: flex;
        }
        .search {
          display: flex;
          justify-content: space-between;
          width: 100%;
          align-items: center;
          height: 56px;
          position: sticky;
          top: 0;
          z-index: 2;
          background-color: var(--primary-background-color);
          padding: 0 16px;
          gap: 16px;
          box-sizing: border-box;
          border-bottom: 1px solid var(--divider-color);
        }
        .filters {
          --mdc-text-field-fill-color: var(--input-fill-color);
          --mdc-text-field-idle-line-color: var(--input-idle-line-color);
          --mdc-shape-small: 4px;
          --text-field-overflow: initial;
          display: flex;
          justify-content: flex-end;
          align-items: center;
          color: var(--primary-text-color);
        }
        .active-filters {
          color: var(--primary-text-color);
          position: relative;
          display: flex;
          align-items: center;
          padding-top: 2px;
          padding-bottom: 2px;
          padding-right: 2px;
          padding-left: 8px;
          padding-inline-start: 8px;
          padding-inline-end: 2px;
          font-size: var(--ha-font-size-m);
          width: max-content;
          cursor: initial;
          direction: var(--direction);
          height: 32px;
        }
        .active-filters mwc-button {
          margin-left: 8px;
          margin-inline-start: 8px;
          margin-inline-end: initial;
          direction: var(--direction);
        }
        .active-filters::before {
          background-color: var(--primary-color);
          opacity: 0.12;
          border-radius: 4px;
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          left: 0;
          content: "";
        }
        .badge {
          min-width: 20px;
          box-sizing: border-box;
          border-radius: 50%;
          font-weight: var(--ha-font-weight-normal);
          background-color: var(--primary-color);
          line-height: 20px;
          text-align: center;
          padding: 0px 4px;
          color: var(--text-primary-color);
          position: absolute;
          right: 0px;
          inset-inline-end: 0px;
          inset-inline-start: initial;
          top: 4px;
          font-size: 0.65em;
        }
        .menu-badge-container {
          position: relative;
        }
        h1 {
          margin-top: 8px;
          margin-left: 16px;
          margin-inline-start: 16px;
          margin-inline-end: initial;
        }
        ha-button-menu {
          color: var(--primary-text-color);
        }
      `,
    ];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-config-integrations-dashboard": HaConfigIntegrationsDashboard;
  }
}
