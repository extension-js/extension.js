import * as path from 'path'
import * as fs from 'fs'
import {Compilation} from '@rspack/core'
import {MessagingClient} from './messaging-client'
import {isErrorWithCode, requestErrorToMessage} from './message-utils'
import {type PluginInterface} from '../../browsers-types'
import * as messages from '../../browsers-lib/messages'

const MAX_RETRIES = 150
const RETRY_INTERVAL = 1000

export class RemoteFirefox {
  private readonly options: PluginInterface
  private client: MessagingClient | null = null

  constructor(configOptions: PluginInterface) {
    this.options = configOptions
  }

  private async connectClient(port: number) {
    let lastError

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _ of Array.from({length: MAX_RETRIES})) {
      try {
        const client = new MessagingClient()
        await client.connect(port)
        this.client = client
        return client
      } catch (error: any) {
        if (isErrorWithCode('ECONNREFUSED', error)) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL))
          lastError = error
        } else {
          console.error(
            messages.generalBrowserError(this.options.browser, error.stack)
          )
          throw error
        }
      }
    }

    console.error(messages.errorConnectingToBrowser(this.options.browser))
    throw lastError
  }

  public async installAddons(compilation: Compilation) {
    const {devtools} = this.options

    // Check for stored extensions from multi-instance support
    const storedExtensions = (compilation as any).firefoxExtensions
    // Ensure user extension is first, manager after (if present)
    const rawExtensions =
      storedExtensions ||
      (Array.isArray(this.options.extension)
        ? this.options.extension
        : [this.options.extension])
    const unique: string[] = Array.from(
      new Set(
        (rawExtensions as string[]).filter(
          (p): p is string => typeof p === 'string' && p.length > 0
        )
      )
    )
    // If two are present, heuristic: path containing '/extensions/<browser>-manager' is manager
    const userFirst = unique.sort((a: string, b: string): number => {
      const isAManager = /extensions\/[a-z-]+-manager/.test(a)
      const isBManager = /extensions\/[a-z-]+-manager/.test(b)
      if (isAManager && !isBManager) return 1
      if (!isAManager && isBManager) return -1
      return 0
    })
    const extensionsToLoad = userFirst

    const devPort = (compilation.options.devServer as any)?.port
    const optionPort = (this.options as any)?.port
    const normalizedOptionPort =
      typeof optionPort === 'string' ? parseInt(optionPort, 10) : optionPort
    // If a port is provided via options, assume it's the actual RDP port
    const port =
      (normalizedOptionPort as number) || (devPort ? devPort + 100 : 9222)
    const client = await this.connectClient(port)
    // Fetch addonsActor with retries using getRoot with fallback to listTabs
    let addonsActor: string | undefined
    const maxTries = 40
    const delayMs = 250
    for (let i = 0; i < maxTries && !addonsActor; i++) {
      try {
        const root = await client.request('getRoot')
        if (root && root.addonsActor) {
          addonsActor = root.addonsActor
          break
        }
      } catch {}
      if (!addonsActor) {
        try {
          const tabs = await client.request('listTabs')
          if (tabs && tabs.addonsActor) {
            addonsActor = tabs.addonsActor
            break
          }
        } catch {}
      }
      if (!addonsActor) {
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }

    // Resolve addon directory to an absolute path that contains a manifest.json
    const resolveAddonDirectory = (
      baseDir: string,
      inputPath: string
    ): string => {
      let candidate = inputPath.replace(/\"/g, '')
      if (!path.isAbsolute(candidate)) {
        candidate = path.resolve(baseDir, candidate)
      }
      try {
        const stat = fs.statSync(candidate)
        if (stat.isFile()) {
          // If a file is passed, use its directory
          candidate = path.dirname(candidate)
        }
      } catch {}

      const hasManifest = fs.existsSync(path.join(candidate, 'manifest.json'))
      if (hasManifest) return candidate

      // Try common build output location
      const distFirefox = path.join(candidate, 'dist', 'firefox')
      if (fs.existsSync(path.join(distFirefox, 'manifest.json'))) {
        return distFirefox
      }

      return candidate
    }

    const candidateAddonPaths: string[] = []
    for (const [index, extension] of extensionsToLoad.entries()) {
      const projectPath = (compilation as any).options?.context || process.cwd()
      const addonPath = resolveAddonDirectory(projectPath, extension)
      const isDevtoolsEnabled = index === 0 && devtools
      candidateAddonPaths.push(addonPath)

      try {
        const toActor = addonsActor
        if (!toActor) {
          throw new Error(
            messages.addonInstallError(
              this.options.browser,
              'No addonsActor available from Firefox RDP.'
            )
          )
        }

        await client.request({
          to: toActor,
          type: 'installTemporaryAddon',
          addonPath,
          openDevTools: isDevtoolsEnabled
        })
        // After installing the first add-on (manager), wait for tabs to settle
        if (
          index === 1 ||
          (index === 0 && /extensions\/[a-z-]+-manager/.test(String(addonPath)))
        ) {
          // Wait for the manager welcome page to open before proceeding
          for (let i = 0; i < 20; i++) {
            try {
              const tabs = await client.request('listTabs')
              const hasWelcome = Array.isArray(tabs?.tabs)
                ? tabs.tabs.some(
                    (t: any) =>
                      typeof t?.url === 'string' &&
                      (t.url.includes('welcome.html') ||
                        t.url.includes('about:home'))
                  )
                : false
              if (hasWelcome) break
            } catch {}
            await new Promise((r) => setTimeout(r, 200))
          }
        }
      } catch (err) {
        const message = requestErrorToMessage(err)
        throw new Error(
          messages.addonInstallError(this.options.browser, message)
        )
      }
    }

    // Fallback: print running in development summary for Firefox even when WS isn't ready
    try {
      // Prefer a path whose manifest name is not the manager name
      let chosenPath: string | null = null
      for (const p of candidateAddonPaths) {
        const mp = path.join(p, 'manifest.json')
        if (fs.existsSync(mp)) {
          const mf = JSON.parse(fs.readFileSync(mp, 'utf-8'))
          const name = mf?.name || ''
          if (
            typeof name === 'string' &&
            !/Extension\.js DevTools/i.test(name)
          ) {
            chosenPath = p
            break
          }
        }
      }

      // Fallback to last candidate if none matched
      if (!chosenPath && candidateAddonPaths.length > 0) {
        chosenPath = candidateAddonPaths[candidateAddonPaths.length - 1]
      }
      if (chosenPath) {
        const manifestPath = path.join(chosenPath, 'manifest.json')
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
          const message = {
            data: {
              id: '(temporary)',
              management: {
                name: manifest.name || '(unknown)',
                version: manifest.version || '0.0.0'
              }
            }
          }
          console.log(messages.emptyLine())
          console.log(
            messages.runningInDevelopment(manifest, 'firefox', message as any)
          )
          console.log(messages.emptyLine())
        }
      }
    } catch {}
  }

  // RDP-based source inspection for Firefox
  public async inspectSource(
    compilation: Compilation,
    opts: {startingUrl?: string; source?: string | boolean}
  ): Promise<void> {
    try {
      const devServerPort = (compilation.options.devServer as any)?.port
      const optionPort = (this.options as any)?.port
      const normalizedOptionPort =
        typeof optionPort === 'string' ? parseInt(optionPort, 10) : optionPort
      const rdpPort =
        (normalizedOptionPort as number) ||
        (devServerPort ? devServerPort + 100 : 9222)

      const client = this.client || (await this.connectClient(rdpPort))

      // Determine destination URL (prefer explicit --source URL, else startingUrl)
      let urlToInspect: string | undefined
      if (typeof opts.source === 'string' && opts.source !== 'true') {
        urlToInspect = opts.source
      } else if (opts.startingUrl) {
        urlToInspect = opts.startingUrl
      }

      // Get tabs and pick best candidate in a sequential manner
      const targets = await client.getTargets()
      let tab = (targets as any[]).find(
        (t: any) => t && t.url === urlToInspect && t.actor
      )
      if (!tab)
        tab =
          (targets as any[]).find(
            (t: any) => t && (t.actor || t.outerWindowID)
          ) || (targets as any[])[0]
      if (!tab || !tab.actor) return

      // Only navigate when we have a target URL. This ensures the manager extension
      // has already been installed before we leave the initial about:home/welcome
      if (urlToInspect) {
        // Use consoleActor-based navigation via evaluateJS hack first
        try {
          const detail = await client.getTargetFromDescriptor(tab.actor)
          const consoleActor =
            detail.consoleActor || (tab as any).consoleActor || tab.actor
          await client.navigateViaScript(consoleActor, urlToInspect)
          await client.waitForPageReady(consoleActor, urlToInspect, 8000)
        } catch {
          // Fallback to native navigate
          let targetActor = tab.actor
          try {
            const detail2 = await client.getTargetFromDescriptor(tab.actor)
            if (detail2.targetActor) targetActor = detail2.targetActor
          } catch {}
          try {
            await client.attach(targetActor)
          } catch {}
          await client.navigate(targetActor, urlToInspect)
          await client.waitForLoadEvent(targetActor)
        }
      }

      // Prefer consoleActor for JS evaluation (evaluateJS is exposed there)
      // Resolve consoleActor from descriptor when available
      let consoleActor = (tab as any).consoleActor || tab.actor
      try {
        const detail = await client.getTargetFromDescriptor(tab.actor)
        if (detail.consoleActor) consoleActor = detail.consoleActor
      } catch {}
      const html = (await client.getPageHTML(tab.actor, consoleActor)) || ''
      console.log(''.padEnd(80, '='))
      console.log(''.padEnd(80, '='))
      console.log(html)
      console.log(''.padEnd(80, '='))
    } catch (err: any) {
      console.warn(
        '[firefox][inspectSource] non-fatal error:',
        err?.message || String(err)
      )
    }
  }
}
