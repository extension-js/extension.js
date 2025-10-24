import fs from 'fs'
import path from 'path'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import {type LoaderContext} from '../../../../../webpack-types'

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string'
    },
    manifestPath: {
      type: 'string'
    },
    mode: {
      type: 'string'
    }
  }
}

export default function (this: LoaderContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

  validate(schema, options, {
    name: 'scripts:content-script-wrapper',
    baseDataPath: 'options'
  })

  // Inject wrapper only for declared content scripts
  const declaredContentJsAbsPaths: string[] = []
  const contentScripts = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts
    : []

  for (const cs of contentScripts) {
    const jsList = Array.isArray(cs?.js) ? cs.js : []
    for (const js of jsList) {
      declaredContentJsAbsPaths.push(path.resolve(projectPath, js as string))
    }
  }

  const resourceAbsPath = path.normalize(this.resourcePath)
  const isDeclaredContentScript = declaredContentJsAbsPaths.some(
    (abs) => resourceAbsPath === path.normalize(abs)
  )

  if (!isDeclaredContentScript) {
    return source
  }

  // Only proceed if a default export exists; a sibling loader warns if missing
  if (!/\bexport\s+default\b/.test(source)) {
    return source
  }

  // Avoid double injection
  if (source.includes('__EXTENSIONJS_MOUNT_WRAPPED__')) {
    return source
  }

  // Detect static CSS imports to wire accept callbacks that trigger remount
  const cssImportMatches = Array.from(
    source.matchAll(
      /import\s+(?:['\"](?<bare>[^'\"]+\.(css|sass|scss|less))['\"]|(?:(?:.+?)\s+from\s+['\"](?<from>[^'\"]+\.(css|sass|scss|less))['\"]))/g
    )
  )
  const cssSpecifiers = cssImportMatches.map(
    (m) => (m.groups?.bare || m.groups?.from) as string
  )

  // Inline runtime helper to avoid cross-context import resolution
  const runtimeInline =
    'function __EXTENSIONJS_mountWithHMR(mount){\n' +
    '  var cleanup;\n' +
    '  function apply(){ try { cleanup = mount() } catch(e){} }\n' +
    "  function unmount(){ try { typeof cleanup === 'function' && cleanup() } catch(e){} }\n" +
    '  function remount(){ unmount(); apply(); }\n' +
    "  if (typeof document !== 'undefined') {\n" +
    "    if (document.readyState === 'complete') { apply(); }\n" +
    '    else {\n' +
    "      var onReady = function(){ try { if (document.readyState === 'complete') { document.removeEventListener('readystatechange', onReady); apply(); } } catch(e){} };\n" +
    "      document.addEventListener('readystatechange', onReady);\n" +
    '    }\n' +
    '  } else { try { apply(); } catch(e){} }\n' +
    '  try {\n' +
    '    if (import.meta && import.meta.webpackHot) {\n' +
    '      try { import.meta.webpackHot.accept(); import.meta.webpackHot.dispose(unmount); } catch(e){}\n' +
    '    }\n' +
    '  } catch(e){}\n' +
    "  var cssEvt='__EXTENSIONJS_CSS_UPDATE__';\n" +
    '  var onCss=function(){ try { remount(); } catch(e){} };\n' +
    '  try { window.addEventListener(cssEvt, onCss); } catch(e){}\n' +
    '  return function(){ try { window.removeEventListener(cssEvt, onCss); } catch(e){}; unmount(); };\n' +
    '}\n'

  // Guard: if default export is an invocation (e.g., export default init())
  // and not a function declaration, skip injection to avoid executing user code twice
  if (
    /\bexport\s+default\s+[A-Za-z_$][\w$]*\s*\(/.test(source) &&
    !/\bexport\s+default\s+function\b/.test(source)
  ) {
    ;(this as any).emitWarning?.(
      new Error(
        'Default export appears to be an invocation. Export a function reference instead: `export default function init(){}` or `export default init`.'
      )
    )
    return source
  }

  // Transform default export into a const, then optionally strip a bare call
  const replaced = source.replace(
    /\bexport\s+default\b/,
    'const __EXTENSIONJS_default__ ='
  )

  // Try to detect the identifier name of the default-exported function
  // Supported forms:
  //  - export default function NAME(...) { ... }
  //  - export default NAME
  let defaultName: string | undefined
  {
    const m1 = source.match(
      /\bexport\s+default\s+function\s+([A-Za-z_$][\w$]*)\s*\(/
    )
    if (m1) {
      defaultName = m1[1]
    } else {
      const m2 = source.match(/\bexport\s+default\s+([A-Za-z_$][\w$]*)\b/)
      if (m2) defaultName = m2[1]
    }
  }

  // Remove a top-level direct call to the default-exported function to prevent double mounting
  let cleaned = replaced
  if (defaultName) {
    const callPattern = new RegExp(
      `(^|\\n|;)\\s*${defaultName}\\s*\\(\\s*\\)\\s*;?\\s*(?=\\n|$)`,
      'g'
    )
    const next = cleaned.replace(callPattern, (_m, p1) => p1 || '\n')
    if (next !== cleaned) {
      cleaned = next
      ;(this as any).emitWarning?.(
        new Error(
          `Removed direct call to ${defaultName}() to prevent double mount; wrapper handles mounting.`
        )
      )
    }
  }

  const cssAccepts = cssSpecifiers.length
    ? `\ntry {\n  if (import.meta && import.meta.webpackHot) {\n    ${cssSpecifiers
        .map(
          (s) =>
            `import.meta.webpackHot.accept(${JSON.stringify(
              s
            )}, () => { try { window.dispatchEvent(new CustomEvent('__EXTENSIONJS_CSS_UPDATE__')) } catch {} })`
        )
        .join('\n    ')}\n  }\n} catch {}\n`
    : ''

  const injected =
    `${runtimeInline}` +
    `${cleaned}\n` +
    `;/* __EXTENSIONJS_MOUNT_WRAPPED__ */\n` +
    `try { __EXTENSIONJS_mountWithHMR(__EXTENSIONJS_default__) } catch {}\n` +
    `${cssAccepts}` +
    `export default __EXTENSIONJS_default__\n`

  return injected
}
