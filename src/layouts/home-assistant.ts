import type { PropertyValues } from "lit";
import { html } from "lit";
import { customElement, state } from "lit/decorators";
import type { Connection } from "home-assistant-js-websocket";
import { isNavigationClick } from "../common/dom/is-navigation-click";
import { navigate } from "../common/navigate";
import { getStorageDefaultPanelUrlPath } from "../data/panel";
import type { WindowWithPreloads } from "../data/preloads";
import type { RecorderInfo } from "../data/recorder";
import { getRecorderInfo } from "../data/recorder";
import "../resources/custom-card-support";
import { HassElement } from "../state/hass-element";
import QuickBarMixin from "../state/quick-bar-mixin";
import type { HomeAssistant, Route } from "../types";
import { storeState } from "../util/ha-pref-storage";
import {
  removeLaunchScreen,
  renderLaunchScreenInfoBox,
} from "../util/launch-screen";
import {
  registerServiceWorker,
  supportsServiceWorker,
} from "../util/register-service-worker";
import "./ha-init-page";
import "./home-assistant-main";
import { storage } from "../common/decorators/storage";

const useHash = __DEMO__;
// USERNOTE: In demo, the path is after the hash so we extract it from the hash.
const curPath = () =>
  useHash ? location.hash.substring(1) : location.pathname;

// USERNOTE: Extract the panel from the path, it would be the text after the first slash but before the next slash.
// Example: /lovelace/light/kitchen -> lovelace
const panelUrl = (path: string) => {
  const dividerPos = path.indexOf("/", 1);
  return dividerPos === -1 ? path.substring(1) : path.substring(1, dividerPos);
};

/**
 * LLM: Core application element that manages the Home Assistant frontend state and routing.
 *
 * Purpose: Acts as the root element of the Home Assistant frontend, managing the WebSocket connection,
 *          state updates, and routing between different panels.
 *
 * Caveats & Side Effects:
 * - Maintains a single source of truth for the hass object
 * - Handles connection state and reconnection logic
 * - Manages visibility and background behavior
 * - Uses dynamic rendering approach for progressive loading
 *
 * Role in Scope: Serves as the central coordinator between the backend and frontend components,
 *               ensuring state consistency and proper routing.
 */
@customElement("home-assistant")
export class HomeAssistantAppEl extends QuickBarMixin(HassElement) {
  @state() private _route: Route;

  @state() private _databaseMigration?: boolean;

  private _panelUrl: string;

  @storage({ key: "ha-version", state: false, subscribe: false })
  private _haVersion?: string;

  private _hiddenTimeout?: number;

  private _visiblePromiseResolve?: () => void;

  /**
   * LLM: Initializes the application state and sets up routing.
   *
   * Purpose: Sets up the initial route and panel URL based on the current path.
   *
   * Caveats & Side Effects:
   * - Redirects to default panel if path is empty
   * - Initializes route and panel URL state
   *
   * Role in Scope: First step in application initialization, ensuring proper routing state.
   */
  constructor() {
    super();
    const path = curPath();
    // eslint-disable-next-line no-console
    console.log("path", path);

    // LLM: Redirect to default panel if no specific path is provided
    if (["", "/"].includes(path)) {
      navigate(`/${getStorageDefaultPanelUrlPath()}${location.search}`, {
        replace: true,
      });
    }
    this._route = {
      prefix: "",
      path,
    };
    this._panelUrl = panelUrl(path);
  }

  /**
   * LLM: Main rendering template for the application.
   *
   * Purpose: Renders the main application layout with the current route and hass state.
   *
   * Caveats & Side Effects:
   * - Only called after data is available
   * - Delegates actual rendering to home-assistant-main
   *
   * Role in Scope: Provides the main application structure once data is loaded.
   */
  protected renderHass() {
    return html`
      <home-assistant-main
        .hass=${this.hass}
        .route=${this._route}
      ></home-assistant-main>
    `;
  }

