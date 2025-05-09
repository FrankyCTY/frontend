import type { PropertyValues } from "lit";
import { ReactiveElement } from "lit";
import { property } from "lit/decorators";
import memoizeOne from "memoize-one";
import { navigate } from "../common/navigate";
import type { Route } from "../types";

/**
 * USERNOTE: Extracts the first segment (panel name) from a URL path.
 *
 * Example usage:
 *   extractPage("/lovelace/kitchen/lights", "default") -> "lovelace"
 *   extractPage("/history", "default")                -> "history"
 *   extractPage("/", "default")                       -> "default"
 *   extractPage("", "default")                        -> "default"
 */
const extractPage = (path: string, defaultPage: string) => {
  if (path === "") {
    return defaultPage;
  }
  const subpathStart = path.indexOf("/", 1);
  return subpathStart === -1
    ? path.substr(1)
    : path.substr(1, subpathStart - 1);
};

export interface RouteOptions {
  // HTML tag of the route page.
  // tag: `ha-panel-${panel.component_name}`
  tag: string;
  // Function to load the page.
  load?: () => Promise<unknown>;
  cache?: boolean;
}

export interface RouterOptions {
  // The default route to show if path does not define a page.
  defaultPage?: string;
  // If all routes should be preloaded
  preloadAll?: boolean;
  // If a route has been shown, should we keep the element in memory
  cacheAll?: boolean;
  // Should we show a loading spinner while we load the element for the route
  showLoading?: boolean;
  // Promise that resolves when the initial data is loaded which is needed to show any route.
  initialLoad?: () => Promise<unknown>;
  // Hook that is called before rendering a new route. Allowing redirects.
  // If string returned, that page will be rendered instead.
  // USERNOTE: Intercept before route render and if route is a string, redirect to that route instead.
  beforeRender?: (page: string) => string | undefined;
  // USERNOTE: Key: URL_PATH, Value: RouteOptions or string for specific panel
  routes: Record<string, RouteOptions | string>;
}

// Time to wait for code to load before we show loading screen.
const LOADING_SCREEN_THRESHOLD = 400; // ms

// USERNOTE: The base class for all router pages.
export class HassRouterPage extends ReactiveElement {
  @property({ attribute: false }) public route?: Route;

  protected routerOptions!: RouterOptions;

  protected _currentPage = "";

  // USERNOTE: Promise that resolves when the page has rendered
  private _currentLoadProm?: Promise<void>;

  // USERNOTE: Cache of already rendered pages/panels.
  private _cache = {};

  private _initialLoadDone = false;

  // USERNOTE: This method _computeTail is a memoized function that processes a Route object to split its path into two parts:
  // - prefix: The base URL path of the route.
  //   - Example: /config/dashboard -> prefix: /config
  // - path: The remaining part of the URL path of the route.
  //  - Example: /config/dashboard -> path: /dashboard
  private _computeTail = memoizeOne((route: Route) => {
    const dividerPos = route.path.indexOf("/", 1);
    return dividerPos === -1
      ? {
          prefix: route.prefix + route.path,
          path: "",
        }
      : {
          prefix: route.prefix + route.path.substr(0, dividerPos),
          path: route.path.substr(dividerPos),
        };
  });

  protected createRenderRoot() {
    return this;
  }

