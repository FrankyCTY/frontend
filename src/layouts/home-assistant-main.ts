import type { PropertyValues, TemplateResult } from "lit";
import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators";
import type { HASSDomEvent } from "../common/dom/fire_event";
import { fireEvent } from "../common/dom/fire_event";
import { listenMediaQuery } from "../common/dom/media_query";
import { toggleAttribute } from "../common/dom/toggle_attribute";
import "../components/ha-drawer";
import { showNotificationDrawer } from "../dialogs/notifications/show-notification-drawer";
import type { HomeAssistant, Route } from "../types";
import "./partial-panel-resolver";
import { computeRTLDirection } from "../common/util/compute_rtl";
import { storage } from "../common/decorators/storage";

/**
 * LLM: Event interface for Home Assistant DOM events.
 *
 * Purpose: Defines the structure of events that can be fired to control the main UI.
 *
 * Caveats & Side Effects:
 * - Controls menu toggling, sidebar editing, and notification display
 * - Events are used for UI state management
 *
 * Role in Scope: Provides type safety for UI control events.
 */
declare global {
  // for fire event
  interface HASSDomEvents {
    "hass-toggle-menu": undefined | { open?: boolean };
    "hass-edit-sidebar": EditSideBarEvent;
    "hass-show-notifications": undefined;
  }
  interface HTMLElementEventMap {
    "hass-edit-sidebar": HASSDomEvent<EditSideBarEvent>;
    "hass-toggle-menu": HASSDomEvent<HASSDomEvents["hass-toggle-menu"]>;
  }
}

interface EditSideBarEvent {
  order: string[];
  hidden: string[];
}

/**
 * LLM: Main application container component for Home Assistant.
 *
 * Purpose: Manages the main layout including sidebar, drawer, and panel content.
 *
 * Caveats & Side Effects:
 * - Handles responsive layout changes
 * - Manages external authentication integration
 * - Controls sidebar and drawer state
 *
 * Role in Scope: Serves as the root container for the Home Assistant UI.
 */
