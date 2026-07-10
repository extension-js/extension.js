// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import fs from 'fs'
import path from 'path'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import type {LoaderInterface} from '../../../types'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../feature-scripts/contracts'
import {stripBom} from '../../../lib/parse-json-safe'
import {toResourceKey} from '../../../lib/resource-path'

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
  const resourcePath = String((this as any).resourcePath || '')
  const moduleLayer = String((this as any)?._module?.layer || '')

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
      const manifest = JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf-8')))
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

      let issuer = (this as any)?._module?.issuer

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

  // `import.meta` is ONLY legal in module parses. A page script that rspack
  // resolves as `javascript/dynamic` (classic script parse — e.g. any .js in
  // a `"type": "commonjs"` package, which is exactly what the classic-concat
  // pipeline feeds through here) must get the CJS `module.hot` API instead,
  // or the injected guard itself is a parse error that fails the whole dev
  // build. Module and auto parses keep `import.meta.webpackHot` (strict ESM
  // provides no `module` binding).
  const moduleType = String((this as any)?._module?.type || '')
  const hot =
    moduleType === 'javascript/dynamic' ? 'module.hot' : 'import.meta.webpackHot'

  const reloadCode = `
if (${hot}) {
  try {
    // Accept updates for HTML-attached scripts and clear common containers
    ${hot}.accept();
    ${hot}.dispose(function() {
      try {
        var clear = function(el) {
          if (!el) return;
          while (el.firstChild) el.removeChild(el.firstChild);
        };

        // Clear default template container
        clear(document.getElementById('app'));

        // Also clear any extension-root wrappers if present
        var roots = document.querySelectorAll('[data-extension-root]');
        roots.forEach(function(node) {
          clear(node);
        });
      } catch (err) {
        // 'err' is local in this catch, keep for error clarity
        console.error('Error clearing HTML containers', err);
      }
    });
  } catch (error) {
    console.error('Error accepting HMR', error);
  }
}
`
  // Minimal behavior: inject HMR accept wrapper for any handled script
  return `${reloadCode}${source}`
}
