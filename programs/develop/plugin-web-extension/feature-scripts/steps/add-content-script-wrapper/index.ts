// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {Compilation, type Compiler, sources} from '@rspack/core'
import {resolveDevelopDistFile} from '../../../../lib/develop-context'
import {filterKeysForThisBrowser} from '../../../../lib/manifest-utils'
import {stripBom} from '../../../../lib/parse-json-safe'
import {findNearestProjectManifestSync} from '../../../../lib/project-manifest'
import {
  canonicalizeDir,
  canonicalizeResourcePath,
  isResourceUnderDirs
} from '../../../../lib/resource-path'
import {NOT_RAW_RESOURCE_QUERY} from '../../../../lib/resource-query'
import {scriptsFolderRoot} from '../../../../plugin-special-folders/folders-config'
import type {
  DevOptions,
  FilepathList,
  Manifest,
  PluginInterface
} from '../../../../types'
import {
  CONTENT_SCRIPT_CSS_PROBE_MARKER_PREFIX,
  createContentScriptCssProbeMarkerPattern,
  EXTENSIONJS_MAIN_WORLD_IMPORT_LAYER,
  parseCanonicalContentScriptAsset
} from '../../contracts'
import {findRuntimeMainWorldEntries} from '../../scripts-lib/runtime-main-world-scripts'
import {getMainWorldBridgeScripts} from './get-bridge-scripts'

// The wrapper loader bakes a css-probe marker before any asset exists. Once
// assets are final, each marker resolves to the sibling stylesheet the build
// actually emitted, or to nothing, so the runtime never requests a phantom css.
export function resolveBundleCssProbeMarker(
  cssPath: string,
  hasAsset: (name: string) => boolean,
  assetNames: () => string[]
): string {
  if (hasAsset(cssPath)) return cssPath

  // Dev cache-busts the stylesheet with a hash segment; match it back to the
  // canonical index the runtime asked for.
  const wanted = parseCanonicalContentScriptAsset(cssPath)
  if (!wanted || wanted.extension !== 'css') return ''

  for (const name of assetNames()) {
    const parsed = parseCanonicalContentScriptAsset(name)

    if (parsed && parsed.extension === 'css' && parsed.index === wanted.index) {
      return name
    }
  }

  return ''
}

// Every js file of a declared MAIN world group, resolved the way the wrapper
// loader resolves a declared entry.
export function findDeclaredMainWorldFiles(
  manifestPath: string,
  browser: DevOptions['browser']
): string[] {
  try {
    const manifest = filterKeysForThisBrowser(
      JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf8'))) as Manifest,
      browser
    )
    const groups = Array.isArray(manifest.content_scripts)
      ? (manifest.content_scripts as Array<{world?: unknown; js?: unknown}>)
      : []
    const manifestDir = canonicalizeDir(path.dirname(manifestPath))

    return groups
      .filter((group) => group?.world === 'MAIN')
      .flatMap((group) => (Array.isArray(group.js) ? group.js : []))
      .filter((file): file is string => typeof file === 'string' && !!file)
      .map((file) => path.normalize(path.resolve(manifestDir, file)))
  } catch {
    return []
  }
}

