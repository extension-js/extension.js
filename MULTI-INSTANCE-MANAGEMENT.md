# Extension.js Multi-Instance Management

## Overview

Extension.js supports running multiple development instances simultaneously, each with its own isolated browser window, WebSocket connection, and manager extension. This is particularly useful for AI debugging scenarios where multiple instances need to run in parallel.

## Architecture

### Core Components

1. **Instance Manager** (`programs/develop/lib/instance-manager.ts`)
   - Manages the lifecycle of development instances
   - Allocates unique ports for each instance
   - Tracks instance state and metadata

2. **Dynamic Extension Manager** (`programs/develop/lib/dynamic-extension-manager.ts`)
   - Generates browser-specific manager extensions
   - Creates instance-specific copies with unique ports
   - Manages extension lifecycle and cleanup

3. **Port Manager** (`programs/develop/webpack/lib/port-manager.ts`)
   - Handles port allocation and conflict resolution
   - Manages WebSocket port assignment
   - Provides port information for logging

## Directory Structure

### User Project Structure

```
examples/content/dist/extension-js/
├── extensions/                    # Manager extensions
│   ├── chrome-manager/           # Base Chrome template
│   ├── edge-manager/             # Base Edge template
│   ├── firefox-manager/          # Base Firefox template
│   ├── chrome-manager-8094/      # Instance-specific Chrome manager
│   ├── edge-manager-8095/        # Instance-specific Edge manager
│   └── firefox-manager-8096/     # Instance-specific Firefox manager
└── profiles/                     # Browser user profiles
    ├── chrome-profile/           # Chrome user data
    ├── edge-profile/             # Edge user data
    └── firefox-profile/          # Firefox user data
```

### Naming Convention

- **Base Templates**: `{browser}-manager/` (e.g., `chrome-manager/`)
- **Instance Managers**: `{browser}-manager-{port}/` (e.g., `chrome-manager-8094/`)
- **User Profiles**: `{browser}-profile/` (e.g., `chrome-profile/`)

## How It Works

### 1. Instance Creation

When you run `pnpm extension dev <path> --browser <browser> --port <port>`:

1. **Port Allocation**: The system finds available ports for:
   - Development server (default: 8080+)
   - WebSocket server (default: 9000+)

2. **Instance Registration**: Creates a new instance record with:
   - Unique instance ID
   - Allocated ports
   - Browser type
   - Project path
   - Status: "running"

3. **Manager Extension Generation**: Creates a browser-specific manager extension:
   - Copies base template for the browser
   - Replaces placeholders with instance-specific values
   - Generates unique extension key
   - Stores in `dist/extension-js/extensions/{browser}-manager-{port}/`

### 2. Browser Launch

The browser is launched with:

1. **User Profile**: Isolated profile directory
2. **Manager Extension**: Instance-specific manager extension
3. **User Extension**: The actual extension being developed
4. **WebSocket Connection**: Unique port for communication

### 3. Communication Flow

```
CLI Instance → WebSocket Server → Manager Extension → Browser Extension
     ↓              ↓                    ↓                ↓
  Port 8094    Port 9006        chrome-manager-8094   User Extension
```

### 4. Hot Reload

When files change:

1. **File Detection**: Webpack detects changes
2. **Recompilation**: Extension is recompiled
3. **WebSocket Message**: Manager extension receives reload signal
4. **Browser Reload**: Extension is reloaded in browser
5. **Extension ID**: New extension ID is sent back to CLI

## Instance Management

### Instance Registry

Instances are tracked in `~/.extension-js/instances.json`:

```json
{
  "instances": {
    "7af9683b9ab90573": {
      "instanceId": "7af9683b9ab90573",
      "browser": "chrome",
      "port": 8094,
      "webSocketPort": 9006,
      "projectPath": "/path/to/project",
      "extensionId": "jcfjeppdiiljdpdbcaiejnmakcbbkpje",
      "managerExtensionId": "ivxyzctjunswjrcuanpjurljbosxhtnv",
      "profilePath": "/path/to/profile",
      "status": "running",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

### Instance States

- **running**: Instance is active and communicating
- **terminated**: Instance has been stopped
- **error**: Instance encountered an error

## Browser Support

### Chrome/Chromium-based

- **Manifest Version**: 3
- **Background**: Service Worker
- **Extension Key**: Required
- **Manager Template**: `chrome-manager-extension/`

### Edge

- **Manifest Version**: 3
- **Background**: Service Worker
- **Extension Key**: Required
- **Manager Template**: `edge-manager-extension/`

### Firefox

- **Manifest Version**: 2
- **Background**: Scripts (not service worker)
- **Extension Key**: Not required
- **Manager Template**: `firefox-manager-extension/`

## Usage Examples

### Basic Usage

```bash
# Start a Chrome instance
pnpm extension dev ./examples/content --browser chrome --port 8094

# Start an Edge instance
pnpm extension dev ./examples/action --browser edge --port 8095

