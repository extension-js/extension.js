# Extension.js Multi-Instance System

## Overview

The Extension.js multi-instance system allows you to run multiple development instances simultaneously, each with its own isolated environment. This is particularly useful for AI debugging scenarios where you need to test multiple solutions in parallel.

## Features

### ✅ Complete Instance Isolation

- **Unique Ports**: Each instance gets its own dev server port and WebSocket port
- **Unique Extensions**: Each instance gets its own manager extension with unique ID
- **Isolated Communication**: Each CLI instance only receives messages from its own service worker
- **Instance-Specific Profiles**: Each instance can have its own browser profile

### ✅ Multi-Browser Support

- **Chrome**: Multiple Chrome instances with unique extensions
- **Edge**: Multiple Edge instances with unique extensions
- **Firefox**: Multiple Firefox instances with unique extensions
- **Chromium-based**: Support for custom Chromium builds
- **Gecko-based**: Support for custom Gecko builds

### ✅ AI-Friendly Features

- **Instance Registry**: JSON file tracking all running instances
- **Automatic Cleanup**: Remove extensions when instances terminate
- **Error Recovery**: Automatic retry and cleanup on failures
- **Resource Management**: Proper cleanup of temporary files and processes

## Architecture

### Instance Management

```
InstanceManager
├── Instance Registry (~/.extension-js/instances.json)
├── Port Allocation (8080+, 9000+)
├── Instance Tracking (process ID, status, timestamps)
└── Cleanup Management (automatic + manual)
```

### Dynamic Extension Management

```
DynamicExtensionManager
├── Extension Generation (unique IDs, names, ports)
├── Service Worker Customization (instance routing)
├── File Management (temp directories, cleanup)
└── Browser Integration (installation, uninstallation)
```

### WebSocket Communication

```
WebSocket Server (per instance)
├── Instance Routing (message filtering)
├── Extension ID Tracking
├── Status Updates
└── Graceful Shutdown
```

## Usage

### Basic Multi-Instance Usage

```bash
# Terminal 1: Start Chrome instance
pnpm extension dev ./my-extension --browser chrome --port 8080

# Terminal 2: Start Edge instance
pnpm extension dev ./my-extension --browser edge --port 8081

# Terminal 3: Start Firefox instance
pnpm extension dev ./my-extension --browser firefox --port 8082
```

Each instance will:

- Get unique ports (dev server + WebSocket)
- Generate unique manager extensions
- Show instance-specific extension IDs
- Operate completely independently

### AI Debugging Workflow

```bash
# AI can run multiple instances for parallel testing
for i in {1..5}; do
  pnpm extension dev ./test-extension-$i --browser chrome &
done

# Each instance gets:
# - Instance ID: auto-generated (e.g., 7af9683b)
# - Dev Port: 8080, 8081, 8082, etc.
# - WebSocket Port: 9000, 9001, 9002, etc.
# - Manager Extension: auto-generated unique extension
```

### Instance Management

```bash
# List running instances (coming soon)
pnpm extension instances

# Clean up terminated instances
pnpm extension instances --cleanup

# Terminate specific instance (instance ID is auto-generated)
pnpm extension instances --kill 7af9683b
```

## Technical Details

### Instance Registry Format

```json
{
  "instances": {
    "7af9683b": {
      "instanceId": "7af9683b",
      "processId": 12345,
      "port": 8080,
      "webSocketPort": 9000,
      "browser": "chrome",
      "extensionId": "user-extension-id",
      "managerExtensionId": "manager-extension-id",
      "profilePath": "/tmp/extension-js-7af9683b",
      "projectPath": "/path/to/project",
      "startTime": 1703123456789,
      "status": "running"
    }
  },
  "lastCleanup": 1703123456789
}
```

### Port Allocation

- **Dev Server Ports**: 8080, 8081, 8082, ...
- **WebSocket Ports**: 9000, 9001, 9002, ...
- **Automatic Fallback**: If port is in use, next available port is used

### Extension Generation

Each instance gets a unique manager extension with:

- **Unique Extension ID**: 32-character alphanumeric string
- **Unique Name**: "Extension Manager (7af9683b)" (auto-generated)
- **Instance-Specific Port**: Hardcoded WebSocket port
- **Instance Routing**: Service worker filters messages by instance ID

### Service Worker Customization

```javascript
// Instance-specific service worker (auto-generated)
const instanceId = '__INSTANCE_ID__' // Replaced with actual instance ID during build
const port = '__RELOAD_PORT__' // Replaced with actual port during build

// Only process messages for this instance
if (message.instanceId && message.instanceId !== instanceId) {
  console.log(`Ignoring message from wrong instance`)
  return
}
```

## File Structure

```
~/.extension-js/
├── instances.json          # Instance registry
└── temp/                   # Temporary files

project/.extension-js-temp/
├── manager-7af9683b/       # Instance-specific manager extension (auto-generated ID)
│   ├── manifest.json
│   ├── reload-service.js
│   └── images/
└── manager-9bc12345/       # Another instance (auto-generated ID)
    ├── manifest.json
    ├── reload-service.js
    └── images/
```

## Error Handling

### Port Conflicts

- Automatic port allocation with fallback
- Clear error messages for port conflicts
- Graceful handling of port unavailability

### Extension Conflicts

- Unique extension IDs prevent conflicts
- Automatic cleanup of old extensions
- Error recovery for extension installation failures

### Process Management

- Instance tracking by process ID
- Automatic cleanup on process termination
- Graceful shutdown handling

## Performance Considerations

### Memory Usage

- Each instance uses additional memory for:
  - Browser process
  - Dev server
  - WebSocket server
  - Extension files

### File System

- Temporary files are cleaned up automatically
- Registry file is small and efficient
- Extension files are generated on-demand

### Network

- Each instance uses unique ports
- No network conflicts between instances
- Isolated WebSocket communication

## Troubleshooting

### Common Issues

**Port Already in Use**

```bash
# Solution: Use different port or let system auto-allocate
pnpm extension dev ./my-extension --port 8085
```

**Extension Not Loading**

```bash
# Solution: Check browser extension management
# Chrome: chrome://extensions
# Edge: edge://extensions
# Firefox: about:debugging
```

**Instance Not Terminating**

```bash
# Solution: Manual cleanup
pnpm extension instances --cleanup
# Or kill process manually
kill -9 <process-id>
```

### Debug Mode

Enable debug logging:

```bash
EXTENSION_ENV=development pnpm extension dev ./my-extension
```

This will show:

- Instance creation details
- Port allocation information
- Extension generation logs
- WebSocket communication logs

## Future Enhancements

### Planned Features

- **Instance Monitoring**: Real-time status dashboard
- **Resource Limits**: Configurable memory/CPU limits
- **Instance Templates**: Pre-configured instance setups
- **Cross-Instance Communication**: Shared state between instances
- **Instance Scheduling**: Automated instance management

### API Integration

- **REST API**: Programmatic instance management
- **WebSocket API**: Real-time instance status
- **Plugin System**: Custom instance behaviors

## Contributing

The multi-instance system is designed to be extensible. Key areas for contribution:

1. **Browser Support**: Add support for new browsers
2. **Instance Features**: Add new instance capabilities
3. **Performance**: Optimize memory and CPU usage
4. **Monitoring**: Add better instance monitoring
5. **Testing**: Improve test coverage

## Support

For issues and questions:

- **GitHub Issues**: Report bugs and feature requests
- **Documentation**: Check this README and inline code comments
- **Examples**: See `test-multi-instance.js` for usage examples
