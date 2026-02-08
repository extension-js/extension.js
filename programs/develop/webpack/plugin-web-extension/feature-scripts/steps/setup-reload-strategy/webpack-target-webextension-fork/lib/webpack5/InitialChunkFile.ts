export default class WebExtensionContentScriptEntryPlugin {
  private readonly options: any

  constructor(options: any) {
    this.options = options
  }

  apply(compiler: any) {
    const {WebpackError, sources, Template} = compiler.webpack
    const {experimental_output} = this.options
    if (!experimental_output) return
    {
      const sw = this.options.background?.serviceWorkerEntry
      if (
        sw &&
        sw in experimental_output &&
        typeof experimental_output[sw] === 'function'
      ) {
        throw new Error(
          `[webpack-extension-target] options.experimental_output[${JSON.stringify(
            sw
          )}] cannot be a function because it is a service worker entry. Use { file, touch(manifest, file) { manifest.background.service_worker = file; } } instead.`
        )
      }
    }

    compiler.hooks.thisCompilation.tap(
      WebExtensionContentScriptEntryPlugin.name,
      (compilation: any) => {
        compilation.hooks.processAssets.tap(
          {
            name: WebExtensionContentScriptEntryPlugin.name,
            stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_DERIVED
          },
          (assets: any) => {
            let manifest: any
            const serviceWorkerEntry =
              this.options.background?.serviceWorkerEntry
            {
              if (
                serviceWorkerEntry &&
                !(serviceWorkerEntry in experimental_output) &&
                (getInitialFiles(compilation, serviceWorkerEntry)?.length ||
                  0) > 1
              ) {
                const e = new WebpackError(
                  `[webpack-extension-target] Entry ${JSON.stringify(
                    serviceWorkerEntry
                  )} is not specified in options.experimental_output.`
                )
                e.stack = ''
                compilation.warnings.push(e)
              }
            }
            for (const entry in experimental_output) {
              const isBackgroundEntry = entry === serviceWorkerEntry
              const entryOption = experimental_output[entry]
              const initialFiles = getInitialFiles(compilation, entry)
              if (!initialFiles || initialFiles.length === 0) {
                const name = JSON.stringify(entry)
                const e = new WebpackError(
                  initialFiles
                    ? `[webpack-extension-target] Entry ${name} does not emit any initial file (specified in options.experimental_output).`
                    : `[webpack-extension-target] Entry ${name} does not exist (specified in options.experimental_output).`
                )
                e.stack = ''
                compilation.errors.push(e)
                continue
              }

              if (entryOption === false) {
                if (initialFiles.length > 1) {
                  const name = JSON.stringify(entry)
                  const e = new WebpackError(
                    `[webpack-extension-target] Entry ${name} emits more than one initial file which is prohibited (specified in options.experimental_output).`
                  )
                  e.stack = ''
                  compilation.errors.push(e)
                }
                continue
              }

              const emitFile = (entryOptionFile: string, files: string[]) => {
                if (entryOptionFile in assets) {
                  const e = new WebpackError(
                    `[webpack-extension-target] Cannot override an existing file ${JSON.stringify(
                      entryOptionFile
                    )} (specified by options.experimental_output[${JSON.stringify(entry)}]).`
                  )
                  e.stack = ''
                  compilation.errors.push(e)
                  return
                }
                let code: string[]
                if (isBackgroundEntry) {
                  const asyncAndSyncFiles = getInitialAndAsyncFiles(
                    compilation,
                    entry
                  )
                  if (compilation.outputOptions.chunkFormat === 'module') {
                    code = asyncAndSyncFiles.map(
                      (file: string) => `import ${JSON.stringify('./' + file)};`
                    )
                  } else {
                    code = [
                      'try {',
                      Template.indent(
                        'importScripts(' +
                          asyncAndSyncFiles
                            .map((file: string) => JSON.stringify(file))
                            .join(', ') +
                          ');'
                      ),
                      '} catch (e) {',
                      Template.indent('Promise.reject(e);'),
                      '}'
                    ]
                  }
                } else {
                  code = [
                    ';(() => {',
                    Template.indent([
                      'const getURL = typeof browser === "object" ? browser.runtime.getURL : chrome.runtime.getURL;',
                      `${JSON.stringify(files)}.forEach(file => import(getURL(file)));`
                    ]),
                    '})();',
                    'null;'
                  ]
                }
                const source = new compiler.webpack.sources.RawSource(
                  Template.asString(code)
                )
                compilation.emitAsset(entryOptionFile, source)
              }

              if (typeof entryOption === 'string') {
                emitFile(entryOption, initialFiles)
                continue
              }

              if (!manifest) {
                const manifestAsset = assets['manifest.json']
                const name = JSON.stringify(entry)
                if (!manifestAsset) {
                  const e = new WebpackError(
                    `[webpack-extension-target] A manifest.json is required (required by options.experimental_output[${name}]). You can emit this file by using CopyPlugin or any other plugins.`
                  )
                  e.stack = ''
                  compilation.errors.push(e)
                  continue
                }
                try {
                  const source = manifestAsset.source()
                  if (typeof source === 'string') manifest = JSON.parse(source)
                  else manifest = JSON.parse(source.toString('utf-8'))
                } catch {
                  const e = new WebpackError(
                    `[webpack-extension-target] Failed to parse manifest.json (required by options.experimental_output[${name}]).`
                  )
                  e.stack = ''
                  e.file = 'manifest.json'
                  compilation.errors.push(e)
                  continue
                }
              }

              if (typeof entryOption === 'function') {
                entryOption(manifest, initialFiles)
              } else if (typeof entryOption === 'object') {
                emitFile(entryOption.file, initialFiles)
                entryOption.touch(manifest, entryOption.file)
              }
            }
            if (manifest) {
              compilation.updateAsset(
                'manifest.json',
                new sources.RawSource(JSON.stringify(manifest, undefined, 4))
              )
            }
          }
        )
      }
    )
  }
}

