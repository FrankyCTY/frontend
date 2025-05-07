/**
 * LLM: Determines if a click event should trigger client-side navigation.
 *
 * Purpose: Intercepts link clicks to enable single-page application navigation.
 *
 * Caveats & Side Effects:
 * - Prevents default browser navigation for internal links
 * - Only handles left-clicks without modifier keys
 * - Skips external links, downloads, and special link types
 *
 * Role in Scope: Core component of SPA navigation system.
 */
export const isNavigationClick = (e: MouseEvent, preventDefault = true) => {
  // Taken from polymer/pwa-helpers. BSD-3 licensed
  // LLM: Skip if event is already handled or not a left-click
  if (
    e.defaultPrevented ||
    e.button !== 0 ||
    e.metaKey ||
    e.ctrlKey ||
    e.shiftKey
  ) {
    return undefined;
  }

  // LLM: Find the clicked anchor element in the event path
  // USERNOTE: composedPath() returns the path of the event target and all of its ancestors in tree order.
  const anchor = e
    .composedPath()
    .find((n) => (n as HTMLElement).tagName === "A") as  // USERNOTE: Find the first node whose tagName is "A"—i.e. the nearest anchor element to the event target.
    | HTMLAnchorElement
    | undefined;

  // LLM: Skip special link types that should use default browser behavior
  if (
    !anchor ||
    anchor.target ||
    anchor.hasAttribute("download") ||
    anchor.getAttribute("rel") === "external"
  ) {
    return undefined;
  }

  // LLM: Extract and validate the href
  let href = anchor.href;
  if (!href || href.indexOf("mailto:") !== -1) {
    return undefined;
  }

  // LLM: Verify link is internal to the application
  const location = window.location;
  const origin = location.origin || location.protocol + "//" + location.host;
  if (href.indexOf(origin) !== 0) {
    return undefined;
  }
  href = href.substr(origin.length);

  // LLM: Skip empty hash links
  if (href === "#") {
    return undefined;
  }

  // LLM: Prevent default navigation and return the path
  if (preventDefault) {
    e.preventDefault();
  }
  return href;
};
