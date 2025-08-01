import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'
import {InstanceInfo} from './instance-manager'
import {DevOptions} from '../commands/commands-lib/config-types'

export interface ExtensionManifest {
  name: string
  description: string
  version: string
  manifest_version: number
  key: string
  background: {
    service_worker: string
    type: string
  }
  icons: Record<string, string>
  permissions: string[]
}

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
    this.baseExtensionPath = path.join(
      __dirname,
      '../webpack/plugin-reload/extensions'
    )
    this.projectPath = projectPath || process.cwd()
    this.userExtensionsPath = path.join(
      this.projectPath,
      'dist',
      'extension-js',
      'extensions'
    )
  }

  /**
   * Generate a unique extension key for the manager extension
   */
  private generateExtensionKey(): string {
    // Generate a valid extension key (base64 encoded public key)
    const keyData = crypto.randomBytes(128)
    return keyData.toString('base64')
  }

  /**
   * Get the base extension template for a browser
   */
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

  /**
   * Read and parse the base manifest
   */
  private async readBaseManifest(
    browser: DevOptions['browser']
  ): Promise<ExtensionManifest> {
    const basePath = this.getBaseExtensionPath(browser)
    const manifestPath = path.join(basePath, 'manifest.json')
    const manifestContent = await fs.readFile(manifestPath, 'utf-8')
    return JSON.parse(manifestContent)
  }

  /**
   * Read the base service worker
   */
  private async readBaseServiceWorker(
    browser: DevOptions['browser']
  ): Promise<string> {
    const basePath = this.getBaseExtensionPath(browser)
    const serviceWorkerPath = path.join(basePath, 'reload-service.js')
    return await fs.readFile(serviceWorkerPath, 'utf-8')
  }

  /**
   * Generate a unique extension for an instance
   */
  async generateExtension(instance: InstanceInfo): Promise<GeneratedExtension> {
    const extensionId = instance.managerExtensionId
    const instanceId = instance.instanceId

    // Create unique extension name and description
    const extensionName = `Extension Manager (${instanceId.slice(0, 8)})`
    const extensionDescription = `Extension.js developer tools for instance ${instanceId}`

    // Read base extension files
    const baseManifest = await this.readBaseManifest(instance.browser)
    const baseServiceWorker = await this.readBaseServiceWorker(instance.browser)

    // Generate unique manifest
    const manifest: ExtensionManifest = {
      ...baseManifest,
      name: extensionName,
      description: extensionDescription,
      key: this.generateExtensionKey()
    }

    // Create instance-specific service worker with unique port
    const serviceWorkerContent = baseServiceWorker
      .replace(
        /const\s+port\s*=\s*['"](__RELOAD_PORT__|\d+)['"]/,
        `const port = '${instance.webSocketPort}'`
      )
      .replace(
        /const\s+instanceId\s*=\s*['"](__INSTANCE_ID__|\w+)['"]/,
        `const instanceId = '${instance.instanceId}'`
      )

    // Add instance-specific cache buster and logging
    const enhancedServiceWorker = `// Instance: ${instanceId}
// Generated: ${new Date().toISOString()}
// Cache-buster: ${Date.now()}

${serviceWorkerContent}

// Instance-specific logging
console.log('[Extension Manager] Instance ${instanceId} initialized on port ${instance.webSocketPort}');
`

    // Create extension directory
    const extensionPath = path.join(
      this.userExtensionsPath,
      `${instance.browser}-manager-${instance.port}`
    )
    await fs.mkdir(extensionPath, {recursive: true})

    // Write manifest
    const manifestPath = path.join(extensionPath, 'manifest.json')
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))

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

  /**
   * Copy additional extension files (icons, background scripts, etc.)
   */
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
      console.warn(`Warning: Could not copy extension files: ${error}`)
    }
  }

  /**
   * Clean up a specific extension
   */
  async cleanupExtension(instanceId: string): Promise<void> {
    // Get the instance to find the port
    const {InstanceManager} = await import('./instance-manager')
    const instanceManager = new InstanceManager(this.projectPath)
    const instance = await instanceManager.getInstance(instanceId)

    if (!instance) {
      console.warn(`Warning: Instance ${instanceId} not found for cleanup`)
      return
    }

    const extensionPath = path.join(
      this.userExtensionsPath,
      `${instance.browser}-manager-${instance.port}`
    )

    try {
      await fs.rm(extensionPath, {recursive: true, force: true})
    } catch (error) {
      console.warn(
        `Warning: Could not cleanup extension for ${instance.browser}-manager-${instance.port}: ${error}`
      )
    }
  }

  /**
   * Clean up all temporary extensions
   */
  async cleanupAllExtensions(): Promise<void> {
    try {
      await fs.rm(this.userExtensionsPath, {recursive: true, force: true})
    } catch (error) {
      console.warn(`Warning: Could not cleanup temp extensions: ${error}`)
    }
  }

  /**
   * Get the path for a specific extension
   */
  getExtensionPath(instanceId: string): string {
    // For browser-port naming, we need to get the instance first
    // This method is mainly for compatibility, but we'll need the instance
    return path.join(this.userExtensionsPath, `manager-port-${instanceId}`)
  }

  /**
   * Check if an extension exists
   */
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

  /**
   * Regenerate extension if needed (for port changes, etc.)
   */
  async regenerateExtensionIfNeeded(
    instance: InstanceInfo
  ): Promise<GeneratedExtension> {
    const exists = await this.extensionExists(instance.instanceId)

    if (!exists) {
      return await this.generateExtension(instance)
    }

    // Check if the extension needs to be regenerated (e.g., port changed)
    const extensionPath = this.getExtensionPath(instance.instanceId)
    const serviceWorkerPath = path.join(extensionPath, 'reload-service.js')

    try {
      const content = await fs.readFile(serviceWorkerPath, 'utf-8')
      const portMatch = content.match(/const\s+port\s*=\s*['"](\d+)['"]/)

      if (portMatch && parseInt(portMatch[1]) !== instance.webSocketPort) {
        // Port changed, regenerate
        await this.cleanupExtension(instance.instanceId)
        return await this.generateExtension(instance)
      }
    } catch (error) {
      // File doesn't exist or can't be read, regenerate
      await this.cleanupExtension(instance.instanceId)
      return await this.generateExtension(instance)
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