  /**
   * LLM: Lifecycle method called before updates are processed.
   *
   * Purpose: Checks for database migration status and triggers migration check if needed.
   *
   * Caveats & Side Effects:
   * - Only checks migration on first hass config change
   * - Prevents unnecessary migration checks
   *
   * Role in Scope: Ensures database migrations are handled before rendering.
   */
  protected willUpdate(changedProps: PropertyValues<this>) {
    super.willUpdate(changedProps);
    if (
      this._databaseMigration === undefined &&
      changedProps.has("hass") &&
      this.hass?.config &&
      changedProps.get("hass")?.config !== this.hass?.config
    ) {
      this.checkDataBaseMigration();
    }
  }

  /**
   * LLM: Lifecycle method that handles updates and rendering setup.
   *
   * Purpose: Sets up the render method and removes launch screen when data is ready.
   *
   * Caveats & Side Effects:
   * - Dynamically assigns render method when data is available
   * - Removes launch screen when transitioning to main UI
   * - Restores default update behavior
   *
   * Role in Scope: Manages the transition from loading to main UI.
   */
  protected update(changedProps: PropertyValues<this>) {
    if (
      this.hass?.states &&
      this.hass.config &&
      this.hass.services &&
      this._databaseMigration === false
    ) {
      // USERNOTE: On reactive property changes, we run the renderHass() template, but thanks to Lit's DOM diffing it only patches bindings that actually changed.
      this.render = this.renderHass;
      this.update = super.update;
      // USERNOTE: On reactive property changes, we remove the launch screen as we should have some data by now.
      removeLaunchScreen();
    }
    super.update(changedProps);
  }

  /**
   * LLM: Initial setup and event listener registration.
   *
   * Purpose: Sets up the initial Home Assistant connection and registers event listeners.
   *
   * Caveats & Side Effects:
   * - Initializes WebSocket connection
   * - Sets up navigation and visibility handlers
   * - Registers service worker
   * - Renders the launch screen
   *
   * Role in Scope: Completes the initialization process after element creation.
   */
  protected firstUpdated(changedProps: PropertyValues<this>) {
    // USERNOTE: Invoke the chain of mixings e.g. firstUpated() as they might need to set things up on first update.
    super.firstUpdated(changedProps);
    this._initializeHass();
    setTimeout(() => registerServiceWorker(this), 1000);

    // USERNOTE: Update hass and store the state to local storage when the suspendWhenHidden property changes.
    this.addEventListener("hass-suspend-when-hidden", (ev) => {
      this._updateHass({ suspendWhenHidden: ev.detail.suspend });
      storeState(this.hass!);
    });

    // Navigation
    const updateRoute = (path = curPath()) => {
      // USERNOTE: Current route is the same as the new path, so we don't need to update anything.
      if (this._route && path === this._route.path) {
        return;
      }
      // USERNOTE: Update current route state.
      this._route = {
        prefix: "",
        path: path,
      };

      // USERNOTE: Update the panel URL state based on target new path.
      this._panelUrl = panelUrl(path);
      // USERNOTE: Propagate the new panel URL to the translations-mixin.
      this.panelUrlChanged(this._panelUrl!);
      // USERNOTE: Update the hass object with the new panel URL.
      this._updateHass({ panelUrl: this._panelUrl });
    };

    // LLM: Set up history change listeners for route updates
    if (useHash) {
      window.addEventListener("hashchange", () => updateRoute());
    } else {
      window.addEventListener("popstate", () => updateRoute());
    }

    /**
     * LLM: Global link click interception for SPA navigation.
     *
     * Purpose: Intercepts all link clicks in the application to enable client-side navigation.
     *
     * Caveats & Side Effects:
     * - Prevents full page reloads for internal navigation
     * - Maintains browser history state
     * - Works with both hash-based and path-based routing
     *
     * Role in Scope: Enables single-page application behavior throughout the frontend.
     */
    window.addEventListener("click", (ev) => {
      const href = isNavigationClick(ev);
      if (href) {
        navigate(href);
      }
    });

    // Render launch screen info box (loading data / error message)
    // if Home Assistant is not loaded yet.
    // USERNOTE: Hass is rendered when all the core hass properties are loaded in update().
    if (this.render !== this.renderHass) {
      this._renderInitInfo(false);
    }
  }

