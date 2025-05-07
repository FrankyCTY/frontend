import type { Auth, Connection, HassConfig } from "home-assistant-js-websocket";
import {
  callService,
  ERR_CONNECTION_LOST,
  ERR_INVALID_AUTH,
  subscribeConfig,
  subscribeEntities,
  subscribeServices,
} from "home-assistant-js-websocket";
import { fireEvent } from "../common/dom/fire_event";
import { subscribeAreaRegistry } from "../data/area_registry";
import { broadcastConnectionStatus } from "../data/connection-status";
import { subscribeDeviceRegistry } from "../data/device_registry";
import { subscribeFrontendUserData } from "../data/frontend";
import { forwardHaptic } from "../data/haptics";
import { DEFAULT_PANEL } from "../data/panel";
import { serviceCallWillDisconnect } from "../data/service";
import {
  DateFormat,
  FirstWeekday,
  NumberFormat,
  TimeFormat,
  TimeZone,
} from "../data/translation";
import { subscribePanels } from "../data/ws-panels";
import { translationMetadata } from "../resources/translations-metadata";
import type { Constructor, HomeAssistant, ServiceCallResponse } from "../types";
import { getLocalLanguage } from "../util/common-translation";
import { fetchWithAuth } from "../util/fetch-with-auth";
import { getState } from "../util/ha-pref-storage";
import hassCallApi, { hassCallApiRaw } from "../util/hass-call-api";
import type { HassBaseEl } from "./hass-base-mixin";
import { promiseTimeout } from "../common/util/promise-timeout";
import { subscribeFloorRegistry } from "../data/ws-floor_registry";
import { subscribeEntityRegistryDisplay } from "../data/ws-entity_registry_display";

/**
 * LLM: Core WebSocket connection and subscription management
 * Purpose: Establishes and maintains WebSocket connection to Home Assistant backend
 * Role: Central hub for all real-time data subscriptions
 * Caveats: Handles connection lifecycle, reconnection, and subscription management
 */
