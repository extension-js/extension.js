import {spawn, type ChildProcess} from 'child_process'
import * as chromeLocation from 'chrome-location2'
import * as path from 'path'
import * as fs from 'fs'
import {createReadStream, createWriteStream} from 'fs'

export interface CDPClientOptions {
  browserBinary?: string
  userDataDir?: string
  port?: number
  instanceId?: string
}

export class CDPClient {
  private browserProcess: ChildProcess | null = null
  private incomingPipe: any = null
  private outgoingPipe: any = null
  private browserBinary: string
  private userDataDir: string
  private port: number
  private instanceId?: string
  private receivedData = ''
  private isProcessingMessage = false
  private lastId = 0
  private deferredResponses = new Map()
  private disconnected = false
  private disconnectedPromise: Promise<void>
  private resolveDisconnectedPromise: (() => void) | null = null

  constructor(options: CDPClientOptions) {
    // Use provided browser binary or detect Chrome location
    this.browserBinary = options.browserBinary || chromeLocation.default()
    this.userDataDir = options.userDataDir || ''
    this.port = options.port || 9222
    this.instanceId = options.instanceId

    this.disconnectedPromise = new Promise((resolve) => {
      this.resolveDisconnectedPromise = resolve
    })
  }

  async connect(): Promise<void> {
    // Start browser with remote debugging pipe enabled
    const args = [
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions-except=',
      '--load-extension='
    ]

    if (this.userDataDir) {
      args.push(`--user-data-dir=${this.userDataDir}`)
    }

    // Create pipes for CDP communication
    const {incoming, outgoing} = this.createPipes()

    this.browserProcess = spawn(this.browserBinary, args, {
      stdio: ['pipe', 'pipe', 'pipe', incoming, outgoing]
    })

    // Set up pipe event handlers
    this.setupPipeHandlers()

    // Wait for browser to be ready
    await this.waitForBrowser()
  }

  private createPipes() {
    // Create pipes for CDP communication
    // Chrome expects file descriptors 3 and 4 for incoming and outgoing pipes
    const incoming = createReadStream('', {fd: 3})
    const outgoing = createWriteStream('', {fd: 4})

    this.incomingPipe = incoming
    this.outgoingPipe = outgoing

    return {incoming, outgoing}
  }

  private setupPipeHandlers() {
    if (!this.incomingPipe || !this.outgoingPipe) {
      throw new Error('Pipes not initialized')
    }

    this.incomingPipe.on('data', (data: Buffer) => {
      this.receivedData += data.toString()
      this.processNextMessage()
    })

    this.incomingPipe.on('error', (error: Error) => {
      console.error('CDP pipe error:', error)
      this.finalizeDisconnect()
    })

    this.incomingPipe.on('close', () => {
      this.finalizeDisconnect()
    })
  }

  private processNextMessage() {
    if (this.isProcessingMessage) {
      return
    }

    this.isProcessingMessage = true
    let end = this.receivedData.indexOf('\x00')

    while (end !== -1) {
      const rawMessage = this.receivedData.slice(0, end)
      this.receivedData = this.receivedData.slice(end + 1) // +1 to skip \x00
      end = this.receivedData.indexOf('\x00')

      try {
        const message = JSON.parse(rawMessage)
        this.handleMessage(message)
      } catch (error) {
        console.error('Failed to parse CDP message:', error)
      }
    }

    this.isProcessingMessage = false
  }

  private handleMessage(message: any) {
    if (message.id && this.deferredResponses.has(message.id)) {
      const {resolve, reject} = this.deferredResponses.get(message.id)
      this.deferredResponses.delete(message.id)

      if (message.error) {
        reject(new Error(message.error.message))
      } else {
        resolve(message.result)
      }
    }
  }

  private finalizeDisconnect() {
    this.disconnected = true
    if (this.resolveDisconnectedPromise) {
      this.resolveDisconnectedPromise()
    }
  }

  async waitUntilDisconnected(): Promise<void> {
    return this.disconnectedPromise
  }

  async sendCommand(method: string, params: any = {}): Promise<any> {
    if (this.disconnected) {
      throw new Error(`CDP disconnected, cannot send: command ${method}`)
    }

    const message = {
      id: ++this.lastId,
      method,
      params
    }

    const rawMessage = `${JSON.stringify(message)}\x00`

    return new Promise((resolve, reject) => {
      // CDP will always send a response
      this.deferredResponses.set(message.id, {resolve, reject})
      this.outgoingPipe.write(rawMessage)
    })
  }