function getInitialFiles(compilation: any, entry: string) {
  const entryPoint = compilation.entrypoints.get(entry)
  if (!entryPoint) return undefined
  const files = new Set<string>()

  const runtimeChunk = entryPoint.getRuntimeChunk()
  if (runtimeChunk) {
    runtimeChunk.files.forEach((file: string) => {
      if (!isJSFile(file)) return
      const asset = compilation.getAsset(file)
      if (!asset) return
      if (!asset.info.hotModuleReplacement) files.add(file)
    })
  }
  entryPoint.getFiles().forEach((file: string) => {
    if (!isJSFile(file)) return
    const asset = compilation.getAsset(file)
    if (!asset) return
    if (!asset.info.hotModuleReplacement) files.add(file)
  })
  return [...files]
}

function getInitialAndAsyncFiles(compilation: any, entry: string) {
  const entryPoint = compilation.entrypoints.get(entry)
  if (!entryPoint) return []
  const files = new Set<string>()
  const visitedChunk = new Set<any>()

  function visit(chunk: any) {
    const chunkId =
      'rspack' in compilation.compiler
        ? !chunk.id || !chunk.hash
          ? Array.from(chunk.files).join('')
          : chunk.id + chunk.hash
        : chunk
    if (visitedChunk.has(chunkId)) return
    visitedChunk.add(chunkId)
    chunk.files.forEach((file: string) => {
      if (!isJSFile(file)) return
      const asset = compilation.getAsset(file)
      if (!asset) return
      if (!asset.info.hotModuleReplacement) files.add(file)
    })
    for (const child of chunk.getAllAsyncChunks()) {
      visit(child)
    }
  }
  entryPoint.chunks.forEach(visit)
  const allFiles = [...files].filter(
    (file) => isJSFile(file) && compilation.getAsset(file)
  )
  return allFiles
}

function isJSFile(file: string) {
  return file.endsWith('.js') || file.endsWith('.mjs')
}
