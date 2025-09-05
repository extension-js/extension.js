import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import {InstanceInfo} from './instance-manager'
import {DevOptions} from '../../../develop-lib/config-types'
import * as messages from '../../webpack-lib/messages'

export type ExtensionManifest =
  | (chrome.runtime.ManifestV2 & {
      background?: {scripts?: string[]; type?: string}
    })
  | (chrome.runtime.ManifestV3 & {
      background?: {service_worker?: string; type?: string}
    })

export interface GeneratedExtension {
  extensionId: string
  manifest: ExtensionManifest
  serviceWorkerPath: string
  extensionPath: string
}

export class DynamicExtensionManager {
  private readonly baseExtensionPath: string
  private readonly projectPath: string
  private readonly userExtensionsPath: string

  constructor(projectPath?: string) {
    // Resolve the base path for bundled manager extension assets.
    // When bundled (dist/module.js), __dirname points to `.../dist`.
    // In that case assets live under `dist/webpack/plugin-reload/extensions`.
    // In source/dev, assets live under `webpack/plugin-reload/extensions`.
    // Also support a fallback `dist/extensions` if present.
    const candidateBasePaths: string[] = []

    // 1) Installed package layout: resolve entry point reliably
    try {
      const entryPath = require.resolve('extension-develop')
      const distDir = path.dirname(entryPath)
      candidateBasePaths.push(path.join(distDir, 'extensions'))
    } catch {}

    // 2) Repo build layout: when executing within this package's dist/
    candidateBasePaths.push(path.join(__dirname, 'extensions'))

    // 3) If __dirname is repo root, prefer root/dist/extensions
    candidateBasePaths.push(path.join(__dirname, 'dist', 'extensions'))

    // 4) Monorepo root executing compiled bundle: programs/develop/dist/extensions
    candidateBasePaths.push(
      path.join(__dirname, 'programs', 'develop', 'dist', 'extensions')
    )

    // 5) Installed indirect: current project node_modules
    candidateBasePaths.push(
      path.join(
        process.cwd(),
        'node_modules',
        'extension-develop',
        'dist',
        'extensions'
      )
    )

    // 6) Source layout during tests/ts-node: programs/develop/webpack/plugin-reload/extensions
    candidateBasePaths.push(
      path.join(__dirname, '..', '..', 'plugin-reload', 'extensions')
    )

    let resolvedBasePath = candidateBasePaths[0]
    for (const candidate of candidateBasePaths) {
      try {
        if (fsSync.existsSync(candidate)) {
          resolvedBasePath = candidate
          break
        }
      } catch {}
    }

    this.baseExtensionPath = resolvedBasePath
    this.projectPath = projectPath || process.cwd()
    this.userExtensionsPath = path.join(
      this.projectPath,
      'dist',
      'extension-js',
      'extensions'
    )
  }

  private generateExtensionKey(): string {
    // Generate a valid extension key (base64 encoded public key)
    const keyData = crypto.randomBytes(128)
    return keyData.toString('base64')
  }

  private getManagerKeyStorePath(): string {
    // Cross-platform user config dir
    const home = require('os').homedir()
    let baseDir: string
    if (process.platform === 'win32') {
      const appData =
        process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
      baseDir = path.join(appData, 'extension-js', 'manager-keys')
    } else if (process.platform === 'darwin') {
      baseDir = path.join(
        home,
        'Library',
        'Application Support',
        'extension-js',
        'manager-keys'
      )
    } else {
      baseDir = path.join(home, '.config', 'extension-js', 'manager-keys')
    }
    return baseDir
  }

