import type { ActionDetail } from "@material/mwc-list";
import {
  mdiCloudLock,
  mdiDotsVertical,
  mdiMagnify,
  mdiPower,
  mdiRefresh,
} from "@mdi/js";
import type { UnsubscribeFunc } from "home-assistant-js-websocket";
import type { CSSResultGroup, PropertyValues, TemplateResult } from "lit";
import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators";
import memoizeOne from "memoize-one";
import { isComponentLoaded } from "../../../common/config/is_component_loaded";
import "../../../components/chips/ha-assist-chip";
import "../../../components/ha-button-menu";
import "../../../components/ha-card";
import "../../../components/ha-icon-button";
import "../../../components/ha-icon-next";
import "../../../components/ha-list-item";
import "../../../components/ha-menu-button";
import "../../../components/ha-svg-icon";
import "../../../components/ha-tip";
import "../../../components/ha-top-app-bar-fixed";
import type { CloudStatus } from "../../../data/cloud";
import type { RepairsIssue } from "../../../data/repairs";
import {
  severitySort,
  subscribeRepairsIssueRegistry,
} from "../../../data/repairs";
import type { UpdateEntity } from "../../../data/update";
import {
  checkForEntityUpdates,
  filterUpdateEntitiesWithInstall,
} from "../../../data/update";
import {
  QuickBarMode,
  showQuickBar,
} from "../../../dialogs/quick-bar/show-dialog-quick-bar";
import { showRestartDialog } from "../../../dialogs/restart/show-dialog-restart";
import type { PageNavigation } from "../../../layouts/hass-tabs-subpage";
import { SubscribeMixin } from "../../../mixins/subscribe-mixin";
import { haStyle } from "../../../resources/styles";
import type { HomeAssistant } from "../../../types";
import { documentationUrl } from "../../../util/documentation-url";
import { isMobileClient } from "../../../util/is_mobile";
import "../ha-config-section";
import { configSections } from "../ha-panel-config";
import "../repairs/ha-config-repairs";
import "./ha-config-navigation";
import "./ha-config-updates";
import { showShortcutsDialog } from "../../../dialogs/shortcuts/show-shortcuts-dialog";

/**
 * LLM: Utility function that generates a random tip to display on the dashboard.
 *
 * Purpose: Provides helpful tips to users about Home Assistant features and community resources.
 *
 * @param openFn - Function to open the shortcuts dialog
 * @param hass - HomeAssistant instance for localization and context
 * @param narrow - Boolean indicating if the UI is in narrow/mobile mode
 * @returns A randomly selected tip as HTML content, weighted by importance
 */
const randomTip = (openFn: any, hass: HomeAssistant, narrow: boolean) => {
  const weighted: string[] = [];
  let tips = [
    {
      content: hass.localize("ui.panel.config.tips.join", {
        forums: html`<a
          href="https://community.home-assistant.io"
          target="_blank"
          rel="noreferrer"
          >${hass.localize("ui.panel.config.tips.join_forums")}</a
        >`,
        twitter: html`<a
          href=${documentationUrl(hass, `/twitter`)}
          target="_blank"
          rel="noreferrer"
          >${hass.localize("ui.panel.config.tips.join_x")}</a
        >`,
        mastodon: html`<a
          href=${documentationUrl(hass, `/mastodon`)}
          target="_blank"
          rel="noreferrer"
          >${hass.localize("ui.panel.config.tips.join_mastodon")}</a
        >`,
        bluesky: html`<a
          href=${documentationUrl(hass, `/bluesky`)}
          target="_blank"
          rel="noreferrer"
          >${hass.localize("ui.panel.config.tips.join_bluesky")}</a
        >`,
        discord: html`<a
          href=${documentationUrl(hass, `/join-chat`)}
          target="_blank"
          rel="noreferrer"
          >${hass.localize("ui.panel.config.tips.join_chat")}</a
        >`,
        blog: html`<a
          href=${documentationUrl(hass, `/blog`)}
          target="_blank"
          rel="noreferrer"
          >${hass.localize("ui.panel.config.tips.join_blog")}</a
        >`,
        newsletter: html`<span class="keep-together"
          ><a
            href="https://newsletter.openhomefoundation.org/"
            target="_blank"
            rel="noreferrer"
            >${hass.localize("ui.panel.config.tips.join_newsletter")}</a
          >
        </span>`,
      }),
      weight: 2,
      narrow: true,
    },
  ];

  // LLM: Add keyboard shortcut tips only if shortcuts are enabled and not on mobile
  if (hass?.enableShortcuts && !isMobileClient) {
    const localizeParam = {
      keyboard_shortcut: html`<a href="#" @click=${openFn}
        >${hass.localize("ui.tips.keyboard_shortcut")}</a
      >`,
    };

    tips.push(
      {
        content: hass.localize("ui.tips.key_c_tip", localizeParam),
        weight: 1,
        narrow: false,
      },
      {
        content: hass.localize("ui.tips.key_m_tip", localizeParam),
        weight: 1,
        narrow: false,
      },
      {
        content: hass.localize("ui.tips.key_a_tip", localizeParam),
        weight: 1,
        narrow: false,
      }
    );
  }

  // LLM: Filter tips to only show those that work in narrow mode if we're in narrow mode
  if (narrow) {
    tips = tips.filter((tip) => tip.narrow);
  }

  // LLM: Create a weighted array where tips with higher weight appear more frequently
  tips.forEach((tip) => {
    for (let i = 0; i < tip.weight; i++) {
      weighted.push(tip.content);
    }
  });

  return weighted[Math.floor(Math.random() * weighted.length)];
};

