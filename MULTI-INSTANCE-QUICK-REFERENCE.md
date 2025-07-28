# Multi-Instance Quick Reference

## 🚀 Quick Start

### Start Multiple Instances
```bash
# Chrome instances
pnpm extension dev ./examples/content --browser chrome --port 8094 &
pnpm extension dev ./examples/action --browser chrome --port 8095 &
pnpm extension dev ./examples/content-react --browser chrome --port 8096 &

# Cross-browser testing
pnpm extension dev ./examples/content --browser edge --port 8097 &
pnpm extension dev ./examples/content --browser firefox --port 8098 &
```

### Check Running Instances
```bash
# View instance registry
cat ~/.extension-js/instances.json

# Check generated extensions
ls -la examples/*/dist/extension-js/extensions/*-manager-*

# Monitor processes
ps aux | grep "extension dev"
```

## 🧹 Cleanup Commands

### Kill Specific Instance
```bash
# Kill by port
pkill -f "extension dev.*--port 8094"

# Kill by browser
pkill -f "extension dev.*--browser chrome"
```

### Clean All Instances
```bash
# Kill all extension dev processes
pkill -f "extension dev"

# Clean instance registry
rm -rf ~/.extension-js/instances.json

# Clean all manager extensions
rm -rf examples/*/dist/extension-js/extensions/*-manager-*
```

### Clean Specific Project
```bash
# Clean content example
rm -rf examples/content/dist/extension-js/extensions/*-manager-*
```

## 🔍 Debugging Commands

### Check Port Usage
```bash
# Check if port is in use
lsof -i :8094

# Kill process on port
lsof -ti:8094 | xargs kill -9
```

### Check Extension Structure
```bash
# View extension directory
ls -la examples/content/dist/extension-js/extensions/

# Check manager extension manifest
cat examples/content/dist/extension-js/extensions/chrome-manager-8094/manifest.json

# Check reload service
cat examples/content/dist/extension-js/extensions/chrome-manager-8094/reload-service.js
```

### Monitor Logs
```bash
# Watch for new instances
tail -f ~/.extension-js/instances.json

# Monitor extension dev processes
ps aux | grep "extension dev" | grep -v grep
```

## 📊 Instance Information

### Expected Output
```
🧩 Instance 7af9683b started
   Port: 8094, WebSocket: 9006
   Manager Extension: chrome-manager-8094

🧩 Extension.js 2.0.0-rc.38
   Extension Name         Extension.js - Content Script Example
   Extension Version      0.0.1
   Extension ID           jcfjeppdiiljdpdbcaiejnmakcbbkpje
   Instance: 7af9683b
```

### Directory Structure
```
examples/content/dist/extension-js/
├── extensions/
│   ├── chrome-manager/           # Base template
│   ├── chrome-manager-8094/      # Instance-specific
│   └── edge-manager-8095/        # Another instance
└── profiles/
    ├── chrome-profile/           # User data
    └── edge-profile/             # User data
```

## 🎯 Common Patterns

### AI Debugging Pattern
```bash
# Start 5 different extensions for parallel debugging
pnpm extension dev ./examples/content --browser chrome --port 8094 &
pnpm extension dev ./examples/action --browser chrome --port 8095 &
pnpm extension dev ./examples/content-react --browser chrome --port 8096 &
pnpm extension dev ./examples/content-vue --browser chrome --port 8097 &
pnpm extension dev ./examples/content-svelte --browser chrome --port 8098 &

# Monitor all instances
watch -n 1 'cat ~/.extension-js/instances.json | jq "."'
```

### Cross-Browser Testing Pattern
```bash
# Test same extension across all browsers
pnpm extension dev ./examples/content --browser chrome --port 8094 &
pnpm extension dev ./examples/content --browser edge --port 8095 &
pnpm extension dev ./examples/content --browser firefox --port 8096 &

# Check browser-specific manager extensions
ls -la examples/content/dist/extension-js/extensions/*-manager-*
```

### Hot Reload Testing Pattern
```bash
# Start instance
pnpm extension dev ./examples/content --browser chrome --port 8094

# In another terminal, edit a file
echo "// Test change" >> examples/content/content/scripts.js

# Watch for hot reload in browser
```

## ⚠️ Troubleshooting

### Port Already in Use
```bash
# Find process using port
lsof -i :8094

# Kill process
lsof -ti:8094 | xargs kill -9

# Or use different port
pnpm extension dev ./examples/content --browser chrome --port 8099
```

### Extension Won't Load
```bash
# Check extension directory exists
ls -la examples/content/dist/extension-js/extensions/chrome-manager-8094/

# Check manifest is valid
cat examples/content/dist/extension-js/extensions/chrome-manager-8094/manifest.json

# Regenerate extension (restart instance)
pkill -f "extension dev.*--port 8094"
pnpm extension dev ./examples/content --browser chrome --port 8094
```

### WebSocket Connection Failed
```bash
# Check WebSocket port
lsof -i :9006

# Check manager extension loaded
# Look for "Extension Manager" in browser extensions

# Restart instance
pkill -f "extension dev.*--port 8094"
pnpm extension dev ./examples/content --browser chrome --port 8094
```

## 📝 Notes

- **Instance IDs**: 16-character unique identifiers
- **Ports**: Dev server (8080+), WebSocket (9000+)
- **Manager Extensions**: `{browser}-manager-{port}/`
- **Profiles**: `{browser}-profile/` (persistent)
- **Registry**: `~/.extension-js/instances.json`

## 🎉 Success Indicators

✅ **Instance Started**: `🧩 Instance XXXXXXXX started`  
✅ **Extension Loaded**: `Extension ID: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`  
✅ **Hot Reload Working**: Browser updates when files change  
✅ **Multiple Instances**: Each has unique extension ID and ports  
✅ **Cross-Browser**: Works on Chrome, Edge, Firefox  

---

For detailed documentation, see [MULTI-INSTANCE-MANAGEMENT.md](./MULTI-INSTANCE-MANAGEMENT.md) 