import type { CSSResultGroup, TemplateResult } from "lit";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators";
import { canShowPage } from "../../../common/config/can_show_page";
import "../../../components/ha-card";
import "../../../components/ha-icon-next";
import "../../../components/ha-navigation-list";
import type { CloudStatus } from "../../../data/cloud";
import type { PageNavigation } from "../../../layouts/hass-tabs-subpage";
import type { HomeAssistant } from "../../../types";

/**
 * LLM: Navigation component that displays all configuration options in the Home Assistant UI.
 *
 * Purpose: Renders a list of navigation items for the main configuration sections,
 * filtering items based on user permissions and configured components.
 *
 * Role in Scope: Core navigation component for the configuration dashboard.
 * Acts as a bridge between the configuration data structure and the UI rendering.
 *
 * Features:
 * - Shows/hides configuration options based on available components
 * - Handles special cases like cloud status and external app configuration
 * - Integrates with ha-navigation-list for consistent UI presentation
 */
@customElement("ha-config-navigation")
class HaConfigNavigation extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ type: Boolean }) public narrow = false;

  @property({ attribute: false }) public pages!: PageNavigation[];

  /**
   * LLM: Renders the navigation items for the configuration dashboard.
   *
   * Processes each page to:
   * 1. Filter out pages that shouldn't be shown based on user permissions
   * 2. Generate proper titles from translation keys
   * 3. Handle special description for cloud components
   */
  protected render(): TemplateResult {
    // LLM: Filter and transform the pages before rendering
    const pages = this.pages
      .filter((page) =>
        // LLM: Special case for external app configuration - only show if the auth system indicates a settings screen is available
        page.path === "#external-app-configuration"
          ? this.hass.auth.external?.config.hasSettingsScreen
          : canShowPage(this.hass, page)
      )
      .map((page) => ({
        ...page,
        // LLM: Get name from direct property or translation key
        name:
          page.name ||
          this.hass.localize(
            `ui.panel.config.dashboard.${page.translationKey}.main`
          ),
        // LLM: Special handling of description for cloud components with login state
        description:
          page.component === "cloud" && (page.info as CloudStatus)
            ? page.info.logged_in
              ? `
                  ${this.hass.localize(
                    "ui.panel.config.cloud.description_login"
                  )}
                `
              : `
                  ${this.hass.localize(
                    "ui.panel.config.cloud.description_features"
                  )}
                `
            : `
                ${
                  page.description ||
                  this.hass.localize(
                    `ui.panel.config.dashboard.${page.translationKey}.secondary`
                  )
                }
              `,
      }));

    // LLM: Use the ha-navigation-list component to render the final navigation with proper styling
    return html`
      <ha-navigation-list
        has-secondary
        .hass=${this.hass}
        .narrow=${this.narrow}
        .pages=${pages}
        .label=${this.hass.localize("panel.config")}
      ></ha-navigation-list>
    `;
  }

  /**
   * LLM: Custom styles for the navigation list.
   * Sets the font size for navigation items.
   */
  static styles: CSSResultGroup = css`
    ha-navigation-list {
      --navigation-list-item-title-font-size: 16px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-config-navigation": HaConfigNavigation;
  }
}