/**
 * LLM: Main configuration dashboard component for Home Assistant.
 *
 * Purpose: Serves as the primary entry point for all configuration options in Home Assistant.
 * Displays system status information, available updates, repair issues, and navigation to
 * various configuration sections.
 *
 * Role in Scope: Central hub for accessing all configuration-related functionality.
 *
 * Features:
 * - Shows repair issues that need attention
 * - Displays available updates for entities
 * - Provides navigation to all configuration sections
 * - Shows helpful tips to users
 * - Includes quick actions for common tasks (check updates, restart)
 */
@customElement("ha-config-dashboard")
class HaConfigDashboard extends SubscribeMixin(LitElement) {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ type: Boolean, reflect: true }) public narrow = false;

  @property({ attribute: "is-wide", type: Boolean }) public isWide = false;

  @property({ attribute: false }) public cloudStatus?: CloudStatus;

  @property({ attribute: false }) public showAdvanced = false;

  @state() private _tip?: string;

  @state() private _repairsIssues: { issues: RepairsIssue[]; total: number } = {
    issues: [],
    total: 0,
  };

  /**
   * LLM: Memoized function to generate navigation pages for the config dashboard.
   * Conditionally includes the cloud page if the cloud component is loaded.
   *
   * @returns Array of PageNavigation objects representing available config sections
   */
  private _pages = memoizeOne((cloudStatus, isCloudLoaded) => {
    const pages: PageNavigation[] = [];
    // LLM: Only include the cloud configuration option if the cloud component is loaded
    if (isCloudLoaded) {
      pages.push({
        component: "cloud",
        path: "/config/cloud",
        name: "Home Assistant Cloud",
        info: cloudStatus,
        iconPath: mdiCloudLock,
        iconColor: "#3B808E",
        translationKey: "cloud",
      });
    }
    // LLM: Combine cloud pages (if any) with the standard dashboard sections defined in configSections
    return [...pages, ...configSections.dashboard];
  });

  /**
   * LLM: Subscribes to the repairs issue registry to display system issues.
   *
   * Purpose: Keeps track of system issues that need attention and displays them
   * on the dashboard, sorted by severity.
   *
   * Side Effects: Loads translations for the domains of the issues.
   */
  public hassSubscribe(): UnsubscribeFunc[] {
    return [
      subscribeRepairsIssueRegistry(this.hass.connection!, (repairs) => {
        // LLM: Filter out ignored issues
        const repairsIssues = repairs.issues.filter((issue) => !issue.ignored);

        this._repairsIssues = {
          // LLM: Sort issues by severity and take up to 2 issues (or all 3 if there are exactly 3)
          issues: repairsIssues
            .sort((a, b) => severitySort[a.severity] - severitySort[b.severity])
            .slice(0, repairsIssues.length === 3 ? repairsIssues.length : 2),
          total: repairsIssues.length,
        };

        // LLM: Load translations for all domains that have issues
        const integrations = new Set<string>();
        for (const issue of this._repairsIssues.issues) {
          integrations.add(issue.domain);
        }
        this.hass.loadBackendTranslation("issues", [...integrations]);
      }),
    ];
  }

  /**
   * LLM: Renders the configuration dashboard UI.
   *
   * Structure:
   * 1. App bar with menu, title and action buttons
   * 2. Repairs issues card (if any issues exist)
   * 3. Updates card (if any updates available)
   * 4. Navigation card with links to all config sections
   * 5. Random tip at the bottom
   */
  protected render(): TemplateResult {
    // LLM: Get update entities that can be installed and filter them
    const { updates: canInstallUpdates, total: totalUpdates } =
      this._filterUpdateEntitiesWithInstall(
        this.hass.states,
        this.hass.entities
      );

    const { issues: repairsIssues, total: totalRepairIssues } =
      this._repairsIssues;

    return html`
      <ha-top-app-bar-fixed>
        <ha-menu-button
          slot="navigationIcon"
          .hass=${this.hass}
          .narrow=${this.narrow}
        ></ha-menu-button>
        <div slot="title">${this.hass.localize("panel.config")}</div>

        <ha-icon-button
          slot="actionItems"
          .label=${this.hass.localize("ui.dialogs.quick-bar.title")}
          .path=${mdiMagnify}
          @click=${this._showQuickBar}
        ></ha-icon-button>
        <ha-button-menu slot="actionItems" @action=${this._handleMenuAction}>
          <ha-icon-button
            slot="trigger"
            .label=${this.hass.localize("ui.common.menu")}
            .path=${mdiDotsVertical}
          ></ha-icon-button>

          <ha-list-item graphic="icon">
            ${this.hass.localize("ui.panel.config.updates.check_updates")}
            <ha-svg-icon slot="graphic" .path=${mdiRefresh}></ha-svg-icon>
          </ha-list-item>

          <ha-list-item graphic="icon">
            ${this.hass.localize(
              "ui.panel.config.system_dashboard.restart_homeassistant"
            )}
            <ha-svg-icon slot="graphic" .path=${mdiPower}></ha-svg-icon>
          </ha-list-item>
        </ha-button-menu>

        <ha-config-section
          .narrow=${this.narrow}
          .isWide=${this.isWide}
          full-width
        >
          <!-- LLM: Conditionally render the repairs/updates card only if there are issues or updates -->
          ${repairsIssues.length || canInstallUpdates.length
            ? html`<ha-card outlined>
                ${repairsIssues.length
                  ? html`
                      <ha-config-repairs
                        .hass=${this.hass}
                        .narrow=${this.narrow}
                        .total=${totalRepairIssues}
                        .repairsIssues=${repairsIssues}
                      ></ha-config-repairs>
                      <!-- LLM: Show "more repairs" chip if not all issues are displayed -->
                      ${totalRepairIssues > repairsIssues.length
                        ? html`
                            <ha-assist-chip
                              href="/config/repairs"
                              .label=${this.hass.localize(
                                "ui.panel.config.repairs.more_repairs",
                                {
                                  count:
                                    totalRepairIssues - repairsIssues.length,
                                }
                              )}
                            >
                            </ha-assist-chip>
                          `
                        : ""}
                    `
                  : ""}
                <!-- LLM: Add a divider between repairs and updates sections if both exist -->
                ${repairsIssues.length && canInstallUpdates.length
                  ? html`<hr />`
                  : ""}
                ${canInstallUpdates.length
                  ? html`
                      <ha-config-updates
                        .hass=${this.hass}
                        .narrow=${this.narrow}
                        .total=${totalUpdates}
                        .updateEntities=${canInstallUpdates}
                      ></ha-config-updates>
                      <!-- LLM: Show "more updates" chip if not all updates are displayed -->
                      ${totalUpdates > canInstallUpdates.length
                        ? html`
                            <ha-assist-chip
                              href="/config/updates"
                              label=${this.hass.localize(
                                "ui.panel.config.updates.more_updates",
                                {
                                  count:
                                    totalUpdates - canInstallUpdates.length,
                                }
                              )}
                            >
                            </ha-assist-chip>
                          `
                        : ""}
                    `
                  : ""}
              </ha-card>`
            : ""}

          <!-- LLM: Navigation card with links to all configuration sections -->
          <ha-card outlined>
            <ha-config-navigation
              .hass=${this.hass}
              .narrow=${this.narrow}
              .showAdvanced=${this.showAdvanced}
              .pages=${this._pages(
                this.cloudStatus,
                isComponentLoaded(this.hass, "cloud")
              )}
            ></ha-config-navigation>
          </ha-card>
          <!-- LLM: Random tip shown at the bottom of the dashboard -->
          <ha-tip .hass=${this.hass}>${this._tip}</ha-tip>
        </ha-config-section>
      </ha-top-app-bar-fixed>
    `;
  }

  /**
   * LLM: Lifecycle method called when component properties change.
   * Initializes the random tip when the hass object becomes available.
   */
  protected override updated(changedProps: PropertyValues): void {
    super.updated(changedProps);

    if (!this._tip && changedProps.has("hass")) {
      this._tip = randomTip(this._openShortcutDialog, this.hass, this.narrow);
    }
  }

  /**
   * LLM: Opens the keyboard shortcuts dialog when a user clicks on the shortcut link in tips.
   */
  private _openShortcutDialog(ev: Event) {
    ev.preventDefault();

    showShortcutsDialog(this);
  }

  /**
   * LLM: Memoized function to filter and prepare update entities for display.
   *
   * Purpose: Filters update entities that can be installed and aren't hidden,
   * then limits the number shown based on the total count.
   *
   * @returns Object containing filtered updates and total count
   */
  private _filterUpdateEntitiesWithInstall = memoizeOne(
    (
      entities: HomeAssistant["states"],
      entityRegistry: HomeAssistant["entities"]
    ): { updates: UpdateEntity[]; total: number } => {
      // LLM: Get entities that can be installed and aren't hidden in the registry
      const updates = filterUpdateEntitiesWithInstall(entities).filter(
        (entity) => !entityRegistry[entity.entity_id]?.hidden
      );

      return {
        // LLM: Show up to 2 updates (or all 3 if there are exactly 3)
        updates: updates.slice(0, updates.length === 3 ? updates.length : 2),
        total: updates.length,
      };
    }
  );

  /**
   * LLM: Shows the quick bar dialog with command mode.
   *
   * Purpose: Provides quick access to commands and actions in Home Assistant.
   * Includes a hint about keyboard shortcuts if they're enabled.
   */
  private _showQuickBar(): void {
    const params = {
      keyboard_shortcut: html`<a href="#" @click=${this._openShortcutDialog}
        >${this.hass.localize("ui.tips.keyboard_shortcut")}</a
      >`,
    };

    showQuickBar(this, {
      mode: QuickBarMode.Command,
      hint: this.hass.enableShortcuts
        ? this.hass.localize("ui.dialogs.quick-bar.key_c_tip", params)
        : undefined,
    });
  }

  /**
   * LLM: Handles actions from the menu button in the app bar.
   *
   * Purpose: Processes user selections from the dropdown menu:
   * - Index 0: Check for entity updates
   * - Index 1: Show restart dialog
   */
  private async _handleMenuAction(ev: CustomEvent<ActionDetail>) {
    switch (ev.detail.index) {
      case 0:
        checkForEntityUpdates(this, this.hass);
        break;
      case 1:
        showRestartDialog(this);
        break;
    }
  }

  /**
   * LLM: Component styles for the configuration dashboard.
   *
   * Key styling features:
   * - Responsive layout with special handling for mobile/narrow view
   * - Safe area insets for bottom margin (especially important on mobile)
   * - Card styling with consistent margins and overflow handling
   * - Special styling for links, chips, and dividers
   */
  static get styles(): CSSResultGroup {
    return [
      haStyle,
      css`
        ha-card:last-child {
          margin-bottom: var(--safe-area-inset-bottom);
        }
        :host(:not([narrow])) ha-card:last-child {
          margin-bottom: max(24px, var(--safe-area-inset-bottom));
        }
        ha-config-section {
          margin: auto;
          margin-top: -32px;
          max-width: 600px;
        }
        ha-card {
          overflow: hidden;
        }
        ha-card a {
          text-decoration: none;
          color: var(--primary-text-color);
        }
        ha-assist-chip {
          margin: 8px 16px 16px 16px;
        }
        .title {
          font-size: var(--ha-font-size-l);
          padding: 16px;
          padding-bottom: 0;
        }

        @media all and (max-width: 600px) {
          ha-card {
            border-width: 1px 0;
            border-radius: 0;
            box-shadow: unset;
          }
          ha-config-section {
            margin-top: -42px;
          }
        }

        ha-tip {
          margin-bottom: max(var(--safe-area-inset-bottom), 8px);
        }

        .new {
          color: var(--primary-color);
        }

        .keep-together {
          display: inline-block;
        }

        hr {
          height: 1px;
          background-color: var(
            --ha-card-border-color,
            var(--divider-color, #e0e0e0)
          );
          border: none;
          margin-top: 0;
        }
      `,
    ];
  }
}

/**
 * LLM: TypeScript declaration to register the custom element with the browser.
 * This ensures proper type checking when using the element in HTML.
 */
declare global {
  interface HTMLElementTagNameMap {
    "ha-config-dashboard": HaConfigDashboard;
  }
}
