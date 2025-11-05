import * as fs from 'fs'
import * as path from 'path'
import {type Compiler, sources, Compilation} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import {patchHtmlNested} from '../html-lib/patch-html'
import {
  getAssetsFromHtml,
  isFromIncludeList,
  getFilePath,
  isHttpLike,
  isSpecialScheme,
  cleanLeading,
  computePosixRelative,
  resolveAbsoluteFsPath,
  reportToCompilation
} from '../html-lib/utils'
import * as messages from '../html-lib/messages'

function warnRemoteResourceReferences(params: {
  compilation: Compilation
  compiler: Compiler
  manifestDir: string
  resource: string
  js?: string[]
  css?: string[]
}) {
  const {compilation, compiler, manifestDir, resource, js, css} = params
  const displayFile = path.relative(manifestDir, resource)

  for (const jsUrl of js || []) {
    if (isHttpLike(jsUrl) && !isSpecialScheme(jsUrl)) {
      reportToCompilation(
        compilation,
        compiler,
        messages.remoteResourceWarning(resource, jsUrl, 'script'),
        'warning',
        displayFile
      )
    }
  }
  for (const cssUrl of css || []) {
    if (isHttpLike(cssUrl) && !isSpecialScheme(cssUrl)) {
      reportToCompilation(
        compilation,
        compiler,
        messages.remoteResourceWarning(resource, cssUrl, 'style'),
        'warning',
        displayFile
      )
    }
  }
}

