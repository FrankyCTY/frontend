import type { Button } from "@material/mwc-button";
import type { Corner, Menu, MenuCorner } from "@material/mwc-menu";
import type { TemplateResult } from "lit";
import { css, html, LitElement } from "lit";
import { customElement, property, query } from "lit/decorators";
import { mainWindow } from "../common/dom/get_main_window";
import { FOCUS_TARGET } from "../dialogs/make-dialog-manager";
import type { HaIconButton } from "./ha-icon-button";
import "./ha-menu";

/**
 * LLM: A button component that displays a dropdown menu when clicked.
 *
 * Purpose: Provides a customizable menu button that can display various menu items in a dropdown.
 * Used throughout the UI for overflow menus, option selectors, and contextual actions.
 *
 * Features:
 * - Configurable menu positioning (corner, menuCorner)
 * - Support for multi-selection
 * - Support for fixed positioning
 * - Customizable trigger element through slots
 * - Accessible with proper ARIA attributes
 */
@customElement("ha-button-menu")
export class HaButtonMenu extends LitElement {
  protected readonly [FOCUS_TARGET];

  /**
   * LLM: Determines which corner of the button the menu should align with.
   * Default is "BOTTOM_START" (below the button, aligned to start edge).
   */
  @property() public corner: Corner = "BOTTOM_START";

  /**
   * LLM: Determines which corner of the menu should align with the button.
   * Default is "START" (the start edge of the menu).
   */
  @property({ attribute: "menu-corner" }) public menuCorner: MenuCorner =
    "START";

  /**
   * LLM: X-coordinate for fixed position menus. If null, positioning is relative to button.
   */
  @property({ type: Number }) public x: number | null = null;

  /**
   * LLM: Y-coordinate for fixed position menus. If null, positioning is relative to button.
   */
  @property({ type: Number }) public y: number | null = null;

  /**
   * LLM: Enables multi-selection mode for the menu if true.
   */
  @property({ type: Boolean }) public multi = false;

  /**
   * LLM: Makes menu items activatable if true (items can be selected/activated).
   */
  @property({ type: Boolean }) public activatable = false;

  /**
   * LLM: Disables the menu button when true.
   */
  @property({ type: Boolean }) public disabled = false;

  /**
   * LLM: Uses fixed positioning for the menu when true.
   */
  @property({ type: Boolean }) public fixed = false;

  /**
   * LLM: When true, the menu doesn't use the button as an anchor for positioning.
   * USERNOTE: Anchor: The element that the menu is positioned relative to.
   */
  @property({ type: Boolean, attribute: "no-anchor" }) public noAnchor = false;

  /**
   * LLM: Reference to the underlying menu component for direct manipulation.
   */
  @query("ha-menu", true) private _menu?: Menu;

  /**
   * LLM: Getter for accessing the menu items.
   */
  public get items() {
    return this._menu?.items;
  }

  /**
   * LLM: Getter for accessing the currently selected menu item(s).
   */
  public get selected() {
    return this._menu?.selected;
  }

  /**
   * LLM: Focuses either the first menu item (if open) or the trigger button.
   * Used for accessibility and keyboard navigation.
   */
  public override focus() {
    if (this._menu?.open) {
      this._menu.focusItemAtIndex(0);
    } else {
      this._triggerButton?.focus();
    }
  }

  /**
   * LLM: Renders the button menu with trigger slot and menu.
   * The trigger slot contains the button that will open the menu.
   * The default slot contains the menu items.
   */
  protected render(): TemplateResult {
    return html`
      <div @click=${this._handleClick}>
        <slot name="trigger" @slotchange=${this._setTriggerAria}></slot>
      </div>
      <ha-menu
        .corner=${this.corner}
        .menuCorner=${this.menuCorner}
        .fixed=${this.fixed}
        .multi=${this.multi}
        .activatable=${this.activatable}
        .y=${this.y}
        .x=${this.x}
      >
        <slot></slot>
      </ha-menu>
    `;
  }

  /**
   * LLM: Lifecycle method called after first render.
   * Fixes RTL (right-to-left) layout issues by adjusting the margins of icons
   * in list items when the document direction is RTL.
   */
  protected firstUpdated(changedProps): void {
    super.firstUpdated(changedProps);

    if (mainWindow.document.dir === "rtl") {
      this.updateComplete.then(() => {
        this.querySelectorAll("ha-list-item").forEach((item) => {
          const style = document.createElement("style");
          style.innerHTML =
            "span.material-icons:first-of-type { margin-left: var(--mdc-list-item-graphic-margin, 32px) !important; margin-right: 0px !important;}";
          item!.shadowRoot!.appendChild(style);
        });
      });
    }
  }

  /**
   * LLM: Event handler for click events on the trigger element.
   * Shows the menu when the trigger is clicked, unless disabled.
   * Sets the anchor element for menu positioning.
   */
  private _handleClick(): void {
    if (this.disabled) {
      return;
    }
    this._menu!.anchor = this.noAnchor ? null : this;
    this._menu!.show();
  }

  /**
   * LLM: Gets the trigger button element from the slot.
   * Supports ha-icon-button, ha-button, or mwc-button as trigger elements.
   */
  private get _triggerButton() {
    return this.querySelector(
      'ha-icon-button[slot="trigger"], ha-button[slot="trigger"], mwc-button[slot="trigger"]'
    ) as HaIconButton | Button | null;
  }

  /**
   * LLM: Sets ARIA attributes on the trigger button for accessibility.
   * Called when the trigger slot changes to ensure proper accessibility setup.
   */
  private _setTriggerAria() {
    if (this._triggerButton) {
      this._triggerButton.ariaHasPopup = "menu";
    }
  }

  static styles = css`
    :host {
      display: inline-block;
      position: relative;
    }
    ::slotted([disabled]) {
      color: var(--disabled-text-color);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-button-menu": HaButtonMenu;
  }
}