  protected update(changedProps: PropertyValues) {
    super.update(changedProps);

    const routerOptions = this.routerOptions || { routes: {} };

    if (routerOptions && routerOptions.initialLoad && !this._initialLoadDone) {
      return;
    }

    if (!changedProps.has("route")) {
      // Do not update if we have a currentLoadProm, because that means
      // that there is still an old panel shown and we're moving to a new one.
      // USERNOTE: Dynamically update the panel (lastChild) if it is not a route (panel) change to ensure the panel got the updated props.
      // USERNOTE: We only do this if we are NOT in progress of rendering a new panel! (this._currentLoadProm must NOT be true)
      if (this.lastChild && !this._currentLoadProm) {
        this.updatePageEl(this.lastChild, changedProps);
      }
      return;
    }

    // USERNOTE: ============== HANDLE ROUTE CHANGE ==============
    const route = this.route;
    // eslint-disable-next-line no-console
    console.log("hass-router-page: update() - route change", route);
    const defaultPage = routerOptions.defaultPage;

    // USERNOTE: If route path is root, re-navigate to default page.
    // Example:
    // If the route has no path (i.e., /config, where route.path === "", prefix: /config)
    // And a defaultPage is set in routerOptions → then navigate.
    if (route && route.path === "" && defaultPage !== undefined) {
      const queryParams = window.location.search;
      // USERNOTE: Navigate to the default page. (e.g. /config/dashboard for config panel)
      navigate(`${route.prefix}/${defaultPage}${queryParams}`, {
        replace: true,
      });
    }

    // USERNOTE: Extract the first segment (panel name) from the new route path.
    let newPage = route
      ? extractPage(route.path, defaultPage || "")
      : "not_found";
    // USERNOTE: Look up route option
    let routeOptions = routerOptions.routes[newPage];

    // Handle redirects
    // USERNOTE: If a route's value is a string, it means "redirect to this other page". So we traverse the redirection chain until route option is NOT string.
    while (typeof routeOptions === "string") {
      newPage = routeOptions;
      routeOptions = routerOptions.routes[newPage];
    }

    // USERNOTE: Allows routerOptions.beforeRender to intercept and potentially reroute navigation just before rendering.
    // - UNDEFINED -> No route change
    // - STRING -> Redirect to new route
    if (routerOptions.beforeRender) {
      const result = routerOptions.beforeRender(newPage);
      if (result !== undefined) {
        newPage = result;
        routeOptions = routerOptions.routes[newPage];

        // Handle redirects
        while (typeof routeOptions === "string") {
          newPage = routeOptions;
          routeOptions = routerOptions.routes[newPage];
        }

        // Update the url if we know where we're mounted.
        if (route) {
          navigate(`${route.prefix}/${result}${location.search}`, {
            replace: true,
          });
        }
      }
    }

    // LLM: If we're already on the requested page, just update its properties
    // This avoids unnecessary page reloads when only props change
    if (this._currentPage === newPage) {
      if (this.lastChild) {
        this.updatePageEl(this.lastChild, changedProps);
      }
      return;
    }

    // LLM: Handle case where no valid route options exist for the requested page
    // This effectively clears the current page and removes any existing content
    if (!routeOptions) {
      this._currentPage = "";
      if (this.lastChild) {
        this.removeChild(this.lastChild);
      }
      return;
    }

    // LLM: Initialize new page state and prepare to load its resources
    // This kicks off the async loading process for the new page
    this._currentPage = newPage;
    const loadProm = routeOptions.load
      ? routeOptions.load()
      : Promise.resolve();

    let showLoadingScreenTimeout: undefined | number;

    // LLM: Error handling for page loading failures
    // This ensures graceful degradation by showing an error screen if loading fails
    loadProm.catch((err) => {
      // eslint-disable-next-line
      console.error("Error loading page", newPage, err);

      // USERNOTE: Ensure we’re still trying to load the same page (user might have clicked away in the meantime). Prevents displaying the error for an outdated navigation event.
      if (this._currentPage !== newPage) {
        return;
      }

      // LLM: Clean up any existing content before showing error
      if (this.lastChild) {
        this.removeChild(this.lastChild!);
      }

      if (showLoadingScreenTimeout) {
        clearTimeout(showLoadingScreenTimeout);
      }

      // LLM: Display user-friendly error screen
      this.appendChild(
        this.createErrorScreen(`Error while loading page ${newPage}.`)
      );
    });

    // If we don't show loading screen, just show the panel.
    // It will be automatically upgraded when loading done.
    // USERNOTE: Sync code, will be executed immediately before then() and catch() in loadProm.
    if (!routerOptions.showLoading) {
      this._createPanel(routerOptions, newPage, routeOptions);
      return;
    }

    // We are only going to show the loading screen after some time.
    // That way we won't have a double fast flash on fast connections.
    let created = false;

    // USERNOTE: Macrotask, will be executed after then() and catch() in loadProm.
    showLoadingScreenTimeout = window.setTimeout(() => {
      // LLM: Skip loading screen if page already created or changed
      // What is created TRUE? It happens when loadProm is resolved and the page is created, see subsequent code.
      if (created || this._currentPage !== newPage) {
        return;
      }

      // Show a loading screen.
      if (this.lastChild) {
        this.removeChild(this.lastChild);
      }
      this.appendChild(this.createLoadingScreen());
    }, LOADING_SCREEN_THRESHOLD); // USERNOTE: 400ms delay before showing loading screen

    // LLM: Handle successful page load
    // This creates the actual page content once resources are loaded
    this._currentLoadProm = loadProm.then(
      () => {
        this._currentLoadProm = undefined;
        // Check if we're still trying to show the same page.
        // USERNOTE: This prevents displaying the outdated page.
        if (this._currentPage !== newPage) {
          return;
        }

        created = true;
        this._createPanel(
          routerOptions,
          newPage,
          // @ts-ignore TS forgot this is not a string.
          routeOptions
        );
      },
      () => {
        this._currentLoadProm = undefined;
      }
    );
  }

