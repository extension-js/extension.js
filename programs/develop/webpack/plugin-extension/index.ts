// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {Compiler} from '@rspack/core'
import {
  getManifestFieldsData,
  getSpecialFoldersData
} from 'browser-extension-manifest-fields'

// Plugins
import {ManifestPlugin} from './feature-manifest'
import {HtmlPlugin} from './feature-html'
import {ScriptsPlugin} from './feature-scripts'
import {LocalesPlugin} from './feature-locales'
import {JsonPlugin} from './feature-json'
import {IconsPlugin} from './feature-icons'
import {WebResourcesPlugin} from './feature-web-resources'
import {SpecialFoldersPlugin} from './feature-special-folders'
import {ResolvePlugin} from './feature-resolve'

// Types
import type {PluginInterface, FilepathList, DevOptions} from '../webpack-types'

export class ExtensionPlugin {
  public static readonly name: string = 'plugin-extension'

  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    const manifestPath = this.manifestPath

    const manifestFieldsData = getManifestFieldsData({
      manifestPath,
      browser: this.browser
    })

    // MAIN world bridge: for each content script with `world: "MAIN"`, we append an
    // isolated-world bridge content script entry so the MAIN world bundle can still
    // load async chunks without extension globals.
    //
    // This must happen here (before ScriptsPlugin) because entries are derived from includeList.
    let bridgeScripts: FilepathList = {}
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      const contentScripts: any[] = Array.isArray(raw?.content_scripts)
        ? raw.content_scripts
        : []
      const originalCount = contentScripts.length
      const bridgeSourceCandidates = [
        // Source tree (vitest/dev in-repo)
        path.resolve(
          __dirname,
          'feature-scripts/steps/setup-reload-strategy/main-world-bridge.ts'
        ),
        // Monorepo runtime fallback: when executing built `dist/module.js` without regenerating
        // `dist/main-world-bridge.js`, the source file still exists one level up.
        path.resolve(
          __dirname,
          '../webpack/plugin-extension/feature-scripts/steps/setup-reload-strategy/main-world-bridge.ts'
        ),
        // Built package (dist) – emitted by rslib as `dist/main-world-bridge.js`
        path.resolve(__dirname, 'main-world-bridge.js')
      ]
      const bridgeSource =
        bridgeSourceCandidates.find((p) => fs.existsSync(p)) ||
        bridgeSourceCandidates[0]
      let bridgeOrdinal = 0
      for (let i = 0; i < contentScripts.length; i++) {
        const cs = contentScripts[i]
        if (cs?.world !== 'MAIN') continue
        const bridgeIndex = originalCount + bridgeOrdinal++
        bridgeScripts[`content_scripts/content-${bridgeIndex}`] = bridgeSource
      }
    } catch {
      // ignore: bridge is best-effort and only needed for MAIN world users
    }

    const specialFoldersData = getSpecialFoldersData({
      // Hack: Let's pretend the manifest is in the package.json file.
      // Under the hoot it will get the dirname and scan the files in the folder.
      manifestPath: path.join(compiler.options.context || '', 'package.json')
    })

    // Generate a manifest file with all the assets we need
    new ManifestPlugin({
      browser: this.browser,
      manifestPath,
      includeList: {
        ...manifestFieldsData.html,
        ...(manifestFieldsData.icons as FilepathList),
        ...manifestFieldsData.json,
        ...manifestFieldsData.scripts,
        ...bridgeScripts
      }
    }).apply(compiler)

    // Get every field in manifest that allows an .html file
    new HtmlPlugin({
      manifestPath,
      browser: this.browser,
      includeList: {
        ...manifestFieldsData.html,
        ...specialFoldersData.pages
      }
    }).apply(compiler)

    // Get all scripts (bg, content, sw) declared in manifest
    new ScriptsPlugin({
      manifestPath,
      browser: this.browser,
      includeList: {
        ...manifestFieldsData.scripts,
        ...bridgeScripts,
        ...specialFoldersData.scripts
      }
    }).apply(compiler)

    // Get locales
    new LocalesPlugin({
      manifestPath
    }).apply(compiler)

    // Grab all JSON assets from manifest except _locales
    new JsonPlugin({
      manifestPath,
      includeList: manifestFieldsData.json,
      browser: this.browser
    }).apply(compiler)

    // Grab all icon assets from manifest including popup icons
    new IconsPlugin({
      manifestPath,
      includeList: manifestFieldsData.icons as FilepathList,
      browser: this.browser
    }).apply(compiler)

    // Grab all resources from script files
    // (background, content_scripts, service_worker)
    // and add them to the assets bundle.
    new WebResourcesPlugin({
      manifestPath,
      includeList: {
        ...manifestFieldsData.scripts,
        ...specialFoldersData.scripts
      }
    }).apply(compiler)

    // Plugin to add special folders (public, pages, scripts) to the extension
    new SpecialFoldersPlugin({
      manifestPath
    }).apply(compiler)

    // TODO: cezaraugusto enable this after v3
    // new ResolvePlugin({
    //   manifestPath,
    //   browser: this.browser
    // }).apply(compiler)
  }
}
