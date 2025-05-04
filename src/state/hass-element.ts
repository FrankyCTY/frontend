import type { Constructor } from "../types";
import AuthMixin from "./auth-mixin";
import { connectionMixin } from "./connection-mixin";
import { dialogManagerMixin } from "./dialog-manager-mixin";
import DisconnectToastMixin from "./disconnect-toast-mixin";
import { hapticMixin } from "./haptic-mixin";
import { HassBaseEl } from "./hass-base-mixin";
import { loggingMixin } from "./logging-mixin";
import { contextMixin } from "./context-mixin";
import MoreInfoMixin from "./more-info-mixin";
import ActionMixin from "./action-mixin";
import NotificationMixin from "./notification-mixin";
import { panelTitleMixin } from "./panel-title-mixin";
import SidebarMixin from "./sidebar-mixin";
import ThemesMixin from "./themes-mixin";
import TranslationsMixin from "./translations-mixin";
import StateDisplayMixin from "./state-display-mixin";
import { urlSyncMixin } from "./url-sync-mixin";

// USERNOTE: Function to extend the HassBaseEl to apply methods to the class instance.
const ext = <T extends Constructor>(baseClass: T, mixins): T =>
  // USERNOTE: Apply mixing from RIGHT to LEFT (end of array to start of array)
  mixins.reduceRight((base, mixin) => mixin(base), baseClass);

// USERNOTE: The Augmented LitElement class
export class HassElement extends ext(HassBaseEl, [
  AuthMixin,
  ThemesMixin,
  TranslationsMixin,
  StateDisplayMixin,
  MoreInfoMixin,
  ActionMixin,
  SidebarMixin,
  DisconnectToastMixin,
  /**
   * LLM: Core WebSocket connection and subscription management
   * Purpose: Establishes and maintains WebSocket connection to Home Assistant backend
   * Role: Central hub for all real-time data subscriptions
   * Caveats: Handles connection lifecycle, reconnection, and subscription management
   */
  connectionMixin,
  NotificationMixin,
  dialogManagerMixin,
  urlSyncMixin,
  hapticMixin,
  panelTitleMixin,
  loggingMixin,
  contextMixin,
]) {}
