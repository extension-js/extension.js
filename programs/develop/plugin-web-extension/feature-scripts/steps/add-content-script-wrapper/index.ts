// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {Compilation, type Compiler, sources} from '@rspack/core'
import {resolveDevelopDistFile} from '../../../../lib/develop-context'
import {findNearestProjectManifestSync} from '../../../../lib/project-manifest'
import {
  canonicalizeDir,
  isResourceUnderDirs
} from '../../../../lib/resource-path'
import type {DevOptions, FilepathList, PluginInterface} from '../../../../types'
import {
  CONTENT_SCRIPT_CSS_PROBE_MARKER_PREFIX,
  createContentScriptCssProbeMarkerPattern,
  parseCanonicalContentScriptAsset
} from '../../contracts'
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

export class AddContentScriptWrapper {
  public static getBridgeScripts(
    manifestPath: string,
    browser: DevOptions['browser'] = 'chrome'
  ): FilepathList {
    return getMainWorldBridgeScripts(manifestPath, browser)
  }

  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = (options.browser as DevOptions['browser']) || 'chrome'
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
          options: {
            manifestPath: this.manifestPath,
            mode: compiler.options.mode
          }
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
      use: [
        {
          loader: this.resolveLoader(),
          options: {
            manifestPath: this.manifestPath,
            mode: compiler.options.mode
          }
        }
      ]
    })

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
