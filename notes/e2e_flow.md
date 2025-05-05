# End-to-End Flow: From Subscription to Integration

## 1. Initial Connection and Subscription Setup

### 1.1 Core Connection Establishment

```typescript
// src/state/connection-mixin.ts
protected initializeHass(auth: Auth, conn: Connection) {
  // Initialize Home Assistant connection
  this.hass = {
    auth,
    connection: conn,
    connected: true,
    // ... other properties
  };
  this.hassConnected();
}
```

### 1.2 Subscription Initialization

```typescript
// src/state/connection-mixin.ts
protected hassConnected() {
  const conn = this.hass!.connection;

  // Core subscriptions for real-time updates
  subscribeEntities(conn, (states) => this._updateHass({ states }));
  subscribeConfig(conn, (config) => this._updateHass({ config }));
  // ... other subscriptions
}
```

## 2. Integration Setup Flow

### 2.1 User Initiation

```typescript
// src/panels/config/integrations/dialog-add-integration.ts
public async showDialog(params?: AddIntegrationDialogParams): Promise<void> {
  const loadPromise = this._load();
  this._open = true;
  this._pickedBrand = params?.brand;
  // ... initialization
}
```

### 2.2 Integration Loading

```typescript
// src/panels/config/integrations/dialog-add-integration.ts
private async _load() {
  const descriptions = await getIntegrationDescriptions(this.hass);
  // Load core and custom integrations
  this._integrations = {
    ...descriptions.core.integration,
    ...descriptions.custom.integration,
  };
  // Load helper integrations
  this._helpers = {
    ...descriptions.core.helper,
    ...descriptions.custom.helper,
  };
}
```

### 2.3 Integration Selection

```typescript
// src/panels/config/integrations/dialog-add-integration.ts
private async _handleIntegrationPicked(integration: IntegrationListItem) {
  if (integration.supported_by) {
    this._supportedBy(integration);
    return;
  }
  if (integration.config_flow) {
    this._createFlow(integration.domain);
    return;
  }
  // ... other integration types
}
```

## 3. Config Flow Process

### 3.1 Flow Creation

```typescript
// src/panels/config/integrations/dialog-add-integration.ts
private async _createFlow(domain: string) {
  const flowsInProgress = await this._fetchFlowsInProgress([domain]);
  if (flowsInProgress?.length) {
    this._pickedBrand = domain;
    return;
  }
  const manifest = await fetchIntegrationManifest(this.hass, domain);
  this.closeDialog();
  showConfigFlowDialog(this, {
    startFlowHandler: domain,
    manifest,
    // ... other parameters
  });
}
```

### 3.2 Flow Step Handling

```typescript
// src/dialogs/config-flow/step-flow-form.ts
protected async _handleSubmit(ev: Event) {
  ev.preventDefault();
  const formData = new FormData(ev.target as HTMLFormElement);
  const result = await this.hass.callWS<DataEntryFlowStep>({
    type: "config_flow/step",
    flow_id: this.flow.flow_id,
    step_id: this.flow.step_id,
    data: formData,
  });
  // ... handle result
}
```

## 4. WebSocket Communication Flow

### 4.1 Message Types

```typescript
// WebSocket message types for config flow
interface ConfigFlowMessage {
  type: "config_flow/create" | "config_flow/step" | "config_flow/abort";
  flow_id?: string;
  handler?: string;
  step_id?: string;
  data?: Record<string, any>;
}
```

### 4.2 State Updates

```typescript
// src/state/connection-mixin.ts
private _updateHass(update: Partial<HomeAssistant>) {
  this.hass = { ...this.hass!, ...update };
  fireEvent(this, "hass-update", { hass: this.hass });
}
```

## 5. Integration Completion

### 5.1 Entry Creation

```typescript
// src/dialogs/config-flow/step-flow-create-entry.ts
protected async _createEntry() {
  const result = await this.hass.callWS<DataEntryFlowResult>({
    type: "config_flow/create_entry",
    flow_id: this.flow.flow_id,
  });
  // ... handle result
}
```

### 5.2 State Synchronization

```typescript
// After successful integration
subscribeConfigEntries(this.hass, (entries) => {
  // Update UI with new integration
  this._updateHass({ config_entries: entries });
});
```

## 6. Error Handling and Recovery

### 6.1 Connection Errors

```typescript
// src/state/connection-mixin.ts
conn.addEventListener("reconnect-error", (_conn, err) => {
  if (err === ERR_INVALID_AUTH) {
    broadcastConnectionStatus("auth-invalid");
    location.reload();
  }
});
```

### 6.2 Flow Errors

```typescript
// src/dialogs/config-flow/step-flow-form.ts
if (result.type === "abort") {
  showAlertDialog(this, {
    text: result.reason,
    warning: true,
  });
}
```

## 7. Performance Considerations

### 7.1 Connection Management

- Single WebSocket connection for all subscriptions
- Automatic reconnection with backoff
- Connection health monitoring

### 7.2 State Updates

- Batched updates to minimize re-renders
- Memoization of processed data
- Efficient state diffing

### 7.3 Resource Cleanup

- Proper unsubscribe handling
- Memory leak prevention
- Connection cleanup on component unmount

## 8. Security Considerations

### 8.1 Authentication

- Token-based authentication
- Secure WebSocket connection
- Session management

### 8.2 Data Validation

- Server-side validation
- Client-side validation
- Input sanitization

## 9. Testing and Debugging

### 9.1 Development Tools

- WebSocket message logging
- State inspection
- Performance profiling

### 9.2 Error Tracking

- Error boundary implementation
- Logging and monitoring
- User feedback mechanisms
