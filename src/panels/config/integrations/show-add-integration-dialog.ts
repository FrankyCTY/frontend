import { fireEvent } from "../../../common/dom/fire_event";
import type { IntegrationManifest } from "../../../data/integration";

export interface AddIntegrationDialogParams {
  brand?: string;
  domain?: string;
  // USERNOTE: The search filter to apply to the integrations in the dialog (e.g. passed from the /config/integrations/dashboard search input)
  initialFilter?: string;
}

export interface YamlIntegrationDialogParams {
  manifest: IntegrationManifest;
}

export const showAddIntegrationDialog = (
  element: HTMLElement,
  dialogParams?: AddIntegrationDialogParams
): void => {
  // USERNOTE: Listened & handled in the make-dialog-manager.ts that is set up by dialog-manager-mixin.ts
  fireEvent(element, "show-dialog", {
    dialogTag: "dialog-add-integration",
    dialogImport: () => import("./dialog-add-integration"),
    dialogParams: dialogParams,
  });
};

export const showYamlIntegrationDialog = (
  element: HTMLElement,
  dialogParams?: YamlIntegrationDialogParams
): void => {
  fireEvent(element, "show-dialog", {
    dialogTag: "dialog-yaml-integration",
    dialogImport: () => import("./dialog-yaml-integration"),
    dialogParams: dialogParams,
  });
};
