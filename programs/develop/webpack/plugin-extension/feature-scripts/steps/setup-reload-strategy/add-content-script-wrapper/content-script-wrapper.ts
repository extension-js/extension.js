// @ts-nocheck
import fs from 'fs'
import path from 'path'
import {validate} from 'schema-utils'

const schema = {
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

export default function (source) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  const isProd =
    String((options && options.mode) || '').toLowerCase() === 'production'

  validate(schema, options, {
    name: 'scripts:content-script-wrapper',
    baseDataPath: 'options'
  })

  // Inject wrapper for:
  // - declared manifest content scripts
  // - special-folder scripts under /scripts (treated as content-script-like)
  const declaredContentJsAbsPaths = []
  const contentScripts = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts
    : []

  for (const cs of contentScripts) {
    const jsList = Array.isArray(cs?.js) ? cs.js : []
    for (const js of jsList) {
      declaredContentJsAbsPaths.push(path.resolve(projectPath, js))
    }
  }

  const resourceAbsPath = path.normalize(this.resourcePath)
  const isDeclaredContentScript = declaredContentJsAbsPaths.some(
    (abs) => resourceAbsPath === path.normalize(abs)
  )

  const scriptsDir = path.resolve(projectPath, 'scripts')
  const relToScripts = path.relative(scriptsDir, resourceAbsPath)
  const isScriptsFolderScript =
    relToScripts &&
    !relToScripts.startsWith('..') &&
    !path.isAbsolute(relToScripts)

  const isContentScriptLike = isDeclaredContentScript || isScriptsFolderScript

  if (!isContentScriptLike) {
    return source
  }

  const resourceQuery = String(this.resourceQuery || '')
  const isInnerWrapperRequest = /\b__extjs_inner=1\b/.test(resourceQuery)

  if (!isInnerWrapperRequest) {
    if (isProd) {
      // Production: inline wrapper and call default export directly (no dynamic import/HMR)
      if (!isContentScriptLike) {
        return source
      }
      if (!/\bexport\s+default\b/.test(source)) {
        return source
      }
      if (source.includes('__EXTENSIONJS_MOUNT_WRAPPED__')) {
        return source
      }

      // Transform default export into a const
      const replaced = source.replace(
        /\bexport\s+default\b/,
        'const __EXTENSIONJS_default__ ='
      )

      // Try to detect the identifier name of the default-exported function
      let defaultName
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
          this.emitWarning?.(
            new Error(
              `Removed direct call to ${defaultName}() to prevent double mount; wrapper handles mounting.`
            )
          )
        }
      }

      const runtimeProdInline =
        'function __EXTENSIONJS_mount(mount){\n' +
        '  var cleanup;\n' +
        '  function apply(){ cleanup = mount() }\n' +
        "  function unmount(){ if (typeof cleanup === 'function') cleanup() }\n" +
        "  if (typeof document !== 'undefined') {\n" +
        "    if (document.readyState === 'complete') { apply(); }\n" +
        '    else {\n' +
        "      var onReady = function(){ if (document.readyState === 'complete') { document.removeEventListener('readystatechange', onReady); apply(); } };\n" +
        "      document.addEventListener('readystatechange', onReady);\n" +
        '    }\n' +
        '  } else { apply() }\n' +
        '  return unmount;\n' +
        '}\n'

      const injected =
        `${runtimeProdInline}` +
        `${cleaned}\n` +
        `;/* __EXTENSIONJS_MOUNT_WRAPPED__ */\n` +
        `try { __EXTENSIONJS_mount(__EXTENSIONJS_default__) } catch (error) {}\n` +
        `export default __EXTENSIONJS_default__\n`

      return injected
    }

    const innerSpecifier = JSON.stringify(
      this.resourcePath.replace(/\\/g, '/') + '?__extjs_inner=1'
    )

    const proxyCode = [
      '/* extension.js content script proxy */',
      // With devServer.hot=true, the dev-server client can fall back to liveReload
      // when HMR can't apply updates (common right after syntax errors).
      // In content script contexts (http/https pages) that becomes an infinite reload loop.
      //
      // NOTE: The infinite reload loop is triggered by the HMR runtime (`hot/dev-server`)
      // calling `window.location.reload()` when updates can't be applied (common after syntax errors).
      // In browsers, `location.reload` is generally non-writable, but the prototype method can be patched.
      // This is dev-only and only for non-extension pages, to avoid breaking extension pages behavior.
      'try {',
      "  if (typeof location === 'object' && location && !String(location.protocol || '').includes('-extension:')) {",
      "    var __extjsProto = (typeof Object === 'function' && Object.getPrototypeOf) ? Object.getPrototypeOf(location) : null;",
      "    if (__extjsProto && typeof __extjsProto.reload === 'function' && !__extjsProto.__extjsReloadPatched) {",
      '      __extjsProto.__extjsReloadPatched = true;',
      '      __extjsProto.__extjsOrigReload = __extjsProto.reload;',
      '      __extjsProto.reload = function(){',
      "        try { console.warn('[extension.js] blocked HMR-triggered location.reload() in content script context to prevent infinite reload loop. Fix the syntax error and HMR will recover on next successful compile.'); } catch (error) {}",
      '      };',
      '    }',
      '  }',
      '} catch (error) {',
      '  // Do nothing',
      '}',
      'function loadInnerWrappedModule(){',
      `  try { import(/* webpackMode: "eager" */ ${innerSpecifier}).catch(function(e){ console.warn('[extension.js] content script failed to load. waiting for next successful compile', e) }) } catch (e) { console.warn('[extension.js] content script failed to load. waiting for next successful compile', e) }`,
      '}',
      'loadInnerWrappedModule()',
      // NOTE: This proxy module may be parsed as classic script (non-ESM) depending on bundler settings.
      // Avoid `import.meta` and `export {}` here; use `module.hot` to integrate with HMR in script mode.
      'try {',
      '  var hotModuleReplacement = (typeof module !== "undefined" && module && module.hot) ? module.hot : null;',
      '  if (hotModuleReplacement) {',
      '    var isExtensionJsDisposed = false;',
      '    if (typeof hotModuleReplacement.dispose === "function") hotModuleReplacement.dispose(function(){ isExtensionJsDisposed = true });',
      '    // Accept updates, but avoid triggering reload from inside accept callback',
      '    // (it can run during disposal and cause "[HMR] unexpected require(...) from disposed module" warnings).',
      '    if (typeof hotModuleReplacement.accept === "function") hotModuleReplacement.accept();',
      '    if (typeof hotModuleReplacement.addStatusHandler === "function") hotModuleReplacement.addStatusHandler(function(status){ if (isExtensionJsDisposed) return; if (status === "idle") loadInnerWrappedModule(); });',
      '  }',
      '} catch (error) {}'
    ].join('\n')
    return proxyCode
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
    '  function apply(){ cleanup = mount() }\n' +
    "  function unmount(){ if (typeof cleanup === 'function') cleanup() }\n" +
    '  function remount(){ unmount(); apply(); }\n' +
    "  if (typeof document !== 'undefined') {\n" +
    "    if (document.readyState === 'complete') { apply(); }\n" +
    '    else {\n' +
    "      var onReady = function(){ if (document.readyState === 'complete') { document.removeEventListener('readystatechange', onReady); apply(); } };\n" +
    "      document.addEventListener('readystatechange', onReady);\n" +
    '    }\n' +
    '  } else { apply() }\n' +
    '  if (import.meta.webpackHot) {\n' +
    '    if (typeof import.meta.webpackHot.accept === "function") import.meta.webpackHot.accept();\n' +
    '    if (typeof import.meta.webpackHot.dispose === "function") import.meta.webpackHot.dispose(unmount);\n' +
    '    if (typeof import.meta.webpackHot.addStatusHandler === "function") {\n' +
    "      import.meta.webpackHot.addStatusHandler(function(s){ if (s==='abort'||s==='fail') { console.warn('[extension.js] HMR status:', s) } });\n" +
    '    }\n' +
    '  }\n' +
    "  var cssEvt='__EXTENSIONJS_CSS_UPDATE__';\n" +
    '  var onCss=function(){ remount() };\n' +
    '  window.addEventListener(cssEvt, onCss);\n' +
    '  return function(){ window.removeEventListener(cssEvt, onCss); unmount(); };\n' +
    '}\n'

  // Guard: if default export is an invocation (e.g., export default init())
  // and not a function declaration, skip injection to avoid executing user code twice
  if (
    /\bexport\s+default\s+[A-Za-z_$][\w$]*\s*\(/.test(source) &&
    !/\bexport\s+default\s+function\b/.test(source)
  ) {
    this.emitWarning?.(
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
  let defaultName
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
      this.emitWarning?.(
        new Error(
          `Removed direct call to ${defaultName}() to prevent double mount; wrapper handles mounting.`
        )
      )
    }
  }

  const cssAccepts = cssSpecifiers.length
    ? `\ntry {\n  if (import.meta.webpackHot) {\n    ${cssSpecifiers
        .map(
          (s) =>
            `import.meta.webpackHot.accept(${JSON.stringify(
              s
            )}, () => { try { window.dispatchEvent(new CustomEvent('__EXTENSIONJS_CSS_UPDATE__')) } catch (error) {} })`
        )
        .join('\n    ')}\n  }\n} catch (error) {}\n`
    : ''

  const injected =
    `${runtimeInline}` +
    `${cleaned}\n` +
    `;/* __EXTENSIONJS_MOUNT_WRAPPED__ */\n` +
    `try { __EXTENSIONJS_mountWithHMR(__EXTENSIONJS_default__) } catch (error) {}\n` +
    `${cssAccepts}` +
    `export default __EXTENSIONJS_default__\n`

  return injected
}
