import type { Auth, Connection } from "home-assistant-js-websocket";
import { LitElement } from "lit";
import { property } from "lit/decorators";
import type { HomeAssistant } from "../types";

export class HassBaseEl extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  // USERNOTE: As a little buffer for any state updates that arrive before the element’s hass property has ever been initialized.
  protected _pendingHass: Partial<HomeAssistant> = {};

  // eslint-disable-next-line: variable-name
  private __provideHass: HTMLElement[] = [];

  // USERNOTE: Function to provide the hass object to the element.
  public provideHass(el) {
    this.__provideHass.push(el);
    el.hass = this.hass;
  }

  protected initializeHass(_auth: Auth, _conn: Connection) {
    // implemented in connection-mixin
  }

  // Exists so all methods can safely call super method
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected hassConnected() {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected hassReconnected() {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected hassDisconnected() {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected panelUrlChanged(_newPanelUrl) {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected checkDataBaseMigration() {}

  // USERNOTE: Function to update the elements to have the updated hass object reference. (Not deep copy)
  protected hassChanged(hass, _oldHass) {
    this.__provideHass.forEach((el) => {
      (el as any).hass = hass;
    });
  }

  protected _updateHass(obj: Partial<HomeAssistant>) {
    // USERNOTE: If the hass object is not yet initialized, store the update in a buffer.
    if (!this.hass) {
      this._pendingHass = { ...this._pendingHass, ...obj };
      return;
    }
    // USERNOTE: If the hass object is initialized, update the hass object.
    this.hass = { ...this.hass, ...obj };
  }
}
