import type { UnsubscribeFunc } from "home-assistant-js-websocket";
import type { PropertyValues, ReactiveElement } from "lit";
import { property } from "lit/decorators";
import type { Constructor, HomeAssistant } from "../types";

export interface HassSubscribeElement {
  hassSubscribe(): UnsubscribeFunc[];
}

// USERNOTE: Mixin manages the subscription to the hass object.
// - Automatically subscribes when the component is connected
// - Automatically unsubscribes when the component is disconnected
// - Handles re-subscription if the connection is lost and restored
export const SubscribeMixin = <T extends Constructor<ReactiveElement>>(
  superClass: T
) => {
  class SubscribeClass extends superClass {
    @property({ attribute: false }) public hass?: HomeAssistant;

    /**
     * LLM: List of required host properties that must be set before subscriptions are established.
     *
     * Purpose: Ensures all required data is available before setting up subscriptions.
     *
     * Caveats & Side Effects:
     * - Subscriptions are delayed until all required props are set
     * - Changes to these props trigger subscription updates
     */
    protected hassSubscribeRequiredHostProps?: string[];

    /**
     * LLM: Internal storage for active subscription unsubscribe functions.
     *
     * Purpose: Maintains references to cleanup functions for all active subscriptions.
     *
     * Technical Details:
     * - Can contain both sync and async unsubscribe functions
     * - Cleared on component disconnect
     */
    private __unsubs?: (UnsubscribeFunc | Promise<UnsubscribeFunc>)[];

    /**
     * LLM: Lifecycle hook called when component is connected to DOM.
     *
     * Purpose: Initializes subscriptions when component becomes active.
     *
     * Technical Details:
     * - Calls _checkSubscribed to establish initial subscriptions
     * - Runs after super.connectedCallback()
     */
    public connectedCallback() {
      super.connectedCallback();
      this._checkSubscribed();
    }

    /**
     * LLM: Lifecycle hook called when component is disconnected from DOM.
     *
     * Purpose: Cleans up all active subscriptions to prevent memory leaks.
     *
     * Technical Details:
     * - Handles both sync and async unsubscribe functions
     * - Clears subscription storage
     * - Runs before super.disconnectedCallback()
     */
    public disconnectedCallback() {
      super.disconnectedCallback();
      if (this.__unsubs) {
        while (this.__unsubs.length) {
          const unsub = this.__unsubs.pop()!;
          if (unsub instanceof Promise) {
            unsub.then((unsubFunc) => unsubFunc());
          } else {
            unsub();
          }
        }
        this.__unsubs = undefined;
      }
    }

    /**
     * LLM: Lifecycle hook called when component properties are updated.
     *
     * Purpose: Manages subscription updates when relevant properties change.
     *
     * Technical Details:
     * - Checks for hass property changes
     * - Validates required host properties
     * - Triggers subscription updates when needed
     */
    protected updated(changedProps: PropertyValues) {
      super.updated(changedProps);
      if (changedProps.has("hass")) {
        this._checkSubscribed();
        return;
      }
      if (!this.hassSubscribeRequiredHostProps) {
        return;
      }
      for (const key of changedProps.keys()) {
        if (this.hassSubscribeRequiredHostProps.includes(key as string)) {
          this._checkSubscribed();
          return;
        }
      }
    }

    /**
     * LLM: Hook for components to define their subscription requirements.
     *
     * Purpose: Allows components to specify which Home Assistant events they need to observe.
     *
     * Caveats & Side Effects:
     * - Must be implemented by components using this mixin
     * - Return value determines subscription lifecycle
     *
     * Role in Scope: Core extension point for subscription management.
     */
    protected hassSubscribe(): (UnsubscribeFunc | Promise<UnsubscribeFunc>)[] {
      return [];
    }

    /**
     * LLM: Internal method to manage subscription state.
     *
     * Purpose: Ensures subscriptions are established when all requirements are met.
     *
     * Technical Details:
     * - Validates component connection state
     * - Checks required properties
     * - Establishes new subscriptions
     * - Prevents duplicate subscriptions
     *
     * Invoked When:
     * - Component is connected to the DOM
     * - HASS is updated
     * - HASS subscribe required host properties are updated
     */
    private _checkSubscribed(): void {
      if (
        // USERNOTE: Check if subscriptions already exist, preventing duplicate subscriptions
        this.__unsubs !== undefined ||
        // USERNOTE: Ensure the element is still connected to the DOM
        !(this as unknown as Element).isConnected ||
        // USERNOTE:   // Confirm that the Home Assistant (hass) context is initialized
        this.hass === undefined ||
        // USERNOTE: // Verify all required properties for subscribing are defined
        this.hassSubscribeRequiredHostProps?.some(
          (prop) => this[prop] === undefined
        )
      ) {
        return;
      }
      this.__unsubs = this.hassSubscribe();
    }
  }
  return SubscribeClass;
};