  protected firstUpdated(changedProps: PropertyValues) {
    // eslint-disable-next-line no-console
    console.log("hass-router-page: firstUpdated", changedProps);
    super.firstUpdated(changedProps);

    const options = this.routerOptions;

    if (!options) {
      return;
    }

    if (options.preloadAll) {
      Object.values(options.routes).forEach(
        (route) => typeof route === "object" && route.load && route.load()
      );
    }

    if (options.initialLoad) {
      setTimeout(() => {
        if (!this._initialLoadDone) {
          this.appendChild(this.createLoadingScreen());
        }
      }, LOADING_SCREEN_THRESHOLD);

      options.initialLoad().then(() => {
        this._initialLoadDone = true;
        this.requestUpdate("route");
      });
    }
  }

  protected createLoadingScreen() {
    import("./hass-loading-screen");
    return document.createElement("hass-loading-screen");
  }

  protected createErrorScreen(error: string) {
    import("./hass-error-screen");
    const errorEl = document.createElement("hass-error-screen");
    errorEl.error = error;
    return errorEl;
  }

  // USERNOTE: Gracefully reset the route state when the update is completed.
  /**
   * Rebuild the current panel.
   *
   * Promise will resolve when rebuilding is done and DOM updated.
   */
  protected async rebuild(): Promise<void> {
    const oldRoute = this.route;

    if (oldRoute === undefined) {
      return;
    }

    this.route = undefined;
    // USERNOTE: Wait for the update to complete before setting the route
    await this.updateComplete;
    // Make sure that the parent didn't override this in the meanwhile.
    if (this.route === undefined) {
      this.route = oldRoute;
    }
  }

  /**
   * Promise that resolves when the page has rendered.
   */
  protected get pageRendered(): Promise<void> {
    return this.updateComplete.then(() => this._currentLoadProm);
  }

  // USERNOTE: Create the html element using the custom element's "selector" as tag.
  protected createElement(tag: string) {
    // USERNOTE: Create a new element with the given tag.
    // tag: `ha-panel-${panel.component_name}`
    return document.createElement(tag);
  }

  protected updatePageEl(_pageEl, _changedProps?: PropertyValues) {
    // default we do nothing
  }

  protected get routeTail(): Route {
    return this._computeTail(this.route!);
  }

  private _createPanel(
    routerOptions: RouterOptions,
    page: string,
    routeOptions: RouteOptions
  ) {
    // USERNOTE: Remove the current panel/component if it exists.
    if (this.lastChild) {
      this.removeChild(this.lastChild);
    }

    const panelEl = this._cache[page] || this.createElement(routeOptions.tag);
    this.updatePageEl(panelEl);
    // USERNOTE: Append the new element within this router page (partial-panel-resolver).
    this.appendChild(panelEl);

    // USERNOTE: Cache the new element if the option is set.
    if (routerOptions.cacheAll || routeOptions.cache) {
      this._cache[page] = panelEl;
    }
  }
}
