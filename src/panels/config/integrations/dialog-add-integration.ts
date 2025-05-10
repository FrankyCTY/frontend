import "@material/mwc-button";

import type { IFuseOptions } from "fuse.js";
import Fuse from "fuse.js";
import type { HassConfig } from "home-assistant-js-websocket";
import type { PropertyValues, TemplateResult } from "lit";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators";
import { ifDefined } from "lit/directives/if-defined";
import { styleMap } from "lit/directives/style-map";
import memoizeOne from "memoize-one";
import { isComponentLoaded } from "../../../common/config/is_component_loaded";
import { fireEvent } from "../../../common/dom/fire_event";
import {
  PROTOCOL_INTEGRATIONS,
  protocolIntegrationPicked,
} from "../../../common/integrations/protocolIntegrationPicked";
import { navigate } from "../../../common/navigate";
import { caseInsensitiveStringCompare } from "../../../common/string/compare";
import type { LocalizeFunc } from "../../../common/translations/localize";
import { createCloseHeading } from "../../../components/ha-dialog";
import "../../../components/ha-icon-button-prev";
import "../../../components/ha-list";
import "../../../components/ha-spinner";
import "../../../components/search-input";
import { getConfigEntries } from "../../../data/config_entries";
import { fetchConfigFlowInProgress } from "../../../data/config_flow";
import type { DataEntryFlowProgress } from "../../../data/data_entry_flow";
import {
  domainToName,
  fetchIntegrationManifest,
} from "../../../data/integration";
import type {
  Brand,
  Brands,
  Integration,
  Integrations,
} from "../../../data/integrations";
import {
  findIntegration,
  getIntegrationDescriptions,
} from "../../../data/integrations";
import { showConfigFlowDialog } from "../../../dialogs/config-flow/show-dialog-config-flow";
import {
  showAlertDialog,
  showConfirmationDialog,
} from "../../../dialogs/generic/show-dialog-box";
import { haStyleDialog, haStyleScrollbar } from "../../../resources/styles";
import { loadVirtualizer } from "../../../resources/virtualizer";
import type { HomeAssistant } from "../../../types";
import "./ha-domain-integrations";
import "./ha-integration-list-item";
import type { AddIntegrationDialogParams } from "./show-add-integration-dialog";
import { showYamlIntegrationDialog } from "./show-add-integration-dialog";

/**
 * LLM: Interface defining the structure of an integration list item
 * Purpose: Represents an integration in the UI with its properties and capabilities
 * Role: Used throughout the dialog to display and handle different types of integrations
 * Caveats: Properties determine how the integration is handled in the setup flow
 */
export interface IntegrationListItem {
  name: string;
  domain: string;
  config_flow?: boolean;
  is_helper?: boolean;
  integrations?: string[];
  domains?: string[];
  iot_standards?: string[];
  // USERNOTE: Delegated Integration Setup to Protocol Integration
  // USERNOTE: Indicates that this integration is supported by another integration, usually a protocol integration. (e.g., Zha, Z-Wave, Matter)
  supported_by?: string;
  // USERNOTE: Is Iot class starts with 'cloud_'
  // USERNOTE: These are integrations that are cloud-based and require an internet connection.
  cloud?: boolean;
  is_built_in?: boolean;
  overwrites_built_in?: boolean;
  // USERNOTE: For those protocol integrations (e.g., Zha, Z-Wave, Matter) that can be added to.
  // USERNOTE: Indicates there is integrated (already set up) protocol integration that this integration can be added to.
  is_add?: boolean;
  single_config_entry?: boolean;
}

/**
 * LLM: Main dialog component for adding new integrations
 * Purpose: Provides a unified interface for adding different types of integrations
 * Role: Entry point for integration setup, handles different integration types
 * Caveats: Manages complex state for different integration flows
 */
@customElement("dialog-add-integration")
class AddIntegrationDialog extends LitElement {
  public hass!: HomeAssistant;

  @state() private _integrations?: Brands;

  // USERNOTE: Helper Integrations: These are typically UI-configurable entities that users can add to enhance automation logic, dashboards, or behavior
  // - They aren't traditional device or service integrations.
  @state() private _helpers?: Integrations;

  @state() private _initialFilter?: string;

  @state() private _filter?: string;

  @state() private _pickedBrand?: string;

