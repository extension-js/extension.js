import * as path from 'path'
import * as fs from 'fs'
import {CDPClient} from '../../../../../plugin-browsers/browsers-lib/cdp-client'
import {DevOptions} from '../../../../../module'

export interface EnhancedReloadOptions {
  browser: DevOptions['browser']
  extensionPath: string
  port: number
  instanceId?: string
  chromiumBinary?: string
  geckoBinary?: string
}

export class EnhancedReloadService {
  private cdpClient: CDPClient | null = null
  private options: EnhancedReloadOptions
  private isConnected = false

  constructor(options: EnhancedReloadOptions) {
    this.options = options
  }

  async initialize(): Promise<void> {
    if (
      this.options.browser === 'firefox' ||
      this.options.browser === 'gecko-based'
    ) {
      // Firefox uses different approach - we'll handle it separately
      console.log('🦊 Firefox detected - using WebSocket-based reloading')
      return
    }

    try {
      console.log(
        '🔧 Initializing enhanced reload service for Chromium-based browser'
      )
      this.cdpClient = new CDPClient({
        browserBinary: this.options.chromiumBinary,
        port: this.options.port + 1000, // Use different port to avoid conflicts
        instanceId: this.options.instanceId
      })

      await this.cdpClient.connect()
      this.isConnected = true
      console.log('✅ Enhanced reload service initialized successfully')
    } catch (error) {
      console.warn(
        '⚠️ Failed to initialize CDP client for enhanced reloading:',
        error
      )
      console.log('🔄 Falling back to WebSocket-only approach')
      // Fallback to WebSocket-only approach
    }
  }

  async reloadExtension(changedFile: string): Promise<void> {
    const startTime = Date.now()
    
    // Determine if this is a critical file that needs direct reloading
    const isCriticalFile = this.isCriticalFile(changedFile)

    console.log(`📁 File changed: ${changedFile} (Critical: ${isCriticalFile})`)

    if (isCriticalFile && this.isConnected && this.cdpClient) {
      try {
        console.log('🚀 Using CDP-based reloading for critical file')
        // Use optimized CDP-based reloading
        await this.cdpClient.reloadExtensionOptimized(this.options.extensionPath, changedFile)
        
        const reloadTime = Date.now() - startTime
        console.log(`✅ Enhanced reload completed for: ${changedFile} (${reloadTime}ms)`)

        // Add cache buster to manifest
        await this.addCacheBuster(this.options.extensionPath)
        return
      } catch (error) {
        const reloadTime = Date.now() - startTime
        console.warn(`❌ CDP reload failed after ${reloadTime}ms, falling back to WebSocket:`, error)
      }
    }

    // Fallback to WebSocket-based reloading
    await this.fallbackWebSocketReload(changedFile)
  }

  private isCriticalFile(changedFile: string): boolean {
    const fileName = path.basename(changedFile)
    const fileExt = path.extname(changedFile)

    // Critical files that require direct browser reloading
    const criticalFiles = [
      'manifest.json',
      'background.js',
      'background.ts',
      'service-worker.js',
      'service-worker.ts'
    ]

    // Check if it's a background script or service worker
    const isBackgroundScript =
      changedFile.includes('background') ||
      changedFile.includes('service-worker') ||
      changedFile.includes('service_worker')

    // Check if it's a manifest file
    const isManifest = fileName === 'manifest.json'

    // Check if it's a critical file
    const isCritical = criticalFiles.some((critical) =>
      fileName.includes(critical)
    )

    return isBackgroundScript || isManifest || isCritical
  }

  private async fallbackWebSocketReload(changedFile: string): Promise<void> {
    // This would be handled by the existing WebSocket system
    // We're just logging here for debugging
    console.log(`📡 WebSocket reload triggered for: ${changedFile}`)
  }

  async addCacheBuster(extensionPath: string): Promise<void> {
    // Add cache-busting mechanism to force background script reloads
    const manifestPath = path.join(extensionPath, 'manifest.json')

    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

        // Add a cache-busting timestamp to the manifest
        manifest._cacheBuster = Date.now()

        // Write back the manifest with cache buster
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

        console.log('✅ Cache buster added to manifest')
      } catch (error) {
        console.warn('⚠️ Failed to add cache buster:', error)
      }
    }
  }

  async cleanup(): Promise<void> {
    if (this.cdpClient) {
      await this.cdpClient.disconnect()
      this.cdpClient = null
      this.isConnected = false
      console.log('🧹 Enhanced reload service cleaned up')
    }
  }
}
