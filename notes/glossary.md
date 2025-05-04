# Glossary

## Integration Setup Flow

### Config Flow

- **Purpose**: Generic system for setting up integrations in Home Assistant
- **Role**: Handles the step-by-step configuration process for integrations
- **Components**:
  - Frontend dialog system
  - Backend flow handlers
  - WebSocket communication
  - State management

### Config Entry

- **Purpose**: Stores integration configuration data
- **Role**: Persistent storage of integration settings
- **Fields**:
  - `entry_id`: Unique identifier
  - `domain`: Integration domain
  - `title`: Display name
  - `data`: Configuration data
  - `options`: Additional settings
  - `version`: Schema version
  - `source`: Configuration source

### WebSocket Communication

- **Purpose**: Real-time communication between frontend and backend
- **Role**: Handles config flow steps and state updates
- **Key Features**:
  - Bi-directional communication
  - Event-based updates
  - State synchronization

### Integration State

- **Purpose**: Tracks integration and device states
- **Role**: Manages real-time updates and UI synchronization
- **Components**:
  - Entity states
  - Device information
  - Service availability
