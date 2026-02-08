import type * as webpack from 'webpack'
import {RuntimeGlobal} from './BrowserRuntime'

export default function AutoPublicPathRuntimeModule(
  webpack: typeof import('webpack')
): webpack.RuntimeModule {
  const {
    RuntimeModule,
    RuntimeGlobals,
    Template,
    javascript: {JavascriptModulesPlugin},
    HotUpdateChunk
  } = webpack as any

  // rspack don't have JavascriptModulesPlugin.getChunkFilenameTemplate
  const getChunkFilenameTemplate =
    JavascriptModulesPlugin.getChunkFilenameTemplate ||
    function getChunkFilenameTemplate(chunk: any, outputOptions: any) {
      if (chunk.filenameTemplate) {
        return chunk.filenameTemplate
      } else if (
        typeof HotUpdateChunk === 'function' &&
        chunk instanceof HotUpdateChunk
      ) {
        return outputOptions.hotUpdateChunkFilename
      } else if (chunk.canBeInitial()) {
        return outputOptions.filename
      }
      return outputOptions.chunkFilename
    }

  class AutoPublicPathRuntime extends RuntimeModule {
    constructor() {
      super('publicPath', RuntimeModule.STAGE_BASIC)
    }

    generate() {
      const {compilation} = this as any
      if (!compilation || !(this as any).chunk)
        return Template.asString(
          '/* [webpack-target-webextension] AutoPublicPathRuntimeModule skipped because no compilation/chunk is found. */'
        )
      const {scriptType, importMetaName} = compilation.outputOptions
      const chunkName = compilation.getPath(
        getChunkFilenameTemplate(
          (this as any).chunk,
          compilation.outputOptions
        ),
        {
          chunk: (this as any).chunk,
          contentHashType: 'javascript'
        }
      )
      const outputPath = compilation.outputOptions.path
      if (!outputPath)
        return Template.asString(
          '/* [webpack-target-webextension] AutoPublicPathRuntimeModule skipped because no output path is found. */'
        )
      const undoPath = getUndoPath(chunkName, outputPath, false)

      const optionalChaining =
        compilation.outputOptions.environment.optionalChaining
      const _const = compilation.outputOptions.environment.const
        ? 'const'
        : 'var'
      const _let = compilation.outputOptions.environment.const ? 'let' : 'var'
      return Template.asString([
        `${_let} scriptUrl;`,
        scriptType === 'module'
          ? `if (typeof ${importMetaName}.url === "string") scriptUrl = ${importMetaName}.url;`
          : Template.asString([
              `if (${RuntimeGlobals.global}.importScripts) scriptUrl = ${RuntimeGlobals.global}.location + "";`,
              `${_const} document = ${RuntimeGlobals.global}.document;`,
              `if (!scriptUrl && ${
                optionalChaining
                  ? 'document?.currentScript'
                  : 'document && document.currentScript'
              }) {`,
              Template.indent('scriptUrl = document.currentScript.src;'),
              '}'
            ]),
        '// When supporting browsers where an automatic publicPath is not supported you must specify an output.publicPath manually via configuration',
        '// or pass an empty string ("") and set the __webpack_public_path__ variable from your code to use your own logic.',
        `var __extjsBase = (typeof globalThis === "object" && globalThis && globalThis.__EXTJS_EXTENSION_BASE__) ? String(globalThis.__EXTJS_EXTENSION_BASE__) : "";`,
        `if (!__extjsBase && typeof document === "object" && document && document.documentElement) {`,
        Template.indent([
          `try { __extjsBase = document.documentElement.getAttribute("data-extjs-extension-base") || ""; } catch(_) { __extjsBase = ""; }`
        ]),
        `}`,
        // MAIN world: ignore page-origin scriptUrl when extension base is known.
        `if (__extjsBase && scriptUrl && !/^((chrome|moz)-extension):\/\//.test(scriptUrl)) {`,
        Template.indent([`scriptUrl = __extjsBase;`]),
        `}`,
        'if (!scriptUrl) {',
        Template.indent([
          `if (${RuntimeGlobal} && ${RuntimeGlobal}.runtime && typeof ${RuntimeGlobal}.runtime.getURL === "function") {`,
          Template.indent(`scriptUrl = ${RuntimeGlobal}.runtime.getURL("/");`),
          `} else {`,
          // MAIN world: extension runtime missing; keep publicPath empty and let bridge resolve chunks.
          Template.indent('scriptUrl = __extjsBase || "";'),
          `}`
        ]),
        '}',
        'scriptUrl = scriptUrl.replace(/#.*$/, "").replace(/\\?.*$/, "").replace(/\\/[^\\/]+$/, "/");',
        !undoPath
          ? `${RuntimeGlobals.publicPath} = scriptUrl;`
          : `${RuntimeGlobals.publicPath} = scriptUrl + ${JSON.stringify(undoPath)};`,
        `if (!scriptUrl && typeof document === "object" && document && document.documentElement) {`,
        Template.indent([
          `try {`,
          Template.indent([
            `var __extjsRetries = 0;`,
            `var __extjsUpdateBase = function(){`,
            Template.indent([
              `var base = "";`,
              `try { base = document.documentElement.getAttribute("data-extjs-extension-base") || ""; } catch(_) { base = ""; }`,
              `if (base) {`,
              Template.indent([
                `var normalized = base.replace(/\\/+$/, "/");`,
                !undoPath
                  ? `${RuntimeGlobals.publicPath} = normalized;`
                  : `${RuntimeGlobals.publicPath} = normalized + ${JSON.stringify(undoPath)};`
              ]),
              `} else if (__extjsRetries++ < 50) {`,
              Template.indent([`setTimeout(__extjsUpdateBase, 100);`]),
              `}`
            ]),
            `};`,
            `__extjsUpdateBase();`
          ]),
          `} catch (_) {}`
        ]),
        `}`
      ])
    }
  }
  return new AutoPublicPathRuntime()
}

/**
 * The following function (from webpack/lib/util/identifier) is not exported by Webpack 5 as a public API.
 * To not import anything from Webpack directly, this function is copied here.
 *
 * It follows the MIT license.
 */
function getUndoPath(
  filename: string,
  outputPath: string,
  enforceRelative: boolean
) {
  let depth = -1
  let append = ''
  outputPath = outputPath.replace(/[\\/]$/, '')
  for (const part of filename.split(/[/\\]+/)) {
    if (part === '..') {
      if (depth > -1) {
        depth--
      } else {
        const i = outputPath.lastIndexOf('/')
        const j = outputPath.lastIndexOf('\\')
        const pos = i < 0 ? j : j < 0 ? i : Math.max(i, j)
        if (pos < 0) return outputPath + '/'
        append = outputPath.slice(pos + 1) + '/' + append
        outputPath = outputPath.slice(0, pos)
      }
    } else if (part !== '.') {
      depth++
    }
  }
  return depth > 0
    ? `${'../'.repeat(depth)}${append}`
    : enforceRelative
      ? `./${append}`
      : append
}
