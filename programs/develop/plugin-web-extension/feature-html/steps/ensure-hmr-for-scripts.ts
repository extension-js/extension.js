// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import fs from 'node:fs'
import path from 'node:path'
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
} from '../../../lib/loader-source-maps'
import {stripBom} from '../../../lib/parse-json-safe'
import {toResourceKey} from '../../../lib/resource-path'
import type {LoaderInterface} from '../../../types'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../feature-scripts/contracts'

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string'
    },
    manifestPath: {
      type: 'string'
    },
    includeList: {
      type: 'object'
    },
    frameworkOwnsRefresh: {
      type: 'boolean'
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

  try {
    validate(schema, options, {
      name: 'html:ensure-hmr-for-scripts',
      baseDataPath: 'options'
    })
  } catch (error) {
    throw error
  }

  if (moduleLayer === EXTENSIONJS_CONTENT_SCRIPT_LAYER) {
    if (debugHtmlHmr) {
      console.log(
        `[extjs:html-hmr] skip layer resource=${resourcePath} layer=${moduleLayer}`
      )
    }
    return source
  }

  // A framework with its own refresh runtime (React Refresh, the Vue and
  // Svelte loaders) owns the page's updates and its mount point; a page
  // accept here would empty the container underneath it.
  if (
    (options as {frameworkOwnsRefresh?: unknown})?.frameworkOwnsRefresh === true
  ) {
    if (debugHtmlHmr) {
      console.log(
        `[extjs:html-hmr] skip framework-refresh resource=${resourcePath}`
      )
    }
    return source
  }

  // Only a page entry accepts its own update: a module another module
  // imports must let the update bubble to the entry that renders it, or a
  // bare self-accept re-runs the child while the importer keeps the stale
  // binding and the page shows the old text.
  const issuer = (this as unknown as {_module?: {issuer?: unknown}})?._module
    ?.issuer
  if (issuer) {
    if (debugHtmlHmr) {
      console.log(`[extjs:html-hmr] skip child resource=${resourcePath}`)
    }
    return source
  }

  try {
    const manifestPath = String(options?.manifestPath || '')
    const manifestDir = manifestPath ? path.dirname(manifestPath) : ''

    if (manifestPath && resourcePath) {
      const manifest = JSON.parse(
        stripBom(fs.readFileSync(manifestPath, 'utf-8'))
      )
      const contentScripts = Array.isArray(manifest?.content_scripts)
        ? manifest.content_scripts
        : []

      const contentEntryPaths = new Set<string>()

      for (const contentScript of contentScripts) {
        const jsList = Array.isArray(contentScript?.js) ? contentScript.js : []

        for (const jsFile of jsList) {
          contentEntryPaths.add(
            toResourceKey(path.resolve(manifestDir, jsFile))
          )
        }
      }

      if (contentEntryPaths.has(toResourceKey(resourcePath))) {
        if (debugHtmlHmr) {
          console.log(
            `[extjs:html-hmr] skip direct resource=${resourcePath} manifest=${manifestPath}`
          )
        }
        return source
      }
    }
  } catch (error) {
    if (debugHtmlHmr) {
      console.log(
        `[extjs:html-hmr] error resource=${resourcePath} manifest=${String(options?.manifestPath || '')} error=${error instanceof Error ? error.message : String(error)}`
      )
    }
    // Fail silently and keep the HTML HMR path for regular page scripts.
  }

  if (debugHtmlHmr) {
    console.log(
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
  esModuleLexerInit
    .then(() => {
      let hasModuleSyntax = false
      try {
        const [, , , moduleSyntax] = esModuleLexerParse(source)
        hasModuleSyntax = Boolean(moduleSyntax)
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
        console.error('Error clearing HTML containers', err);
      }
    });
  } catch (error) {
    console.error('Error accepting HMR', error);
  }
}
`
}
