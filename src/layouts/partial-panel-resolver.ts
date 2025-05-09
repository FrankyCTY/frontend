import {
  STATE_NOT_RUNNING,
  STATE_RUNNING,
  STATE_STARTING,
} from "home-assistant-js-websocket";
import type { PropertyValues } from "lit";
import { customElement, property } from "lit/decorators";
import { deepActiveElement } from "../common/dom/deep-active-element";
import { deepEqual } from "../common/util/deep-equal";
import { getDefaultPanel } from "../data/panel";
import type { CustomPanelInfo } from "../data/panel_custom";
import type { HomeAssistant, Panels } from "../types";
import { removeLaunchScreen } from "../util/launch-screen";
import type { RouteOptions, RouterOptions } from "./hass-router-page";
import { HassRouterPage } from "./hass-router-page";

/**
 * LLM: Cache configuration for panel URLs.
 *
 * Purpose: Defines which panel paths should be cached for performance.
 *
 * Caveats & Side Effects:
 * - Only lovelace and developer-tools panels are cached
 * - Caching improves performance for frequently accessed panels
 *
 * Role in Scope: Optimizes panel loading performance.
 */
const CACHE_URL_PATHS = ["lovelace", "developer-tools"];

/**
 * LLM: Panel component mapping and lazy loading configuration.
 *
 * Purpose: Maps panel names to their dynamic import functions.
 *
 * Caveats & Side Effects:
 * - Uses dynamic imports for code splitting
 * - Each panel is loaded on-demand
 * - Supports custom panels and iframes
 *
 * Role in Scope: Enables lazy loading of panel components.
 */
const COMPONENTS = {
  energy: () => import("../panels/energy/ha-panel-energy"),
  calendar: () => import("../panels/calendar/ha-panel-calendar"),
  config: () => import("../panels/config/ha-panel-config"),
  custom: () => import("../panels/custom/ha-panel-custom"),
  "developer-tools": () =>
    import("../panels/developer-tools/ha-panel-developer-tools"),
  lovelace: () => import("../panels/lovelace/ha-panel-lovelace"),
  history: () => import("../panels/history/ha-panel-history"),
  iframe: () => import("../panels/iframe/ha-panel-iframe"),
  logbook: () => import("../panels/logbook/ha-panel-logbook"),
  map: () => import("../panels/map/ha-panel-map"),
  my: () => import("../panels/my/ha-panel-my"),
  profile: () => import("../panels/profile/ha-panel-profile"),
  todo: () => import("../panels/todo/ha-panel-todo"),
  "media-browser": () =>
    import("../panels/media-browser/ha-panel-media-browser"),
};

/**
 * LLM: Panel resolver component for dynamic panel loading.
 *
 * Purpose: Manages the loading and display of different Home Assistant panels.
 *
 * Caveats & Side Effects:
 * - Handles panel visibility and state management
 * - Manages panel caching and lazy loading
 * - Handles panel disconnection during background state
 *
 * Role in Scope: Core component for panel navigation and management.
 */