  private async getOrCreatePersistentManagerKey(): Promise<string> {
    try {
      const storeDir = this.getManagerKeyStorePath()
      await fs.mkdir(storeDir, {recursive: true})
      const projectHash = crypto
        .createHash('sha1')
        .update(this.projectPath || process.cwd())
        .digest('hex')
      const keyPath = path.join(storeDir, `${projectHash}.json`)
      try {
        const raw = await fs.readFile(keyPath, 'utf-8')
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed.key === 'string' && parsed.key.length > 0) {
          return parsed.key
        }
      } catch {}
      const newKey = this.generateExtensionKey()
      try {
        await fs.writeFile(keyPath, JSON.stringify({key: newKey}, null, 2))
      } catch {}
      return newKey
    } catch {
      // Fallback to ephemeral key if persistence fails
      return this.generateExtensionKey()
    }
  }

  private getBaseExtensionPath(browser: DevOptions['browser']): string {
    const browserMap: Record<string, string> = {
      chrome: 'chrome-manager-extension',
      edge: 'edge-manager-extension',
      firefox: 'firefox-manager-extension',
      'chromium-based': 'chromium-based-manager-extension',
      'gecko-based': 'gecko-based-manager-extension'
    }

    const extensionName = browserMap[browser] || 'chrome-manager-extension'
    return path.join(this.baseExtensionPath, extensionName)
  }

  private async readBaseManifest(
    browser: DevOptions['browser']
  ): Promise<ExtensionManifest> {
    const basePath = this.getBaseExtensionPath(browser)
    const manifestPath = path.join(basePath, 'manifest.json')
    const manifestContent = await fs.readFile(manifestPath, 'utf-8')
    return JSON.parse(manifestContent)
  }

  private async readBaseServiceWorker(
    browser: DevOptions['browser']
  ): Promise<string> {
    const basePath = this.getBaseExtensionPath(browser)
    const serviceWorkerPath = path.join(basePath, 'reload-service.js')
    return await fs.readFile(serviceWorkerPath, 'utf-8')
  }

  async generateExtension(instance: InstanceInfo): Promise<GeneratedExtension> {
    const extensionId = instance.managerExtensionId
    const instanceId = instance.instanceId

    // Create unique extension name and description
    // #${instanceId.slice(0, 8)}
    const extensionName = `Extension.js DevTools`
    const extensionDescription =
      `Extension.js built-in developer tools for instance ` +
      `${instanceId.slice(0, 8)}.`

    // Read base extension files
    const baseManifest = await this.readBaseManifest(instance.browser)
    const baseServiceWorker = await this.readBaseServiceWorker(instance.browser)

    // Generate unique manifest
    const manifest: ExtensionManifest = {
      ...baseManifest,
      name: extensionName,
      description: extensionDescription,
      key: await this.getOrCreatePersistentManagerKey()
    }

    // Create instance-specific service worker with unique port
    const serviceWorkerContent = baseServiceWorker
      .replace(
        /const\s+port\s*=\s*['"][^'"]+['"]/,
        `const port = '${instance.webSocketPort}'`
      )
      .replace(
        /const\s+instanceId\s*=\s*['"][^'"]+['"]/,
        `const instanceId = '${instance.instanceId}'`
      )

    // Add instance-specific cache buster and logging
    const enhancedServiceWorker =
      `// Instance: ${instanceId}\n` +
      `// Generated: ${new Date().toISOString()}\n` +
      `// Cache-buster: ${Date.now()}\n\n` +
      `${serviceWorkerContent}\n\n` +
      `// Instance-specific logging\n` +
      `${
        process.env.EXTENSION_ENV === 'development'
          ? `console.log('[Extension.js DevTools] Instance ${instanceId} ` +
            `initialized on port ${instance.webSocketPort}');`
          : ''
      }\n`

    // Create extension directory (ensure only one manager per project/profile)
    const extensionPath = path.join(
      this.userExtensionsPath,
      `${instance.browser}-manager-${instance.port}`
    )
    try {
      // Proactively remove stale manager folders to avoid multiple managers reconnecting
      const entries = await fs.readdir(this.userExtensionsPath, {
        withFileTypes: true
      })
      for (const entry of entries) {
        try {
          if (
            entry.isDirectory() &&
            entry.name.startsWith(`${instance.browser}-manager-`) &&
            path.join(this.userExtensionsPath, entry.name) !== extensionPath
          ) {
            await fs.rm(path.join(this.userExtensionsPath, entry.name), {
              recursive: true,
              force: true
            })
          }
        } catch {}
      }
    } catch {}
    await fs.mkdir(extensionPath, {recursive: true})

    // Write manifest with instance ID replacement
    const manifestPath = path.join(extensionPath, 'manifest.json')
    const manifestContent = JSON.stringify(manifest, null, 2).replace(
      /__INSTANCE_ID__/g,
      instance.instanceId
    )
    await fs.writeFile(manifestPath, manifestContent)

    // Write service worker
    const serviceWorkerPath = path.join(extensionPath, 'reload-service.js')
    await fs.writeFile(serviceWorkerPath, enhancedServiceWorker)

    // Copy other necessary files
    await this.copyExtensionFiles(instance.browser, extensionPath)

    return {
      extensionId,
      manifest,
      serviceWorkerPath,
      extensionPath
    }
  }

  private async copyExtensionFiles(
    browser: DevOptions['browser'],
    targetPath: string
  ): Promise<void> {
    const basePath = this.getBaseExtensionPath(browser)

    try {
      const entries = await fs.readdir(basePath, {withFileTypes: true})

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name === 'images') {
          const sourceImagesPath = path.join(basePath, 'images')
          const targetImagesPath = path.join(targetPath, 'images')
          await fs.mkdir(targetImagesPath, {recursive: true})

          const imageEntries = await fs.readdir(sourceImagesPath, {
            withFileTypes: true
          })
          for (const imageEntry of imageEntries) {
            if (imageEntry.isFile()) {
              const sourceImagePath = path.join(
                sourceImagesPath,
                imageEntry.name
              )
              const targetImagePath = path.join(
                targetImagesPath,
                imageEntry.name
              )
              await fs.copyFile(sourceImagePath, targetImagePath)
            }
          }
        } else if (entry.isDirectory() && entry.name === 'pages') {
          // Copy pages directory if it exists
          const sourcePagesPath = path.join(basePath, 'pages')
          const targetPagesPath = path.join(targetPath, 'pages')
          await fs.mkdir(targetPagesPath, {recursive: true})

          const pageEntries = await fs.readdir(sourcePagesPath, {
            withFileTypes: true
          })
          for (const pageEntry of pageEntries) {
            if (pageEntry.isFile()) {
              const sourcePagePath = path.join(sourcePagesPath, pageEntry.name)
              const targetPagePath = path.join(targetPagesPath, pageEntry.name)
              await fs.copyFile(sourcePagePath, targetPagePath)
            }
          }
        } else if (
          entry.isFile() &&
          entry.name !== 'manifest.json' &&
          entry.name !== 'reload-service.js'
        ) {
          // Copy other files like background.js, define-initial-tab.js, etc.
          const sourceFilePath = path.join(basePath, entry.name)
          const targetFilePath = path.join(targetPath, entry.name)
          await fs.copyFile(sourceFilePath, targetFilePath)
        }
      }
    } catch (error) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.warn(messages.extensionManagerCopyFilesWarning(error))
      }
    }
  }

  async cleanupExtension(instanceId: string): Promise<void> {
    // Get the instance to find the port
    const {InstanceManager} = await import('./instance-manager')
    const instanceManager = new InstanceManager(this.projectPath)
    const instance = await instanceManager.getInstance(instanceId)

    if (!instance) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.warn(
          messages.extensionManagerInstanceNotFoundWarning(instanceId)
        )
      }
      return
    }

    const extensionPath = path.join(
      this.userExtensionsPath,
      `${instance.browser}-manager-${instance.port}`
    )

    try {
      await fs.rm(extensionPath, {recursive: true, force: true})
    } catch (error) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.warn(
          `Warning: Could not cleanup extension for ` +
            `${instance.browser}-manager-${instance.port}: ${error}`
        )
      }
    }
  }

  async cleanupAllExtensions(): Promise<void> {
    try {
      await fs.rm(this.userExtensionsPath, {recursive: true, force: true})
    } catch (error) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.warn(messages.extensionManagerCleanupWarning(error))
      }
    }
  }

  getExtensionPath(instanceId: string): string {
    // Resolve path consistent with generateExtension/extensionExists
    // Fallback to legacy path only if registry lookup fails
    try {
      const InstanceManager = require('./instance-manager')
        .InstanceManager as any
      const instanceManager = new InstanceManager(this.projectPath)
      // Best-effort sync access via deasync is not available; return legacy path if not cached.
      // Callers using this path for IO will quickly trigger regeneration if missing.
      const registryPath = path.join(
        require('os').homedir(),
        'Library',
        'Application Support',
        'extension-js',
        'instances.json'
      )
      if (fsSync.existsSync(registryPath)) {
        try {
          const raw = fsSync.readFileSync(registryPath, 'utf-8')
          const data = JSON.parse(raw) as {instances?: Record<string, any>}
          const info = data.instances?.[instanceId]
          if (info && info.browser && typeof info.port === 'number') {
            return path.join(
              this.userExtensionsPath,
              `${info.browser}-manager-${info.port}`
            )
          }
        } catch {}
      }
    } catch {}
    return path.join(this.userExtensionsPath, `manager-port-${instanceId}`)
  }

  async extensionExists(instanceId: string): Promise<boolean> {
    // Get the instance to find the port
    const {InstanceManager} = await import('./instance-manager')
    const instanceManager = new InstanceManager(this.projectPath)
    const instance = await instanceManager.getInstance(instanceId)

    if (!instance) {
      return false
    }

    const extensionPath = path.join(
      this.userExtensionsPath,
      `${instance.browser}-manager-${instance.port}`
    )

    try {
      await fs.access(extensionPath)
      return true
    } catch {
      return false
    }
  }

  async regenerateExtensionIfNeeded(
    instance: InstanceInfo
  ): Promise<GeneratedExtension> {
    const exists = await this.extensionExists(instance.instanceId)

    if (!exists) {
      return await this.generateExtension(instance)
    }

    // Check if the extension needs to be regenerated (e.g., port changed)
    const extensionPath = path.join(
      this.userExtensionsPath,
      `${instance.browser}-manager-${instance.port}`
    )
    const serviceWorkerPath = path.join(extensionPath, 'reload-service.js')

    try {
      const content = await fs.readFile(serviceWorkerPath, 'utf-8')
      const portMatch = content.match(/const\s+port\s*=\s*['"](\d+)['"]/)
      const idMatch = content.match(
        /const\s+instanceId\s*=\s*['"]([^'\"]+)['"]/
      )

      // If base logic changed (e.g., handshake improvements), force regeneration
      const needsLogicUpgrade = !content.includes('ensureClientReadyHandshake')

      const needsPortUpdate =
        !!portMatch && parseInt(portMatch[1]) !== instance.webSocketPort
      const needsIdUpdate = !idMatch || idMatch[1] !== instance.instanceId

      if (needsLogicUpgrade) {
        // Preserve existing manifest.key during regeneration
        let preservedKey: string | undefined
        try {
          const manifestPath = path.join(extensionPath, 'manifest.json')
          const raw = await fs.readFile(manifestPath, 'utf-8')
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed.key === 'string')
            preservedKey = parsed.key
        } catch {}

        await this.cleanupExtension(instance.instanceId)
        const generated = await this.generateExtension(instance)
        // Re-apply preserved key if present
        if (preservedKey) {
          try {
            const manifestPath = path.join(
              generated.extensionPath,
              'manifest.json'
            )
            const raw = await fs.readFile(manifestPath, 'utf-8')
            const parsed = JSON.parse(raw)
            parsed.key = preservedKey
            await fs.writeFile(manifestPath, JSON.stringify(parsed, null, 2))
          } catch {}
        }
        return generated
      }

      if (needsPortUpdate || needsIdUpdate) {
        // In-place update of reload-service.js to keep manager extension stable
        let updated = content
          .replace(
            /const\s+port\s*=\s*['"][^'\"]+['"]/,
            `const port = '${instance.webSocketPort}'`
          )
          .replace(
            /const\s+instanceId\s*=\s*['"][^'\"]+['"]/,
            `const instanceId = '${instance.instanceId}'`
          )

        // Prepend cache-buster for SW reload
        const cacheBuster = `// Cache-buster: ${Date.now()}\n`
        updated = cacheBuster + updated
        await fs.writeFile(serviceWorkerPath, updated)

        // Return current artifact references
        const manifest = await this.readBaseManifest(instance.browser)
        return {
          extensionId: instance.managerExtensionId,
          manifest,
          serviceWorkerPath,
          extensionPath
        }
      }
    } catch (error) {
      // File doesn't exist or can't be read, regenerate
      // Attempt to preserve manifest.key if present
      let preservedKey: string | undefined
      try {
        const manifestPath = path.join(extensionPath, 'manifest.json')
        const raw = await fs.readFile(manifestPath, 'utf-8')
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed.key === 'string') preservedKey = parsed.key
      } catch {}

      await this.cleanupExtension(instance.instanceId)
      const generated = await this.generateExtension(instance)
      if (preservedKey) {
        try {
          const manifestPath = path.join(
            generated.extensionPath,
            'manifest.json'
          )
          const raw = await fs.readFile(manifestPath, 'utf-8')
          const parsed = JSON.parse(raw)
          parsed.key = preservedKey
          await fs.writeFile(manifestPath, JSON.stringify(parsed, null, 2))
        } catch {}
      }
      return generated
    }

    // Extension exists and is up to date
    const manifest = await this.readBaseManifest(instance.browser)
    return {
      extensionId: instance.managerExtensionId,
      manifest,
      serviceWorkerPath: path.join(extensionPath, 'reload-service.js'),
      extensionPath
    }
  }
}
