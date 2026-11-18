// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {Compilation, type Compiler, sources} from '@rspack/core'
import {isOsPathUnder} from '../../../lib/real-path'
import {publicContainmentRoot} from '../../../plugin-special-folders/resolve-public-folder'
import type {FilepathList, PluginInterface} from '../../../types'
import {reportToCompilation} from '../../shared/compilation-issues'
import {isFolder, resolveRootAbsoluteRef} from '../../shared/paths'
import {findCompiledRootRefSource} from '../html-lib/compiled-root-ref'
import * as messages from '../html-lib/messages'
import {patchHtmlNested} from '../html-lib/patch-html'
import {sourceMayShip} from '../html-lib/source-may-ship'
import {
  getAssetsFromHtml,
  getFilePath,
  htmlStaticAssetOutputName,
  isFromIncludeList,
  isHttpLike,
  isSpecialScheme,
  isWrittenAsRootUrl,
  resolveAbsoluteFsPath,
  rootUrlPath
} from '../html-lib/utils'

// The name a missing reference reports under, split the way fileNotFound
// splits its text: a script or a stylesheet is an entry, the rest an asset.
export function missingRefName(missingFilePath: string) {
  return /\.(?:[jt]sx?|css|scss|sass|less)$/.test(missingFilePath)
    ? 'HtmlEntrypointMissing'
    : 'HtmlAssetMissing'
}

