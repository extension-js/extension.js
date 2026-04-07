// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

// @ts-nocheck
import fs from 'fs'
import path from 'path'
import {validate} from 'schema-utils'
import {parseSync} from '@swc/core'
import {
  CANONICAL_CONTENT_SCRIPT_ENTRY_PREFIX,
  getCanonicalContentScriptEntryName
} from '../../../contracts'
import {findNearestPackageJsonSync} from '../../../scripts-lib/package-json'

const schema = {
  type: 'object',
  properties: {
    manifestPath: {type: 'string'},
    mode: {type: 'string'}
  }
}

function getSourceSignature(source) {
  const head = String(source || '').slice(0, 64)
  const tail = String(source || '').slice(-64)
  return `${String(source || '').length}:${head}:${tail}`
}

function createBuildToken(source) {
  let hash = 0
  for (let index = 0; index < source.length; index++) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0
  }
  return hash.toString(16)
}

function collectStyleAssetSpecifiers(source) {
  const styleSpecifiers = new Set()
  const patterns = [
    /import\s+(?:[^'"`]*from\s*)?["']([^"'`]+\.(?:css|scss|sass|less|styl)(?:\?[^"'`]+)?)["']/g,
    /require\(\s*["']([^"'`]+\.(?:css|scss|sass|less|styl)(?:\?[^"'`]+)?)["']\s*\)/g
  ]

  for (const pattern of patterns) {
    let match = pattern.exec(source)
    while (match) {
      const specifier = String(match[1] || '').trim()
      if (
        specifier &&
        !/(?:^|[?&])url(?:[=&]|$)/.test(specifier) &&
        !/(?:^|[?&])raw(?:[=&]|$)/.test(specifier)
      ) {
        styleSpecifiers.add(specifier)
      }
      match = pattern.exec(source)
    }
  }

  return Array.from(styleSpecifiers)
}

function hasDefaultExport(source, resourcePath, compilation) {
  try {
    const ext = path.extname(resourcePath).toLowerCase()
    const isTS =
      ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.mtsx'
    const isJSX =
      ext === '.jsx' || ext === '.tsx' || ext === '.mjsx' || ext === '.mtsx'

    const abs = path.normalize(resourcePath)
    const sig = getSourceSignature(source)
    if (compilation) {
      compilation.__extjsHasDefaultExportCache ??= new Map()
      const cacheKey = `${abs}|${sig}`
      const cached = compilation.__extjsHasDefaultExportCache.get(cacheKey)
      if (typeof cached === 'boolean') return cached
    }

    const ast = parseSync(source, {
      syntax: isTS ? 'typescript' : 'ecmascript',
      tsx: isTS && isJSX,
      jsx: !isTS && isJSX,
      decorators: true,
      dynamicImport: true,
      importAssertions: true,
      topLevelAwait: true
    })

    const body = Array.isArray(ast?.body) ? ast.body : []
    for (const item of body) {
      if (!item || typeof item !== 'object') continue
      if (
        item.type === 'ExportDefaultDeclaration' ||
        item.type === 'ExportDefaultExpression'
      ) {
        compilation?.__extjsHasDefaultExportCache?.set(`${abs}|${sig}`, true)
        return true
      }
      if (
        item.type === 'ExportNamedDeclaration' &&
        Array.isArray(item.specifiers)
      ) {
        for (const specifier of item.specifiers) {
          if (!specifier || typeof specifier !== 'object') continue
          if (specifier.type === 'ExportDefaultSpecifier') {
            compilation?.__extjsHasDefaultExportCache?.set(
              `${abs}|${sig}`,
              true
            )
            return true
          }

          if (specifier.type === 'ExportSpecifier') {
            const exported = specifier.exported
            if (
              exported &&
              typeof exported === 'object' &&
              ((exported.type === 'Identifier' &&
                exported.value === 'default') ||
                (exported.type === 'Ident' && exported.value === 'default') ||
                (exported.type === 'Str' && exported.value === 'default'))
            ) {
              compilation?.__extjsHasDefaultExportCache?.set(
                `${abs}|${sig}`,
                true
              )
              return true
            }
          }
        }
      }
    }

    compilation?.__extjsHasDefaultExportCache?.set(`${abs}|${sig}`, false)
    return false
  } catch {
    const fallback = source.includes('export default')
    try {
      compilation?.__extjsHasDefaultExportCache?.set(
        `${path.normalize(resourcePath)}|${getSourceSignature(source)}`,
        fallback
      )
    } catch {}
    return fallback
  }
}

export default function contentScriptWrapper(source) {
  const options = this.getOptions()
  validate(schema, options, {
    name: 'scripts:content-script-wrapper',
    baseDataPath: 'options'
  })

  const compilation = this._compilation
  const manifestPath = options.manifestPath
  const manifestDir = path.dirname(manifestPath)
  const packageJsonPath = findNearestPackageJsonSync(manifestPath)
  const packageJsonDir = packageJsonPath
    ? path.dirname(packageJsonPath)
    : manifestDir
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  const isProd =
    String((options && options.mode) || '').toLowerCase() === 'production'
  const rewrittenSource = String(source)

  const declaredContentJsAbsEntries = []
  const contentScripts = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts
    : []

  for (let index = 0; index < contentScripts.length; index++) {
    const contentScript = contentScripts[index]
    const jsList = Array.isArray(contentScript?.js) ? contentScript.js : []
    const runAtRaw =
      typeof contentScript?.run_at === 'string'
        ? contentScript.run_at
        : 'document_idle'
    const runAt =
      runAtRaw === 'document_start' ||
      runAtRaw === 'document_end' ||
      runAtRaw === 'document_idle'
        ? runAtRaw
        : 'document_idle'

    for (let scriptIndex = 0; scriptIndex < jsList.length; scriptIndex++) {
      const jsFile = jsList[scriptIndex]
      declaredContentJsAbsEntries.push({
        abs: path.resolve(manifestDir, jsFile),
        runAt,
        index,
        scriptIndex
      })
    }
  }

  const resourceAbsPath = path.normalize(this.resourcePath)
  const declaredEntry = declaredContentJsAbsEntries.find(
    (entry) => resourceAbsPath === path.normalize(entry.abs)
  )

  const scriptsDir = path.resolve(packageJsonDir, 'scripts')
  const relToScripts = path.relative(scriptsDir, resourceAbsPath)
  const isScriptsFolderScript =
    relToScripts &&
    !relToScripts.startsWith('..') &&
    !path.isAbsolute(relToScripts)
  const isContentScriptLike = Boolean(declaredEntry || isScriptsFolderScript)

  if (!isContentScriptLike) {
    return rewrittenSource
  }

  const runAt = declaredEntry?.runAt || 'document_idle'
  const bundleKey = declaredEntry
    ? getCanonicalContentScriptEntryName(declaredEntry.index)
    : `scripts/${String(relToScripts || '').replace(/\\/g, '/')}`
  const reinjectKey = declaredEntry
    ? `${bundleKey}::script-${declaredEntry.scriptIndex}`
    : bundleKey
  const buildToken = createBuildToken(rewrittenSource)
  const cssAssetSpecifiers = collectStyleAssetSpecifiers(rewrittenSource)
  const cssAssetUrlsInline = `var __EXTENSIONJS_BUNDLE_CSS_URLS=[${cssAssetSpecifiers
    .map(
      (specifier) =>
        `(function(){ try { return String(new URL(${JSON.stringify(
          specifier
        )}, import.meta.url)); } catch (error) { return ""; } })()`
    )
    .join(',')}];\n`

  const bundleCssHydrationInline =
    'function __EXTENSIONJS_runtimeGetURL(path){\n' +
    '  try {\n' +
    '    if (typeof globalThis === "object" && globalThis && globalThis.browser && globalThis.browser.runtime && typeof globalThis.browser.runtime.getURL === "function") return globalThis.browser.runtime.getURL(path);\n' +
    '    if (typeof globalThis === "object" && globalThis && globalThis.chrome && globalThis.chrome.runtime && typeof globalThis.chrome.runtime.getURL === "function") return globalThis.chrome.runtime.getURL(path);\n' +
    '  } catch (error) {}\n' +
    '  try {\n' +
    '    var base = (typeof globalThis === "object" && globalThis && globalThis.__EXTJS_EXTENSION_BASE__) ? String(globalThis.__EXTJS_EXTENSION_BASE__) : "";\n' +
    '    if (!base && typeof document === "object" && document && document.documentElement) base = String(document.documentElement.getAttribute("data-extjs-extension-base") || "");\n' +
    '    if (!base) return "";\n' +
    '    return base.replace(/\\/+$/, "/") + String(path || "").replace(/^\\/+/, "");\n' +
    '  } catch (error) {}\n' +
    '  return "";\n' +
    '}\n' +
    'function __EXTENSIONJS_scheduleBundleCssHydration(){\n' +
    '  try {\n' +
    `    if (String(__EXTENSIONJS_BUNDLE_KEY || "").indexOf(${JSON.stringify(CANONICAL_CONTENT_SCRIPT_ENTRY_PREFIX)}) !== 0) return;\n` +
    '    if (typeof document === "undefined" || typeof fetch !== "function") return;\n' +
    '    var cssUrls = Array.from(new Set((Array.isArray(__EXTENSIONJS_BUNDLE_CSS_URLS) ? __EXTENSIONJS_BUNDLE_CSS_URLS : []).concat([__EXTENSIONJS_runtimeGetURL(__EXTENSIONJS_BUNDLE_KEY + ".css")]).filter(function(value){ return typeof value === "string" && value.trim().length > 0; })));\n' +
    '    if (!cssUrls.length) return;\n' +
    '    var cssText = "";\n' +
    '    var cssPromise = null;\n' +
    '    var readCss = function(){\n' +
    '      if (cssPromise) return cssPromise;\n' +
    '      cssPromise = (function fetchCandidate(index){\n' +
    '        if (index >= cssUrls.length) return Promise.resolve("");\n' +
    '        return fetch(cssUrls[index]).then(function(response){\n' +
    '          if (!response || !response.ok) return "";\n' +
    '          return response.text();\n' +
    '        }).catch(function(){\n' +
    '          return "";\n' +
    '        }).then(function(text){\n' +
    '          if (typeof text === "string" && text.trim().length > 0) return text;\n' +
    '          return fetchCandidate(index + 1);\n' +
    '        });\n' +
    '      })(0).then(function(text){\n' +
    '        cssText = typeof text === "string" ? text : "";\n' +
    '        try { setTimeout(tick, 0); } catch (error) {}\n' +
    '        return cssText;\n' +
    '      }).catch(function(){ return ""; });\n' +
    '      return cssPromise;\n' +
    '    };\n' +
    '    var tries = 0;\n' +
    '    var tick = function(){\n' +
    '      try {\n' +
    '        var hosts = Array.from(document.querySelectorAll("#extension-root,[data-extension-root]:not([data-extension-root=\\"extension-js-devtools\\"])"));\n' +
    '        for (var i = 0; i < hosts.length; i++) {\n' +
    '          var host = hosts[i];\n' +
    '          if (!host || !host.shadowRoot || typeof host.getAttribute !== "function") continue;\n' +
    '          var hostOwner = String(host.getAttribute("data-extjs-reinject-owner") || "");\n' +
    '          if (hostOwner && hostOwner !== String(__EXTENSIONJS_REINJECT_KEY || "")) continue;\n' +
    '          if (!hostOwner && String(host.getAttribute("data-extjs-reinject-key") || "") && String(host.getAttribute("data-extjs-reinject-key") || "") !== String(__EXTENSIONJS_BUNDLE_KEY || "")) continue;\n' +
    '          var sr = host.shadowRoot;\n' +
    '          var styles = Array.from(sr.querySelectorAll("style"));\n' +
    '          var hasUserStyle = styles.some(function(styleEl){\n' +
    '            return styleEl && styleEl.getAttribute("data-extjs-bundle-css") !== "true" && String(styleEl.textContent || "").trim().length > 0;\n' +
    '          });\n' +
    '          var injected = sr.querySelector("style[data-extjs-bundle-css=\\"true\\"]");\n' +
    '          if (hasUserStyle) {\n' +
    '            if (injected && injected.parentNode) injected.parentNode.removeChild(injected);\n' +
    '            return;\n' +
    '          }\n' +
    '          if (typeof cssText === "string" && cssText.trim()) {\n' +
    '            if (!injected) {\n' +
    '              injected = document.createElement("style");\n' +
    '              injected.setAttribute("data-extjs-bundle-css", "true");\n' +
    '              injected.setAttribute("data-extjs-reinject-key", String(__EXTENSIONJS_REINJECT_KEY || ""));\n' +
    '              sr.insertBefore(injected, sr.firstChild || null);\n' +
    '            }\n' +
    '            if (String(injected.textContent || "") !== cssText) injected.textContent = cssText;\n' +
    '            return;\n' +
    '          }\n' +
    '        }\n' +
    '      } catch (error) {}\n' +
    '      if (tries++ < 20) {\n' +
    '        if (!cssPromise) readCss();\n' +
    '        setTimeout(tick, 250);\n' +
    '      }\n' +
    '    };\n' +
    '    tick();\n' +
    '  } catch (error) {}\n' +
    '}\n'

  const bootstrap =
    `var __EXTENSIONJS_BUNDLE_KEY=${JSON.stringify(bundleKey)};\n` +
    `var __EXTENSIONJS_REINJECT_KEY=${JSON.stringify(reinjectKey)};\n` +
    `var __EXTENSIONJS_REINJECT_BUILD_TOKEN=${JSON.stringify(buildToken)};\n` +
    `var __EXTENSIONJS_DEV_MARKERS_ENABLED=${JSON.stringify(!isProd)};\n` +
    `${cssAssetUrlsInline}` +
    'var __EXTENSIONJS_REINJECT_REGISTRY=(typeof globalThis==="object" && globalThis ? (globalThis.__EXTENSIONJS_DEV_REINJECT__ || (globalThis.__EXTENSIONJS_DEV_REINJECT__={})) : {});\n' +
    'var __EXTENSIONJS_REGISTERED_CLEANUPS=[];\n' +
    'function __EXTENSIONJS_readReinjectGeneration(entry){\n' +
    '  try {\n' +
    '    if (!entry) return 0;\n' +
    '    if (typeof entry === "function" && typeof entry.__extjsGeneration === "number") return entry.__extjsGeneration;\n' +
    '    if (typeof entry === "object") {\n' +
    '      if (typeof entry.__extjsGeneration === "number") return entry.__extjsGeneration;\n' +
    '      if (typeof entry.generation === "number") return entry.generation;\n' +
    '      if (typeof entry.cleanup === "function" && typeof entry.cleanup.__extjsGeneration === "number") return entry.cleanup.__extjsGeneration;\n' +
    '    }\n' +
    '  } catch (error) {}\n' +
    '  return 0;\n' +
    '}\n' +
    'function __EXTENSIONJS_runCleanups(list){\n' +
    '  try {\n' +
    '    if (!Array.isArray(list)) return;\n' +
    '    for (var i = list.length - 1; i >= 0; i--) {\n' +
    '      try { if (typeof list[i] === "function") list[i](); } catch (error) {}\n' +
    '    }\n' +
    '  } catch (error) {}\n' +
    '}\n' +
    'function __EXTENSIONJS_registerCleanup(fn){\n' +
    '  if (typeof fn === "function") __EXTENSIONJS_REGISTERED_CLEANUPS.push(fn);\n' +
    '  return fn;\n' +
    '}\n' +
    'function __EXTENSIONJS_setReinjectMarker(key, generation, status){\n' +
    '  try {\n' +
    '    if (!__EXTENSIONJS_DEV_MARKERS_ENABLED || typeof document === "undefined") return;\n' +
    '    var root = document.body || document.documentElement;\n' +
    '    if (!root) return;\n' +
    '    var marker = null;\n' +
    '    try {\n' +
    '      var markers = Array.from(document.querySelectorAll("[data-extjs-reinject-marker=\\"true\\"]"));\n' +
    '      for (var i = 0; i < markers.length; i++) {\n' +
    '        var current = markers[i];\n' +
    '        if (current && typeof current.getAttribute === "function" && current.getAttribute("data-extjs-reinject-key") === key) { marker = current; break; }\n' +
    '      }\n' +
    '    } catch (error) {}\n' +
    '    if (!marker && typeof document.createElement === "function") {\n' +
    '      marker = document.createElement("div");\n' +
    '      marker.setAttribute("data-extjs-reinject-marker", "true");\n' +
    '      marker.setAttribute("hidden", "");\n' +
    '      marker.setAttribute("aria-hidden", "true");\n' +
    '      try { marker.style.display = "none"; } catch (error) {}\n' +
    '      root.appendChild(marker);\n' +
    '    }\n' +
    '    if (!marker) return;\n' +
    '    marker.setAttribute("data-extjs-reinject-key", String(__EXTENSIONJS_BUNDLE_KEY || key || ""));\n' +
    '    marker.setAttribute("data-extjs-reinject-generation", String(generation));\n' +
    '    marker.setAttribute("data-extjs-reinject-status", String(status || "mounted"));\n' +
    '    marker.setAttribute("data-extjs-reinject-build", String(__EXTENSIONJS_REINJECT_BUILD_TOKEN || ""));\n' +
    '    try { marker.textContent = String(__EXTENSIONJS_BUNDLE_KEY || key || "") + ":" + String(generation) + ":" + String(status || "mounted"); } catch (error) {}\n' +
    '    try {\n' +
    '      var roots = Array.from(document.querySelectorAll("#extension-root,[data-extension-root]:not([data-extension-root=\\"extension-js-devtools\\"])"));\n' +
    '      var ownedRootCount = 0;\n' +
    '      for (var j = 0; j < roots.length; j++) {\n' +
    '        var host = roots[j];\n' +
    '        if (!host || typeof host.setAttribute !== "function") continue;\n' +
    '        var hostOwner = String(host.getAttribute("data-extjs-reinject-owner") || "");\n' +
    '        if (hostOwner && hostOwner !== String(__EXTENSIONJS_REINJECT_KEY || "")) continue;\n' +
    '        ownedRootCount++;\n' +
    '        host.setAttribute("data-extjs-reinject-owner", String(__EXTENSIONJS_REINJECT_KEY || ""));\n' +
    '        host.setAttribute("data-extjs-reinject-key", String(__EXTENSIONJS_BUNDLE_KEY || key || ""));\n' +
    '        host.setAttribute("data-extjs-reinject-generation", String(generation));\n' +
    '        host.setAttribute("data-extjs-reinject-status", String(status || "mounted"));\n' +
    '        host.setAttribute("data-extjs-reinject-build", String(__EXTENSIONJS_REINJECT_BUILD_TOKEN || ""));\n' +
    '        try {\n' +
    '          if (!host.__extjsDebugRemovePatched) {\n' +
    '            host.__extjsDebugRemovePatched = true;\n' +
    '            var __extjsOriginalRemove = typeof host.remove === "function" ? host.remove.bind(host) : null;\n' +
    '            if (__extjsOriginalRemove) {\n' +
    '              host.remove = function(){\n' +
    '                try {\n' +
    '                  var pageRoot = document.documentElement;\n' +
    '                  if (pageRoot && typeof pageRoot.setAttribute === "function") {\n' +
    '                    pageRoot.setAttribute("data-extjs-debug-stage", "root-remove-called");\n' +
    '                    pageRoot.setAttribute("data-extjs-debug-last-removal", "remove()");\n' +
    '                    pageRoot.setAttribute("data-extjs-debug-last-removal-key", String(__EXTENSIONJS_REINJECT_KEY || ""));\n' +
    '                    pageRoot.setAttribute("data-extjs-debug-last-removal-source", "patched-host-remove");\n' +
    '                  }\n' +
    '                } catch (error) {}\n' +
    '                return __extjsOriginalRemove();\n' +
    '              };\n' +
    '            }\n' +
    '          }\n' +
    '        } catch (error) {}\n' +
    '      }\n' +
    '      try {\n' +
    '        marker.setAttribute("data-extjs-debug-stage", String(status || ""));\n' +
    '        marker.setAttribute("data-extjs-debug-root-count", String(roots.length));\n' +
    '        marker.setAttribute("data-extjs-debug-owned-root-count", String(ownedRootCount));\n' +
    '        marker.setAttribute("data-extjs-debug-marker-count", String(markers.length));\n' +
    '      } catch (error) {}\n' +
    '    } catch (error) {}\n' +
    '    try {\n' +
    '      var pageRoot = document.documentElement;\n' +
    '      if (pageRoot && typeof pageRoot.setAttribute === "function") {\n' +
    '        pageRoot.setAttribute("data-extjs-last-reinject-key", String(__EXTENSIONJS_BUNDLE_KEY || key || ""));\n' +
    '        pageRoot.setAttribute("data-extjs-last-reinject-generation", String(generation));\n' +
    '        pageRoot.setAttribute("data-extjs-last-reinject-status", String(status || "mounted"));\n' +
    '        pageRoot.setAttribute("data-extjs-last-reinject-build", String(__EXTENSIONJS_REINJECT_BUILD_TOKEN || ""));\n' +
    '        pageRoot.setAttribute("data-extjs-debug-stage", marker.getAttribute("data-extjs-debug-stage") || String(status || ""));\n' +
    '        pageRoot.setAttribute("data-extjs-debug-root-count", marker.getAttribute("data-extjs-debug-root-count") || "0");\n' +
    '        pageRoot.setAttribute("data-extjs-debug-owned-root-count", marker.getAttribute("data-extjs-debug-owned-root-count") || "0");\n' +
    '        pageRoot.setAttribute("data-extjs-debug-marker-count", marker.getAttribute("data-extjs-debug-marker-count") || "0");\n' +
    '      }\n' +
    '    } catch (error) {}\n' +
    '  } catch (error) {}\n' +
    '}\n' +
    'function __EXTENSIONJS_debugObserveOwnedRootRemoval(){\n' +
    '  try {\n' +
    '    if (typeof globalThis !== "object" || !globalThis || globalThis.__EXTJS_DEBUG_REMOVAL_OBSERVER__) return;\n' +
    '    if (typeof MutationObserver !== "function" || typeof document === "undefined") return;\n' +
    '    var target = document.documentElement || document.body || document;\n' +
    '    if (!target) return;\n' +
    '    var observer = new MutationObserver(function(records){\n' +
    '      try {\n' +
    '        var ownedKey = String(__EXTENSIONJS_REINJECT_KEY || "");\n' +
    '        var findOwnedRoot = function(node){\n' +
    '          try {\n' +
    '            if (!node || node.nodeType !== 1) return null;\n' +
    '            if (typeof node.getAttribute === "function" && String(node.getAttribute("data-extjs-reinject-owner") || "") === ownedKey) return node;\n' +
    '            if (typeof node.querySelector === "function") {\n' +
    '              return node.querySelector("[data-extjs-reinject-owner=\\"" + ownedKey.replace(/"/g, "\\\\\\"") + "\\"]");\n' +
    '            }\n' +
    '          } catch (error) {}\n' +
    '          return null;\n' +
    '        };\n' +
    '        for (var r = 0; r < records.length; r++) {\n' +
    '          var removedNodes = Array.from(records[r].removedNodes || []);\n' +
    '          for (var n = 0; n < removedNodes.length; n++) {\n' +
    '            var node = removedNodes[n];\n' +
    '            var ownedRoot = findOwnedRoot(node);\n' +
    '            if (!ownedRoot || typeof ownedRoot.getAttribute !== "function") continue;\n' +
    '            var owner = String(ownedRoot.getAttribute("data-extjs-reinject-owner") || "");\n' +
    '            if (!owner || owner !== ownedKey) continue;\n' +
    '            var pageRoot = document.documentElement;\n' +
    '            if (pageRoot && typeof pageRoot.setAttribute === "function") {\n' +
    '              if (!pageRoot.getAttribute("data-extjs-debug-last-removal")) pageRoot.setAttribute("data-extjs-debug-last-removal", "mutation-observer");\n' +
    '              if (!pageRoot.getAttribute("data-extjs-debug-last-removal-key")) pageRoot.setAttribute("data-extjs-debug-last-removal-key", owner);\n' +
    '              if (!pageRoot.getAttribute("data-extjs-debug-last-removal-source")) pageRoot.setAttribute("data-extjs-debug-last-removal-source", "mutation-observer");\n' +
    '              if (!pageRoot.getAttribute("data-extjs-debug-last-removed-node-tag")) pageRoot.setAttribute("data-extjs-debug-last-removed-node-tag", String(node.tagName || "").toLowerCase());\n' +
    '              if (!pageRoot.getAttribute("data-extjs-debug-last-removed-node-id")) pageRoot.setAttribute("data-extjs-debug-last-removed-node-id", String(node.id || ""));\n' +
    '              if (!pageRoot.getAttribute("data-extjs-debug-last-removed-node-class")) pageRoot.setAttribute("data-extjs-debug-last-removed-node-class", String(node.className || ""));\n' +
    '              if (!pageRoot.getAttribute("data-extjs-debug-last-removed-node-direct")) pageRoot.setAttribute("data-extjs-debug-last-removed-node-direct", String(node === ownedRoot));\n' +
    '              if (!pageRoot.getAttribute("data-extjs-debug-last-removal-ready-state")) pageRoot.setAttribute("data-extjs-debug-last-removal-ready-state", String(document.readyState || ""));\n' +
    '              if (!pageRoot.getAttribute("data-extjs-debug-last-removal-url")) pageRoot.setAttribute("data-extjs-debug-last-removal-url", String(location.href || ""));\n' +
    '              pageRoot.setAttribute("data-extjs-debug-stage", "root-removed-observed");\n' +
    '            }\n' +
    '            return;\n' +
    '          }\n' +
    '        }\n' +
    '      } catch (error) {}\n' +
    '    });\n' +
    '    observer.observe(target, { childList: true, subtree: true });\n' +
    '    globalThis.__EXTJS_DEBUG_REMOVAL_OBSERVER__ = observer;\n' +
    '  } catch (error) {}\n' +
    '}\n' +
    'function __EXTENSIONJS_cleanupKnownRoots(){\n' +
    '  try {\n' +
    '    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;\n' +
    '    var roots = Array.from(document.querySelectorAll("#extension-root,[data-extension-root]:not([data-extension-root=\\"extension-js-devtools\\"])"));\n' +
    '    for (var i = 0; i < roots.length; i++) {\n' +
    '      var host = roots[i];\n' +
    '      if (!host || typeof host.getAttribute !== "function") continue;\n' +
    '      var hostOwner = String(host.getAttribute("data-extjs-reinject-owner") || "");\n' +
    '      if (!hostOwner || hostOwner !== String(__EXTENSIONJS_REINJECT_KEY || "")) continue;\n' +
    '      try {\n' +
    '        var pageRoot = document.documentElement;\n' +
    '        if (pageRoot && typeof pageRoot.setAttribute === "function") {\n' +
    '          pageRoot.setAttribute("data-extjs-debug-stage", "cleanup-known-roots");\n' +
    '          pageRoot.setAttribute("data-extjs-debug-last-removal", "cleanup-known-roots");\n' +
    '          pageRoot.setAttribute("data-extjs-debug-last-removal-key", String(__EXTENSIONJS_REINJECT_KEY || ""));\n' +
    '          pageRoot.setAttribute("data-extjs-debug-last-removal-source", "cleanup-known-roots");\n' +
    '          pageRoot.setAttribute("data-extjs-debug-last-removed-node-tag", String(host.tagName || "").toLowerCase());\n' +
    '        }\n' +
    '      } catch (error) {}\n' +
    '      try { host.remove(); } catch (error) {}\n' +
    '    }\n' +
    '  } catch (error) {}\n' +
    '}\n' +
    'function __EXTENSIONJS_composeCleanup(primaryCleanup){\n' +
    '  return function(){\n' +
    '    try { if (typeof primaryCleanup === "function") primaryCleanup(); } catch (error) {}\n' +
    '    try { __EXTENSIONJS_runCleanups(__EXTENSIONJS_REGISTERED_CLEANUPS); } catch (error) {}\n' +
    '    try { __EXTENSIONJS_cleanupKnownRoots(); } catch (error) {}\n' +
    '    try { __EXTENSIONJS_setReinjectMarker(__EXTENSIONJS_REINJECT_KEY, Number(__EXTENSIONJS_REINJECT_GENERATION) || 0, "cleaned"); } catch (error) {}\n' +
    '  };\n' +
    '}\n' +
    'function __EXTENSIONJS_recordExecutionSnapshot(stage){\n' +
    '  try {\n' +
    '    if (typeof document === "undefined") return;\n' +
    '    var pageRoot = document.documentElement;\n' +
    '    if (!pageRoot || typeof pageRoot.getAttribute !== "function" || typeof pageRoot.setAttribute !== "function") return;\n' +
    '    var currentCount = Number(pageRoot.getAttribute("data-extjs-debug-execution-count") || "0");\n' +
    '    var nextCount = Number.isFinite(currentCount) ? currentCount + 1 : 1;\n' +
    '    var roots = [];\n' +
    '    try { roots = Array.from(document.querySelectorAll("#extension-root,[data-extension-root]:not([data-extension-root=\\"extension-js-devtools\\"])")); } catch (error) {}\n' +
    '    pageRoot.setAttribute("data-extjs-debug-execution-count", String(nextCount));\n' +
    '    pageRoot.setAttribute("data-extjs-debug-last-execution-stage", String(stage || ""));\n' +
    '    pageRoot.setAttribute("data-extjs-debug-last-execution-key", String(__EXTENSIONJS_REINJECT_KEY || ""));\n' +
    '    pageRoot.setAttribute("data-extjs-debug-existing-root-count-before-cleanup", String(roots.length));\n' +
    '  } catch (error) {}\n' +
    '}\n' +
    'function __EXTENSIONJS_patchDomRemovalApis(){\n' +
    '  try {\n' +
    '    if (typeof globalThis !== "object" || !globalThis || globalThis.__EXTJS_DEBUG_DOM_APIS_PATCHED__) return;\n' +
    '    var record = function(source, node, parent){\n' +
    '      try {\n' +
    '        var pageRoot = document.documentElement;\n' +
    '        if (!pageRoot || typeof pageRoot.setAttribute !== "function") return;\n' +
    '        var ownedRoot = null;\n' +
    '        if (node && node.nodeType === 1) {\n' +
    '          if (typeof node.getAttribute === "function" && String(node.getAttribute("data-extjs-reinject-owner") || "") === String(__EXTENSIONJS_REINJECT_KEY || "")) ownedRoot = node;\n' +
    '          else if (typeof node.querySelector === "function") ownedRoot = node.querySelector("[data-extjs-reinject-owner=\\"" + String(__EXTENSIONJS_REINJECT_KEY || "").replace(/"/g, "\\\\\\"") + "\\"]");\n' +
    '        }\n' +
    '        if (!ownedRoot) return;\n' +
    '        pageRoot.setAttribute("data-extjs-debug-stage", "dom-api-removal");\n' +
    '        pageRoot.setAttribute("data-extjs-debug-last-removal", source);\n' +
    '        pageRoot.setAttribute("data-extjs-debug-last-removal-source", source);\n' +
    '        pageRoot.setAttribute("data-extjs-debug-last-removal-key", String(__EXTENSIONJS_REINJECT_KEY || ""));\n' +
    '        pageRoot.setAttribute("data-extjs-debug-last-removed-node-tag", String(node && node.tagName || "").toLowerCase());\n' +
    '        pageRoot.setAttribute("data-extjs-debug-last-removed-node-id", String(node && node.id || ""));\n' +
    '        pageRoot.setAttribute("data-extjs-debug-last-removed-node-class", String(node && node.className || ""));\n' +
    '        pageRoot.setAttribute("data-extjs-debug-last-removed-node-direct", String(node === ownedRoot));\n' +
    '        pageRoot.setAttribute("data-extjs-debug-last-removal-ready-state", String(document.readyState || ""));\n' +
    '        pageRoot.setAttribute("data-extjs-debug-last-removal-url", String(location.href || ""));\n' +
    '        pageRoot.setAttribute("data-extjs-debug-last-removal-parent-tag", String(parent && parent.tagName || "").toLowerCase());\n' +
    '      } catch (error) {}\n' +
    '    };\n' +
    '    try {\n' +
    '      var originalRemoveChild = Node.prototype.removeChild;\n' +
    '      if (typeof originalRemoveChild === "function") {\n' +
    '        Node.prototype.removeChild = function(child){\n' +
    '          record("Node.removeChild", child, this);\n' +
    '          return originalRemoveChild.call(this, child);\n' +
    '        };\n' +
    '      }\n' +
    '    } catch (error) {}\n' +
    '    try {\n' +
    '      var originalReplaceChildren = Element.prototype.replaceChildren;\n' +
    '      if (typeof originalReplaceChildren === "function") {\n' +
    '        Element.prototype.replaceChildren = function(){\n' +
    '          try {\n' +
    '            var existing = Array.from(this.childNodes || []);\n' +
    '            for (var i = 0; i < existing.length; i++) record("Element.replaceChildren", existing[i], this);\n' +
    '          } catch (error) {}\n' +
    '          return originalReplaceChildren.apply(this, arguments);\n' +
    '        };\n' +
    '      }\n' +
    '    } catch (error) {}\n' +
    '    globalThis.__EXTJS_DEBUG_DOM_APIS_PATCHED__ = true;\n' +
    '  } catch (error) {}\n' +
    '}\n' +
    'try {\n' +
    '  if (typeof globalThis === "object" && globalThis) {\n' +
    '    globalThis.__EXTENSIONJS_registerCleanup = __EXTENSIONJS_registerCleanup;\n' +
    '    globalThis.registerCleanup = __EXTENSIONJS_registerCleanup;\n' +
    '  }\n' +
    '} catch (error) {}\n' +
    'try { __EXTENSIONJS_debugObserveOwnedRootRemoval(); } catch (error) {}\n' +
    'try { __EXTENSIONJS_patchDomRemovalApis(); } catch (error) {}\n' +
    'try { __EXTENSIONJS_recordExecutionSnapshot("bootstrap"); } catch (error) {}\n' +
    'var __EXTENSIONJS_previousEntry=__EXTENSIONJS_REINJECT_REGISTRY[__EXTENSIONJS_REINJECT_KEY];\n' +
    'var __EXTENSIONJS_REINJECT_GENERATION=__EXTENSIONJS_readReinjectGeneration(__EXTENSIONJS_previousEntry);\n' +
    'try {\n' +
    '  var __EXTENSIONJS_previousCleanup=typeof __EXTENSIONJS_previousEntry === "function" ? __EXTENSIONJS_previousEntry : (__EXTENSIONJS_previousEntry && typeof __EXTENSIONJS_previousEntry.cleanup === "function" ? __EXTENSIONJS_previousEntry.cleanup : null);\n' +
    '  if (typeof __EXTENSIONJS_previousCleanup === "function") {\n' +
    '    try {\n' +
    '      var __extjsPageRoot = document.documentElement;\n' +
    '      if (__extjsPageRoot && typeof __extjsPageRoot.setAttribute === "function") {\n' +
    '        __extjsPageRoot.setAttribute("data-extjs-debug-stage", "previous-cleanup");\n' +
    '        __extjsPageRoot.setAttribute("data-extjs-debug-last-removal", "previous-cleanup");\n' +
    '        __extjsPageRoot.setAttribute("data-extjs-debug-last-removal-key", String(__EXTENSIONJS_REINJECT_KEY || ""));\n' +
    '        __extjsPageRoot.setAttribute("data-extjs-debug-last-removal-source", "previous-cleanup");\n' +
    '      }\n' +
    '    } catch (error) {}\n' +
    '    __EXTENSIONJS_previousCleanup();\n' +
    '  }\n' +
    '} catch (error) {}\n' +
    'try { __EXTENSIONJS_cleanupKnownRoots(); } catch (error) {}\n' +
    'function __EXTENSIONJS_syncAssetBase(){\n' +
    '  try {\n' +
    '    var base = "";\n' +
    '    try {\n' +
    '      if (typeof globalThis === "object" && globalThis && globalThis.browser && globalThis.browser.runtime && typeof globalThis.browser.runtime.getURL === "function") base = String(globalThis.browser.runtime.getURL("/"));\n' +
    '      else if (typeof globalThis === "object" && globalThis && globalThis.chrome && globalThis.chrome.runtime && typeof globalThis.chrome.runtime.getURL === "function") base = String(globalThis.chrome.runtime.getURL("/"));\n' +
    '    } catch (error) {}\n' +
    '    if (!base) {\n' +
    '      try {\n' +
    '        if (typeof document === "object" && document && document.documentElement) base = String(document.documentElement.getAttribute("data-extjs-extension-base") || "");\n' +
    '      } catch (error) {}\n' +
    '    }\n' +
    '    if (!base) return false;\n' +
    '    if (base.charAt(base.length - 1) !== "/") base += "/";\n' +
    '    if (typeof __webpack_require__ === "function" || typeof __webpack_require__ === "object") {\n' +
    '      try { __webpack_require__.p = base; } catch (error) {}\n' +
    '      try { __webpack_require__.b = base; } catch (error) {}\n' +
    '    }\n' +
    '    return true;\n' +
    '  } catch (error) {}\n' +
    '  return false;\n' +
    '}\n' +
    'try {\n' +
    '  if (!__EXTENSIONJS_syncAssetBase()) {\n' +
    '    var __EXTENSIONJS_assetBaseRetries = 0;\n' +
    '    var __EXTENSIONJS_retryAssetBase = function(){\n' +
    '      try {\n' +
    '        if (__EXTENSIONJS_syncAssetBase()) return;\n' +
    '      } catch (error) {}\n' +
    '      if (__EXTENSIONJS_assetBaseRetries++ < 50) setTimeout(__EXTENSIONJS_retryAssetBase, 100);\n' +
    '    };\n' +
    '    __EXTENSIONJS_retryAssetBase();\n' +
    '  }\n' +
    '} catch (error) {}\n'

  const runtimeInline =
    'function __EXTENSIONJS_whenReady(runAt, cb){\n' +
    '  try {\n' +
    "    if (typeof document === 'undefined') { cb(); return function(){} }\n" +
    "    if (runAt === 'document_start') { cb(); return function(){} }\n" +
    '    var isDone = false;\n' +
    '    function isReady(){\n' +
    "      if (runAt === 'document_end') return document.readyState === 'interactive' || document.readyState === 'complete';\n" +
    "      if (runAt === 'document_idle') return document.readyState === 'complete';\n" +
    "      return document.readyState === 'complete';\n" +
    '    }\n' +
    '    if (isReady()) { cb(); return function(){} }\n' +
    '    var onReady = function(){\n' +
    '      try {\n' +
    '        if (isDone) return;\n' +
    "        if (isReady()) { isDone = true; document.removeEventListener('readystatechange', onReady); cb(); }\n" +
    '      } catch (error) {}\n' +
    '    };\n' +
    "    document.addEventListener('readystatechange', onReady);\n" +
    "    return function(){ try { if (!isDone) document.removeEventListener('readystatechange', onReady); } catch (error) {} };\n" +
    '  } catch (error) { try { cb(); } catch (ignored) {} return function(){} }\n' +
    '}\n' +
    `${bundleCssHydrationInline}` +
    'function __EXTENSIONJS_mount(mount, runAt){\n' +
    '  var cleanup = function(){};\n' +
    '  var cancelReady = function(){};\n' +
    '  if (typeof mount !== "function") {\n' +
    '    try { __EXTENSIONJS_REINJECT_GENERATION = (Number(__EXTENSIONJS_REINJECT_GENERATION) || 0) + 1; } catch (error) {}\n' +
    '    try { __EXTENSIONJS_setReinjectMarker(__EXTENSIONJS_REINJECT_KEY, Number(__EXTENSIONJS_REINJECT_GENERATION) || 0, "executed"); } catch (error) {}\n' +
    '    try { __EXTENSIONJS_scheduleBundleCssHydration(); } catch (error) {}\n' +
    '    return __EXTENSIONJS_composeCleanup(null);\n' +
    '  }\n' +
    '  function apply(){\n' +
    '    try {\n' +
    '      var nextCleanup = mount();\n' +
    '      cleanup = __EXTENSIONJS_composeCleanup(nextCleanup);\n' +
    '      __EXTENSIONJS_REINJECT_GENERATION = (Number(__EXTENSIONJS_REINJECT_GENERATION) || 0) + 1;\n' +
    '      try { cleanup.__extjsGeneration = __EXTENSIONJS_REINJECT_GENERATION; cleanup.__extjsKey = __EXTENSIONJS_REINJECT_KEY; } catch (error) {}\n' +
    '      try { __EXTENSIONJS_setReinjectMarker(__EXTENSIONJS_REINJECT_KEY, __EXTENSIONJS_REINJECT_GENERATION, "mounted"); } catch (error) {}\n' +
    '      try { __EXTENSIONJS_scheduleBundleCssHydration(); } catch (error) {}\n' +
    '    } catch (error) {\n' +
    '      try { console.warn("[extension.js] content script default export failed to run", error); } catch (ignored) {}\n' +
    '      try { __EXTENSIONJS_setReinjectMarker(__EXTENSIONJS_REINJECT_KEY, Number(__EXTENSIONJS_REINJECT_GENERATION) || 0, "mount-error"); } catch (ignored) {}\n' +
    '    }\n' +
    '  }\n' +
    "  function unmount(){ try { cancelReady && cancelReady(); } catch (error) {} try { if (typeof cleanup === 'function') cleanup(); } catch (error) {} }\n" +
    '  cancelReady = __EXTENSIONJS_whenReady(runAt, apply);\n' +
    '  return unmount;\n' +
    '}\n'

  if (!hasDefaultExport(rewrittenSource, this.resourcePath, compilation)) {
    return (
      `var __EXTJS_WRAPPER_KIND="FS3_INLINE";\n` +
      `${bootstrap}` +
      `${runtimeInline}` +
      `${rewrittenSource}\n` +
      `try { __EXTENSIONJS_REINJECT_GENERATION = (Number(__EXTENSIONJS_REINJECT_GENERATION) || 0) + 1; } catch (error) {}\n` +
      `try { __EXTENSIONJS_setReinjectMarker(__EXTENSIONJS_REINJECT_KEY, Number(__EXTENSIONJS_REINJECT_GENERATION) || 0, "executed"); } catch (error) {}\n` +
      `try { __EXTENSIONJS_scheduleBundleCssHydration() } catch (error) {}\n` +
      `try { __EXTENSIONJS_REINJECT_REGISTRY[__EXTENSIONJS_REINJECT_KEY] = { cleanup: __EXTENSIONJS_composeCleanup(null), generation: Number(__EXTENSIONJS_REINJECT_GENERATION) || 0, build: __EXTENSIONJS_REINJECT_BUILD_TOKEN }; } catch (error) {}\n`
    )
  }

  const replaced = rewrittenSource.replace(
    /\bexport\s+default\b/,
    'const __EXTENSIONJS_default__ ='
  )

  let defaultName
  {
    const matchFunction = rewrittenSource.match(
      /\bexport\s+default\s+function\s+([A-Za-z_$][\w$]*)\s*\(/
    )
    if (matchFunction) {
      defaultName = matchFunction[1]
    } else {
      const matchIdentifier = rewrittenSource.match(
        /\bexport\s+default\s+([A-Za-z_$][\w$]*)\b/
      )
      if (matchIdentifier) defaultName = matchIdentifier[1]
    }
  }

  let cleaned = replaced
  if (defaultName) {
    const callPattern = new RegExp(
      `(^|\\n|;)\\s*${defaultName}\\s*\\(\\s*\\)\\s*;?\\s*(?=\\n|$)`,
      'g'
    )
    const next = cleaned.replace(
      callPattern,
      (_match, prefix) => prefix || '\n'
    )
    if (next !== cleaned) {
      cleaned = next
      this.emitWarning?.(
        new Error(
          `Removed direct call to ${defaultName}() to prevent double mount; wrapper handles mounting.`
        )
      )
    }
  }

  return (
    `var __EXTJS_WRAPPER_KIND="FS3_INLINE";\n` +
    `${bootstrap}` +
    `${runtimeInline}` +
    `${cleaned}\n` +
    `;/* __EXTENSIONJS_MOUNT_WRAPPED__ */\n` +
    `var __EXTENSIONJS_cleanup = function(){};\n` +
    `try { __EXTENSIONJS_cleanup = __EXTENSIONJS_mount(__EXTENSIONJS_default__, ${JSON.stringify(
      runAt
    )}) } catch (error) {}\n` +
    `try { __EXTENSIONJS_REINJECT_REGISTRY[__EXTENSIONJS_REINJECT_KEY] = __EXTENSIONJS_cleanup } catch (error) {}\n` +
    `export default __EXTENSIONJS_default__\n`
  )
}