@customElement("partial-panel-resolver")
class PartialPanelResolver extends HassRouterPage {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ type: Boolean }) public narrow = false;

  // USERNOTE: A control flag that temporarily blocks the rendering or update of the current panel route until Home Assistant has progressed to a usable state (STATE_STARTING or STATE_RUNNING)
  private _waitForStart = false;

  private _disconnectedPanel?: HTMLElement;

  private _disconnectedActiveElement?: HTMLElement;

  private _hiddenTimeout?: number;

  /**
   * LLM: Initializes panel visibility management.
   *
   * Purpose: Sets up event listeners for panel visibility changes.
   *
   * Caveats & Side Effects:
   * - Listens for document visibility changes
   * - Handles app resume events
   * - Manages panel state during background/foreground transitions
   *
   * Role in Scope: Ensures proper panel state management.
   */
  protected firstUpdated(changedProps: PropertyValues) {
    // eslint-disable-next-line no-console
    console.log("partial-panel-resolver: firstUpdated", changedProps);
    super.firstUpdated(changedProps);

    // LLM: Set up visibility change listeners for background state management
    document.addEventListener(
      "visibilitychange",
      () => this._checkVisibility(),
      false
    );
    document.addEventListener("resume", () => this._checkVisibility());
  }

  /**
   * LLM: Updates panel state based on Home Assistant state changes.
   *
   * Purpose: Handles panel updates when Home Assistant state changes.
   *
   * Caveats & Side Effects:
   * - Rebuilds panels on state transitions
   * - Updates routes when panels change
   * - Manages loading states
   *
   * Role in Scope: Maintains panel state consistency.
   */
  public willUpdate(changedProps: PropertyValues) {
    // eslint-disable-next-line no-console
    console.log("partial-panel-resolver: willUpdate", changedProps);
    super.willUpdate(changedProps);

    if (!changedProps.has("hass")) {
      return;
    }

    const oldHass = changedProps.get("hass") as this["hass"];

    // LLM: If _waitForStart is true and the system transitions to a usable state (STARTING or RUNNING), it triggers a rebuild():
    // This clears and reassigns the route (this.route) after updateComplete, forcing the panel view to reinitialize once the system is ready.
    if (
      this._waitForStart &&
      (this.hass.config.state === STATE_STARTING ||
        this.hass.config.state === STATE_RUNNING)
    ) {
      this._waitForStart = false;
      // USERNOTE: Non-blocking to willUpdate(). This waits until updateComplete().
      this.rebuild();
    }

    // LLM: Update routes when panels configuration changes
    if (this.hass.panels && (!oldHass || oldHass.panels !== this.hass.panels)) {
      this._updateRoutes(oldHass?.panels);
    }
  }

  /**
   * LLM: Creates loading screen for panel transitions.
   *
   * Purpose: Provides visual feedback during panel loading.
   *
   * Caveats & Side Effects:
   * - Sets root navigation flag
   * - Configures loading screen with current state
   *
   * Role in Scope: Manages loading state UI.
   */
  protected createLoadingScreen() {
    const el = super.createLoadingScreen();
    el.rootnav = true;
    el.hass = this.hass;
    el.narrow = this.narrow;
    return el;
  }

  /**
   * LLM: Updates panel content with current state.
   *
   * Purpose: Synchronizes panel content with current route and state.
   *
   * Caveats & Side Effects:
   * - Updates panel properties
   * - Handles route changes
   *
   * Role in Scope: Maintains panel content consistency.
   */
  protected updatePageEl(el) {
    const hass = this.hass;

    el.hass = hass;
    el.narrow = this.narrow;
    el.route = this.routeTail;
    el.panel = hass.panels[this._currentPage];
  }

  /**
   * LLM: Manages panel visibility state.
   *
   * Purpose: Handles panel visibility changes for performance optimization.
   *
   * Caveats & Side Effects:
   * - Respects suspendWhenHidden setting
   * - Manages panel disconnection in background
   *
   * Role in Scope: Optimizes panel performance in background.
   */
  private _checkVisibility() {
    if (this.hass.suspendWhenHidden === false) {
      return;
    }

    if (document.hidden) {
      this._onHidden();
    } else {
      this._onVisible();
    }
  }

  /**
   * LLM: Generates route configuration for panels.
   *
   * Purpose: Creates route configuration for panel navigation.
   *
   * Caveats & Side Effects:
   * - Configures lazy loading for panels
   * - Sets up caching for specific panels
   *
   * Role in Scope: Manages panel routing configuration.
   */
  private _getRoutes(panels: Panels): RouterOptions {
    const routes: RouterOptions["routes"] = {};
    // USERNOTE: Create routes for each panel
    Object.values(panels).forEach((panel) => {
      const data: RouteOptions = {
        tag: `ha-panel-${panel.component_name}`,
        // USERNOTE: Cache panels that are frequently accessed
        cache: CACHE_URL_PATHS.includes(panel.url_path),
      };
      if (panel.component_name in COMPONENTS) {
        // USERNOTE: Assign load component callback to corresponding dynamic import for panel component
        data.load = COMPONENTS[panel.component_name];
      }
      routes[panel.url_path] = data;
    });

    return {
      beforeRender: (page) => {
        // USERNOTE: If page is not found, return default panel
        if (!page || !routes[page]) {
          return getDefaultPanel(this.hass).url_path;
        }
        return undefined;
      },
      showLoading: true,
      routes,
    };
  }

  /**
   * LLM: Handles panel disconnection in background.
   *
   * Purpose: Optimizes performance by disconnecting unused panels.
   *
   * Caveats & Side Effects:
   * - Preserves iframe and custom panel states
   * - Manages active element focus
   *
   * Role in Scope: Optimizes background performance.
   */
  private _onHidden() {
    this._hiddenTimeout = window.setTimeout(() => {
      this._hiddenTimeout = undefined;
      // setTimeout can be delayed in the background and only fire
      // when we switch to the tab or app again (Hey Android!)
      if (!document.hidden) {
        return;
      }
      const curPanel = this.hass.panels[this._currentPage];
      if (
        this.lastChild &&
        // iFrames will lose their state when disconnected
        // Do not disconnect any iframe panel
        curPanel.component_name !== "iframe" &&
        // Do not disconnect any custom panel that embeds into iframe (ie hassio)
        (curPanel.component_name !== "custom" ||
          !(curPanel as CustomPanelInfo).config._panel_custom.embed_iframe)
      ) {
        this._disconnectedPanel = this.lastChild as HTMLElement;
        const activeEl = deepActiveElement(
          this._disconnectedPanel.shadowRoot || undefined
        );
        if (activeEl instanceof HTMLElement) {
          this._disconnectedActiveElement = activeEl;
        }
        this.removeChild(this.lastChild);
      }
    }, 300000);
    window.addEventListener("focus", () => this._onVisible(), { once: true });
  }

  /**
   * LLM: Restores panel state when becoming visible.
   *
   * Purpose: Reconnects panels and restores UI state.
   *
   * Caveats & Side Effects:
   * - Clears disconnection timeout
   * - Restores disconnected panels
   * - Restores focus state
   *
   * Role in Scope: Manages panel restoration.
   */
  private _onVisible() {
    if (this._hiddenTimeout) {
      clearTimeout(this._hiddenTimeout);
      this._hiddenTimeout = undefined;
    }
    if (this._disconnectedPanel) {
      this.appendChild(this._disconnectedPanel);
      this._disconnectedPanel = undefined;
    }
    if (this._disconnectedActiveElement) {
      this._disconnectedActiveElement.focus();
      this._disconnectedActiveElement = undefined;
    }
  }

  /**
   * LLM: Updates panel routes and state.
   *
   * Purpose: Manages panel route updates and state transitions.
   *
   * Caveats & Side Effects:
   * - Handles panel configuration changes
   * - Manages loading states
   * - Removes launch screen when ready
   *
   * Role in Scope: Maintains panel routing state.
   */
  private async _updateRoutes(oldPanels?: HomeAssistant["panels"]) {
    // USERNOTE: Update routes for new panels
    this.routerOptions = this._getRoutes(this.hass.panels);

    // USERNOTE: If a panel is missing from the current config and the system is NOT_RUNNING, it:
    // - Sets _waitForStart = true
    // - Replaces the rendered panel (if any) with a loading screen.
    // This avoids displaying a broken panel during HA downtime, instead waiting for a valid startup state before re-rendering.
    if (
      !this._waitForStart &&
      this._currentPage &&
      !this.hass.panels[this._currentPage]
    ) {
      if (this.hass.config.state === STATE_NOT_RUNNING) {
        this._waitForStart = true;
        // USERNOTE: Replaces the rendered panel (if any) with a loading screen.
        if (this.lastChild) {
          this.removeChild(this.lastChild);
        }
        this.appendChild(this.createLoadingScreen());
        return;
      }
    }

    // USERNOTE: IF the panel info has changed/is first time rendering, rebuild the panel
    if (
      !oldPanels ||
      !deepEqual(
        oldPanels[this._currentPage],
        this.hass.panels[this._currentPage]
      )
    ) {
      await this.rebuild();
      // USERNOTE: Wait for the page to be rendered before removing the launch screen
      await this.pageRendered;
      removeLaunchScreen();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "partial-panel-resolver": PartialPanelResolver;
  }
}
