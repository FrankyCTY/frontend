import { mdiMenu } from "@mdi/js";
import type { UnsubscribeFunc } from "home-assistant-js-websocket";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators";
import { fireEvent } from "../common/dom/fire_event";
import { subscribeNotifications } from "../data/persistent_notification";
import type { HomeAssistant } from "../types";
import "./ha-icon-button";

/**
 * LLM: Menu button component that toggles the Home Assistant sidebar.
 *
 * Purpose: Provides a hamburger menu button that appears conditionally based on screen size
 * and sidebar configuration. Shows a notification indicator when notifications are present.
 *
 * Role in Scope: Part of the top navigation UI that controls sidebar visibility, especially
 * important on mobile/narrow views where the sidebar is hidden by default.
 */
@customElement("ha-menu-button")
class HaMenuButton extends LitElement {
  @property({ type: Boolean }) public hassio = false;

  @property({ type: Boolean }) public narrow = false;

  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private _hasNotifications = false;

  @state() private _show = false;

  /**
   * LLM: Flag to always show the menu button regardless of other conditions.
   * Used for backward compatibility with older Hass.io versions.
   */
  private _alwaysVisible = false;

  /**
   * LLM: Flag to reattach notification subscription when component reconnects.
   */
  private _attachNotifOnConnect = false;

  private _unsubNotifications?: UnsubscribeFunc;

  /**
   * LLM: Lifecycle callback when component is connected to the DOM.
   * Reattaches notification subscription if needed.
   */
  public connectedCallback() {
    super.connectedCallback();
    if (this._attachNotifOnConnect) {
      this._attachNotifOnConnect = false;
      this._subscribeNotifications();
    }
  }

  /**
   * LLM: Lifecycle callback when component is disconnected from the DOM.
   * Cleans up notification subscription and sets flag to reattach when reconnected.
   */
  public disconnectedCallback() {
    super.disconnectedCallback();
    if (this._unsubNotifications) {
      this._attachNotifOnConnect = true;
      this._unsubNotifications();
      this._unsubNotifications = undefined;
    }
  }

  /**
   * LLM: Renders the menu button and notification indicator if conditions are met.
   * Returns nothing (doesn't render) when the button shouldn't be shown.
   */
  protected render() {
    if (!this._show) {
      return nothing;
    }
    // LLM: Only show notification indicator when in narrow mode or sidebar is always hidden
    const hasNotifications =
      this._hasNotifications &&
      (this.narrow || this.hass.dockedSidebar === "always_hidden");
    return html`
      <ha-icon-button
        .label=${this.hass.localize("ui.sidebar.sidebar_toggle")}
        .path=${mdiMenu}
        @click=${this._toggleMenu}
      ></ha-icon-button>
      ${hasNotifications ? html`<div class="dot"></div>` : ""}
    `;
  }

  /**
   * LLM: Lifecycle method called after first render.
   * Sets up backward compatibility for older Hass.io versions.
   */
  protected firstUpdated(changedProps) {
    super.firstUpdated(changedProps);
    if (!this.hassio) {
      return;
    }
    // This component is used on Hass.io too, but Hass.io might run the UI
    // on older frontends too, that don't have an always visible menu button
    // in the sidebar.
    this._alwaysVisible =
      (Number((window.parent as any).frontendVersion) || 0) < 20190710;
  }

  /**
   * LLM: Lifecycle method called before rendering when properties change.
   * Core logic that determines whether the menu button should be visible.
   */
  protected willUpdate(changedProps) {
    super.willUpdate(changedProps);

    // LLM: Only process if narrow or hass properties changed
    if (!changedProps.has("narrow") && !changedProps.has("hass")) {
      return;
    }

    const oldHass = changedProps.has("hass")
      ? (changedProps.get("hass") as HomeAssistant | undefined)
      : this.hass;
    const oldNarrow = changedProps.has("narrow")
      ? (changedProps.get("narrow") as boolean | undefined)
      : this.narrow;

    // LLM: Calculate previous and current visibility states
    const oldShowButton =
      oldNarrow || oldHass?.dockedSidebar === "always_hidden";
    const showButton =
      this.narrow || this.hass.dockedSidebar === "always_hidden";

    // LLM: Skip if visibility hasn't changed
    if (this.hasUpdated && oldShowButton === showButton) {
      return;
    }

    // LLM: Set visibility based on screen size, sidebar config, or backward compatibility
    this._show = showButton || this._alwaysVisible;

    // LLM: If button shouldn't be shown, unsubscribe from notifications to save resources
    if (!showButton) {
      if (this._unsubNotifications) {
        this._unsubNotifications();
        this._unsubNotifications = undefined;
      }
      return;
    }

    // LLM: Subscribe to notifications when button is visible
    this._subscribeNotifications();
  }

  /**
   * LLM: Subscribes to Home Assistant notifications to show notification indicator.
   * Sets _hasNotifications flag when notifications are present.
   */
  private _subscribeNotifications() {
    if (this._unsubNotifications) {
      throw new Error("Already subscribed");
    }
    this._unsubNotifications = subscribeNotifications(
      this.hass.connection,
      (notifications) => {
        this._hasNotifications = notifications.length > 0;
      }
    );
  }

  /**
   * LLM: Event handler for menu button click.
   * Fires custom event to toggle the sidebar visibility.
   */
  private _toggleMenu(): void {
    fireEvent(this, "hass-toggle-menu");
  }

  static styles = css`
    :host {
      position: relative;
    }
    .dot {
      pointer-events: none;
      position: absolute;
      background-color: var(--accent-color);
      width: 12px;
      height: 12px;
      top: 9px;
      right: 7px;
      inset-inline-end: 7px;
      inset-inline-start: initial;
      border-radius: 50%;
      border: 2px solid var(--app-header-background-color);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-menu-button": HaMenuButton;
  }
}
