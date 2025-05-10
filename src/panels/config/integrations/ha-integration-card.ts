/**
 * LLM: Integration Card Component
 *
 * Purpose:
 * Renders a card representing a Home Assistant integration, showing its status, devices, entities,
 * and configuration options. This component is used in the integrations configuration panel.
 *
 * Role in Scope:
 * - Displays integration status and metadata
 * - Provides navigation to related devices/entities
 * - Shows integration type indicators (custom, cloud, yaml)
 * - Handles error states and debugging information
 *
 * Caveats:
 * - Requires Home Assistant instance and domain to be set
 * - Manages complex state calculations for multiple config entries
 * - Handles RTL (right-to-left) layout considerations
 */

import { mdiFileCodeOutline, mdiPackageVariant, mdiWeb } from "@mdi/js";
import type { CSSResultGroup, TemplateResult } from "lit";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators";
import { classMap } from "lit/directives/class-map";
import memoizeOne from "memoize-one";
import { computeRTL } from "../../../common/util/compute_rtl";
import "../../../components/ha-button";
import "../../../components/ha-card";
import "../../../components/ha-ripple";
import "../../../components/ha-svg-icon";
import "../../../components/ha-tooltip";
import type { ConfigEntry } from "../../../data/config_entries";
import { ERROR_STATES } from "../../../data/config_entries";
import type { DeviceRegistryEntry } from "../../../data/device_registry";
import type { EntityRegistryEntry } from "../../../data/entity_registry";
import type {
  IntegrationLogInfo,
  IntegrationManifest,
} from "../../../data/integration";
import { LogSeverity } from "../../../data/integration";
import { haStyle } from "../../../resources/styles";
import type { HomeAssistant } from "../../../types";
import type { ConfigEntryExtended } from "./ha-config-integrations";
import "./ha-integration-header";
import { PROTOCOL_INTEGRATIONS } from "../../../common/integrations/protocolIntegrationPicked";