# Start a Firefox instance
pnpm extension dev ./examples/content-react --browser firefox --port 8096
```

### Multiple Instances

```bash
# Run 5 different extensions simultaneously
pnpm extension dev ./examples/content --browser chrome --port 8094 &
pnpm extension dev ./examples/action --browser chrome --port 8095 &
pnpm extension dev ./examples/content-react --browser chrome --port 8096 &
pnpm extension dev ./examples/content-vue --browser chrome --port 8097 &
pnpm extension dev ./examples/content-svelte --browser chrome --port 8098 &
```

### Cross-Browser Testing

```bash
# Test same extension across browsers
pnpm extension dev ./examples/content --browser chrome --port 8094 &
pnpm extension dev ./examples/content --browser edge --port 8095 &
pnpm extension dev ./examples/content --browser firefox --port 8096 &
```

## Debugging

### Instance Information

Each instance logs:
```
🧩 Instance 7af9683b started
   Port: 8094, WebSocket: 9006
   Manager Extension: chrome-manager-8094
```

### Extension Information

When extension loads:
```
🧩 Extension.js 2.0.0-rc.38
   Extension Name         Extension.js - Content Script Example
   Extension Version      0.0.1
   Extension ID           jcfjeppdiiljdpdbcaiejnmakcbbkpje
   Instance: 7af9683b
```

### Directory Structure

Check generated extensions:
```bash
ls -la examples/content/dist/extension-js/extensions/
```

### Instance Registry

Check running instances:
```bash
cat ~/.extension-js/instances.json
```

## Cleanup

### Automatic Cleanup

- Instances are marked as "terminated" when CLI exits
- Manager extensions are cleaned up on instance termination
- User profiles persist for reuse

### Manual Cleanup

```bash
# Kill specific instance
pkill -f "extension dev.*--port 8094"

# Clean all instances
rm -rf ~/.extension-js/instances.json

# Clean all manager extensions
rm -rf examples/*/dist/extension-js/extensions/*-manager-*
```

## Troubleshooting

### Port Conflicts

If you see "Port XXXX is in use":
1. Check for existing instances: `cat ~/.extension-js/instances.json`
2. Kill conflicting processes: `lsof -ti:XXXX | xargs kill -9`
3. Use a different port: `--port XXXX`

### Extension Loading Errors

If manager extension fails to load:
1. Check extension directory exists
2. Verify manifest.json is valid
3. Check browser console for errors
4. Regenerate extension: restart the instance

### WebSocket Connection Issues

If WebSocket connection fails:
1. Check WebSocket port is available
2. Verify manager extension is loaded
3. Check browser console for connection errors
4. Restart the instance

## Best Practices

### For AI Debugging

1. **Use Different Ports**: Always specify unique ports
2. **Use Different Browsers**: Test across Chrome, Edge, Firefox
3. **Monitor Logs**: Watch for extension ID in stdout
4. **Clean Up**: Kill instances when done debugging

### For Development

1. **Isolate Instances**: Use different ports for each instance
2. **Cross-Browser Testing**: Test on multiple browsers
3. **Profile Management**: Reuse profiles for faster startup
4. **Hot Reload**: Make changes and watch for reload

### For Production

1. **Single Instance**: Use one instance per development session
2. **Port Management**: Let system auto-assign ports
3. **Cleanup**: Ensure proper cleanup on exit
4. **Monitoring**: Monitor instance registry for orphaned instances

## API Reference

### InstanceManager

```typescript
class InstanceManager {
  async createInstance(browser: string, projectPath: string, port?: number): Promise<InstanceInfo>
  async getInstance(instanceId: string): Promise<InstanceInfo | null>
  async updateInstance(instanceId: string, updates: Partial<InstanceInfo>): Promise<void>
  async terminateInstance(instanceId: string): Promise<void>
  async getRunningInstances(): Promise<InstanceInfo[]>
  async getStats(): Promise<InstanceStats>
}
```

### DynamicExtensionManager

```typescript
class DynamicExtensionManager {
  async generateExtension(instance: InstanceInfo): Promise<GeneratedExtension>
  async cleanupExtension(instanceId: string): Promise<void>
  async cleanupAllExtensions(): Promise<void>
  getExtensionPath(instanceId: string): string
  async extensionExists(instanceId: string): Promise<boolean>
}
```

### PortManager

```typescript
class PortManager {
  async allocatePorts(browser: string, projectPath: string, requestedPort?: number): Promise<PortAllocation>
  getCurrentInstance(): InstanceInfo | null
  async updateExtensionId(extensionId: string): Promise<void>
  async terminateCurrentInstance(): Promise<void>
}
```

## Migration Guide

### From Old Structure

If you have old `manager-port-XXXX` directories:

1. **Stop all instances**
2. **Remove old directories**:
   ```bash
   rm -rf examples/*/dist/extension-js/extensions/manager-port-*
   ```
3. **Start new instances** with new structure

### To New Structure

New instances automatically use the improved structure:
- `chrome-manager-8094/` instead of `manager-port-8094/`
- `edge-manager-8095/` instead of `manager-port-8095/`
- `firefox-manager-8096/` instead of `manager-port-8096/`

## Future Enhancements

### Planned Features

1. **CLI Commands**: `pnpm extension instances` for management
2. **Instance Monitoring**: Real-time status monitoring
3. **Resource Usage**: Track memory and CPU usage
4. **Auto Cleanup**: Automatic cleanup of orphaned instances
5. **Instance Groups**: Group related instances together

### Potential Improvements

1. **Shared Profiles**: Option to share profiles between instances
2. **Instance Templates**: Predefined instance configurations
3. **Remote Debugging**: Debug instances across network
4. **Performance Metrics**: Track instance performance
5. **Integration Testing**: Automated multi-instance testing

---

This documentation provides a comprehensive guide to the multi-instance management system. For questions or issues, please refer to the troubleshooting section or create an issue in the repository. 