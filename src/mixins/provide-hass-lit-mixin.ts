import type { PropertyValues, ReactiveElement } from "lit";
import type { Constructor, HomeAssistant } from "../types";

export interface ProvideHassElement {
  provideHass(element: HTMLElement);
}

// USERNOTE: Ensure we share the same hass object reference across all elements, especially the one that is dynamically created in javascript.
export const ProvideHassLitMixin = <T extends Constructor<ReactiveElement>>(
  superClass: T
) =>
  class extends superClass {
    protected hass!: HomeAssistant;

    private __provideHass: HTMLElement[] = [];

    public provideHass(el) {
      this.__provideHass.push(el);
      el.hass = this.hass;
    }

    // USERNOTE: It’s called after the element’s properties have been “reactively” updated and its template has (normally) re-rendered.
    // USERNOTE: IF changes include hass, then update the hass object for all elements that have been provided with the hass object.
    protected updated(changedProps: PropertyValues) {
      super.updated(changedProps);

      if (changedProps.has("hass")) {
        this.__provideHass.forEach((el) => {
          (el as any).hass = this.hass;
        });
      }
    }
  };