  @state() private _prevPickedBrand?: string;

  @state() private _flowsInProgress?: DataEntryFlowProgress[];

  @state() private _open = false;

  @state() private _narrow = false;

  private _width?: number;

  private _height?: number;

  /**
   * LLM: Shows the integration dialog with optional parameters
   * Purpose: Entry point for adding new integrations
   * Role: Initializes the dialog and starts the integration process
   * Caveats: Handles different entry points (brand, domain, initial filter)
   */
  public async showDialog(params?: AddIntegrationDialogParams): Promise<void> {
    // eslint-disable-next-line no-console
    console.log("dialog-add-integration", params);
    const loadPromise = this._load();
    this._open = true;
    this._pickedBrand = params?.brand;
    this._initialFilter = params?.initialFilter;
    this._narrow = matchMedia(
      "all and (max-width: 450px), all and (max-height: 500px)"
    ).matches;
    if (params?.domain) {
      this._createFlow(params.domain);
    }
    if (params?.brand) {
      await loadPromise;
      const brand = this._integrations?.[params.brand];
      if (brand && "integrations" in brand && brand.integrations) {
        this._fetchFlowsInProgress(Object.keys(brand.integrations));
      }
    }
  }

  public closeDialog() {
    this._open = false;
    this._integrations = undefined;
    this._helpers = undefined;
    this._pickedBrand = undefined;
    this._prevPickedBrand = undefined;
    this._flowsInProgress = undefined;
    this._filter = undefined;
    this._width = undefined;
    this._height = undefined;
    fireEvent(this, "dialog-closed", { dialog: this.localName });
  }

  public willUpdate(changedProps: PropertyValues): void {
    super.willUpdate(changedProps);

    if (!this.hasUpdated) {
      loadVirtualizer();
    }

    if (this._filter === undefined && this._initialFilter !== undefined) {
      this._filter = this._initialFilter;
    }
    if (this._initialFilter !== undefined && this._filter === "") {
      this._initialFilter = undefined;
      this._filter = undefined;
      this._width = undefined;
      this._height = undefined;
    } else if (
      this.hasUpdated &&
      changedProps.has("_filter") &&
      !changedProps.has("_open") &&
      (!this._width || !this._height)
    ) {
      // Store the width and height so that when we search, box doesn't jump
      const boundingRect =
        this.shadowRoot!.querySelector("ha-list")?.getBoundingClientRect();
      this._width = boundingRect?.width;
      this._height = boundingRect?.height;
    }
  }

