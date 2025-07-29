import {spawn, type ChildProcess} from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

export interface CDPClientOptions {
  browserBinary?: string
  userDataDir?: string
  port?: number
  instanceId?: string
}

export class CDPClient {
  private browserProcess: ChildProcess | null = null
  private wsUrl: string | null = null
  private browserBinary: string
  private userDataDir: string
  private port: number
  private instanceId?: string

  constructor(options: CDPClientOptions) {
    this.browserBinary = options.browserBinary || 'google-chrome'
    this.userDataDir = options.userDataDir || ''
    this.port = options.port || 9222
    this.instanceId = options.instanceId
  }

  async connect(): Promise<void> {
    // Start browser with remote debugging enabled
    const args = [
      `--remote-debugging-port=${this.port}`,
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

    this.browserProcess = spawn(this.browserBinary, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    // Wait for browser to start and get WebSocket URL
    await this.waitForBrowser()
  }

  private async waitForBrowser(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Browser startup timeout'))
      }, 30000)

      const checkBrowser = async () => {
        try {
          const response = await fetch(
            `http://localhost:${this.port}/json/version`
          )
          const data = await response.json()
          this.wsUrl = data.webSocketDebuggerUrl
          clearTimeout(timeout)
          resolve()
        } catch (error) {
          // Browser not ready yet, retry
          setTimeout(checkBrowser, 100)
        }
      }

      checkBrowser()
    })
  }

  async sendCommand(method: string, params: any = {}): Promise<any> {
    if (!this.wsUrl) {
      throw new Error('CDP client not connected')
    }

    const WebSocket = require('ws')
    const ws = new WebSocket(this.wsUrl)

    return new Promise((resolve, reject) => {
      ws.on('open', () => {
        const message = {
          id: Date.now(),
          method,
          params
        }

        ws.send(JSON.stringify(message))
      })

      ws.on('message', (data: Buffer) => {
        const response = JSON.parse(data.toString())
        if (response.id) {
          ws.close()
          if (response.error) {
            reject(new Error(response.error.message))
          } else {
            resolve(response.result)
          }
        }
      })

      ws.on('error', reject)
    })
  }

  async reloadExtension(extensionPath: string): Promise<void> {
    try {
      // Try the modern CDP approach first (Chrome 126+)
      await this.sendCommand('Extensions.loadUnpacked', {
        path: extensionPath
      })
    } catch (error) {
      // Fallback to chrome.developerPrivate API for older Chrome versions
      await this.reloadExtensionFallback(extensionPath)
    }
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
  }
}
