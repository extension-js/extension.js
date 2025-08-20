import * as fs from 'fs'
import * as path from 'path'
import rspack, {type Compiler, sources, Compilation} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import {getAssetsFromHtml, isFromIncludeList} from '../html-lib/utils'
import {patchHtmlNested} from '../html-lib/patch-html'
import * as messages from '../../../webpack-lib/messages'

export class AddAssetsToCompilation {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList
  public readonly browser?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
    this.browser = options.browser
  }

  // Normalize public folder path. We standardize on lowercase "public" only.
  private normalizePublicPath(assetPath: string): string {
    if (!assetPath.startsWith('public/')) return assetPath
    return assetPath
      .replace(/^Public\//, 'public/')
      .replace(/^PUBLIC\//, 'public/')
      .replace(/^public\//, 'public/')
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'html:add-assets-to-compilation',
      (compilation) => {
        const processAssetsHook: any = (compilation as any).hooks?.processAssets
        const runner = () => {
          if (compilation.errors.length > 0) return

          const allEntries = this.includeList || {}
          const projectPath = path.dirname(this.manifestPath)
          const publicRoot = path.join(projectPath, 'public')

          for (const field of Object.entries(allEntries)) {
            const [, resource] = field

            if (resource) {
              const compilationAsset = compilation.getAsset(
                path.basename(resource as string)
              )

              if (compilationAsset) {
                const htmlSource = compilationAsset.source.source().toString()

                const staticAssets = getAssetsFromHtml(
                  resource as string,
                  htmlSource
                )?.static

                const fileAssets = [...new Set(staticAssets)]

                for (const asset of fileAssets) {
                  // Compute absolute fs path
                  const isRootUrl = asset.startsWith('/')
                  const isDotPublic = asset.startsWith('./public/')
                  const isPlainPublic = asset.startsWith('public/')
                  const absoluteFsPath = isRootUrl
                    ? (() => {
                        const rootRelative = asset.slice(1)
                        const normalized =
                          this.normalizePublicPath(rootRelative)
                        const withoutPublicPrefix = normalized.replace(
                          /^public\//,
                          ''
                        )
                        return path.join(publicRoot, withoutPublicPrefix)
                      })()
                    : isDotPublic
                      ? path.join(
                          projectPath,
                          this.normalizePublicPath(asset.replace(/^\.\//, ''))
                        )
                      : isPlainPublic
                        ? path.join(
                            projectPath,
                            this.normalizePublicPath(asset)
                          )
                        : asset
                  const isUnderPublicRoot =
                    String(absoluteFsPath).startsWith(publicRoot)

                  // Handle missing static assets. This is not covered
                  // by HandleCommonErrorsPlugin because static assets
                  // are not entrypoints.
                  if (!fs.existsSync(absoluteFsPath)) {
                    const FilepathListEntry = isFromIncludeList(
                      asset,
                      this.includeList
                    )

                    // If this asset is an asset emitted by some other plugin,
                    // we don't want to emit it again. This is the case for
                    // HTML or script assets.
                    if (!FilepathListEntry) {
                      // Skip warning for hash references and public paths
                      if (!path.basename(asset).startsWith('#')) {
                        const errorMessage = messages.fileNotFound(
                          resource as string,
                          asset
                        )
                        compilation.warnings.push(
                          new rspack.WebpackError(errorMessage)
                        )
                        continue
                      }
                    }
                  }

                  const source = fs.readFileSync(absoluteFsPath)
                  const rawSource = new (sources as any).RawSource(source)

                  // For public paths, maintain the same structure in output
                  // For relative paths, preserve directory structure under assets relative to the HTML
                  const computePosixRelative = (
                    fromPath: string,
                    toPath: string
                  ) => {
                    const rel =
                      (path as any).relative?.(
                        path.dirname(fromPath),
                        toPath
                      ) || toPath
                    const sep = (path as any).sep || '/'
                    return rel.split(sep).join('/')
                  }

                  const filepath = isUnderPublicRoot
                    ? this.normalizePublicPath(
                        path.posix.relative(publicRoot, absoluteFsPath)
                      )
                    : path.posix.join(
                        'assets',
                        computePosixRelative(resource as string, absoluteFsPath)
                      )

                  // Check if this is a nested HTML file that exists in the compilation
                  const isNestedHtml = asset.endsWith('.html')
                  const nestedHtmlAsset = isNestedHtml
                    ? compilation.getAsset(path.basename(asset))
                    : null

                  // Skip emitting if the asset is in the include list and is not a nested HTML
                  if (
                    isFromIncludeList(asset, this.includeList) &&
                    !nestedHtmlAsset
                  ) {
                    continue
                  }

                  if (!compilation.getAsset(filepath)) {
                    // If for some reason the HTML file reached this condition,
                    // it means it is not defined in the manifest file nor
                    // in the include list. If the HTML file is treated like
                    // any other resource, it will be emitted as an asset.
                    // Here we also emit the assets referenced in the HTML file.
                    if (asset.endsWith('.html')) {
                      const updatedHtml = patchHtmlNested(
                        compilation,
                        absoluteFsPath,
                        this.excludeList || {}
                      )
                      const htmlAssets = getAssetsFromHtml(absoluteFsPath)
                      const assetsFromHtml = [
                        ...(htmlAssets?.js || []),
                        ...(htmlAssets?.css || []),
                        ...(htmlAssets?.static || [])
                      ]

                      // Emit the HTML itself using RawSource
                      compilation.emitAsset(
                        filepath,
                        new (sources as any).RawSource(
                          (updatedHtml || source).toString()
                        )
                      )
                      assetsFromHtml.forEach((assetFromHtml) => {
                        const source = fs.readFileSync(assetFromHtml)
                        const rawSource = new (sources as any).RawSource(source)

                        const assetFilepath = path.posix.join(
                          'assets',
                          computePosixRelative(absoluteFsPath, assetFromHtml)
                        )

                        if (!compilation.getAsset(assetFilepath)) {
                          compilation.emitAsset(assetFilepath, rawSource)
                        }
                      })
                    } else {
                      compilation.emitAsset(filepath, rawSource)
                    }
                  }
                }
              }
            }
          }
          // end runner
        }

        // Fallback for test environments where processAssets hook isn't mocked
        if (processAssetsHook && typeof processAssetsHook.tap === 'function') {
          processAssetsHook.tap(
            {
              name: 'html:add-assets-to-compilation',
              stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
            },
            () => runner()
          )
        } else {
          runner()
        }
      }
    )
  }
}