@customElement("home-assistant-main")
export class HomeAssistantMain extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ attribute: false }) public route?: Route;

  @property({ type: Boolean }) public narrow = false;

  @state() private _sidebarEditMode = false;

  @state() private _externalSidebar = false;

  @state() private _drawerOpen = false;

  @state()
  @storage({
    key: "sidebarPanelOrder",
    state: true,
    subscribe: true,
  })
  private _panelOrder: string[] = [];

  @state()
  @storage({
    key: "sidebarHiddenPanels",
    state: true,
    subscribe: true,
  })
  private _hiddenPanels: string[] = [];

  constructor() {
    super();
    // USERNOTE: Set up responsive layout listener
    listenMediaQuery("(max-width: 870px)", (matches) => {
      this.narrow = matches;
    });
  }

  protected render(): TemplateResult {
    const sidebarNarrow = this._sidebarNarrow || this._externalSidebar;

    return html`
      <ha-drawer
        .type=${sidebarNarrow ? "modal" : ""}
        .open=${sidebarNarrow ? this._drawerOpen : undefined}
        .direction=${computeRTLDirection(this.hass)}
        @MDCDrawer:closed=${this._drawerClosed}
      >
        <ha-sidebar
          .hass=${this.hass}
          .narrow=${sidebarNarrow}
          .route=${this.route}
          .panelOrder=${this._panelOrder}
          .hiddenPanels=${this._hiddenPanels}
          .alwaysExpand=${sidebarNarrow || this.hass.dockedSidebar === "docked"}
        ></ha-sidebar>
        <partial-panel-resolver
          .narrow=${this.narrow}
          .hass=${this.hass}
          .route=${this.route}
          slot="appContent"
        ></partial-panel-resolver>
      </ha-drawer>
    `;
  }

  /**
   * LLM: Initializes the main application component.
   *
   * Purpose: Sets up external authentication, sidebar, and event listeners.
   *
   * Caveats & Side Effects:
   * - Handles external authentication integration
   * - Sets up sidebar editing mode
   * - Configures menu toggle and notification events
   *
   * Role in Scope: Initializes core UI functionality and external integrations.
   */
  protected firstUpdated() {
    // Preload sidebar component for better performance
    import(/* webpackPreload: true */ "../components/ha-sidebar");

    /**
     * LLM: External Authentication Integration
     *
     * Purpose: Handles integration with external authentication providers.
     *
     * Caveats & Side Effects:
     * - Checks if external auth is enabled
     * - Configures sidebar visibility based on external auth settings
     * - Loads external app entrypoint if needed
     *
     * Role in Scope: Manages external authentication UI integration.
     */
    if (this.hass.auth.external) {
      // Check if external auth provider has sidebar enabled
      this._externalSidebar =
        this.hass.auth.external.config.hasSidebar === true;
      // Load and attach external app entrypoint
      import("../external_app/external_app_entrypoint").then((mod) =>
        mod.attachExternalToApp(this)
      );
    }

    // USERNOTE: Set up sidebar edit mode event listener
    this.addEventListener(
      "hass-edit-sidebar",
      (ev: HASSDomEvent<EditSideBarEvent>) => {
        this._panelOrder = ev.detail.order;
        this._hiddenPanels = ev.detail.hidden;
      }
    );

    // USERNOTE: Set up menu toggle event listener
    this.addEventListener("hass-toggle-menu", (ev) => {
      if (this._sidebarEditMode) {
        return;
      }
      if (this._externalSidebar) {
        // LLM: Handle external sidebar menu toggle
        this.hass.auth.external!.fireMessage({
          type: "sidebar/show",
        });
        return;
      }
      if (this._sidebarNarrow) {
        this._drawerOpen = ev.detail?.open ?? !this._drawerOpen;
      } else {
        fireEvent(this, "hass-dock-sidebar", {
          dock: ev.detail?.open
            ? "docked"
            : ev.detail?.open === false
              ? "auto"
              : this.hass.dockedSidebar === "auto"
                ? "docked"
                : "auto",
        });
      }
    });

    // USERNOTE: Set up notification drawer event listener
    this.addEventListener("hass-show-notifications", () => {
      showNotificationDrawer(this, {
        narrow: this.narrow,
      });
    });
  }

  public willUpdate(changedProps: PropertyValues) {
    // USERNOTE: When route changes, ensure the drawer is closed if the sidebar is narrow. This ensures UI consistency
    if (changedProps.has("route") && this._sidebarNarrow) {
      this._drawerOpen = false;
    }
  }

  /**
   * LLM: Updates component attributes after rendering.
   *
   * Purpose: Manages expanded and modal states.
   *
   * Caveats & Side Effects:
   * - Updates expanded attribute based on sidebar state
   * - Updates modal attribute based on narrow/external state
   *
   * Role in Scope: Maintains UI state consistency.
   */
  protected updated(changedProps: PropertyValues) {
    super.updated(changedProps);

    toggleAttribute(this, "expanded", this.hass.dockedSidebar === "docked");

    toggleAttribute(
      this,
      "modal",
      this._sidebarNarrow || this._externalSidebar
    );
  }

  /**
   * LLM: Determines if sidebar should be in narrow mode.
   *
   * Purpose: Controls sidebar display mode based on viewport and settings.
   *
   * Caveats & Side Effects:
   * - Combines narrow viewport and always_hidden settings
   * - Affects drawer and sidebar behavior
   *
   * Role in Scope: Manages sidebar display mode.
   */
  private get _sidebarNarrow() {
    return this.narrow || this.hass.dockedSidebar === "always_hidden";
  }

  /**
   * LLM: Handles drawer close events.
   *
   * Purpose: Resets drawer and edit mode state.
   *
   * Caveats & Side Effects:
   * - Closes drawer
   * - Exits edit mode
   *
   * Role in Scope: Manages drawer state transitions.
   */
  private _drawerClosed() {
    this._drawerOpen = false;
    this._sidebarEditMode = false;
  }

  static styles = css`
    :host {
      color: var(--primary-text-color);
      /* remove the grey tap highlights in iOS on the fullscreen touch targets */
      -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
      --mdc-drawer-width: 56px;
      --mdc-top-app-bar-width: calc(100% - var(--mdc-drawer-width));
    }
    :host([expanded]) {
      --mdc-drawer-width: calc(256px + var(--safe-area-inset-left));
    }
    :host([modal]) {
      --mdc-drawer-width: unset;
      --mdc-top-app-bar-width: unset;
    }
    partial-panel-resolver,
    ha-sidebar {
      /* allow a light tap highlight on the actual interface elements  */
      -webkit-tap-highlight-color: rgba(0, 0, 0, 0.1);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "home-assistant-main": HomeAssistantMain;
  }
}