  /**
   * LLM: Filters and categorizes integrations based on their type
   * Purpose: Organizes integrations for display in the UI
   * Role: Determines how each integration should be handled
   * Caveats: Complex logic for handling different integration types
   *
   * Data Sources:
   * - i: Brands - Core and custom integrations from getIntegrationDescriptions
   * - h: Integrations - Helper integrations from getIntegrationDescriptions
   * - components: HassConfig["components"] - List of loaded components
   * - localize: LocalizeFunc - Function for translating strings
   * - filter?: string - Optional search filter
   *
   * Performance:
   * - Uses memoizeOne to cache results
   * - Only recomputes when inputs change
   * - Optimizes UI rendering performance
   */
  private _filterIntegrations = memoizeOne(
    (
      i: Brands,
      h: Integrations,
      components: HassConfig["components"],
      localize: LocalizeFunc,
      filter?: string
    ): IntegrationListItem[] => {
      // USERNOTE: For direct protocol integrations which only need to 'trigger device pairing flows' since there are already integrated protocol integrations. (e.g., Zha, Z-Wave, Matter)
      const addDeviceRows: IntegrationListItem[] = PROTOCOL_INTEGRATIONS.filter(
        (domain) => components.includes(domain)
      )
        .map((domain) => ({
          name: localize(`ui.panel.config.integrations.add_${domain}_device`),
          domain,
          config_flow: true,
          is_built_in: true,
          is_add: true,
        }))
        .sort((a, b) =>
          caseInsensitiveStringCompare(
            a.name,
            b.name,
            this.hass.locale.language
          )
        );

      // USERNOTE: Separates UI-configurable integrations and YAML-only integrations for different display logic.
      const integrations: IntegrationListItem[] = [];
      const yamlIntegrations: IntegrationListItem[] = [];

      // FIXME: Why integration with type 'Brand' | 'Integration'?
      Object.entries(i).forEach(([domain, integration]) => {
        // LLM: Skip hardware integrations as they can't be added via UI
        if (
          "integration_type" in integration &&
          integration.integration_type === "hardware"
        ) {
          return;
        }

        // USERNOTE: For integrations that support config flow, IoT standards, or supported by another integration.
        if (
          "integration_type" in integration &&
          (integration.config_flow ||
            integration.iot_standards ||
            integration.supported_by)
        ) {
          const supportedIntegration = integration.supported_by
            ? findIntegration(this._integrations, integration.supported_by)
            : integration;
          if (!supportedIntegration) {
            return;
          }
          integrations.push({
            domain,
            name: integration.name || domainToName(localize, domain),
            config_flow: supportedIntegration.config_flow,
            iot_standards: supportedIntegration.iot_standards,
            supported_by: integration.supported_by,
            is_built_in: supportedIntegration.is_built_in !== false,
            overwrites_built_in: integration.overwrites_built_in,
            cloud: supportedIntegration.iot_class?.startsWith("cloud_"),
            // USERNOTE: Indicates that this integration allows only one configuration
            single_config_entry: integration.single_config_entry,
          });
        } else if (
          // USERNOTE: For meta-integrations: These entries do not represent a single integration in the traditional sense, but rather a collection of multiple related integrations under a recognizable brand or ecosystem umbrella (Apple, Google, Amazon, etc.).
          !("integration_type" in integration) &&
          ("iot_standards" in integration || "integrations" in integration)
        ) {
          integrations.push({
            domain,
            name: integration.name || domainToName(localize, domain),
            iot_standards: integration.iot_standards,
            integrations: integration.integrations
              ? Object.entries(integration.integrations).map(
                  ([dom, val]) => val.name || domainToName(localize, dom)
                )
              : undefined,
            domains: integration.integrations
              ? Object.keys(integration.integrations)
              : undefined,
            is_built_in: integration.is_built_in !== false,
            overwrites_built_in: integration.overwrites_built_in,
          });
          // USERNOTE: For YAML-only integrations: These integrations don't support UI config (no config_flow) and require manual YAML setup.
        } else if (filter && "integration_type" in integration) {
          yamlIntegrations.push({
            domain,
            name: integration.name || domainToName(localize, domain),
            config_flow: integration.config_flow,
            is_built_in: integration.is_built_in !== false,
            overwrites_built_in: integration.overwrites_built_in,
            cloud: integration.iot_class?.startsWith("cloud_"),
          });
        }
      });

      // LLM: Apply search filter if provided
      // Purpose: Filter integrations based on user search
      // Role: Enables quick finding of integrations
      // Caveats: Uses Fuse.js for fuzzy search
      if (filter) {
        const options: IFuseOptions<IntegrationListItem> = {
          keys: [
            { name: "name", weight: 5 },
            { name: "domain", weight: 5 },
            { name: "integrations", weight: 2 },
            "supported_by",
            "iot_standards",
          ],
          isCaseSensitive: false,
          minMatchCharLength: Math.min(filter.length, 2),
          threshold: 0.2,
          ignoreDiacritics: true,
        };

        // LLM: Process helper integrations for search
        // Purpose: Include helper integrations in search results
        // Role: Makes helpers discoverable through search
        const helpers = Object.entries(h).map(([domain, integration]) => ({
          domain,
          name: integration.name || domainToName(localize, domain),
          config_flow: integration.config_flow,
          is_helper: true,
          is_built_in: integration.is_built_in !== false,
          cloud: integration.iot_class?.startsWith("cloud_"),
        }));

        // LLM: Return filtered results
        // Purpose: Combine and return search results
        // Role: Provides filtered integration list to UI
        return [
          ...new Fuse(integrations, options)
            .search(filter)
            .map((result) => result.item),
          ...new Fuse(yamlIntegrations, options)
            .search(filter)
            .map((result) => result.item),
          ...new Fuse(helpers, options)
            .search(filter)
            .map((result) => result.item),
        ];
      }

      // LLM: Return unfiltered list
      // Purpose: Show all available integrations
      // Role: Provides complete integration list to UI
      return [
        ...addDeviceRows,
        ...integrations.sort((a, b) =>
          caseInsensitiveStringCompare(
            a.name || "",
            b.name || "",
            this.hass.locale.language
          )
        ),
      ];
    }
  );