@customElement("ha-integration-card")
export class HaIntegrationCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property() public domain!: string;

  @property({ attribute: false }) public items!: ConfigEntryExtended[];

  @property({ attribute: false }) public manifest?: IntegrationManifest;

  @property({ attribute: false })
  public entityRegistryEntries!: EntityRegistryEntry[];

  @property({ attribute: "supports-diagnostics", type: Boolean })
  public supportsDiagnostics = false;

  @property({ attribute: false }) public logInfo?: IntegrationLogInfo;

  @property({ attribute: false }) public domainEntities: string[] = [];

  /**
   * LLM: Main Render Method
   *
   * Purpose:
   * Renders the integration card with appropriate styling based on state and debug status.
   *
   * Implementation Details:
   * - Applies state-based CSS classes for visual feedback
   * - Renders header with integration info and status
   * - Delegates device/entity rendering to _renderSingleEntry
   */
  protected render(): TemplateResult {
    const entryState = this._getState(this.items);

    const debugLoggingEnabled =
      this.logInfo && this.logInfo.level === LogSeverity.DEBUG;

    return html`
      <ha-card
        outlined
        class=${classMap({
          "state-loaded": entryState === "loaded",
          "state-not-loaded": entryState === "not_loaded",
          "state-failed-unload": entryState === "failed_unload",
          "state-setup": entryState === "setup_in_progress",
          "state-error": ERROR_STATES.includes(entryState),
          "debug-logging": Boolean(debugLoggingEnabled),
        })}
      >
        <a
          href=${`/config/integrations/integration/${this.domain}`}
          class="ripple-anchor"
        >
          <ha-ripple></ha-ripple>
          <ha-integration-header
            .hass=${this.hass}
            .domain=${this.domain}
            .localizedDomainName=${this.items[0].localized_domain_name}
            .error=${ERROR_STATES.includes(entryState)
              ? this.hass.localize(
                  `ui.panel.config.integrations.config_entry.state.${entryState}`
                )
              : undefined}
            .warning=${entryState !== "loaded" &&
            !ERROR_STATES.includes(entryState)
              ? this.hass.localize(
                  `ui.panel.config.integrations.config_entry.state.${entryState}`
                )
              : debugLoggingEnabled
                ? this.hass.localize(
                    "ui.panel.config.integrations.config_entry.debug_logging_enabled"
                  )
                : undefined}
            .manifest=${this.manifest}
          >
          </ha-integration-header>
        </a>

        ${this._renderSingleEntry()}
      </ha-card>
    `;
  }

  /**
   * LLM: Single Entry Renderer
   *
   * Purpose:
   * Renders the action buttons and icons for a single integration entry.
   *
   * Implementation Details:
   * - Calculates device and entity counts
   * - Renders appropriate action buttons based on available data
   * - Shows integration type indicators (custom, cloud, yaml)
   */
  private _renderSingleEntry(): TemplateResult {
    const devices = this._getDevices(this.items, this.hass.devices);
    const entitiesCount = devices.length
      ? 0
      : this._getEntityCount(
          this.items,
          this.entityRegistryEntries,
          this.domainEntities
        );

    const services = !devices.some((device) => device.entry_type !== "service");

    //   Has devices? ───► ✅ Show "X devices"/"X services"
    //  │
    //  └── Has entities? ───► ✅ Show "X entities"
    //        │
    //        └── Has non-YAML config entries? ───► ✅ Show "X entries"
    //              │
    //              └── ❌ Show nothing (spacer)
    return html`
      <div class="card-actions">
        ${devices.length > 0
          ? html`<a
              href=${devices.length === 1 &&
              // Always link to device page for protocol integrations to show Add Device button
              // @ts-expect-error
              !PROTOCOL_INTEGRATIONS.includes(this.domain)
                ? `/config/devices/device/${devices[0].id}`
                : `/config/devices/dashboard?historyBack=1&domain=${this.domain}`}
            >
              <ha-button>
                ${this.hass.localize(
                  `ui.panel.config.integrations.config_entry.${
                    services ? "services" : "devices"
                  }`,
                  { count: devices.length }
                )}
              </ha-button>
            </a>`
          : entitiesCount > 0
            ? html`<a
                href=${`/config/entities?historyBack=1&domain=${this.domain}`}
              >
                <ha-button>
                  ${this.hass.localize(
                    `ui.panel.config.integrations.config_entry.entities`,
                    { count: entitiesCount }
                  )}
                </ha-button>
              </a>`
            : this.items.find((itm) => itm.source !== "yaml")
              ? html`<a
                  href=${`/config/integrations/integration/${this.domain}`}
                >
                  <ha-button>
                    ${this.hass.localize(
                      `ui.panel.config.integrations.config_entry.entries`,
                      {
                        count: this.items.filter((itm) => itm.source !== "yaml")
                          .length,
                      }
                    )}
                  </ha-button>
                </a>`
              : html`<div class="spacer"></div>`}
        <div class="icons">
          ${this.manifest && !this.manifest.is_built_in
            ? html`<span
                class="icon ${this.manifest.overwrites_built_in
                  ? "overwrites"
                  : "custom"}"
              >
                <ha-tooltip
                  .placement=${computeRTL(this.hass) ? "right" : "left"}
                  .content=${this.hass.localize(
                    this.manifest.overwrites_built_in
                      ? "ui.panel.config.integrations.config_entry.custom_overwrites_core"
                      : "ui.panel.config.integrations.config_entry.custom_integration"
                  )}
                >
                  <ha-svg-icon .path=${mdiPackageVariant}></ha-svg-icon>
                </ha-tooltip>
              </span>`
            : nothing}
          ${this.manifest && this.manifest.iot_class?.startsWith("cloud_")
            ? html`<div class="icon cloud">
                <ha-tooltip
                  .placement=${computeRTL(this.hass) ? "right" : "left"}
                  .content=${this.hass.localize(
                    "ui.panel.config.integrations.config_entry.depends_on_cloud"
                  )}
                >
                  <ha-svg-icon .path=${mdiWeb}></ha-svg-icon>
                </ha-tooltip>
              </div>`
            : nothing}
          ${this.manifest &&
          !this.manifest?.config_flow &&
          !this.items.every((itm) => itm.source === "system")
            ? html`<div class="icon yaml">
                <ha-tooltip
                  .placement=${computeRTL(this.hass) ? "right" : "left"}
                  .content=${this.hass.localize(
                    "ui.panel.config.integrations.config_entry.no_config_flow"
                  )}
                >
                  <ha-svg-icon .path=${mdiFileCodeOutline}></ha-svg-icon
                ></ha-tooltip>
              </div>`
            : nothing}
        </div>
      </div>
    `;
  }

  /**
   * LLM: State Calculator
   *
   * Purpose:
   * Determines the overall state of multiple config entries.
   *
   * Implementation Details:
   * - Returns single entry state if only one entry exists
   * - Prioritizes error states over normal states
   * - Uses memoization for performance
   *
   * @param configEntry - Array of configuration entries to analyze
   * @returns The most significant state among the entries
   */
  private _getState = memoizeOne(
    (configEntry: ConfigEntry[]): ConfigEntry["state"] => {
      if (configEntry.length === 1) {
        return configEntry[0].state;
      }
      let entryState: ConfigEntry["state"];
      for (const entry of configEntry) {
        // USERNOTE: If any of the config entries have an error state, return that state as the overall state
        if (ERROR_STATES.includes(entry.state)) {
          return entry.state;
        }
        entryState = entry.state;
      }
      return entryState!;
    }
  );

  /**
   * LLM: Entity Counter
   *
   * Purpose:
   * Calculates the total number of entities associated with config entries of this card/domain/integration.
   *
   * Implementation Details:
   * - Handles both registry and domain entities
   * - Deduplicates entities across multiple sources
   * - Uses memoization for performance
   *
   * @param configEntry - One or more config entries (same integration/domain)
   * @param entityRegistryEntries - The full list of entities from HA's entity registry
   * @param domainEntities - List of entities grouped by integration domain (grouped heuristically or by source domain that might not associate with the config entries)
   * @returns Total number of unique entities
   */
  private _getEntityCount = memoizeOne(
    (
      configEntry: ConfigEntry[],
      entityRegistryEntries: EntityRegistryEntry[],
      domainEntities: string[]
    ): number => {
      if (!entityRegistryEntries) {
        return domainEntities.length;
      }

      // USERNOTE: The entry ids for the config entries in this card/domain/integration
      const entryIds = configEntry
        .map((entry) => entry.entry_id)
        .filter(Boolean);

      if (!entryIds.length) {
        return domainEntities.length;
      }

      // USERNOTE: Get the entity entries that are associated with the config entries in this card/domain/integration
      const entityRegEntities = entityRegistryEntries.filter(
        (entity) =>
          entity.config_entry_id && entryIds.includes(entity.config_entry_id)
      );

      if (entityRegEntities.length === domainEntities.length) {
        return domainEntities.length;
      }

      // USERNOTE: Entity entry ids that are associated with the config entries in this card/domain/integration
      const entityIds = new Set<string>(
        entityRegEntities.map((reg) => reg.entity_id)
      );

      // USERNOTE: Add the domain entities to the set
      for (const entity of domainEntities) {
        entityIds.add(entity);
      }

      return entityIds.size;
    }
  );

  /**
   * LLM: Device Finder
   *
   * Purpose:
   * Retrieves all devices associated with given config entries of this card/domain/integration.
   *
   * Implementation Details:
   * - Filters device registry entries by config entry IDs
   * - Uses memoization for performance
   *
   * @param configEntry - Configuration entries to find devices for
   * @param deviceRegistryEntries - Current device registry entries
   * @returns Array of matching device registry entries
   */
  private _getDevices = memoizeOne(
    (
      configEntry: ConfigEntry[],
      deviceRegistryEntries: HomeAssistant["devices"]
    ): DeviceRegistryEntry[] => {
      if (!deviceRegistryEntries) {
        return [];
      }
      const entryIds = configEntry.map((entry) => entry.entry_id);
      return Object.values(deviceRegistryEntries).filter((device) =>
        device.config_entries.some((entryId) => entryIds.includes(entryId))
      );
    }
  );

  static get styles(): CSSResultGroup {
    return [
      haStyle,
      css`
        ha-card {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          height: 100%;
          overflow: hidden;
          --state-color: var(--divider-color, #e0e0e0);
          --ha-card-border-color: var(--state-color);
          --state-message-color: var(--state-color);
        }
        .ripple-anchor {
          flex-grow: 1;
          position: relative;
          outline: none;
        }
        .ripple-anchor:focus-visible:before {
          position: absolute;
          display: block;
          content: "";
          inset: 0;
          background-color: var(--secondary-text-color);
          opacity: 0.08;
        }
        ha-integration-header {
          height: 100%;
        }
        .card-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .debug-logging {
          --state-color: var(--warning-color);
          --text-on-state-color: var(--primary-text-color);
        }
        .state-error {
          --state-color: var(--error-color);
          --text-on-state-color: var(--text-primary-color);
        }
        .state-failed-unload {
          --state-color: var(--warning-color);
          --text-on-state-color: var(--primary-text-color);
        }
        .state-not-loaded {
          opacity: 0.8;
          --state-color: var(--warning-color);
          --state-message-color: var(--primary-text-color);
        }
        .state-setup {
          opacity: 0.8;
          --state-message-color: var(--secondary-text-color);
        }
        :host(.highlight) ha-card {
          --state-color: var(--primary-color);
          --text-on-state-color: var(--text-primary-color);
        }
        .content {
          flex: 1;
          --mdc-list-side-padding-right: 20px;
          --mdc-list-side-padding-left: 24px;
          --mdc-list-item-graphic-margin: 24px;
        }
        a {
          text-decoration: none;
          color: var(--primary-text-color);
        }
        .icons {
          display: flex;
        }
        .icon {
          color: var(--label-badge-grey);
          padding: 4px;
          margin-left: 8px;
          margin-inline-start: 8px;
          margin-inline-end: initial;
        }
        .icon.custom {
          color: var(--warning-color);
        }
        .icon.overwrites {
          color: var(--error-color);
        }
        .icon ha-svg-icon {
          width: 24px;
          height: 24px;
          display: block;
        }
        .spacer {
          height: 36px;
        }
      `,
    ];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-integration-card": HaIntegrationCard;
  }
}
