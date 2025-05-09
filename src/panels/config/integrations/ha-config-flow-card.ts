import { mdiBookshelf, mdiCog, mdiDotsVertical, mdiOpenInNew } from "@mdi/js";
import type { TemplateResult } from "lit";
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators";
import { classMap } from "lit/directives/class-map";
import { fireEvent } from "../../../common/dom/fire_event";
import {
  ATTENTION_SOURCES,
  DISCOVERY_SOURCES,
  ignoreConfigFlow,
  localizeConfigFlowTitle,
} from "../../../data/config_flow";
import type { IntegrationManifest } from "../../../data/integration";
import { showConfigFlowDialog } from "../../../dialogs/config-flow/show-dialog-config-flow";
import { showConfirmationDialog } from "../../../dialogs/generic/show-dialog-box";
import type { HomeAssistant } from "../../../types";
import { documentationUrl } from "../../../util/documentation-url";
import type { DataEntryFlowProgressExtended } from "./ha-config-integrations";
import "./ha-integration-action-card";
import "../../../components/ha-button-menu";
import "../../../components/ha-button";
import "../../../components/ha-list-item";
// USERNOTE: An in-progress config flow represents a partially completed integration setup process. It could be triggered by:
// - Automatic discovery (e.g., mDNS, DHCP, USB)
// - User action (clicked "Add Integration")
// - External triggers (e.g., BLE Improv detection)

/**
 * LLM: Card component for displaying and managing in-progress configuration flows.
 *
 * Purpose: Provides a user interface for handling integration setup flows by:
 * - Displaying discovered or in-progress integrations
 * - Offering actions to continue or ignore the setup process
 * - Providing access to configuration URLs and documentation
 * - Supporting special handling for Improv device configuration
 *
 * Role in Scope: Acts as a bridge between the configuration flow system and the user,
 * presenting configuration options in a consistent card format with appropriate actions.
 *
 * Caveats & Side Effects:
 * - May trigger external device configuration via Improv
 * - Can modify the state of configuration flows
 * - May open external URLs or documentation
 * - Emits events that affect parent components
 */