  /**
   * LLM: Gets the filtered list of integrations
   * Purpose: Provides access to filtered integration list
   * Role: Used by render method to display integrations
   * Caveats: Depends on _filterIntegrations memoization
   */
  private _getIntegrations() {
    return this._filterIntegrations(
      this._integrations!,
      this._helpers!,
      this.hass.config.components,
      this.hass.localize,
      this._filter
    );
  }

  protected render() {
    if (!this._open) {
      return nothing;
    }
    const integrations = this._integrations
      ? this._getIntegrations()
      : undefined;

    const pickedIntegration = this._pickedBrand
      ? this._integrations?.[this._pickedBrand] ||
        findIntegration(this._integrations, this._pickedBrand)
      : undefined;

    // USERNOTE: Render specific integration or all integrations
    return html`<ha-dialog
      open
      @closed=${this.closeDialog}
      scrimClickAction
      hideActions
      .heading=${createCloseHeading(
        this.hass,
        this.hass.localize("ui.panel.config.integrations.new")
      )}
    >
      ${this._pickedBrand && (!this._integrations || pickedIntegration)
        ? html`<div slot="heading">
              <ha-icon-button-prev
                @click=${this._prevClicked}
              ></ha-icon-button-prev>
              <h2 class="mdc-dialog__title">
                ${this._calculateBrandHeading(pickedIntegration)}
              </h2>
            </div>
            ${this._renderIntegration(pickedIntegration)}`
        : this._renderAll(integrations)}
    </ha-dialog>`;
  }

  private _calculateBrandHeading(integration: Brand | Integration | undefined) {
    if (
      integration?.iot_standards &&
      !("integrations" in integration) &&
      !this._flowsInProgress?.length
    ) {
      return this.hass.localize(
        "ui.panel.config.integrations.what_device_type"
      );
    }
    if (
      integration &&
      !integration?.iot_standards &&
      !("integrations" in integration) &&
      this._flowsInProgress?.length
    ) {
      return this.hass.localize(
        "ui.panel.config.integrations.confirm_add_discovered"
      );
    }
    return this.hass.localize("ui.panel.config.integrations.what_to_add");
  }

  private _renderIntegration(
    integration: Brand | Integration | undefined
  ): TemplateResult {
    return html`<ha-domain-integrations
      .hass=${this.hass}
      .domain=${this._pickedBrand}
      .integration=${integration}
      .flowsInProgress=${this._flowsInProgress}
      style=${styleMap({
        minWidth: `${this._width}px`,
        minHeight: `581px`,
      })}
      @close-dialog=${this.closeDialog}
      @supported-by=${this._handleSupportedByEvent}
      @select-brand=${this._handleSelectBrandEvent}
    ></ha-domain-integrations>`;
  }

  private _handleSelectBrandEvent(ev: CustomEvent) {
    this._prevPickedBrand = this._pickedBrand;
    this._pickedBrand = ev.detail.brand;
  }

  private _handleSupportedByEvent(ev: CustomEvent) {
    this._supportedBy(ev.detail.integration);
  }

  /**
   * LLM: Integration Support Handler
   *
   * Purpose:
   * Handles the case where an integration is supported by another integration, showing a confirmation
   * dialog and routing to the appropriate setup flow.
   *
   * Role in Scope:
   * - Part of the integration setup flow
   * - Bridges between supported integrations and their supporting integrations
   * - Ensures users understand the relationship between integrations
   *
   * Caveats:
   * - Requires the supporting integration to exist in the system
   * - May trigger protocol-specific flows for certain integrations
   * - Can fail if the supporting integration is not found
   *
   * @param integration - The integration that is supported by another integration
   */
  private _supportedBy(integration) {
    // LLM: Find the supporting integration that provides the actual functionality
    const supportIntegration = findIntegration(
      this._integrations,
      integration.supported_by
    );

    // LLM: Show confirmation dialog explaining the integration relationship
    showConfirmationDialog(this, {
      text: this.hass.localize(
        "ui.panel.config.integrations.config_flow.supported_brand_flow",
        {
          supported_brand:
            integration.name ||
            domainToName(this.hass.localize, integration.domain),
          flow_domain_name:
            supportIntegration?.name ||
            domainToName(this.hass.localize, integration.supported_by),
        }
      ),
      confirm: () => {
        this.closeDialog();
        // LLM: Handle protocol-specific integrations (e.g., Zha, Z-Wave, Matter)
        // USERNOTE: Protocol specific integration: Integrations for user to set up the protocol layer (e.g., ZHA, Z-Wave JS, Matter) that enables many brands/devices to connect.
        if (PROTOCOL_INTEGRATIONS.includes(integration.supported_by)) {
          protocolIntegrationPicked(this, this.hass, integration.supported_by);
          return;
        }
        // LLM: If supporting integration exists, start its setup flow
        if (supportIntegration) {
          this._handleIntegrationPicked({
            domain: integration.supported_by,
            name:
              supportIntegration.name ||
              domainToName(this.hass.localize, integration.supported_by),
            config_flow: supportIntegration.config_flow,
            iot_standards: supportIntegration.iot_standards,
          });
        } else {
          // LLM: Show error if supporting integration is not found
          showAlertDialog(this, {
            text: "Integration not found",
            warning: true,
          });
        }
      },
    });
  }