export class AddContentScriptWrapper {
  public static getBridgeScripts(
    manifestPath: string,
    browser: DevOptions['browser'] = 'chrome'
  ): FilepathList {
    return getMainWorldBridgeScripts(manifestPath, browser)
  }

  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']
  private readonly includeList: FilepathList
  private readonly pageList?: FilepathList
  private readonly devSession?: boolean

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = (options.browser as DevOptions['browser']) || 'chrome'
    this.includeList = options.includeList || {}
    this.pageList = options.pageList
    this.devSession = options.devSession
  }

  private resolveLoader(): string {
    return resolveDevelopDistFile('feature-scripts-content-script-wrapper')
  }

  private resolveConcatLoader(): string {
    return resolveDevelopDistFile('feature-scripts-classic-concat-loader')
  }

  public apply(compiler: Compiler) {
    const manifestDir = canonicalizeDir(path.dirname(this.manifestPath))
    const packageJsonPath = findNearestProjectManifestSync(this.manifestPath)
    const packageJsonDir = canonicalizeDir(
      packageJsonPath ? path.dirname(packageJsonPath) : manifestDir
    )
    const includeDirs =
      packageJsonDir === manifestDir
        ? [manifestDir]
        : [manifestDir, packageJsonDir]
    const includeMatcher = (resource: string): boolean =>
      isResourceUnderDirs(resource, includeDirs)

    // A file the extension registers into the MAIN world at runtime shares the
    // page's globals and DOM prototypes exactly like a declared MAIN world
    // group, and the manifest never names it.
    const runtimeMainWorld = findRuntimeMainWorldEntries({
      includeList: this.includeList,
      pageList: this.pageList,
      manifestDir,
      projectPath: (compiler.options.context as string) || manifestDir
    })
    const mainWorldScripts = runtimeMainWorld
      .filter((entry) => !entry.copyOf)
      .flatMap((entry) => entry.files.map(canonicalizeResourcePath))
    // A file both worlds run is a MAIN world file in its copy's bundle
    // alone, which the path it shares with the isolated build cannot say.
    const mainWorldCopies = runtimeMainWorld
      .filter((entry) => entry.copyOf)
      .flatMap((entry) => entry.files.map(canonicalizeResourcePath))

    // The loader runs from its own bundle, so the `folders` answer travels
    // with its options: the folder in use, or false for a plain scripts/.
    const scriptsRoot = scriptsFolderRoot(compiler.options.context)
    const loaderOptions = {
      manifestPath: this.manifestPath,
      mode: compiler.options.mode,
      ...(typeof this.devSession === 'boolean'
        ? {devSession: this.devSession}
        : {}),
      browser: this.browser,
      mainWorldScripts,
      ...(mainWorldCopies.length > 0 ? {mainWorldCopies} : {}),
      scriptsFolder: scriptsRoot ? canonicalizeDir(scriptsRoot) : false
    }

    // A module a MAIN world entry imports rides that entry's bundle onto the
    // page, so it builds apart from the copy scripts/ emits as its own file.
    const mainWorldEntryFiles = new Set([
      ...findDeclaredMainWorldFiles(this.manifestPath, this.browser),
      ...mainWorldScripts
    ])
    const importedByMainWorldEntry = (issuer: string): boolean =>
      typeof issuer === 'string' &&
      issuer.length > 0 &&
      mainWorldEntryFiles.has(canonicalizeResourcePath(issuer))
    const hasMainWorldEntries =
      mainWorldEntryFiles.size > 0 || mainWorldCopies.length > 0
    // A path cannot tell the copy in that bundle from the standalone one, so
    // deeper imports are told apart by the layer the first import is given.
    const inMainWorldImportLayer = (layer: string): boolean =>
      layer === EXTENSIONJS_MAIN_WORLD_IMPORT_LAYER

    // Classic concat loader must be registered before the content-script-wrapper
    // so the wrapper receives the concatenated source + source map.
    compiler.options.module.rules.push({
      test: /\.(js|cjs|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
      resourceQuery: /__extensionjs_classic_concat__/,
      include: [includeMatcher],
      exclude: [/([\\/])node_modules\1/],
      use: [
        {
          loader: this.resolveLoader(),
          options: loaderOptions
        },
        {
          loader: this.resolveConcatLoader()
        }
      ]
    })

    compiler.options.module.rules.push({
      test: /\.(js|cjs|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
      include: [includeMatcher],
      exclude: [/([\\/])node_modules\1/],
      resourceQuery: NOT_RAW_RESOURCE_QUERY,
      ...(hasMainWorldEntries
        ? {
            issuer: {not: importedByMainWorldEntry},
            issuerLayer: {not: inMainWorldImportLayer}
          }
        : {}),
      use: [
        {
          loader: this.resolveLoader(),
          options: loaderOptions
        }
      ]
    })

    if (hasMainWorldEntries) {
      const mainWorldImportRule = {
        test: /\.(js|cjs|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
        include: [includeMatcher],
        exclude: [/([\\/])node_modules\1/],
        resourceQuery: NOT_RAW_RESOURCE_QUERY,
        // Named on both: an earlier rule hands a content script's imports
        // the plain layer back, and the last rule to name a layer wins.
        layer: EXTENSIONJS_MAIN_WORLD_IMPORT_LAYER,
        use: [
          {
            loader: this.resolveLoader(),
            // One name for both branches, or a module reached directly and
            // through another import would be built and run twice.
            ident: 'extensionjs-main-world-import',
            options: {...loaderOptions, mainWorldBundle: true}
          }
        ]
      }

      // One slot in the rule list: a loader is named after its rule's
      // position, so a second slot would rename every rule added after it.
      compiler.options.module.rules.push({
        oneOf: [
          {...mainWorldImportRule, issuer: importedByMainWorldEntry},
          {...mainWorldImportRule, issuerLayer: inMainWorldImportLayer}
        ]
      })
    }

    compiler.hooks.thisCompilation.tap(
      'scripts:add-content-script-wrapper',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'scripts:resolve-bundle-css-probe',
            // SUMMARIZE runs after minification, so the marker literal the
            // minifier preserved is rewritten in the final user bundle.
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
          },
          () => {
            const assetNames = () =>
              compilation.getAssets().map((asset) => asset.name)

            for (const asset of compilation.getAssets()) {
              if (!/\.(?:js|mjs)$/.test(asset.name)) continue

              const text = asset.source.source().toString()

              if (!text.includes(CONTENT_SCRIPT_CSS_PROBE_MARKER_PREFIX)) {
                continue
              }

              const pattern = createContentScriptCssProbeMarkerPattern()
              const replaced = new sources.ReplaceSource(asset.source)
              let match = pattern.exec(text)
              let touched = false

              while (match) {
                replaced.replace(
                  match.index,
                  match.index + match[0].length - 1,
                  resolveBundleCssProbeMarker(
                    match[1],
                    (name) => Boolean(compilation.getAsset(name)),
                    assetNames
                  )
                )

                touched = true
                match = pattern.exec(text)
              }

              if (touched) compilation.updateAsset(asset.name, replaced)
            }
          }
        )
      }
    )
  }
}
