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
import {withheldEntryKind} from '../../feature-scripts/scripts-lib/utils'
import {reportToCompilation} from '../../shared/compilation-issues'
import {isFolder, resolveRootAbsoluteRef} from '../../shared/paths'
import {findCompiledRootRefSource} from '../html-lib/compiled-root-ref'
import * as messages from '../html-lib/messages'
import {patchHtmlNested} from '../html-lib/patch-html'
import {readHtmlText} from '../html-lib/read-html'
import {sourceMayShip} from '../html-lib/source-may-ship'
import {
  importTarget,
  staticImportSpecifiers
} from '../html-lib/unbundled-imports'
import {
  getAssetsFromHtml,
  getFilePath,
  htmlStaticAssetOutputName,
  isFromIncludeList,
  isHttpLike,
  isSpecialScheme,
  isWrittenAsRootUrl,
  readPageFile,
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

    // A file the entry step dropped gets the severity of a missing one.
    const withheld =
      fs.existsSync(url) && !sourceMayShip(url, projectRoot, manifestDir)

    if (withheld || !fs.existsSync(url)) {
      const displayFile = path.relative(manifestDir, resource)
      reportToCompilation(
        compilation,
        compiler,
        withheld
          ? messages.pageRefWithheld(
              displayFile,
              url,
              authored?.[url] || url,
              withheldEntryKind(url, [projectRoot, manifestDir]),
              {deadRefHint: !strictRefs, kind}
            )
          : messages.fileNotFound(displayFile, url, {
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

// A script a copied page names, shipped as written under `output`.
interface CopiedPageScript {
  page: string
  script: string
  output: string
  // The page maps package names itself, so a bare import may resolve.
  pageMapsImports: boolean
}

function emitNestedHtmlAndReferencedAssets(params: {
  compilation: Compilation
  compiler: Compiler
  filepath: string
  absoluteFsPath: string
  manifestDir: string
  projectRoot: string
  publicDir: string
  copied: Set<string>
  copiedScripts: Map<string, CopiedPageScript>
}) {
  const {
    compilation,
    compiler,
    filepath,
    absoluteFsPath,
    manifestDir,
    projectRoot,
    publicDir,
    copied,
    copiedScripts
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

  copied.add(filepath)

  const strictRefs = process.env.EXTENSION_STRICT_REFS === 'true'
  const pageFile = path.relative(manifestDir, absoluteFsPath)

  assetsFromHtml.forEach((assetFromHtml) => {
    const authored = htmlAssets?.authored?.[assetFromHtml] || assetFromHtml
    const kind = htmlAssets?.js?.includes(assetFromHtml)
      ? 'script'
      : htmlAssets?.css?.includes(assetFromHtml)
        ? 'style'
        : undefined

    // A ref that doesn't resolve to a real source file must not throw here: an
    // uncaught ENOENT inside processAssets wedges the watch loop.
    if (!path.isAbsolute(assetFromHtml) || isFolder(assetFromHtml)) return

    if (!fs.existsSync(assetFromHtml)) {
      // A root URL may be served from public/, which another step checks.
      if (authored.startsWith('/')) return

      // The frame loads without the file, as its parent page would.
      reportToCompilation(
        compilation,
        compiler,
        messages.fileNotFound(absoluteFsPath, assetFromHtml, {
          refLabel: authored,
          deadRefHint: !strictRefs,
          copiedPage: true,
          kind
        }),
        strictRefs ? 'error' : 'warning',
        pageFile,
        missingRefName(assetFromHtml)
      )

      return
    }

    const mayShip = sourceMayShip(assetFromHtml, projectRoot, manifestDir, {
      rootRef: authored.startsWith('/') ? assetFromHtml : undefined,
      publicDir
    })

    if (!mayShip) {
      const shownAt = authored.startsWith('/')
        ? path.join(manifestDir, rootUrlPath(assetFromHtml))
        : assetFromHtml

      reportToCompilation(
        compilation,
        compiler,
        messages.pageRefWithheld(
          absoluteFsPath,
          shownAt,
          authored,
          withheldEntryKind(assetFromHtml, [projectRoot, manifestDir]),
          {kind}
        ),
        'warning',
        pageFile,
        missingRefName(shownAt)
      )

      return
    }

    const r = new sources.RawSource(readPageFile(compilation, assetFromHtml))
    const assetFilepath = htmlStaticAssetOutputName(
      manifestDir,
      absoluteFsPath,
      assetFromHtml,
      compilation.outputOptions,
      compilation
    )

    if (!compilation.getAsset(assetFilepath)) {
      compilation.emitAsset(assetFilepath, r)
      copied.add(assetFilepath)
    }

    if (kind === 'script' && !copiedScripts.has(assetFromHtml)) {
      copiedScripts.set(assetFromHtml, {
        page: absoluteFsPath,
        script: assetFromHtml,
        output: assetFilepath,
        pageMapsImports: /\btype\s*=\s*["']?importmap\b/i.test(
          source.toString()
        )
      })
    }
  })
}

// Says the first import of each copied script that the browser cannot load:
// a file nothing ships at the path it asks for, or a package name.
function warnUnbundledImports(params: {
  compilation: Compilation
  compiler: Compiler
  manifestDir: string
  projectRoot: string
  copiedScripts: Map<string, CopiedPageScript>
}) {
  const {compilation, compiler, manifestDir, projectRoot} = params
  const strictRefs = process.env.EXTENSION_STRICT_REFS === 'true'

  for (const entry of params.copiedScripts.values()) {
    let text: string

    try {
      text = readPageFile(compilation, entry.script).toString('utf8')
    } catch {
      continue
    }

    for (const specifier of staticImportSpecifiers(text)) {
      const target = importTarget(specifier, entry.output)

      if (target.kind === 'remote') continue
      if (target.kind === 'package' && entry.pageMapsImports) continue

      // public/ files and every other copy are assets by this stage.
      if (
        target.kind === 'file' &&
        compilation.getAsset(target.requestedPath)
      ) {
        continue
      }

      reportToCompilation(
        compilation,
        compiler,
        messages.unbundledScriptImport(
          path.relative(projectRoot, entry.page),
          path.relative(projectRoot, entry.script),
          specifier,
          target.kind === 'file' ? target.requestedPath : undefined,
          {deadRefHint: !strictRefs}
        ),
        strictRefs ? 'error' : 'warning',
        path.relative(manifestDir, entry.page),
        'UnbundledScriptImport'
      )

      break
    }
  }
}

// What this step copied into each output folder on its last good compile.
// It outlives a compiler, so a session restart still knows what to remove.
const copiedByOutputPath = new Map<string, Set<string>>()

function removeCopiedFile(outputPath: string, name: string): void {
  const root = path.resolve(outputPath)
  const target = path.resolve(root, name)
  if (!target.startsWith(root + path.sep)) return

  try {
    fs.rmSync(target, {force: true})
  } catch {
    // A file in use stays: pruning must never fail a compile.
  }
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
    // The names this compile copied for the pages, unset until it has run.
    let copiedNow: Set<string> | undefined

    compiler.hooks.thisCompilation.tap(
      'html:add-assets-to-compilation',
      (compilation) => {
        copiedNow = undefined
        const copiedScripts = new Map<string, CopiedPageScript>()

        const runner = () => {
          const errs = compilation.errors || []
          if (Array.isArray(errs) && errs.length > 0) return

          const copied = new Set<string>()
          copiedNow = copied
          copiedScripts.clear()

          const allEntries = this.includeList || {}
          const manifestDir = path.dirname(this.manifestPath)
          const projectRoot =
            (compiler.options.context as string) || path.dirname(manifestDir)

          for (const [featureName, resource] of Object.entries(allEntries)) {
            if (!resource) continue

            const htmlAssetName = getFilePath(featureName, '.html', false)
            const getAssetFn = compilation.getAsset

            const compilationAsset =
              typeof getAssetFn === 'function'
                ? getAssetFn.call(compilation, htmlAssetName)
                : null

            if (!compilationAsset && !fs.existsSync(resource as string)) {
              continue
            }

            const htmlSource = compilationAsset
              ? compilationAsset.source.source().toString()
              : readHtmlText(resource as string)

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

                // A withheld file gets the severity of a missing one.
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
                    withheld
                      ? messages.pageRefWithheld(
                          resource as string,
                          displayPath,
                          asRootUrl ? asset : authored,
                          withheldEntryKind(absoluteFsPath, [
                            projectRoot,
                            manifestDir
                          ])
                        )
                      : messages.fileNotFound(resource as string, displayPath, {
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
                compilation.outputOptions,
                compilation
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
                    publicDir: publicRootForResource,
                    copied,
                    copiedScripts
                  })
                } else {
                  compilation.emitAsset(
                    filepath,
                    new sources.RawSource(
                      readPageFile(compilation, absoluteFsPath)
                    )
                  )

                  copied.add(filepath)
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
                    compilation.emitAsset(
                      sourcePathAsset,
                      new sources.RawSource(
                        readPageFile(compilation, absoluteFsPath)
                      )
                    )

                    copied.add(sourcePathAsset)
                  }
                }
              }
            }
          }
        }

        compilation.hooks.processAssets.tap(
          {
            name: 'html:add-assets-to-compilation',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          () => runner()
        )

        // After every step that copies files, so an import another route
        // ships, the WAR copies included, is not reported.
        compilation.hooks.processAssets.tap(
          {
            name: 'html:add-assets-to-compilation',
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 1
          },
          () => {
            if (copiedScripts.size === 0) return

            const manifestDir = path.dirname(this.manifestPath)
            const projectRoot =
              (compiler.options.context as string) || path.dirname(manifestDir)

            warnUnbundledImports({
              compilation,
              compiler,
              manifestDir,
              projectRoot,
              copiedScripts
            })
          }
        )
      }
    )

    if (!compiler.hooks.done?.tap) return

    // A watch session never cleans its output, so a copy whose source was
    // edited, deleted or dropped from the page is removed here, nothing else.
    compiler.hooks.done.tap('html:add-assets-to-compilation', (stats) => {
      const outputPath = compiler.options.output?.path
      const copied = copiedNow

      if (!outputPath || !copied || stats.compilation.errors.length > 0) {
        return
      }

      const emitted = new Set(
        stats.compilation
          .getAssets()
          .map((asset) => String(asset.name || '').replace(/\\/g, '/'))
      )

      for (const name of copiedByOutputPath.get(outputPath) || []) {
        if (!emitted.has(name)) removeCopiedFile(outputPath, name)
      }

      copiedByOutputPath.set(outputPath, copied)
    })
  }
}