  // USERNOTE: Render "all integrations" dialog content
  private _renderAll(integrations?: IntegrationListItem[]): TemplateResult {
    return html`<search-input
        .hass=${this.hass}
        dialogInitialFocus=${ifDefined(this._narrow ? undefined : "")}
        .filter=${this._filter}
        @value-changed=${this._filterChanged}
        .label=${this.hass.localize(
          "ui.panel.config.integrations.search_brand"
        )}
        @keypress=${this._maybeSubmit}
      ></search-input>
      ${integrations
        ? html`<ha-list
            dialogInitialFocus=${ifDefined(this._narrow ? "" : undefined)}
          >
            <lit-virtualizer
              scroller
              tabindex="-1"
              class="ha-scrollbar"
              style=${styleMap({
                width: `${this._width}px`,
                height: this._narrow ? "calc(100vh - 184px)" : "500px",
              })}
              @click=${this._integrationPicked}
              @keypress=${this._handleKeyPress}
              .items=${integrations}
              .keyFunction=${this._keyFunction}
              .renderItem=${this._renderRow}
            >
            </lit-virtualizer>
          </ha-list>`
        : html`<div class="flex center">
            <ha-spinner></ha-spinner>
          </div>`} `;
  }

  private _keyFunction = (integration: IntegrationListItem) =>
    integration.domain;

  private _renderRow = (integration: IntegrationListItem) => {
    if (!integration) {
      return nothing;
    }
    return html`
      <ha-integration-list-item
        brand
        .hass=${this.hass}
        .integration=${integration}
        tabindex="0"
      >
      </ha-integration-list-item>
    `;
  };

  private async _load() {
    const descriptions = await getIntegrationDescriptions(this.hass);
    for (const integration in descriptions.custom.integration) {
      if (
        !Object.prototype.hasOwnProperty.call(
          descriptions.custom.integration,
          integration
        )
      ) {
        continue;
      }
      descriptions.custom.integration[integration].is_built_in = false;
    }
    this._integrations = {
      ...descriptions.core.integration,
      ...descriptions.custom.integration,
    };
    for (const integration in descriptions.custom.helper) {
      if (
        !Object.prototype.hasOwnProperty.call(
          descriptions.custom.helper,
          integration
        )
      ) {
        continue;
      }
      descriptions.custom.helper[integration].is_built_in = false;
    }
    this._helpers = {
      ...descriptions.core.helper,
      ...descriptions.custom.helper,
    };
    this.hass.loadBackendTranslation(
      "title",
      descriptions.core.translated_name,
      true
    );
  }

  private async _filterChanged(e) {
    this._filter = e.detail.value;
  }

  // USERNOTE: Handles integration picked
  private _integrationPicked(ev) {
    const listItem = ev.target.closest("ha-integration-list-item");
    if (!listItem) {
      return;
    }
    this._handleIntegrationPicked(listItem.integration);
  }

  private _handleKeyPress(ev) {
    if (ev.key === "Enter") {
      this._integrationPicked(ev);
    }
  }