  async reloadExtension(extensionPath: string): Promise<void> {
    try {
      // Try the modern CDP approach first (Chrome 126+)
      console.log('🚀 Attempting CDP-based extension reload...')
      
      // Add a small delay to ensure file system is ready
      await new Promise(resolve => setTimeout(resolve, 100))
      
      await this.sendCommand('Extensions.loadUnpacked', {
        path: extensionPath
      })
      
      console.log('✅ CDP extension reload completed successfully')
    } catch (error) {
      console.warn('⚠️ Modern CDP reload failed, trying fallback:', (error as Error).message)
      // Fallback to chrome.developerPrivate API for older Chrome versions
      await this.reloadExtensionFallback(extensionPath)
    }
  }

  async reloadExtensionOptimized(extensionPath: string, changedFile?: string): Promise<void> {
    // Optimized reloading based on file type
    if (changedFile) {
      const fileName = changedFile.toLowerCase()
      
      // For non-critical files, try to avoid full reload
      if (!this.isCriticalFile(fileName)) {
        console.log('📝 Non-critical file change, attempting selective reload...')
        try {
          // Try to reload just the specific file if possible
          await this.reloadSpecificFile(changedFile)
          return
        } catch (error) {
          console.warn('⚠️ Selective reload failed, falling back to full reload:', (error as Error).message)
        }
      }
    }
    
    // Fall back to full extension reload
    await this.reloadExtension(extensionPath)
  }

  private isCriticalFile(fileName: string): boolean {
    const criticalFiles = [
      'manifest.json',
      'background.js',
      'background.ts',
      'service-worker.js',
      'service-worker.ts',
      'service_worker.js',
      'service_worker.ts'
    ]
    
    return criticalFiles.some(critical => fileName.includes(critical))
  }

  private async reloadSpecificFile(filePath: string): Promise<void> {
    // For content scripts and other non-critical files, we can try to reload them
    // without reloading the entire extension
    console.log(`🔄 Attempting selective reload for: ${filePath}`)
    
    // This is a placeholder for future optimization
    // In practice, most file changes require full reload due to extension architecture
    throw new Error('Selective reload not yet implemented')
  }

  private async reloadExtensionFallback(extensionPath: string): Promise<void> {
    // Create a chrome://extensions/ tab and use developerPrivate API
    const {targetId} = await this.sendCommand('Target.createTarget', {
      url: 'chrome://extensions/',
      newWindow: true,
      background: true,
      windowState: 'minimized'
    })

    const {sessionId} = await this.sendCommand('Target.attachToTarget', {
      targetId,
      flatten: true
    })

    // Code to execute in chrome://extensions/ page
    const reloadCode = `
      (async () => {
        const developerPrivate = chrome.developerPrivate;
        if (!developerPrivate || !developerPrivate.getExtensionsInfo) {
          return 'NOT_READY';
        }

        const extensions = await new Promise((resolve) => {
          developerPrivate.getExtensionsInfo(resolve);
        });

        const extensionIds = [];
        for (const extension of extensions || []) {
          if (extension.location === 'UNPACKED') {
            extensionIds.push(extension.id);
          }
        }

        const reloadPromises = extensionIds.map((extensionId) => {
          return new Promise((resolve, reject) => {
            developerPrivate.reload(
              extensionId,
              { failQuietly: true, populateErrorForUnpacked: true },
              (loadError) => {
                if (loadError) {
                  reject(new Error(loadError.error));
                } else {
                  resolve();
                }
              }
            );
          });
        });

        await Promise.all(reloadPromises);
        return extensionIds.length;
      })();
    `

    // Execute the reload code
    const result = await this.sendCommand('Runtime.evaluate', {
      expression: reloadCode,
      awaitPromise: true,
      sessionId
    })

    // Close the temporary tab
    await this.sendCommand('Target.closeTarget', {targetId})

    if (result.exceptionDetails) {
      throw new Error(
        `Failed to reload extension: ${result.exceptionDetails.text}`
      )
    }
  }

  async disconnect(): Promise<void> {
    if (this.browserProcess) {
      this.browserProcess.kill()
      this.browserProcess = null
    }
    this.finalizeDisconnect()
  }

  private async waitForBrowser(): Promise<void> {
    // For pipe-based CDP, we just need to wait a bit for the browser to start
    // The pipe connection will be established automatically
    return new Promise((resolve) => {
      setTimeout(resolve, 1000)
    })
  }
}
