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
    }
  },
  additionalProperties: false
}

export default function ensureHMRForScripts(
  this: LoaderInterface,
  source: string
) {
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

      interface IssuerLike {
        resource?: unknown
        userRequest?: unknown
        issuer?: IssuerLike | null
      }
      let issuer = (this as unknown as {_module?: {issuer?: IssuerLike | null}})
        ?._module?.issuer

      while (issuer) {
        const issuerResource = String(
          issuer?.resource || issuer?.userRequest || ''
        )

        if (
          issuerResource &&
          contentEntryPaths.has(toResourceKey(issuerResource))
        ) {
          if (debugHtmlHmr) {
            console.log(
              `[extjs:html-hmr] skip issuer resource=${resourcePath} issuer=${issuerResource}`
            )
          }

          return source
        }
        issuer = issuer?.issuer
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
    return `${buildReloadCode('module.hot')}${source}`
  }
  if (moduleType === 'javascript/esm') {
    return `${buildReloadCode('import.meta.webpackHot')}${source}`
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
      callback(
        null,
        `${buildReloadCode(hasModuleSyntax ? 'import.meta.webpackHot' : 'module.hot')}${source}`
      )
    })
    .catch(() => {
      callback(null, `${buildReloadCode('module.hot')}${source}`)
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

        clear(document.getElementById('app'));

        var roots = document.querySelectorAll('[data-extension-root]');
        roots.forEach(function(node) {
          clear(node);
        });
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