export const connectionMixin = <T extends Constructor<HassBaseEl>>(
  superClass: T
) =>
  class extends superClass {
    private __backendPingInterval?: ReturnType<typeof setInterval>;

    protected initializeHass(auth: Auth, conn: Connection) {
      const language = getLocalLanguage();

      this.hass = {
        auth,
        connection: conn,
        connected: true,
        states: null as any,
        entities: null as any,
        devices: null as any,
        areas: null as any,
        floors: null as any,
        config: null as any,
        themes: null as any,
        selectedTheme: null,
        panels: null as any,
        services: null as any,
        user: null as any,
        panelUrl: (this as any)._panelUrl,
        defaultPanel: DEFAULT_PANEL,
        language,
        selectedLanguage: null,
        locale: {
          language,
          number_format: NumberFormat.language,
          time_format: TimeFormat.language,
          date_format: DateFormat.language,
          time_zone: TimeZone.local,
          first_weekday: FirstWeekday.language,
        },
        resources: null as any,
        localize: () => "",

        translationMetadata,
        dockedSidebar: "docked",
        vibrate: true,
        debugConnection: __DEV__,
        suspendWhenHidden: true,
        enableShortcuts: true,
        moreInfoEntityId: null,
        hassUrl: (path = "") => new URL(path, auth.data.hassUrl).toString(),
        callService: async (
          domain,
          service,
          serviceData,
          target,
          notifyOnError = true,
          returnResponse = false
        ) => {
          if (this.hass?.debugConnection) {
            // eslint-disable-next-line no-console
            console.log(
              "Calling service",
              domain,
              service,
              serviceData,
              target
            );
          }
          try {
            return (await callService(
              conn,
              domain,
              service,
              serviceData ?? {},
              target,
              returnResponse
            )) as ServiceCallResponse;
          } catch (err: any) {
            if (
              err.error?.code === ERR_CONNECTION_LOST &&
              serviceCallWillDisconnect(domain, service, serviceData)
            ) {
              return { context: { id: "" } };
            }
            if (this.hass?.debugConnection) {
              // eslint-disable-next-line no-console
              console.error(
                "Error calling service",
                domain,
                service,
                serviceData,
                target
              );
            }
            if (notifyOnError) {
              forwardHaptic("failure");
              const lokalize = await this.hass!.loadBackendTranslation(
                "exceptions",
                err.translation_domain
              );
              const localizedErrorMessage = lokalize(
                `component.${err.translation_domain}.exceptions.${err.translation_key}.message`,
                err.translation_placeholders
              );
              const message =
                localizedErrorMessage ||
                (this as any).hass.localize(
                  "ui.notification_toast.action_failed",
                  "service",
                  `${domain}/${service}`
                ) +
                  ` ${
                    err.message ||
                    (err.error?.code === ERR_CONNECTION_LOST
                      ? "connection lost"
                      : "unknown error")
                  }`;
              fireEvent(this as any, "hass-notification", {
                message,
                duration: 10000,
              });
            }
            throw err;
          }
        },
        callApi: async (method, path, parameters, headers) =>
          hassCallApi(auth, method, path, parameters, headers),
        // callApiRaw introduced in 2024.11
        callApiRaw: async (method, path, parameters, headers, signal) =>
          hassCallApiRaw(auth, method, path, parameters, headers, signal),
        fetchWithAuth: (
          path: string,
          init: Parameters<typeof fetchWithAuth>[2]
        ) => fetchWithAuth(auth, `${auth.data.hassUrl}${path}`, init),
        // For messages that do not get a response
        sendWS: (msg) => {
          if (this.hass?.debugConnection) {
            // eslint-disable-next-line no-console
            console.log("Sending", msg);
          }
          conn.sendMessage(msg);
        },
        // For messages that expect a response
        callWS: <R>(msg) => {
          if (this.hass?.debugConnection) {
            // eslint-disable-next-line no-console
            console.log("Sending", msg);
          }

          const resp = conn.sendMessagePromise<R>(msg);

          if (this.hass?.debugConnection) {
            resp.then(
              // eslint-disable-next-line no-console
              (result) => console.log("Received", result),
              // eslint-disable-next-line no-console
              (err) => console.error("Error", err)
            );
          }
          return resp;
        },
        loadBackendTranslation: (category, integration?, configFlow?) =>
          // @ts-ignore
          this._loadHassTranslations(
            this.hass?.language,
            category,
            integration,
            configFlow
          ),
        loadFragmentTranslation: (fragment) =>
          // @ts-ignore
          this._loadFragmentTranslations(this.hass?.language, fragment),
        formatEntityState: (stateObj, state) =>
          (state != null ? state : stateObj.state) ?? "",
        formatEntityAttributeName: (_stateObj, attribute) => attribute,
        formatEntityAttributeValue: (stateObj, attribute, value) =>
          value != null ? value : (stateObj.attributes[attribute] ?? ""),
        ...getState(),
        ...this._pendingHass,
      };

      this.hassConnected();
    }

    /**
     * LLM: Establishes WebSocket subscriptions when connection is established
     * Purpose: Sets up real-time data subscriptions for various Home Assistant components
     * Role: Initializes all necessary subscriptions for UI updates
     * Caveats: Manages connection events and subscription lifecycle
     */
    protected hassConnected() {
      super.hassConnected();

      const conn = this.hass!.connection;

      // USERNOTE: Dispatch connected event to window obj.
      broadcastConnectionStatus("connected");

      // LLM: Connection event handlers
      // Purpose: Manage connection lifecycle events
      // Role: Handle connection state changes and errors
      conn.addEventListener("ready", () => this.hassReconnected());
      conn.addEventListener("disconnected", () => this.hassDisconnected());
      conn.addEventListener("reconnect-error", (_conn, err) => {
        if (err === ERR_INVALID_AUTH) {
          broadcastConnectionStatus("auth-invalid");
          location.reload();
        }
      });

      // LLM: Core entity subscription
      // Purpose: Subscribe to entity state changes
      // Role: Keep UI in sync with backend state
      subscribeEntities(conn, (states) => this._updateHass({ states }));

      // LLM: Entity registry subscription
      // Purpose: Subscribe to entity metadata changes
      // Role: Update entity display information
      subscribeEntityRegistryDisplay(conn, (entityReg) => {
        const entities: HomeAssistant["entities"] = {};
        for (const entity of entityReg.entities) {
          entities[entity.ei] = {
            entity_id: entity.ei,
            device_id: entity.di,
            area_id: entity.ai,
            labels: entity.lb,
            translation_key: entity.tk,
            platform: entity.pl,
            entity_category:
              entity.ec !== undefined
                ? entityReg.entity_categories[entity.ec]
                : undefined,
            has_entity_name: entity.hn,
            name: entity.en,
            icon: entity.ic,
            hidden: entity.hb,
            display_precision: entity.dp,
          };
        }
        this._updateHass({ entities });
      });

      // LLM: Device registry subscription
      // Purpose: Subscribe to device information changes
      // Role: Update device metadata and relationships
      subscribeDeviceRegistry(conn, (deviceReg) => {
        const devices: HomeAssistant["devices"] = {};
        for (const device of deviceReg) {
          devices[device.id] = device;
        }
        this._updateHass({ devices });
      });

      // LLM: Area registry subscription
      // Purpose: Subscribe to area configuration changes
      // Role: Update area information and relationships
      subscribeAreaRegistry(conn, (areaReg) => {
        const areas: HomeAssistant["areas"] = {};
        for (const area of areaReg) {
          areas[area.area_id] = area;
        }
        this._updateHass({ areas });
      });

      // LLM: Floor registry subscription
      // Purpose: Subscribe to floor configuration changes
      // Role: Update floor information and relationships
      subscribeFloorRegistry(conn, (floorReg) => {
        const floors: HomeAssistant["floors"] = {};
        for (const floor of floorReg) {
          floors[floor.floor_id] = floor;
        }
        this._updateHass({ floors });
      });

      // LLM: Core configuration subscription
      // Purpose: Subscribe to Home Assistant configuration changes
      // Role: Update UI based on configuration updates
      subscribeConfig(conn, (config) => this._updateHass({ config }));

      // LLM: Services subscription
      // Purpose: Subscribe to available services
      // Role: Update service availability and capabilities
      subscribeServices(conn, (services) => this._updateHass({ services }));

      // LLM: Panels subscription
      // Purpose: Subscribe to panel configuration changes
      // Role: Update available panels and their settings
      subscribePanels(conn, (panels) => this._updateHass({ panels }));

      // LLM: User data subscription
      // Purpose: Subscribe to user-specific settings
      // Role: Update UI based on user preferences
      subscribeFrontendUserData(conn, "core", (userData) =>
        this._updateHass({ userData })
      );

      // LLM: Connection health monitoring
      // Purpose: Ensure WebSocket connection remains active
      // Role: Detect and recover from connection issues
      clearInterval(this.__backendPingInterval);
      this.__backendPingInterval = setInterval(() => {
        if (this.hass?.connected) {
          promiseTimeout(15000, this.hass?.connection.ping()).catch(() => {
            if (!this.hass?.connected) {
              return;
            }
            console.log("WebSocket died, forcing reconnect...");
            this.hass?.connection.reconnect(true);
          });
        }
      }, 30000);
    }

    protected hassReconnected() {
      super.hassReconnected();

      this._updateHass({ connected: true });
      broadcastConnectionStatus("connected");

      // on reconnect always fetch config as we might miss an update while we were disconnected
      // @ts-ignore
      this.hass!.callWS({ type: "get_config" }).then((config: HassConfig) => {
        if (config.safe_mode) {
          // @ts-ignore Firefox supports forceGet
          location.reload(true);
        }
        this._updateHass({ config });
        this.checkDataBaseMigration();
      });
    }

    protected hassDisconnected() {
      super.hassDisconnected();
      this._updateHass({ connected: false });
      broadcastConnectionStatus("disconnected");
      clearInterval(this.__backendPingInterval);
    }
  };
