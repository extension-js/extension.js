// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {
  init as esModuleLexerInit,
  parse as esModuleLexerParse
} from 'es-module-lexer'
import {validate} from 'schema-utils'
import type {Schema} from 'schema-utils/declarations/validate'
import {
  adjustLoaderSourceMap,
  inputOrIdentityMap,
  returnWithMap
} from '../../lib/loader-source-maps'
import {debugLine} from '../../lib/messaging'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../plugin-web-extension/feature-scripts/contracts'
import type {LoaderInterface} from '../../types'

const schema: Schema = {
  type: 'object',
  properties: {
    manifestPath: {
      type: 'string'
    }
  },
  additionalProperties: false
}

export default function ensureHMRForScripts(
  this: LoaderInterface,
  source: string,
  inputSourceMap?: unknown
) {
  // The prelude adds lines above the source, so the map that leaves here is
  // the one that arrived (or an identity map) padded by the prelude.
  const withPrelude = (prelude: string) => {
    const resourcePath = String(
      (this as {resourcePath?: unknown}).resourcePath || ''
    )

    return adjustLoaderSourceMap(
      inputOrIdentityMap(inputSourceMap, resourcePath, source),
      {prefix: prelude, before: source, after: source}
    )
  }

  const debugHtmlHmr = process.env.EXTENSION_DEBUG_HTML_HMR_SKIP === '1'
  const resourceQuery = String(this.resourceQuery || '')

  if (resourceQuery.includes('vue&type=')) {
    return source
  }

  const options = this.getOptions()
  const resourcePath = String(
    (this as {resourcePath?: unknown}).resourcePath || ''
  )
  const moduleLayer = String(
    (this as unknown as {_module?: {layer?: unknown}})?._module?.layer || ''
  )

  validate(schema, options, {
    name: 'reload:ensure-hmr-for-scripts',
    baseDataPath: 'options'
  })

  if (moduleLayer === EXTENSIONJS_CONTENT_SCRIPT_LAYER) {
    if (debugHtmlHmr) {
      debugLine(
        `[extjs:html-hmr] skip layer resource=${resourcePath} layer=${moduleLayer}`
      )
    }

    return source
  }

  // Only the scripts a page names reach this point. The rule that names this
  // loader lists them and leaves imported modules and content scripts out.

  if (debugHtmlHmr) {
    debugLine(
      `[extjs:html-hmr] inject resource=${resourcePath} manifest=${String(options?.manifestPath || '')} layer=${moduleLayer || '<none>'}`
    )
  }

  // `import.meta` is ONLY legal in module parses: a `javascript/dynamic`
  // (classic script) parse must get the CJS `module.hot` API instead.
  const moduleType = String(
    (this as unknown as {_module?: {type?: unknown}})?._module?.type || ''
  )

  if (moduleType === 'javascript/dynamic') {
    const prelude = buildReloadCode('module.hot')

    return returnWithMap(this, `${prelude}${source}`, withPrelude(prelude))
  }

  if (moduleType === 'javascript/esm') {
    const prelude = buildReloadCode('import.meta.webpackHot')

    return returnWithMap(this, `${prelude}${source}`, withPrelude(prelude))
  }

  // `javascript/auto` infers module-vs-script FROM THE SOURCE SYNTAX, so the
  // injected guard must pick the API the source's own syntax already selects.
  const callback = this.async()
  esModuleLexerInit()
    .then(() => {
      let hasModuleSyntax = false

      try {
        // The lexer's own verdict: a classic script may call `import()`, and
        // a bare `export {}` is a module, both of which a hand count gets wrong.
        ;[, , , hasModuleSyntax] = esModuleLexerParse(source)
      } catch {
        // Not lexable as a module, the script parse keeps it alive.
      }

      const prelude = buildReloadCode(
        hasModuleSyntax ? 'import.meta.webpackHot' : 'module.hot'
      )
      callback(null, `${prelude}${source}`, withPrelude(prelude))
    })
    .catch(() => {
      const prelude = buildReloadCode('module.hot')
      callback(null, `${prelude}${source}`, withPrelude(prelude))
    })
}

function buildReloadCode(hot: string): string {
  return `
if (${hot}) {
  try {
    ${hot}.accept();
    ${hot}.dispose(function() {
      try {
        var clear = function(el) {
          if (!el) return;
          while (el.firstChild) el.removeChild(el.firstChild);
        };

        // The page mounts on #root; the version before must not stay
        // underneath the one the entry renders next.
        clear(document.getElementById('root'));
      } catch (err) {
        console.warn('Extension.js W_RELOAD_NOT_APPLIED: the page could not be cleared for the hot update, so the version before may stay under the new one.', err);
      }
    });
  } catch (error) {
    console.warn('Extension.js W_RELOAD_NOT_APPLIED: the page could not accept hot updates, so an edit shows after the page is reloaded.', error);
  }
}
`
}
