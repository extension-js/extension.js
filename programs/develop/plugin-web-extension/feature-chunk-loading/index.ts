// ██╗      ██████╗  █████╗ ██████╗ ███████╗██████╗
// ██║     ██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ██║     ██║   ██║███████║██║  ██║█████╗  ██████╔╝
// ██║     ██║   ██║██╔══██║██║  ██║██╔══╝  ██╔══██╗
// ███████╗╚██████╔╝██║  ██║██████╔╝███████╗██║  ██║
// ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {isGeckoBasedBrowser} from '../../lib/constants'
import {extensionSchemeFor} from '../../lib/extension-base-from-stack'
import {parseAuthoredJson} from '../../lib/parse-json-safe'
import {extensionBaseAttributeFor} from '../../lib/taken-extension-base'
import type {
  DevOptions,
  FilepathList,
  Manifest,
  PluginInterface
} from '../../types'
import {filterKeysForThisBrowser} from '../feature-manifest/manifest-lib/manifest'
import {findRuntimeMainWorldEntries} from '../feature-scripts/scripts-lib/runtime-main-world-scripts'
import {chunkLoadingTargetExtensionsFor} from '../shared/chunk-loading-target-extensions'
import {classicConcatFiles} from '../shared/classic-concat'
import {getBackgroundEntryName} from './background-entry-name'
import {ChunkLoadingTarget} from './chunk-loading-target'
import {buildContentScriptsMeta} from './content-scripts-meta'
import type {ContentScriptsMeta} from './options'
import {AddPublicPathRuntimeModule} from './steps/add-public-path-runtime-module'

// A file the background or a page registers into the MAIN world is in no
// manifest group, so its world is read off the entries already created.
function buildRuntimeMainWorldMeta(
  compiler: Compiler,
  manifestPath: string,
  manifest: Manifest
): ContentScriptsMeta {
  const entries = compiler.options.entry
  if (!entries || typeof entries !== 'object') return {}

  const includeList: FilepathList = {}

  for (const [name, entry] of Object.entries(entries)) {
    const imports = (entry as {import?: unknown} | undefined)?.import
    if (!Array.isArray(imports)) continue

    // A page's classic scripts enter as one joined module, the registration
    // sits in one of the files it names.
    includeList[name] = imports
      .filter((file): file is string => typeof file === 'string')
      .flatMap((file) => {
        const joined = classicConcatFiles(file)

        return joined.length > 0 ? joined : [file]
      })
  }

  // Several background.scripts files enter as one generated module, so the
  // files that may hold the registration are read from the manifest.
  const backgroundScripts = manifest.background?.scripts

  if (Array.isArray(backgroundScripts)) {
    includeList['background/scripts'] = backgroundScripts.filter(
      (file): file is string => typeof file === 'string'
    )
  }

  const manifestDir = path.dirname(manifestPath)
  const meta: ContentScriptsMeta = {}

  for (const {entryName} of findRuntimeMainWorldEntries({
    includeList,
    manifestDir,
    projectPath: (compiler.options.context as string) || manifestDir
  })) {
    const bundleId = `${entryName}.js`
    meta[bundleId] = {bundleId, world: 'main'}
  }

  return meta
}

export class SetupChunkLoadingTarget {
  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    const hasValidManifest =
      !!this.manifestPath &&
      fs.existsSync(this.manifestPath) &&
      fs.lstatSync(this.manifestPath).isFile()

    if (!hasValidManifest) return

    let patchedManifest: Manifest

    try {
      const manifest: Manifest = parseAuthoredJson(
        fs.readFileSync(this.manifestPath, 'utf-8')
      )
      patchedManifest = filterKeysForThisBrowser(manifest, this.browser)
    } catch {
      // An unreadable manifest is reported by the manifest feature; a build
      // that is failing anyway must not also fail here.
      return
    }

    const authored = getBackgroundEntryName(patchedManifest, this.browser, {
      manifestDir: path.dirname(this.manifestPath),
      projectPath: compiler.options.context as string | undefined
    })
    const [extension] = chunkLoadingTargetExtensionsFor(compiler)

    // A target with the message fallback answers the public path with its
    // own module. Registered first, this one answers in every other build.
    if (!extension) {
      new AddPublicPathRuntimeModule({
        browser: this.browser,
        manifestPath: this.manifestPath
      }).apply(compiler)
    }

    new ChunkLoadingTarget({
      background: extension
        ? extension.fallbackBackground(authored)
        : {
            ...authored,
            // The classic loader adds a background runtime module that asks
            // the service worker to inject chunks for a content script. A
            // production background usually optimizes down to a bundle with
            // no webpack runtime at all, and the module then lands bare at
            // the top of the file, where __webpack_require__ does not exist
            // and the worker dies on load. The isolated world reaches its
            // chunks through the native dynamic import loader, so a build
            // that asks for no fallback does not need it, in either mode.
            // The reader is `background.classicLoader`, not the top-level key.
            classicLoader: false
          },
      weakRuntimeCheck: true,
      contentScriptsMeta: {
        ...buildContentScriptsMeta(patchedManifest),
        ...buildRuntimeMainWorldMeta(
          compiler,
          this.manifestPath,
          patchedManifest
        )
      },
      gecko: isGeckoBasedBrowser(String(this.browser)),
      baseAttribute: extensionBaseAttributeFor(this.manifestPath, this.browser),
      baseScheme: extensionSchemeFor(String(this.browser))
    }).apply(compiler)
  }
}