  /**
   * LLM: Handles updates to the hass object and database migration state.
   *
   * Purpose: Updates child components and handles migration state changes.
   *
   * Caveats & Side Effects:
   * - Updates hass reference for child components
   * - Handles migration screen display
   *
   * Role in Scope: Ensures state consistency across the application.
   */
  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);
    if (changedProps.has("hass")) {
      // USERNOTE: Updates hass reference for child components
      this.hassChanged(
        this.hass!,
        changedProps.get("hass") as HomeAssistant | undefined
      );
    }
    if (changedProps.has("_databaseMigration")) {
      if (this.render !== this.renderHass) {
        // USERNOTE: Render the init info box if we have not rendered the main content yet, otherwise we have to refresh to do so.
        this._renderInitInfo(false);
      } else if (this._databaseMigration) {
        // we already removed the launch screen, so we refresh to add it again to show the migration screen
        location.reload();
      }
    }
  }

  /**
   * LLM: Handles WebSocket connection establishment.
   *
   * Purpose: Sets up translations and visibility handlers when connection is established.
   *
   * Caveats & Side Effects:
   * - Loads entity translations
   * - Sets up visibility change handlers
   *
   * Role in Scope: Completes setup after WebSocket connection is established.
   */
  protected hassConnected() {
    super.hassConnected();
    // @ts-ignore
    this._loadHassTranslations(this.hass!.language, "entity_component");
    // @ts-ignore
    this._loadHassTranslations(this.hass!.language, "entity");

    document.addEventListener(
      "visibilitychange",
      () => this._checkVisibility(),
      false
    );
    document.addEventListener("freeze", () => this._suspendApp());
    document.addEventListener("resume", () => this._checkVisibility());
  }

  /**
   * LLM: Handles WebSocket reconnection.
   *
   * Purpose: Checks for updates when connection is restored.
   *
   * Caveats & Side Effects:
   * - Checks for backend version changes
   * - Triggers frontend updates if needed
   *
   * Role in Scope: Ensures frontend stays in sync with backend after reconnection.
   */
  protected hassReconnected() {
    super.hassReconnected();
    this._checkUpdate(this.hass!.connection);
  }

  /**
   * LLM: Checks for backend version updates.
   *
   * Purpose: Ensures frontend is updated when backend version changes.
   *
   * Caveats & Side Effects:
   * - Triggers service worker update if available
   * - Forces page reload if service worker is not available
   *
   * Role in Scope: Maintains version compatibility between front and backend.
   */
  private _checkUpdate(connection: Connection) {
    const oldVersion = this._haVersion;
    const currentVersion = connection.haVersion;
    // If backend has been upgraded, make sure we update frontend
    if (currentVersion !== oldVersion) {
      this._haVersion = currentVersion;
      if (supportsServiceWorker()) {
        navigator.serviceWorker.getRegistration().then((registration) => {
          if (registration) {
            registration.update();
          } else if (oldVersion) {
            // @ts-ignore Firefox supports forceGet
            location.reload(true);
          }
        });
      } else if (oldVersion) {
        // @ts-ignore Firefox supports forceGet
        location.reload(true);
      }
    }
  }

  protected async checkDataBaseMigration() {
    if (__DEMO__) {
      this._databaseMigration = false;
      return;
    }

    let recorderInfoProm: Promise<RecorderInfo> | undefined;
    const preloadWindow = window as WindowWithPreloads;
    // On first load, we speed up loading page by having recorderInfoProm ready
    if (preloadWindow.recorderInfoProm) {
      recorderInfoProm = preloadWindow.recorderInfoProm;
      preloadWindow.recorderInfoProm = undefined;
    }
    const info = await (
      recorderInfoProm || getRecorderInfo(this.hass!.connection)
    ).catch((err) => {
      // If the command failed with code unknown_command, recorder is not enabled,
      // otherwise re-throw the error
      if (err.code !== "unknown_command") throw err;
      return { migration_in_progress: false, migration_is_live: false };
    });
    this._databaseMigration =
      info.migration_in_progress && !info.migration_is_live;
    if (this._databaseMigration) {
      // check every 5 seconds if the migration is done
      setTimeout(() => this.checkDataBaseMigration(), 5000);
    }
  }

  /**
   * LLM: Initializes the Home Assistant connection.
   *
   * Purpose: Establishes the WebSocket connection and initializes the hass object.
   *
   * Caveats & Side Effects:
   * - Handles both direct and delayed connection scenarios
   * - Shows error screen if connection fails
   *
   * Role in Scope: Sets up the core connection to the Home Assistant backend.
   */
  protected async _initializeHass() {
    try {
      let result;

      if (window.hassConnection) {
        result = await window.hassConnection;
      } else {
        // In the edge case that core.ts loads before app.ts
        result = await new Promise((resolve) => {
          window.hassConnectionReady = resolve;
        });
      }

      const { auth, conn } = result;
      this._checkUpdate(conn);
      // USERNOTE: Initialize the hass object & connection subscriptions e.g.
      this.initializeHass(auth, conn);
    } catch (_err: any) {
      this._renderInitInfo(true);
    }
  }

  protected _checkVisibility() {
    if (document.hidden) {
      // If the document is hidden, we will prevent reconnects until we are visible again
      this._onHidden();
    } else {
      this._onVisible();
    }
  }

  /**
   * LLM: Handles visibility changes and connection management.
   *
   * Purpose: Manages connection state based on document visibility to optimize resource usage.
   *
   * Caveats & Side Effects:
   * - Suspends reconnection attempts when hidden
   * - Closes connection after 5 minutes of inactivity
   * - Resumes connection when visible again
   *
   * Role in Scope: Optimizes resource usage and connection management based on user activity.
   */
  private _onHidden() {
    if (this._visiblePromiseResolve) {
      return;
    }
    this.hass!.connection.suspendReconnectUntil(
      new Promise((resolve) => {
        this._visiblePromiseResolve = resolve;
      })
    );
    if (this.hass!.suspendWhenHidden !== false) {
      // LLM: Close connection after 5 minutes of inactivity
      this._hiddenTimeout = window.setTimeout(() => {
        this._hiddenTimeout = undefined;
        if (document.hidden) {
          this._suspendApp();
        }
      }, 300000);
    }
    window.addEventListener("focus", () => this._onVisible(), { once: true });
  }

  /**
   * LLM: Suspends the application when in background.
   *
   * Purpose: Stops the application and suspends the WebSocket connection.
   *
   * Caveats & Side Effects:
   * - Stops all ongoing operations
   * - Suspends WebSocket connection
   *
   * Role in Scope: Optimizes resource usage when app is in background.
   */
  private _suspendApp() {
    if (!this.hass!.connection.connected) {
      return;
    }
    window.stop();
    this.hass!.connection.suspend();
  }

  /**
   * LLM: Handles application becoming visible again.
   *
   * Purpose: Resumes normal operation when app becomes visible.
   *
   * Caveats & Side Effects:
   * - Clears connection timeout
   * - Resumes reconnection attempts
   *
   * Role in Scope: Restores normal operation after background state.
   */
  private _onVisible() {
    // Clear timer to close the connection
    if (this._hiddenTimeout) {
      clearTimeout(this._hiddenTimeout);
      this._hiddenTimeout = undefined;
    }
    // Unsuspend the reconnect
    if (this._visiblePromiseResolve) {
      this._visiblePromiseResolve();
      this._visiblePromiseResolve = undefined;
    }
  }

  /**
   * LLM: Renders the initial loading or error screen.
   *
   * Purpose: Shows appropriate screen during loading or error states.
   *
   * Caveats & Side Effects:
   * - Shows error screen if connection failed
   * - Shows migration screen if database is migrating
   *
   * Role in Scope: Provides user feedback during application states.
   */
  private _renderInitInfo(error: boolean) {
    renderLaunchScreenInfoBox(
      html`<ha-init-page
        .error=${error}
        .migration=${this._databaseMigration}
      ></ha-init-page>`
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "home-assistant": HomeAssistantAppEl;
  }
}