@customElement("ha-config-flow-card")
export class HaConfigFlowCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ attribute: false }) public flow!: DataEntryFlowProgressExtended;

  @property({ attribute: false }) public manifest?: IntegrationManifest;

  /**
   * LLM: Renders the configuration flow card with appropriate actions and styling.
   *
   * Structure:
   * 1. Main action card with integration details
   * 2. Primary action button (Add/Reconfigure)
   * 3. Optional ignore button for discovered flows
   * 4. Menu with configuration URL and documentation links
   */
  protected render(): TemplateResult {
    // LLM: Determine if this flow requires special attention styling
    // - If the flow is a reauth flow, it requires attention e.g.
    const attention = ATTENTION_SOURCES.includes(this.flow.context.source);
    return html`
      <ha-integration-action-card
        class=${classMap({
          attention: attention,
        })}
        .hass=${this.hass}
        .manifest=${this.manifest}
        .domain=${this.flow.handler}
        .label=${this.flow.localized_title}
      >
        <!-- LLM: Primary action button - shows "Add" or "Reconfigure" based on flow type -->
        <ha-button
          unelevated
          @click=${this._continueFlow}
          .label=${this.hass.localize(
            attention
              ? "ui.panel.config.integrations.reconfigure"
              : "ui.common.add"
          )}
        ></ha-button>
        <!-- LLM: Show ignore button only for discovered flows with unique IDs -->
        ${DISCOVERY_SOURCES.includes(this.flow.context.source) &&
        this.flow.context.unique_id
          ? html`<ha-button
              @click=${this._ignoreFlow}
              .label=${this.hass.localize(
                "ui.panel.config.integrations.ignore.ignore"
              )}
            ></ha-button>`
          : ""}
        <!-- LLM: Menu with additional actions if configuration URL or manifest exists -->
        ${this.flow.context.configuration_url || this.manifest
          ? html`<ha-button-menu slot="header-button">
              <ha-icon-button
                slot="trigger"
                .label=${this.hass.localize("ui.common.menu")}
                .path=${mdiDotsVertical}
              ></ha-icon-button>
              <!-- LLM: Configuration URL link if available -->
              ${this.flow.context.configuration_url
                ? html`<a
                    href=${this.flow.context.configuration_url.replace(
                      /^homeassistant:\/\//,
                      "/"
                    )}
                    rel="noreferrer"
                    target=${this.flow.context.configuration_url.startsWith(
                      "homeassistant://"
                    )
                      ? "_self"
                      : "_blank"}
                  >
                    <ha-list-item graphic="icon" hasMeta>
                      ${this.hass.localize(
                        "ui.panel.config.integrations.config_entry.open_configuration_url"
                      )}
                      <ha-svg-icon slot="graphic" .path=${mdiCog}></ha-svg-icon>
                      <ha-svg-icon
                        slot="meta"
                        .path=${mdiOpenInNew}
                      ></ha-svg-icon>
                    </ha-list-item>
                  </a>`
                : ""}
              <!-- LLM: Documentation link if manifest exists -->
              ${this.manifest
                ? html`<a
                    href=${this.manifest.is_built_in
                      ? documentationUrl(
                          this.hass,
                          `/integrations/${this.manifest.domain}`
                        )
                      : this.manifest.documentation}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ha-list-item graphic="icon" hasMeta>
                      ${this.hass.localize(
                        "ui.panel.config.integrations.config_entry.documentation"
                      )}
                      <ha-svg-icon
                        slot="graphic"
                        .path=${mdiBookshelf}
                      ></ha-svg-icon>
                      <ha-svg-icon
                        slot="meta"
                        .path=${mdiOpenInNew}
                      ></ha-svg-icon>
                    </ha-list-item>
                  </a>`
                : ""}
            </ha-button-menu>`
          : ""}
      </ha-integration-action-card>
    `;
  }

  /**
   * LLM: Continues or initiates the configuration flow.
   *
   * Purpose: Handles the primary action of continuing a configuration flow,
   * with special handling for external Improv device configuration.
   *
   * Side Effects:
   * - May trigger external device configuration
   * - May open configuration dialog
   * - Emits change event on completion
   */
  private _continueFlow() {
    // LLM: Handle external Improv device configuration
    if (this.flow.flow_id === "external") {
      this.hass.auth.external!.fireMessage({
        type: "improv/configure_device",
        payload: {
          name:
            this.flow.localized_title ||
            this.flow.context.title_placeholders.name,
        },
      });
      return;
    }
    // LLM: Open configuration dialog for standard flows
    showConfigFlowDialog(this, {
      continueFlowId: this.flow.flow_id,
      navigateToResult: true,
      dialogClosedCallback: () => {
        this._handleFlowUpdated();
      },
    });
  }

  /**
   * LLM: Handles ignoring a discovered configuration flow.
   *
   * Purpose: Allows users to dismiss discovered integrations they don't want to configure.
   *
   * Side Effects:
   * - Shows confirmation dialog
   * - May update flow state
   * - Emits change event on completion
   */
  private async _ignoreFlow() {
    // LLM: Show confirmation dialog before ignoring
    const confirmed = await showConfirmationDialog(this, {
      title: this.hass!.localize(
        "ui.panel.config.integrations.ignore.confirm_ignore_title",
        { name: localizeConfigFlowTitle(this.hass.localize, this.flow) }
      ),
      text: this.hass!.localize(
        "ui.panel.config.integrations.ignore.confirm_ignore"
      ),
      confirmText: this.hass!.localize(
        "ui.panel.config.integrations.ignore.ignore"
      ),
    });
    if (!confirmed) {
      return;
    }
    // LLM: Update flow state to ignored
    await ignoreConfigFlow(
      this.hass,
      this.flow.flow_id,
      localizeConfigFlowTitle(this.hass.localize, this.flow)
    );
    this._handleFlowUpdated();
  }

  private _handleFlowUpdated() {
    fireEvent(this, "change", undefined, {
      bubbles: false,
    });
  }

  static styles = css`
    a {
      text-decoration: none;
      color: var(--primary-color);
    }
    ha-button-menu {
      color: var(--secondary-text-color);
    }
    ha-svg-icon[slot="meta"] {
      width: 18px;
      height: 18px;
    }
    .attention {
      --mdc-theme-primary: var(--error-color);
      --ha-card-border-color: var(--error-color);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-config-flow-card": HaConfigFlowCard;
  }
}
