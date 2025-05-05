import { closeAllDialogs } from "../dialogs/make-dialog-manager";
import { fireEvent } from "./dom/fire_event";
import { mainWindow } from "./dom/get_main_window";

/**
 * LLM: Core navigation system for Home Assistant frontend.
 *
 * Purpose: Provides a centralized way to handle navigation between different parts of the application,
 *          managing history state and ensuring proper cleanup of dialogs.
 *
 * Caveats & Side Effects:
 * - Handles both hash-based and path-based routing
 * - Manages dialog cleanup before navigation
 * - Supports demo mode with hash-based routing
 *
 * Role in Scope: Central navigation coordinator ensuring consistent routing behavior across the application.
 */

// LLM: Event interface for location changes
declare global {
  interface HASSDomEvents {
    "location-changed": NavigateOptions;
  }
}

/**
 * LLM: Options for navigation behavior.
 *
 * Purpose: Configures how navigation should be handled.
 *
 * Caveats & Side Effects:
 * - replace: Whether to replace current history entry
 * - data: Optional data to store in history state
 */
export interface NavigateOptions {
  replace?: boolean;
  data?: any;
}

// LLM: Maximum time to wait for dialogs to close before forcing navigation
const DIALOG_WAIT_TIMEOUT = 500;

/**
 * LLM: Main navigation function that handles routing between different parts of the application.
 *
 * Purpose: Provides a unified way to navigate between different views while managing dialogs and history.
 *
 * Caveats & Side Effects:
 * - Closes open dialogs before navigation
 * - Handles both hash-based and path-based routing
 * - Manages history state
 *
 * Role in Scope: Central navigation handler ensuring consistent behavior across the application.
 *
 * @param path - Target path to navigate to
 * @param options - Navigation options (replace, data)
 * @param timestamp - Timestamp for dialog timeout tracking
 */
export const navigate = async (
  path: string,
  options?: NavigateOptions,
  timestamp = Date.now()
) => {
  const { history } = mainWindow;

  // LLM: Handle dialog cleanup before navigation
  if (history.state?.dialog && Date.now() - timestamp < DIALOG_WAIT_TIMEOUT) {
    // USERNOTE: If a dialog is open and it's been a short time since the navigation began, it attempts to close dialogs first (closeAllDialogs()).
    const closed = await closeAllDialogs();
    // USERNOTE: If the dialog can not be closed, we warn the user and return false to indicate navigation failed.
    if (!closed) {
      // eslint-disable-next-line no-console
      console.warn("Navigation blocked, because dialog refused to close");
      return false;
    }
    // USERNOTE: If the dialog is closed, we wait for the history state to update after dialog closure (setTimeout()), until the history.state.dialog is cleared.
    return new Promise<boolean>((resolve) => {
      // LLM: Wait for history state update after dialog closure
      setTimeout(() => {
        navigate(path, options, timestamp).then(resolve);
      });
    });
  }
  // USERNOTE: All dialogs should be closed by now based on the history state, so we can proceed with the navigation.
  const replace = options?.replace || false;

  // LLM: Handle navigation based on demo mode and replace option
  if (__DEMO__) {
    if (replace) {
      history.replaceState(
        history.state?.root ? { root: true } : (options?.data ?? null),
        "",
        `${mainWindow.location.pathname}#${path}`
      );
    } else {
      mainWindow.location.hash = path;
    }
  } else if (replace) {
    // USERNOTE: Replace state: Update the URL and browser history state without reloading the page.
    history.replaceState(
      history.state?.root ? { root: true } : (options?.data ?? null),
      "",
      path
    );
  } else {
    // USERNOTE: Push new state: Update the URL and browser history state without reloading the page.
    history.pushState(options?.data ?? null, "", path);
  }

  // LLM: Notify listeners about location change
  fireEvent(mainWindow, "location-changed", {
    replace,
  });
  return true;
};
