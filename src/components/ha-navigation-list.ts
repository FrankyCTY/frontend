import type { CSSResultGroup, TemplateResult } from "lit";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators";
import { ifDefined } from "lit/directives/if-defined";
import type { PageNavigation } from "../layouts/hass-tabs-subpage";
import type { HomeAssistant } from "../types";
import "./ha-icon-next";
import "./ha-svg-icon";
import "./ha-md-list";
import "./ha-md-list-item";

/**
 * LLM: A flexible navigation list component for Home Assistant.
 *
 * Purpose: Creates a consistent, styled list of navigation items that can be used
 * throughout the Home Assistant UI. Handles rendering navigation pages as list items
 * with icons, labels, and descriptions.
 *
 * Role in Scope: Provides a standardized UI component for navigation across different
 * sections of the UI, maintaining visual consistency while being customizable.
 *
 * Features:
 * - Renders navigation items with icons and optional descriptions
 * - Handles both internal navigation and external app configurations
 * - Applies consistent styling across navigation items
 * - Adapts layout based on screen width (narrow mode)
 * - Ensures proper accessibility attributes
 */
@customElement("ha-navigation-list")
class HaNavigationList extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ type: Boolean }) public narrow = false;

  @property({ attribute: false }) public pages!: PageNavigation[];

  @property({ attribute: "has-secondary", type: Boolean })
  public hasSecondary = false;

  @property() public label?: string;

  /**
   * LLM: Renders a list of navigation items based on the provided pages.
   *
   * Each item includes:
   * - An icon with optional background color
   * - A primary label
   * - An optional secondary description
   * - A "next" icon on wider screens
   *
   * Special handling for external app configuration items is included.
   */
  public render(): TemplateResult {
    return html`
      <ha-md-list
        innerRole="menu"
        itemRoles="menuitem"
        innerAriaLabel=${ifDefined(this.label)}
      >
        ${this.pages.map((page) => {
          // LLM: Check if this is an external app configuration item, which needs special handling
          const externalApp = page.path.endsWith("#external-app-configuration");
          return html`
            <ha-md-list-item
              .type=${externalApp ? "button" : "link"}
              .href=${externalApp ? undefined : page.path}
              @click=${externalApp ? this._handleExternalApp : undefined}
            >
              <div
                slot="start"
                class=${page.iconColor ? "icon-background" : ""}
                .style="background-color: ${page.iconColor || "undefined"}"
              >
                <ha-svg-icon .path=${page.iconPath}></ha-svg-icon>
              </div>
              <span>${page.name}</span>
              ${this.hasSecondary
                ? html`<span slot="supporting-text">${page.description}</span>`
                : ""}
              ${!this.narrow
                ? html`<ha-icon-next slot="end"></ha-icon-next>`
                : ""}
            </ha-md-list-item>
          `;
        })}
      </ha-md-list>
    `;
  }

  /**
   * LLM: Handles click events for external app configuration items.
   *
   * Fires a message to the external auth system to show the configuration screen.
   * This allows companion apps to display their own configuration UI within Home Assistant.
   */
  private _handleExternalApp() {
    this.hass.auth.external!.fireMessage({ type: "config_screen/show" });
  }

  /**
   * LLM: Component styles for the navigation list.
   *
   * Key styling features:
   * - Consistent icon sizing and colors
   * - Special styling for icons with background colors
   * - Controls the font size of list items
   */
  static styles: CSSResultGroup = css`
    ha-svg-icon,
    ha-icon-next {
      color: var(--secondary-text-color);
      height: 24px;
      width: 24px;
      display: block;
    }
    ha-svg-icon {
      padding: 8px;
    }
    .icon-background {
      border-radius: 50%;
    }
    .icon-background ha-svg-icon {
      color: #fff;
    }
    ha-md-list-item {
      font-size: var(--navigation-list-item-title-font-size);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-navigation-list": HaNavigationList;
  }
}
