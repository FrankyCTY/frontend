import type { PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators";
import { navigate } from "../../../common/navigate";
import type { LocalizeFunc } from "../../../common/translations/localize";
import type { ConfigEntry } from "../../../data/config_entries";
import { subscribeConfigEntries } from "../../../data/config_entries";
import {
  localizeConfigFlowTitle,
  subscribeConfigFlowInProgress,
} from "../../../data/config_flow";
import type { DataEntryFlowProgress } from "../../../data/data_entry_flow";
import { domainToName } from "../../../data/integration";
import "../../../layouts/hass-loading-screen";
import type { RouterOptions } from "../../../layouts/hass-router-page";
import { HassRouterPage } from "../../../layouts/hass-router-page";
import { SubscribeMixin } from "../../../mixins/subscribe-mixin";
import type { HomeAssistant } from "../../../types";

import "./ha-config-integration-page";
import "./ha-config-integrations-dashboard";

export interface ConfigEntryUpdatedEvent {
  entry: ConfigEntry;
}

export interface ConfigEntryRemovedEvent {
  entryId: string;
}

export interface DataEntryFlowProgressExtended extends DataEntryFlowProgress {
  localized_title?: string;
}

declare global {
  // for fire event
  interface HASSDomEvents {
    "entry-updated": ConfigEntryUpdatedEvent;
    "entry-removed": ConfigEntryRemovedEvent;
  }
}

export interface ConfigEntryExtended extends ConfigEntry {
  localized_domain_name?: string;
}

/**
 * LLM: Main component for managing integrations in Home Assistant.
 *
 * Purpose: Provides a UI for viewing, managing, and setting up integrations with
 * external devices, services, and platforms. Acts as a router for the integrations
 * dashboard and individual integration configuration pages.
 *
 * Role in Scope: Primary entry point for the integrations section of the Home Assistant
 * configuration interface. Manages the state of both configured integrations and
 * integration setup flows in progress.
 *
 * Features:
 * - Displays a dashboard of all configured integrations
 * - Shows integrations that are in the process of being set up
 * - Routes to individual integration configuration pages
 * - Handles real-time updates to integration status through subscriptions
 *
 * Caveats & Side Effects:
 * - Subscribes to configuration entries and flow progress, which run until component is unmounted
 * - Loads translation data at startup
 */
@customElement("ha-config-integrations")
class HaConfigIntegrations extends SubscribeMixin(HassRouterPage) {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ type: Boolean, reflect: true }) public narrow = false;

  @property({ attribute: "is-wide", type: Boolean }) public isWide = false;

  @property({ attribute: false }) public showAdvanced = false;

  /**
   * LLM: Router configuration for the integrations pages.
   *
   * Defines two routes:
   * - dashboard: The main integrations listing page (default)
   * - integration: Page for a specific integration, showing its devices and entities
   */
  protected routerOptions: RouterOptions = {
    // USERNOTE: The hass-router-page on update() will navigate (redirect) user to the default page
    defaultPage: "dashboard",
    routes: {
      dashboard: {
        tag: "ha-config-integrations-dashboard",
        cache: true,
      },
      integration: {
        tag: "ha-config-integration-page",
      },
    },
  };

  // USERNOTE: Configured config entries retrieved from the backend
  @state() private _configEntries?: ConfigEntryExtended[];

  // USERNOTE: In-progress config flows retrieved from the backend
  // - Does not include Improv devices flows which will be merged in the ha-config-integrations-dashboard.ts as synthetic flows
  // An in-progress config flow represents a partially completed integration setup process. It could be triggered by:
  // - Automatic discovery (e.g., mDNS, DHCP, USB)
  // - User action (clicked "Add Integration")
  // - External triggers (e.g., BLE Improv detection)
  @state() private _configEntriesInProgress?: DataEntryFlowProgressExtended[];

  private _loadTranslationsPromise?: Promise<LocalizeFunc>;

  /**
   * LLM: Sets up subscriptions to track integrations and configuration flows.
   *
   * Purpose: Subscribes to two data sources:
   * 1. Configuration entries (configured integrations)
   * 2. Configuration flows in progress (integrations being set up)
   *
   * The data from these subscriptions is processed and stored in component state,
   * which is then passed to child components.
   *
   * Returns an array of unsubscribe functions that will be called when the component
   * is unmounted.
   */
  public hassSubscribe() {
    return [
      // USERNOTE: Subscribe to config entries with type ["device", "hub", "service", "hardware"]
      subscribeConfigEntries(
        this.hass,
        // USERNOTE: Handler when new message (could be batched) is received
        async (messages) => {
          if (messages.length === 0) {
            this._configEntries = [];
            return;
          }
          // USERNOTE: Full update TRUE means we ignore existing entries and replace them entirely with new ones
          // Instead of preserving existing entries that are not in the new messages
          let fullUpdate = this._configEntries === undefined;
          const newEntries: ConfigEntryExtended[] = [];

          // LLM: Wait for translations to load before processing entries
          await this._loadTranslationsPromise?.then(
            () =>
              // allow hass to update
              new Promise((resolve) => {
                window.setTimeout(resolve, 0);
              })
          );

          // LLM: Process each message (config entry events) based on its type (added, removed, updated, or initial load)
          messages.forEach((message) => {
            if (message.type === null || message.type === "added") {
              // LLM: Add new entry or initial entry, with localized domain name
              newEntries.push({
                ...message.entry,
                localized_domain_name: domainToName(
                  this.hass.localize,
                  message.entry.domain
                ),
              });
              // FIXME: Why null then we mark fullUpdate?
              if (message.type === null) {
                fullUpdate = true;
              }
            } else if (message.type === "removed") {
              // LLM: Remove entry by filtering it out
              this._configEntries = this._configEntries!.filter(
                (entry) => entry.entry_id !== message.entry.entry_id
              );
            } else if (message.type === "updated") {
              // LLM: Update entry while preserving its localized name
              const newEntry = message.entry;
              this._configEntries = this._configEntries!.map((entry) =>
                entry.entry_id === newEntry.entry_id
                  ? {
                      ...newEntry,
                      localized_domain_name: entry.localized_domain_name,
                    }
                  : entry
              );
            }
          });

          // LLM: Combine existing entries with new ones depending on whether this is a full update
          const existingEntries = fullUpdate ? [] : this._configEntries;
          this._configEntries = [...existingEntries!, ...newEntries];
        },
        { type: ["device", "hub", "service", "hardware"] }
      ),

      subscribeConfigFlowInProgress(this.hass, async (messages) => {
        if (messages.length === 0) {
          this._configEntriesInProgress = [];
          return;
        }

        // LLM: Similar approach as with config entries - determine update strategy
        let fullUpdate = this._configEntriesInProgress === undefined;
        const newEntries: DataEntryFlowProgressExtended[] = [];

        // LLM: Process messages about flows in progress
        messages.forEach((message) => {
          if (message.type === "removed") {
            if (!this._configEntriesInProgress) {
              return;
            }
            // LLM: Remove flow that was completed or aborted
            this._configEntriesInProgress =
              this._configEntriesInProgress.filter(
                (flow) => flow.flow_id !== message.flow_id
              );
            return;
          }

          if (message.type === null || message.type === "added") {
            if (message.type === null) {
              fullUpdate = true;
            }
            // LLM: Add new flow in progress
            newEntries.push(message.flow);
          }
        });

        if (!newEntries.length && !fullUpdate) {
          return;
        }
        const existingEntries = fullUpdate ? [] : this._configEntriesInProgress;

        // LLM: Load translations needed for flow titles if any flow has title placeholders
        const titleIntegrations = newEntries
          .filter((flow) => flow.context.title_placeholders)
          .map((flow) => flow.handler);
        const localize = titleIntegrations.length
          ? await this.hass.loadBackendTranslation("config", titleIntegrations)
          : this.hass.localize;

        // LLM: Combine existing and new flows, with localized titles
        this._configEntriesInProgress = [
          ...existingEntries!,
          ...newEntries.map((flow) => ({
            ...flow,
            localized_title: localizeConfigFlowTitle(localize, flow),
          })),
        ];
      }),
    ];
  }

  /**
   * LLM: Lifecycle method that runs before the component updates.
   *
   * On first update, loads translations for all components in the system.
   * This ensures integration names are properly displayed.
   */
  protected willUpdate(changed: PropertyValues) {
    super.willUpdate(changed);
    // USERNOTE: Only load translations once when the component has NOT updated yet (Not even once)
    if (this.hasUpdated) {
      return;
    }
    // LLM: Load translations for all installed components
    // USERNOTE: The integration config entries & config entries flow subscription will wait until the load translations promise is resolved
    this._loadTranslationsPromise = this.hass.loadBackendTranslation(
      "title",
      this.hass.config.components.map((comp) => comp.split(".")[0])
    );
  }

  /**
   * LLM: Updates the active page element with current data.
   *
   * This method is called by the router parent class whenever the route changes
   * or when properties that affect the page content are updated.
   *
   * It handles:
   * - Passing properties to the child page components
   * - Setting the domain for the integration detail page
   * - Handling URL params for backward compatibility
   */
  protected updatePageEl(pageEl) {
    pageEl.hass = this.hass;

    // LLM: If we're on an integration page (integration subrouter), we need to determine which integration route (list or integration detail) to show
    if (this._currentPage === "integration") {
      if (this.routeTail.path) {
        // LLM: Get domain from the URL path
        pageEl.domain = this.routeTail.path.substring(1);
      } else if (window.location.search) {
        // LLM: Backward compatibility for old URL format with query parameters
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has("domain")) {
          const domain = urlParams.get("domain");
          pageEl.domain = domain;
          // LLM: Navigate to the canonical URL format for this integration
          navigate(`/config/integrations/integration/${domain}`);
        }
      }
    }
    // LLM: Pass data and properties to the page component
    pageEl.route = this.routeTail;
    // USERNOTE: Subbed to config entries & config entries flow will be passed to the child page component as properties.
    pageEl.configEntries = this._configEntries;
    pageEl.configEntriesInProgress = this._configEntriesInProgress;
    pageEl.narrow = this.narrow;
    pageEl.isWide = this.isWide;
    pageEl.showAdvanced = this.showAdvanced;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-config-integrations": HaConfigIntegrations;
  }
}