function warnRemoteResourceReferences(params: {
  compilation: Compilation
  compiler: Compiler
  manifestDir: string
  resource: string
  js?: string[]
  css?: string[]
  staticAssets?: string[]
}) {
  const {compilation, compiler, manifestDir, resource, js, css, staticAssets} =
    params
  const displayFile = path.relative(manifestDir, resource)

  for (const jsUrl of js || []) {
    if (isHttpLike(jsUrl) && !isSpecialScheme(jsUrl)) {
      reportToCompilation(
        compilation,
        compiler,
        messages.remoteResourceWarning(resource, jsUrl, 'script'),
        'warning',
        displayFile,
        'RemoteResourceBlocked'
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
        displayFile,
        'RemoteResourceBlocked'
      )
    }
  }

  for (const anyUrl of staticAssets || []) {
    if (isHttpLike(anyUrl) && !isSpecialScheme(anyUrl)) {
      if (/\.css(\?|#|$)/i.test(anyUrl)) {
        reportToCompilation(
          compilation,
          compiler,
          messages.remoteResourceWarning(resource, anyUrl, 'style'),
          'warning',
          displayFile,
          'RemoteResourceBlocked'
        )
      }
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
  authored?: Record<string, string>
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
    css,
    authored
  } = params

  // A root URL keeps the words its ending picks, as a withheld one reads.
  const check = (publicRootUrl: string) => {
    if (!publicRootUrl || isSpecialScheme(publicRootUrl)) return

    if (path.isAbsolute(publicRootUrl)) {
      const rel = path.relative(projectRoot, publicRootUrl)
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return
    }

    if (!isWrittenAsRootUrl(publicRootUrl, projectRoot, authored)) return

    const trimmed = publicRootUrl.replace(/^\//, '')
    const publicRootAbs = path.join(publicRootForResource, trimmed)
    const outputRootAssetAbs = path.join(outputRoot, trimmed)

    // A ref that exists at the extension root is valid and copied by
    // emitRootAbsoluteRefs; resolve against the manifest dir, not the compiler context.
    if (
      resolveRootAbsoluteRef(
        publicRootUrl,
        manifestDir,
        publicRootForResource
      ) ||
      resolveRootAbsoluteRef(publicRootUrl, projectRoot, publicRootForResource)
    ) {
      return
    }

    // A missing .js whose source sibling sits at the root (lib/widget.ts for
    // /lib/widget.js) is compiled to that path by emitRootAbsoluteRefs.
    if (
      findCompiledRootRefSource(
        publicRootUrl,
        manifestDir,
        publicRootForResource
      ) ||
      findCompiledRootRefSource(
        publicRootUrl,
        projectRoot,
        publicRootForResource
      )
    ) {
      return
    }

    if (!fs.existsSync(publicRootAbs) && !fs.existsSync(outputRootAssetAbs)) {
      // Name the place the build looked last, never the staging directory.
      const displayPath = path.join(manifestDir, trimmed)

      reportToCompilation(
        compilation,
        compiler,
        messages.fileNotFound(resource, displayPath, {
          publicRootHint: true,
          refLabel: publicRootUrl
        }),
        'warning',
        path.relative(manifestDir, resource),
        missingRefName(displayPath)
      )
    }
  }

  for (const url of js || []) check(url)
  for (const url of css || []) check(url)
}

function checkMissingLocalEntries(params: {
  compilation: Compilation
  compiler: Compiler
  resource: string
  manifestDir: string
  projectRoot: string
  js?: string[]
  css?: string[]
  authored?: Record<string, string>
}) {
  const {
    compilation,
    compiler,
    resource,
    manifestDir,
    projectRoot,
    js,
    css,
    authored
  } = params

  // Chrome silently 404s a missing local ref and runs the page, so a dead ref
  // warns by default; EXTENSION_STRICT_REFS=true restores the failure for CI.
  const strictRefs = process.env.EXTENSION_STRICT_REFS === 'true'

  const check = (url: string, kind: 'script' | 'style') => {
    if (!url || isHttpLike(url) || isSpecialScheme(url)) return

    // Treat root URLs as public-root references (handled elsewhere): a root ref is
    // a '/'-path that does NOT live inside the project.
    if (isWrittenAsRootUrl(url, projectRoot, authored)) return

    // A file the entry step dropped is reported the way a missing one is.
    if (!fs.existsSync(url) || !sourceMayShip(url, projectRoot, manifestDir)) {
      const displayFile = path.relative(manifestDir, resource)
      reportToCompilation(
        compilation,
        compiler,
        messages.fileNotFound(displayFile, url, {
          deadRefHint: !strictRefs,
          kind
        }),
        strictRefs ? 'error' : 'warning',
        displayFile,
        missingRefName(url)
      )
    }
  }

  for (const url of js || []) check(url, 'script')
  for (const url of css || []) check(url, 'style')
}

function emitNestedHtmlAndReferencedAssets(params: {
  compilation: Compilation
  compiler: Compiler
  filepath: string
  absoluteFsPath: string
  manifestDir: string
  projectRoot: string
  publicDir: string
}) {
  const {
    compilation,
    compiler,
    filepath,
    absoluteFsPath,
    manifestDir,
    projectRoot,
    publicDir
  } = params
  const source = fs.readFileSync(absoluteFsPath)
  const updatedHtml = patchHtmlNested(compilation, absoluteFsPath, manifestDir)
  const htmlAssets = getAssetsFromHtml(absoluteFsPath)
  const assetsFromHtml = [
    ...(htmlAssets?.js || []),
    ...(htmlAssets?.css || []),
    ...(htmlAssets?.static || [])
  ]

  compilation.emitAsset(
    filepath,
    new sources.RawSource((updatedHtml || source).toString())
  )

  assetsFromHtml.forEach((assetFromHtml) => {
    // A ref that doesn't resolve to a real source file must not throw here: an
    // uncaught ENOENT inside processAssets wedges the watch loop.
    if (!path.isAbsolute(assetFromHtml) || !fs.existsSync(assetFromHtml)) {
      return
    }

    const authored = htmlAssets?.authored?.[assetFromHtml] || assetFromHtml
    const mayShip = sourceMayShip(assetFromHtml, projectRoot, manifestDir, {
      rootRef: authored.startsWith('/') ? assetFromHtml : undefined,
      publicDir
    })

    if (!mayShip) {
      reportToCompilation(
        compilation,
        compiler,
        messages.fileNotFound(
          absoluteFsPath,
          authored.startsWith('/')
            ? path.join(manifestDir, rootUrlPath(assetFromHtml))
            : assetFromHtml,
          {
            publicRootHint: authored.startsWith('/'),
            refLabel: authored,
            kind: htmlAssets?.js?.includes(assetFromHtml)
              ? 'script'
              : htmlAssets?.css?.includes(assetFromHtml)
                ? 'style'
                : undefined
          }
        ),
        'warning',
        path.relative(manifestDir, absoluteFsPath)
      )

      return
    }

    const s = fs.readFileSync(assetFromHtml)
    const r = new sources.RawSource(s)
    const assetFilepath = htmlStaticAssetOutputName(
      manifestDir,
      absoluteFsPath,
      assetFromHtml,
      compilation.outputOptions
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
        const processAssetsHook = compilation.hooks?.processAssets

        const runner = () => {
          const errs = compilation.errors || []
          if (Array.isArray(errs) && errs.length > 0) return

          const allEntries = this.includeList || {}
          const manifestDir = path.dirname(this.manifestPath)
          const projectRoot =
            (compiler.options.context as string) || path.dirname(manifestDir)

          for (const [featureName, resource] of Object.entries(allEntries)) {
            if (!resource) continue

            const htmlAssetName = getFilePath(featureName, '.html', false)
            const getAssetFn = compilation.getAsset

            let compilationAsset =
              typeof getAssetFn === 'function'
                ? getAssetFn.call(compilation, htmlAssetName)
                : null

            // Fallback: some test harnesses store by basename(resource)
            if (!compilationAsset) {
              const altName = path.basename(resource as string)
              compilationAsset =
                typeof getAssetFn === 'function'
                  ? getAssetFn.call(compilation, altName)
                  : null
            }

            if (!compilationAsset && !fs.existsSync(resource as string)) {
              continue
            }

            const htmlSource = compilationAsset
              ? compilationAsset.source.source().toString()
              : fs.readFileSync(resource as string, 'utf8')

            const parsedAssets = getAssetsFromHtml(
              resource as string,
              htmlSource
            )
            const staticAssets = parsedAssets?.static
            // The folder the copier ships from, which `folders` can move.
            const publicRootForResource = publicContainmentRoot(
              this.manifestPath,
              projectRoot
            )
            const outputRoot = compilation.options?.output?.path || ''

            warnRemoteResourceReferences({
              compilation,
              compiler,
              manifestDir,
              resource: resource as string,
              js: parsedAssets?.js,
              css: parsedAssets?.css,
              staticAssets: parsedAssets?.static
            })

            try {
              const remoteRefRe =
                /<(script|link)[^>]+?(src|href)=["']((https?:)?\/\/[^"']+)["'][^>]*>/gi
              let m: RegExpExecArray | null

              while ((m = remoteRefRe.exec(htmlSource))) {
                const tag = String(m[1]).toLowerCase()
                const url = String(m[3])
                const kind = tag === 'script' ? 'script' : 'style'

                if (isHttpLike(url) && !isSpecialScheme(url)) {
                  reportToCompilation(
                    compilation,
                    compiler,
                    messages.remoteResourceWarning(
                      resource as string,
                      url,
                      kind
                    ),
                    'warning',
                    path.relative(manifestDir, resource as string),
                    'RemoteResourceBlocked'
                  )
                }
              }
            } catch {
              // Ignore
            }

            warnMissingPublicRootResources({
              compilation,
              compiler,
              resource: resource as string,
              manifestDir,
              projectRoot,
              publicRootForResource,
              outputRoot,
              js: parsedAssets?.js,
              css: parsedAssets?.css,
              authored: parsedAssets?.authored
            })

            checkMissingLocalEntries({
              compilation,
              compiler,
              resource: resource as string,
              manifestDir,
              projectRoot,
              js: parsedAssets?.js,
              css: parsedAssets?.css,
              authored: parsedAssets?.authored
            })

            const fileAssets = [...new Set(staticAssets)]

            for (const asset of fileAssets) {
              const {absoluteFsPath, isUnderPublicRoot, isRootUrl} =
                resolveAbsoluteFsPath({
                  asset,
                  projectRoot,
                  publicRootForResource,
                  outputRoot,
                  manifestRoot: manifestDir
                })

              // Written with a leading slash, the ref is a path inside the
              // extension, also when a file sits at that address on disk.
              const authored = parsedAssets?.authored?.[asset] || asset
              const asRootUrl =
                isRootUrl ||
                (authored.startsWith('/') && !isOsPathUnder(projectRoot, asset))
              const withheld =
                fs.existsSync(absoluteFsPath) &&
                !sourceMayShip(absoluteFsPath, projectRoot, manifestDir, {
                  rootRef: asRootUrl ? asset : undefined,
                  publicDir: publicRootForResource
                })

              if (
                !withheld &&
                isRootUrl &&
                fs.existsSync(
                  path.join(publicRootForResource, rootUrlPath(asset))
                )
              ) {
                continue
              }

              if (withheld || !fs.existsSync(absoluteFsPath)) {
                const inIncludeList = isFromIncludeList(asset, this.includeList)

                // A withheld file is reported the way a missing one is.
                if (
                  withheld ||
                  (!inIncludeList && !path.basename(asset).startsWith('#'))
                ) {
                  const displayPath = asRootUrl
                    ? path.join(manifestDir, rootUrlPath(asset))
                    : absoluteFsPath

                  reportToCompilation(
                    compilation,
                    compiler,
                    messages.fileNotFound(resource as string, displayPath, {
                      publicRootHint: asRootUrl,
                      refLabel: asRootUrl ? asset : authored
                    }),
                    'warning',
                    path.relative(manifestDir, resource as string),
                    missingRefName(displayPath)
                  )

                  continue
                }
              }

              if (isFolder(absoluteFsPath)) {
                reportToCompilation(
                  compilation,
                  compiler,
                  messages.fileIsFolder(resource as string, absoluteFsPath, {
                    refLabel: parsedAssets?.authored?.[asset] || asset
                  }),
                  'warning',
                  path.relative(manifestDir, resource as string),
                  'HtmlAssetMissing'
                )

                continue
              }

              // For assets under public/, do not emit; only track for watch
              if (isUnderPublicRoot) {
                try {
                  compilation.fileDependencies.add(absoluteFsPath)
                } catch {
                  // Ignore
                }

                continue
              }

              const filepath = htmlStaticAssetOutputName(
                manifestDir,
                resource as string,
                absoluteFsPath,
                compilation.outputOptions
              )

              const isNestedHtml = asset.endsWith('.html')

              const nestedHtmlAsset = isNestedHtml
                ? typeof getAssetFn === 'function'
                  ? getAssetFn.call(compilation, path.basename(asset))
                  : null
                : null

              if (
                isFromIncludeList(asset, this.includeList) &&
                !nestedHtmlAsset
              ) {
                continue
              }

              // A root URL stays as written in the page and is served from the
              // extension root, so only the source-path copy below is reachable.
              const reachableUnderAssets = isNestedHtml || !isRootUrl

              if (
                reachableUnderAssets &&
                !(
                  typeof getAssetFn === 'function' &&
                  getAssetFn.call(compilation, filepath)
                )
              ) {
                if (asset.endsWith('.html')) {
                  emitNestedHtmlAndReferencedAssets({
                    compilation,
                    compiler,
                    filepath,
                    absoluteFsPath,
                    manifestDir,
                    projectRoot,
                    publicDir: publicRootForResource
                  })
                } else {
                  const source = fs.readFileSync(absoluteFsPath)
                  compilation.emitAsset(filepath, new sources.RawSource(source))
                }
              }

              // A root URL is served as written, so the file ships at its source
              // path. A rewritten ref and a traced getURL literal need no copy here.
              if (isRootUrl && !isNestedHtml && fs.existsSync(absoluteFsPath)) {
                const manifestRelative = path.relative(
                  manifestDir,
                  absoluteFsPath
                )

                if (
                  manifestRelative &&
                  !manifestRelative.startsWith('..') &&
                  !path.isAbsolute(manifestRelative)
                ) {
                  const sourcePathAsset = manifestRelative
                    .split(path.sep)
                    .join('/')

                  if (
                    sourcePathAsset !== filepath &&
                    !(
                      typeof getAssetFn === 'function' &&
                      getAssetFn.call(compilation, sourcePathAsset)
                    )
                  ) {
                    const source = fs.readFileSync(absoluteFsPath)
                    compilation.emitAsset(
                      sourcePathAsset,
                      new sources.RawSource(source)
                    )
                  }
                }
              }
            }
          }
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