function warnMissingPublicRootResources(params: {
  compilation: Compilation
  compiler: Compiler
  resource: string
  manifestDir: string
  projectRoot: string
  publicRootForResource: string
  outputRoot: string
  js?: string[]
  css?: string[]
}) {
  const {
    compilation,
    compiler,
    resource,
    manifestDir,
    projectRoot,
    publicRootForResource,
    outputRoot,
    js,
    css
  } = params

  const check = (publicRootUrl: string) => {
    if (!publicRootUrl || isSpecialScheme(publicRootUrl)) return
    if (path.isAbsolute(publicRootUrl) && publicRootUrl.startsWith(projectRoot))
      return
    if (!publicRootUrl.startsWith('/')) return

    const trimmed = publicRootUrl.replace(/^\//, '')
    const publicRootAbs = path.join(publicRootForResource, trimmed)
    const outputRootAssetAbs = path.join(outputRoot, trimmed)

    if (!fs.existsSync(publicRootAbs) && !fs.existsSync(outputRootAssetAbs)) {
      const displayPath = path.join(outputRoot, trimmed)

      reportToCompilation(
        compilation,
        compiler,
        messages.fileNotFound(resource, displayPath, {
          publicRootHint: true,
          refLabel: publicRootUrl
        }),
        'warning',
        path.relative(manifestDir, resource)
      )
    }
  }

  js?.forEach(check)
  css?.forEach(check)
}

function checkMissingLocalEntries(params: {
  compilation: Compilation
  compiler: Compiler
  resource: string
  manifestDir: string
  projectRoot: string
  js?: string[]
  css?: string[]
}) {
  const {compilation, compiler, resource, manifestDir, projectRoot, js, css} =
    params

  const check = (url: string) => {
    if (!url || isHttpLike(url) || isSpecialScheme(url)) return

    // Treat root URLs as public-root references (handled elsewhere).
    if (url.startsWith('/') && !url.startsWith(projectRoot)) return

    if (!fs.existsSync(url)) {
      const displayFile = path.relative(manifestDir, resource)
      reportToCompilation(
        compilation,
        compiler,
        messages.fileNotFound(displayFile, url),
        'error',
        displayFile
      )
    }
  }

  js?.forEach(check)
  css?.forEach(check)
}

// resolveAbsoluteFsPath moved to html-lib/utils

function emitNestedHtmlAndReferencedAssets(params: {
  compilation: Compilation
  filepath: string
  absoluteFsPath: string
}) {
  const {compilation, filepath, absoluteFsPath} = params
  const source = fs.readFileSync(absoluteFsPath)
  const updatedHtml = patchHtmlNested(compilation, absoluteFsPath, {})
  const htmlAssets = getAssetsFromHtml(absoluteFsPath)
  const assetsFromHtml = [
    ...(htmlAssets?.js || []),
    ...(htmlAssets?.css || []),
    ...(htmlAssets?.static || [])
  ]

  compilation.emitAsset(
    filepath,
    new (sources as any).RawSource((updatedHtml || source).toString())
  )

  assetsFromHtml.forEach((assetFromHtml) => {
    const s = fs.readFileSync(assetFromHtml)
    const r = new (sources as any).RawSource(s)
    const assetFilepath = path.posix.join(
      'assets',
      computePosixRelative(absoluteFsPath, assetFromHtml)
    )
    if (!compilation.getAsset(assetFilepath)) {
      compilation.emitAsset(assetFilepath, r)
    }
  })
}

export class AddAssetsToCompilation {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly browser?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.browser = options.browser
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'html:add-assets-to-compilation',
      (compilation) => {
        const processAssetsHook: any = (compilation as any).hooks?.processAssets
        const runner = () => {
          if (compilation.errors.length > 0) return

          const allEntries = this.includeList || {}
          const manifestDir = path.dirname(this.manifestPath)
          const projectRoot =
            (compiler.options.context as string) || path.dirname(manifestDir)

          for (const [featureName, resource] of Object.entries(allEntries)) {
            if (!resource) continue

            const htmlAssetName = getFilePath(featureName, '.html', false)
            const compilationAsset = compilation.getAsset(htmlAssetName)
            if (!compilationAsset && !fs.existsSync(resource as string))
              continue

            const htmlSource = compilationAsset
              ? compilationAsset.source.source().toString()
              : fs.readFileSync(resource as string, 'utf8')

            const parsedAssets = getAssetsFromHtml(
              resource as string,
              htmlSource
            )
            const staticAssets = parsedAssets?.static
            const htmlDir = path.dirname(resource as string)
            const projectRootFromResource = path.dirname(path.dirname(htmlDir))
            const publicRootForResource = path.join(
              projectRootFromResource,
              'public'
            )
            const outputRoot = compilation.options?.output?.path || ''

            // Remote references warnings
            warnRemoteResourceReferences({
              compilation,
              compiler,
              manifestDir,
              resource: resource as string,
              js: parsedAssets?.js,
              css: parsedAssets?.css
            })

            // Public-root warnings
            warnMissingPublicRootResources({
              compilation,
              compiler,
              resource: resource as string,
              manifestDir,
              projectRoot,
              publicRootForResource,
              outputRoot,
              js: parsedAssets?.js,
              css: parsedAssets?.css
            })

            // Local missing entries (non-HTTP, non-root public)
            checkMissingLocalEntries({
              compilation,
              compiler,
              resource: resource as string,
              manifestDir,
              projectRoot,
              js: parsedAssets?.js,
              css: parsedAssets?.css
            })

            const fileAssets = [...new Set(staticAssets)]
            for (const asset of fileAssets) {
              const {absoluteFsPath, isUnderPublicRoot, isRootUrl} =
                resolveAbsoluteFsPath({
                  asset,
                  projectRoot,
                  publicRootForResource,
                  outputRoot
                })

              // If root URL exists in source public, skip
              if (
                isRootUrl &&
                fs.existsSync(
                  path.join(publicRootForResource, cleanLeading(asset))
                )
              ) {
                continue
              }

              if (!fs.existsSync(absoluteFsPath)) {
                const inIncludeList = isFromIncludeList(asset, this.includeList)

                if (!inIncludeList && !path.basename(asset).startsWith('#')) {
                  const displayPath = isRootUrl
                    ? path.join(outputRoot, cleanLeading(asset))
                    : absoluteFsPath

                  reportToCompilation(
                    compilation,
                    compiler,
                    messages.fileNotFound(resource as string, displayPath, {
                      publicRootHint: isRootUrl,
                      refLabel: asset
                    }),
                    'warning',
                    path.relative(manifestDir, resource as string)
                  )

                  continue
                }
              }

              // For assets under public/, do not emit; only track for watch
              if (isUnderPublicRoot) {
                try {
                  compilation.fileDependencies.add(absoluteFsPath)
                } catch {
                  // ignore
                }

                continue
              }

              const filepath = path.posix.join(
                'assets',
                computePosixRelative(resource as string, absoluteFsPath)
              )

              // Skip emitting if the asset is in the include list and is not a nested HTML
              const isNestedHtml = asset.endsWith('.html')

              const nestedHtmlAsset = isNestedHtml
                ? compilation.getAsset(path.basename(asset))
                : null
              if (
                isFromIncludeList(asset, this.includeList) &&
                !nestedHtmlAsset
              ) {
                continue
              }

              if (!compilation.getAsset(filepath)) {
                if (asset.endsWith('.html')) {
                  emitNestedHtmlAndReferencedAssets({
                    compilation,
                    filepath,
                    absoluteFsPath
                  })
                } else {
                  const source = fs.readFileSync(absoluteFsPath)
                  compilation.emitAsset(
                    filepath,
                    new (sources as any).RawSource(source)
                  )
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