  /**
   * USERNOTE: Handles integration selection and starts the appropriate setup flow.
   *
   * Purpose:
   * - Acts as the central routing function for all integration types when selected from the integrations dialog.
   *
   * Handles:
   * - Integrations supported by another (via `supported_by`) — redirects to the supporting protocol.
   * - Protocol integrations marked with `is_add` — starts device pairing (e.g., ZHA, Z-Wave, Matter).
   * - Helper integrations (`is_helper`) — navigates to the Helpers UI for entity creation (e.g., input_boolean).
   * - Brand collections (`integrations`) — displays grouped integrations under a common brand (e.g., Apple, Google) in a dialog.
   * - Already-loaded protocol integrations — switches view to the protocol section (for status or device management).
   * - IoT standard integrations (`iot_standards`) — shows protocol-specific integration views.
   * - Single-config-entry integrations (`single_config_entry`) — prevents reconfiguration if already set up.
   * - UI-configurable integrations (`config_flow`) — starts the integration config flow.
   * - Home Assistant Cloud integration (`domain === "cloud"`) — navigates to cloud settings.
   * - Voice assistant integrations (`google_assistant`, `alexa`) — navigates to assistant configuration.
   * - YAML-only integrations (fallback) — fetches and shows manifest instructions.
   */
  private async _handleIntegrationPicked(integration: IntegrationListItem) {
    // eslint-disable-next-line no-console
    console.log("Picked integration from add integration dialog", integration);
    // LLM: This integration is supported by a other integration (likely a protocol integration).
    if (integration.supported_by) {
      this._supportedBy(integration);
      return;
    }

    // LLM: Handle adding devices to existing protocol integrations
    // This path is for when a protocol integration is already set up and we want to add more devices
    if (integration.is_add) {
      protocolIntegrationPicked(this, this.hass, integration.domain);
      this.closeDialog();
      return;
    }

    // USERNOTE: Handle helper integrations (e.g., input_boolean, counter)
    // These are simple logic or UI helpers created via the Helpers UI
    if (integration.is_helper) {
      this.closeDialog();
      navigate(`/config/helpers/add?domain=${integration.domain}`);
      return;
    }

    // USERNOTE: Brand (meta) collections (`integrations`) — displays grouped integrations under a common brand (e.g., Apple, Google) in a dialog.
    if (integration.integrations) {
      let domains = integration.domains || [];
      // LLM: Special case for Apple integration - exclude HomeKit controller from brand view
      if (integration.domain === "apple") {
        domains = domains.filter((domain) => domain !== "homekit_controller");
      }
      this._fetchFlowsInProgress(domains);
      this._pickedBrand = integration.domain;
      return;
    }

    // USERNOTE: Handle already-loaded protocol integrations
    // These protocols (e.g., ZHA, Z-Wave, Matter) are already set up,
    // so update the UI to show their integration section (e.g., for pairing new devices)
    if (
      (PROTOCOL_INTEGRATIONS as readonly string[]).includes(
        integration.domain
      ) &&
      // USERNOTE: Component loaded means it can be used already.
      isComponentLoaded(this.hass, integration.domain)
    ) {
      this._pickedBrand = integration.domain;
      return;
    }

    // LLM: Handle IoT standard integrations
    // These are integrations that follow specific IoT protocols or standards
    if (integration.iot_standards) {
      this._pickedBrand = integration.domain;
      return;
    }

    // LLM: Handle integrations that only allow a single configuration
    // These integrations can only be configured once in the system
    if (integration.single_config_entry) {
      const configEntries = await getConfigEntries(this.hass, {
        domain: integration.domain,
      });
      if (configEntries.length > 0) {
        this.closeDialog();
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
              integration_name: domainToName(localize, integration.name),
            }
          ),
        });
        return;
      }
    }

    // LLM: Handle integrations with config flow
    // These integrations support UI-based configuration
    if (integration.config_flow) {
      this._createFlow(integration.domain);
      return;
    }

    // NOTE: This is not cloud flag (which indicates require internet access), but cloud domain.
    // USERNOTE: Handle the Home Assistant Cloud integration (Nabu Casa)
    // Opens the cloud settings page for account management and remote access
    if (
      integration.domain === "cloud" &&
      isComponentLoaded(this.hass, "cloud")
    ) {
      this.closeDialog();
      navigate("/config/cloud");
      return;
    }

    // USERNOTE: Handle Google Assistant and Alexa integrations (via Home Assistant Cloud)
    // These are managed through Home Assistant Cloud and require cloud component loaded
    if (
      ["google_assistant", "alexa"].includes(integration.domain) &&
      isComponentLoaded(this.hass, "cloud")
    ) {
      this.closeDialog();
      navigate("/config/voice-assistants/assistants");
      return;
    }

    // LLM: Handle YAML-based integrations
    // These integrations require manual YAML configuration
    // USERNOTE: Fetch integration yaml manifest from HA core
    const manifest = await fetchIntegrationManifest(
      this.hass,
      integration.domain
    );
    showYamlIntegrationDialog(this, { manifest });
  }

  private async _createFlow(domain: string) {
    const flowsInProgress = await this._fetchFlowsInProgress([domain]);

    if (flowsInProgress?.length) {
      this._pickedBrand = domain;
      return;
    }

    const manifest = await fetchIntegrationManifest(this.hass, domain);

    this.closeDialog();

    showConfigFlowDialog(this, {
      startFlowHandler: domain,
      showAdvanced: this.hass.userData?.showAdvanced,
      manifest,
      navigateToResult: true,
    });
  }

  private async _fetchFlowsInProgress(domains: string[]) {
    const flowsInProgress = (
      await fetchConfigFlowInProgress(this.hass.connection)
    ).filter(
      (flow) =>
        // filter config flows that are not for the integration we are looking for
        domains.includes(flow.handler) ||
        // filter config flows of other domains (like homekit) that are for the domains we are looking for
        ("alternative_domain" in flow.context &&
          domains.includes(flow.context.alternative_domain))
    );

    if (flowsInProgress.length) {
      this._flowsInProgress = flowsInProgress;
    }
    return flowsInProgress;
  }

  private _maybeSubmit(ev: KeyboardEvent) {
    if (ev.key !== "Enter") {
      return;
    }

    const integrations = this._getIntegrations();

    if (integrations.length > 0) {
      this._handleIntegrationPicked(integrations[0]);
    }
  }

  private _prevClicked() {
    this._pickedBrand = this._prevPickedBrand;
    if (!this._prevPickedBrand) {
      this._flowsInProgress = undefined;
    }
    this._prevPickedBrand = undefined;
  }

  static styles = [
    haStyleScrollbar,
    haStyleDialog,
    css`
      @media all and (min-width: 550px) {
        ha-dialog {
          --mdc-dialog-min-width: 500px;
        }
      }
      ha-dialog {
        --dialog-content-padding: 0;
      }
      search-input {
        display: block;
        margin: 16px 16px 0;
      }
      .divider {
        border-bottom-color: var(--divider-color);
      }
      h2 {
        padding-inline-end: 66px;
        direction: var(--direction);
      }
      p {
        text-align: center;
        padding: 16px;
        margin: 0;
      }
      p > a {
        color: var(--primary-color);
      }
      .flex.center {
        display: flex;
        justify-content: center;
        align-items: center;
      }
      ha-spinner {
        margin: 24px 0;
      }
      ha-list {
        position: relative;
      }
      lit-virtualizer {
        contain: size layout !important;
      }
      ha-integration-list-item {
        width: 100%;
      }
      ha-icon-button-prev {
        color: var(--secondary-text-color);
        position: absolute;
        left: 16px;
        top: 14px;
        inset-inline-end: initial;
        inset-inline-start: 16px;
        direction: var(--direction);
      }
      .mdc-dialog__title {
        margin: 0;
        margin-bottom: 8px;
        margin-left: 48px;
        margin-inline-start: 48px;
        margin-inline-end: initial;
        padding: 24px 24px 0 24px;
        color: var(--mdc-dialog-heading-ink-color, rgba(0, 0, 0, 0.87));
        font-size: var(
          --mdc-typography-headline6-font-size,
          var(--ha-font-size-l)
        );
        line-height: var(--mdc-typography-headline6-line-height, 2rem);
        font-weight: var(
          --mdc-typography-headline6-font-weight,
          var(--ha-font-weight-medium)
        );
        letter-spacing: var(
          --mdc-typography-headline6-letter-spacing,
          0.0125em
        );
        text-decoration: var(
          --mdc-typography-headline6-text-decoration,
          inherit
        );
        text-transform: var(--mdc-typography-headline6-text-transform, inherit);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "dialog-add-integration": AddIntegrationDialog;
  }
}
