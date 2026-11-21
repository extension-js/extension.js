// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import fs from 'node:fs'
import path from 'node:path'
import {parse as parseModuleSyntax} from 'es-module-lexer'
import {validate} from 'schema-utils'
import {
  isChromiumBasedBrowser,
  isGeckoBasedBrowser
} from '../../../../lib/constants'
import {
  closedOnSlash,
  extensionBaseFromFile,
  extensionSchemeFor,
  unlessExtensionAddress
} from '../../../../lib/extension-base-from-stack'
import {
  adjustLoaderSourceMap,
  inputOrIdentityMap,
  returnWithMap
} from '../../../../lib/loader-source-maps'
import {filterKeysForThisBrowser} from '../../../../lib/manifest-utils'
import {parseAuthoredJson} from '../../../../lib/parse-json-safe'
import {findNearestProjectManifestSync} from '../../../../lib/project-manifest'
import {
  canonicalizeDir,
  canonicalizeResourcePath
} from '../../../../lib/resource-path'
import type {DevOptions, Manifest} from '../../../../types'
import {
  CONTENT_SCRIPT_OWNER_KEY_ATTRIBUTE,
  CONTENT_SCRIPT_OWNER_KEY_GLOBAL,
  type ContentScriptWrapperExtension,
  type ContentScriptWrapperPoint,
  type ContentScriptWrapperReadModule
} from '../../../shared/content-script-wrapper-extensions'
import {
  CANONICAL_CONTENT_SCRIPT_ENTRY_PREFIX,
  getCanonicalContentScriptEntryName,
  getContentScriptCssProbeMarker,
  MAIN_WORLD_COPY_SUFFIX
} from '../../contracts'
import * as messages from '../../messages'
import {keepCompletionValue} from '../../scripts-lib/completion-value'
import {
  MOUNT_NAME,
  readDefaultExport,
  refuseDefaultExportLostToLoaders
} from '../../scripts-lib/default-export'
import {
  extensionBaseAttributeFor,
  extensionBaseGlobalFor
} from '../../scripts-lib/taken-extension-base'
import {refuseTopLevelAwait} from '../../scripts-lib/top-level-await'

interface ContentScriptLoaderContext {
  getOptions(): {
    manifestPath: string
    mode?: string
    devSession?: boolean
    browser?: string
    mainWorldScripts?: string[]
    mainWorldCopies?: string[]
    mainWorldBundle?: boolean
    scriptsFolder?: string | false
    extensions?: ContentScriptWrapperExtension[]
  }
  resourcePath: string
  resourceQuery?: string
  loaders?: Array<{path?: string}>
  loaderIndex?: number
  emitWarning?(warning: Error): void
  callback(err: Error | null, content?: string, sourceMap?: unknown): void
}

const schema = {
  type: 'object',
  properties: {
    manifestPath: {type: 'string'},
    mode: {type: 'string'},
    devSession: {type: 'boolean'},
    browser: {type: 'string'},
    mainWorldScripts: {type: 'array', items: {type: 'string'}},
    mainWorldCopies: {type: 'array', items: {type: 'string'}},
    mainWorldBundle: {type: 'boolean'},
    scriptsFolder: {anyOf: [{type: 'string'}, {const: false}]},
    extensions: {type: 'array', items: {type: 'object'}}
  }
} as Parameters<typeof validate>[0]

function escapeCodeString(str: string): string {
  return str.replace(/[<>\u2028\u2029]/g, (ch) => {
    const map: Record<string, string> = {
      '<': '\\u003C',
      '>': '\\u003E',
      '\u2028': '\\u2028',
      '\u2029': '\\u2029'
    }

    return map[ch] || ch
  })
}

function detectNodeJsShapedScript(source: unknown): string[] {
  const indicators: string[] = []

  if (typeof source === 'string' && source.startsWith('#!')) {
    indicators.push('shebang on line 1 (#!/usr/bin/env node ...)')
  }

  if (
    typeof source === 'string' &&
    /(?:^|\n)\s*(?:import[^\n;]*?from\s*|import\s*\(\s*|require\s*\(\s*)["']node:[\w/-]+["']/m.test(
      source
    )
  ) {
    indicators.push("import from the 'node:' protocol")
  }

  return indicators
}

function collectStyleAssetSpecifiers(source: string): string[] {
  const SAFE_SPECIFIER = /^[\w./@~\-?&=#+%]+$/
  const styleSpecifiers = new Set<string>()
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
        SAFE_SPECIFIER.test(specifier) &&
        // CSS-module imports compile to a class-name exports OBJECT, not an asset;
        // new URL(exportsObject, base) yields garbage, and getURL covers modules css.
        !/\.module\.(?:css|scss|sass|less|styl)(?:\?|$)/.test(specifier) &&
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

// A bundle only gets a sibling stylesheet through its module graph, and a
// source that pulls in nothing has no graph beyond itself. Any spelling that
// could reach another module counts, so the answer only ever errs towards yes.
function hasModuleDependency(source: string): boolean {
  return /\bimport\b|\brequire\s*\(|\bfrom\s*["'`]/.test(source)
}

// Whether a file imports another one from scripts/, whose value would
// otherwise be taken for the value of the file that imported it.
function importsScriptsFile(
  source: string,
  resourceAbsPath: string,
  scriptsDir: string
): boolean {
  try {
    const [imports] = parseModuleSyntax(source)

    return imports.some(({specifier}) => {
      if (typeof specifier !== 'string' || !specifier.startsWith('.')) {
        return false
      }

      const relative = path.relative(
        scriptsDir,
        path.resolve(path.dirname(resourceAbsPath), specifier)
      )

      return !relative.startsWith('..') && !path.isAbsolute(relative)
    })
  } catch {
    // Source the lexer cannot read: a relative import is taken at its word.
    return /\bfrom\s*["']\.|\bimport\s*["']\./.test(source)
  }
}

// One spelling for a folder and a file under it: a temp folder can come
// short (RUNNER~1) on one side and long on the other.
function realPath(file: string): string {
  try {
    return fs.realpathSync.native(file)
  } catch {
    return file
  }
}

// The loaders that ran before this one and are not the build's own: its own
// sit in one folder, and the bundler's carry no path of a file.
function loadersOfTheProject(
  context: ContentScriptLoaderContext,
  projectDir: string
): string[] {
  const loaders = context.loaders || []
  const index = context.loaderIndex ?? loaders.length - 1
  const ownDir = path.dirname(String(loaders[index]?.path || ''))

  return loaders
    .slice(index + 1)
    .map((loader) => String(loader?.path || ''))
    .filter((file) => path.isAbsolute(file) && path.dirname(file) !== ownDir)
    .map((file) => {
      const relative = path.relative(realPath(projectDir), realPath(file))
      const inside = !relative.startsWith('..') && !path.isAbsolute(relative)

      return (inside ? relative : file).split(path.sep).join('/')
    })
}

const __EXTENSIONJS_manifestParseCache = new Map<
  string,
  {key: string; manifest: Record<string, unknown>}
>()

function readManifestCached(
  manifestPath: string,
  browser: DevOptions['browser']
): Record<string, unknown> {
  // A content script declared as firefox:content_scripts is invisible to a
  // raw read, so the loader let it through unwrapped. The browser belongs in
  // the cache key because the same manifest resolves differently per target.
  const resolve = (raw: unknown) =>
    filterKeysForThisBrowser(raw as Manifest, browser) as Record<
      string,
      unknown
    >
  const cacheKey = `${manifestPath}::${browser}`

  try {
    const stat = fs.statSync(manifestPath)
    const key = `${stat.mtimeMs}:${stat.size}`
    const cached = __EXTENSIONJS_manifestParseCache.get(cacheKey)

    if (cached && cached.key === key) return cached.manifest

    const manifest = resolve(
      parseAuthoredJson(fs.readFileSync(manifestPath, 'utf-8'))
    )
    __EXTENSIONJS_manifestParseCache.set(cacheKey, {key, manifest})

    return manifest
  } catch {
    // stat/read/parse failures fall back to a direct read so callers keep
    // their existing error behavior.
    return resolve(parseAuthoredJson(fs.readFileSync(manifestPath, 'utf-8')))
  }
}

export default function contentScriptWrapper(
  this: ContentScriptLoaderContext,
  source: string,
  inputSourceMap?: unknown
): string | void {
  const options = this.getOptions()
  validate(schema, options, {
    name: 'scripts:content-script-wrapper',
    baseDataPath: 'options'
  })

  const manifestPath = options.manifestPath
  // Canonicalize to match this.resourcePath (symlink-resolved); under a
  // symlinked project root a raw manifestDir would break declared-entry matching.
  const manifestDir = canonicalizeDir(path.dirname(manifestPath))
  const packageJsonPath = findNearestProjectManifestSync(manifestPath)
  const packageJsonDir = canonicalizeDir(
    packageJsonPath ? path.dirname(packageJsonPath) : manifestDir
  )
  const browser = (options.browser as DevOptions['browser']) || 'chrome'
  const manifest = readManifestCached(manifestPath, browser)
  const devSession =
    typeof options?.devSession === 'boolean'
      ? options.devSession
      : String(options?.mode || '').toLowerCase() !== 'production'
  const isShippedBundle = !devSession
  const rewrittenSource = String(source)

  const declaredContentJsAbsEntries: Array<{
    abs: string
    runAt: string
    world: 'MAIN' | 'ISOLATED'
    index: number
    scriptIndex: number
  }> = []
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
        world: contentScript?.world === 'MAIN' ? 'MAIN' : 'ISOLATED',
        index,
        scriptIndex
      })
    }
  }

  // Canonicalize into the SAME form as manifestDir above; otherwise the
  // declared-entry match silently fails on Windows and scripts go unwrapped.
  const resourceAbsPath = canonicalizeResourcePath(this.resourcePath)
  const declaredEntry = declaredContentJsAbsEntries.find(
    (entry) => resourceAbsPath === path.normalize(entry.abs)
  )

  // The `folders` config moves this folder or turns it off. Off, nothing in
  // scripts/ is a content script unless the manifest declares it.
  const scriptsDir =
    options.scriptsFolder ?? path.resolve(packageJsonDir, 'scripts')
  const relToScripts = scriptsDir
    ? path.relative(scriptsDir, resourceAbsPath)
    : ''
  const isScriptsFolderScript =
    relToScripts &&
    !relToScripts.startsWith('..') &&
    !path.isAbsolute(relToScripts)

  // scripts/ is reserved for browser-side files; a Node CLI dropped there gets
  // the runtime prepended and a cryptic swc error, so name the folder up front.
  if (isScriptsFolderScript && !declaredEntry) {
    const nodeIndicators = detectNodeJsShapedScript(rewrittenSource)

    if (nodeIndicators.length > 0) {
      const relFromProject = path
        .relative(packageJsonDir, resourceAbsPath)
        .split(path.sep)
        .join('/')

      throw Object.assign(
        new Error(
          messages.reservedScriptsFolder(relFromProject, nodeIndicators)
        ),
        {name: 'ReservedScriptsFolder'}
      )
    }
  }

  // A vendored pre-minified library in scripts/ must pass through untouched;
  // only heuristic-caught files skip, declared content_scripts stay wrapped.
  const isVendoredMinifiedScript = /\.min\.[cm]?js$/i.test(resourceAbsPath)

  if (isVendoredMinifiedScript && !declaredEntry) {
    if (inputSourceMap) {
      this.callback(null, rewrittenSource, inputSourceMap)

      return
    }

    return rewrittenSource
  }

  const isContentScriptLike = Boolean(declaredEntry || isScriptsFolderScript)

  if (!isContentScriptLike) {
    if (inputSourceMap) {
      this.callback(null, rewrittenSource, inputSourceMap)

      return
    }

    return rewrittenSource
  }

  const runAt = declaredEntry?.runAt || 'document_idle'
  // A scripts/ file handed to registerContentScripts with world: "MAIN" runs
  // in the page's own world with nothing in the manifest to say so.
  const namedIn = (files: string[] | undefined) =>
    (files || []).some(
      (candidate) => resourceAbsPath === canonicalizeResourcePath(candidate)
    )
  // A file both worlds run shares its path with the isolated build, so it
  // is a MAIN world file only inside the bundle compiled for the page.
  const isMainWorldCopy =
    options.mainWorldBundle === true && namedIn(options.mainWorldCopies)
  const isRuntimeMainWorld =
    namedIn(options.mainWorldScripts) || isMainWorldCopy
  // A bundle compiled for the page's own world carries every module it
  // imports there, and a scripts/ file among them is no entry of its own.
  const isMainWorld =
    declaredEntry?.world === 'MAIN' ||
    isRuntimeMainWorld ||
    options.mainWorldBundle === true
  // Another plugin adds its own text at named points of the wrapper, and a
  // build with none registered emits the wrapper alone.
  const extensions = options.extensions || []
  const at = (point: ContentScriptWrapperPoint): string =>
    extensions
      .map((extension) =>
        extension.textAt(point, {source: rewrittenSource, isMainWorld})
      )
      .join('')
  const adoptsRoots = extensions.some((extension) => extension.adoptsRoots)
  const loadsFiles = extensions.some((extension) => extension.loadsFiles)
  // A runtime file shares one bridge with every file of its registration,
  // so it clears the base once they have all run instead of at once.
  const sharesBridgeBase =
    !declaredEntry &&
    isRuntimeMainWorld &&
    isShippedBundle &&
    isGeckoBasedBrowser(browser)
  // The bridge that runs right before a declared MAIN-world script leaves the
  // extension base on <html>. The bundle takes it and clears it at once when
  // its own stack can name the base again later, which only Firefox cannot.
  const takesBridgeBase =
    sharesBridgeBase ||
    (declaredEntry?.world === 'MAIN' &&
      (isShippedBundle || isChromiumBasedBrowser(browser)))
  // On Firefox the file itself opens on the read that takes the base from
  // the bridge, so a dev bundle keeps that copy too and asks nothing twice.
  const takesFromFile = isMainWorld && isGeckoBasedBrowser(browser)
  const holdsBridgeBase = takesBridgeBase || takesFromFile
  // Two extensions share one document, so a file reads the base from the
  // attribute its own bridge wrote and trusts no other engine's scheme.
  const baseAttribute = JSON.stringify(
    extensionBaseAttributeFor(manifestPath, browser)
  )
  const baseScheme = extensionSchemeFor(String(browser))
  // The page's world has no runtime on Firefox, so one found there is the
  // page's own and a file that took its base never asks it for a URL.
  const asksRuntime = (lines: string) => (takesFromFile ? '' : lines)
  const takenBridgeBase = holdsBridgeBase ? '__EXTENSIONJS_BRIDGE_BASE || ' : ''
  // The page window carries the getter until the file that took the base
  // removes it, the way it removes the attribute.
  const dropsBaseGetter = takesFromFile
    ? `try { delete window.${extensionBaseGlobalFor(manifestPath, browser)}; } catch (error) {} `
    : ''
  const scriptKey = `scripts/${String(relToScripts || '').replace(/\\/g, '/')}`
  const bundleKey = declaredEntry
    ? getCanonicalContentScriptEntryName(declaredEntry.index)
    : isMainWorldCopy
      ? scriptKey.replace(/(\.[^./]+)?$/, `${MAIN_WORLD_COPY_SUFFIX}$1`)
      : scriptKey
  const ownerKey = declaredEntry
    ? `${bundleKey}::script-${declaredEntry.scriptIndex}`
    : bundleKey
  // Whether a sibling stylesheet gets emitted is only known after assets
  // exist; the plugin resolves this marker to the real path, or to nothing.
  const cssProbeMarker = getContentScriptCssProbeMarker(bundleKey)
  const cssAssetSpecifiers = collectStyleAssetSpecifiers(rewrittenSource)
  const cssAssetUrlsInline = `var __EXTENSIONJS_BUNDLE_CSS_URLS=[${cssAssetSpecifiers
    .map(
      (specifier) =>
        `(function(){ try { return String(new URL(${escapeCodeString(
          JSON.stringify(specifier)
        )}, import.meta.url)); } catch (error) { return ""; } })()`
    )
    .join(',')}];\n`

  const bundleCssHydrationBody =
    'function __EXTENSIONJS_runtimeGetURL(path){\n' +
    asksRuntime(
      '  try {\n' +
        '    if (typeof globalThis === "object" && globalThis && globalThis.browser && globalThis.browser.runtime && typeof globalThis.browser.runtime.getURL === "function") return globalThis.browser.runtime.getURL(path);\n' +
        '    if (typeof globalThis === "object" && globalThis && globalThis.chrome && globalThis.chrome.runtime && typeof globalThis.chrome.runtime.getURL === "function") return globalThis.chrome.runtime.getURL(path);\n' +
        '  } catch (error) {}\n'
    ) +
    '  try {\n' +
    // On Firefox a page owns every other global of its world, so the file
    // asks none of them and goes from its own copy to the document.
    (takesFromFile
      ? '    var base = __EXTENSIONJS_BRIDGE_BASE;\n'
      : `    var base = ${takenBridgeBase}"";\n`) +
    `    if (!base && typeof document === "object" && document && document.documentElement) base = String(document.documentElement.getAttribute(${baseAttribute}) || "");\n` +
    `    ${unlessExtensionAddress('base', baseScheme)}\n` +
    '    if (!base) return "";\n' +
    (takesFromFile
      ? `    return ${closedOnSlash('base')} + String(path || "").replace(/^\\/+/, "");\n`
      : '    return base.replace(/\\/+$/, "/") + String(path || "").replace(/^\\/+/, "");\n') +
    '  } catch (error) {}\n' +
    '  return "";\n' +
    '}\n' +
    // A build with no emitted sibling stylesheet resolves the probe marker to
    // an empty string, so no phantom `<bundle>.css` request ever leaves the
    // page. The unresolved-marker and trailing-slash checks keep a pipeline
    // that skipped the resolve pass from fetching garbage URLs.
    `var __EXTENSIONJS_BUNDLE_CSS_PROBE=${JSON.stringify(cssProbeMarker)};\n` +
    'function __EXTENSIONJS_bundleCssProbeUrls(){\n' +
    '  try {\n' +
    '    var probe = String(__EXTENSIONJS_BUNDLE_CSS_PROBE || "");\n' +
    '    if (!probe.length) return [];\n' +
    '    if (probe.lastIndexOf("__EXTENSIONJS_CSS_PROBE", 0) === 0) return [];\n' +
    '    var url = __EXTENSIONJS_runtimeGetURL(probe);\n' +
    '    if (typeof url !== "string" || !url.length) return [];\n' +
    '    if (url.charAt(url.length - 1) === "/") return [];\n' +
    '    return [url];\n' +
    '  } catch (error) { return []; }\n' +
    '}\n' +
    'function __EXTENSIONJS_scheduleBundleCssHydration(){\n' +
    '  try {\n' +
    `    if (String(__EXTENSIONJS_BUNDLE_KEY || "").indexOf(${JSON.stringify(CANONICAL_CONTENT_SCRIPT_ENTRY_PREFIX)}) !== 0) return;\n` +
    '    if (typeof document === "undefined" || typeof fetch !== "function") return;\n' +
    '    var cssUrls = Array.from(new Set((Array.isArray(__EXTENSIONJS_BUNDLE_CSS_URLS) ? __EXTENSIONJS_BUNDLE_CSS_URLS : []).concat(__EXTENSIONJS_bundleCssProbeUrls()).filter(function(value){ return typeof value === "string" && value.trim().length > 0; })));\n' +
    '    if (!cssUrls.length) return;\n' +
    '    var cssText = "";\n' +
    '    var cssPromise = null;\n' +
    '    var readCss = function(){\n' +
    '      if (cssPromise) return cssPromise;\n' +
    // Every sheet the script owns reaches its shadow root, imports first and
    // the declared sheet last, as one text so the owner token stays one.
    '      cssPromise = Promise.all(cssUrls.map(function(url){\n' +
    '        return Promise.resolve().then(function(){ return fetch(url); }).then(function(response){\n' +
    '          if (!response || !response.ok) return "";\n' +
    '          return response.text();\n' +
    '        }).catch(function(){\n' +
    '          return "";\n' +
    '        });\n' +
    '      })).then(function(texts){\n' +
    '        var seen = [];\n' +
    '        for (var t = 0; t < texts.length; t++) {\n' +
    '          if (typeof texts[t] !== "string" || !texts[t].trim().length || seen.indexOf(texts[t]) !== -1) continue;\n' +
    '          seen.push(texts[t]);\n' +
    '        }\n' +
    '        return seen.join("\\n");\n' +
    '      }).then(function(text){\n' +
    // An emitted sheet names its url() targets from the extension root, which
    // a <style> on the visited page would read as that page's own root.
    '        cssText = typeof text === "string" ? text : "";\n' +
    '        var root = __EXTENSIONJS_runtimeGetURL("/");\n' +
    '        if (root) cssText = cssText.replace(/url\\(\\s*(["\']?)\\/(?!\\/)/gi, function(match, quote){ return "url(" + quote + root; });\n' +
    '        try { setTimeout(tick, 0); } catch (error) {}\n' +
    '        return cssText;\n' +
    '      }).catch(function(){ return ""; });\n' +
    '      return cssPromise;\n' +
    '    };\n' +
    '    var tries = 0;\n' +
    '    var wanted = false;\n' +
    '    var tick = function(){\n' +
    '      try {\n' +
    '        var __extjsToken = __EXTENSIONJS_ownerToken();\n' +
    '        var hosts = Array.from(document.querySelectorAll("#extension-root,[data-extension-root]:not([data-extension-root=\\"extension-js-devtools\\"])"));\n' +
    '        for (var i = 0; i < hosts.length; i++) {\n' +
    '          var host = hosts[i];\n' +
    '          if (!host || !host.shadowRoot || typeof host.getAttribute !== "function") continue;\n' +
    // An extension that stamps owners checks hosts by owner instead. With
    // no owner on any root, the two questions left are these.
    (at('style-host-filter') ||
      '          if (__EXTENSIONJS_NO_FOREIGN_ADOPT) continue;\n' +
        '          if (__EXTENSIONJS_PRE_MOUNT_ROOTS.indexOf(host) !== -1) continue;\n') +
    '          var sr = host.shadowRoot;\n' +
    '          var styles = Array.from(sr.querySelectorAll("style"));\n' +
    '          var hasUserStyle = styles.some(function(styleEl){\n' +
    '            return styleEl && styleEl.getAttribute("data-extjs-bundle-css") !== "true" && String(styleEl.textContent || "").trim().length > 0;\n' +
    '          });\n' +
    '          var injected = null;\n' +
    '          for (var s = 0; s < styles.length; s++) {\n' +
    '            if (!styles[s] || styles[s].getAttribute("data-extjs-bundle-css") !== "true") continue;\n' +
    '            var styleOwner = String(styles[s].getAttribute("data-extjs-style-owner") || "");\n' +
    '            if (!styleOwner || styleOwner === __extjsToken) { injected = styles[s]; break; }\n' +
    '          }\n' +
    '          if (hasUserStyle) {\n' +
    '            if (injected && injected.parentNode) injected.parentNode.removeChild(injected);\n' +
    '            return;\n' +
    '          }\n' +
    '          if (typeof cssText === "string" && cssText.trim()) {\n' +
    '            if (!injected) {\n' +
    '              injected = document.createElement("style");\n' +
    '              injected.setAttribute("data-extjs-bundle-css", "true");\n' +
    `              injected.setAttribute("${CONTENT_SCRIPT_OWNER_KEY_ATTRIBUTE}", String(${CONTENT_SCRIPT_OWNER_KEY_GLOBAL} || ""));\n` +
    '              sr.insertBefore(injected, sr.firstChild || null);\n' +
    '            }\n' +
    '            injected.setAttribute("data-extjs-style-owner", __extjsToken);\n' +
    '            if (String(injected.textContent || "") !== cssText) injected.textContent = cssText;\n' +
    '            return;\n' +
    '          }\n' +
    '          wanted = true;\n' +
    '        }\n' +
    '      } catch (error) {}\n' +
    '      if (tries++ < 20) {\n' +
    // A page with no shadow root of ours has nothing to style, so a bundle
    // asks for its sheet only once such a root is there to receive it.
    '        if (wanted && !cssPromise) readCss();\n' +
    '        setTimeout(tick, 250);\n' +
    '      }\n' +
    '    };\n' +
    '    tick();\n' +
    '  } catch (error) {}\n' +
    '}\n'

  // Hydration lifts a sibling stylesheet into the shadow root, so it belongs
  // only in a bundle that can have one: a canonical content script entry whose
  // module graph can reach a stylesheet. Everything else gets the no-op, which
  // is what the runtime guards already decided, only without the bytes.
  const hasModuleGraph =
    cssAssetSpecifiers.length > 0 || hasModuleDependency(rewrittenSource)
  const bundleCssHydrationEnabled =
    bundleKey.startsWith(CANONICAL_CONTENT_SCRIPT_ENTRY_PREFIX) &&
    hasModuleGraph
  const bundleCssHydrationInline = bundleCssHydrationEnabled
    ? bundleCssHydrationBody
    : 'function __EXTENSIONJS_scheduleBundleCssHydration(){}\n'

  // Companion extensions share canonical bundle keys with user content scripts
  // in the SAME page DOM; their wrappers must never adopt foreign roots.
  const isBuiltInCompanion = /extension-js-(?:devtools|theme)/.test(
    String(packageJsonDir || '')
  )

  const projectRelativePath =
    path.relative(packageJsonDir, resourceAbsPath).split(path.sep).join('/') ||
    resourceAbsPath
  const bootstrap =
    `var __EXTENSIONJS_BUNDLE_KEY=${JSON.stringify(bundleKey)};\n` +
    `var ${CONTENT_SCRIPT_OWNER_KEY_GLOBAL}=${JSON.stringify(ownerKey)};\n` +
    // Later readers, a lazy chunk included, find the base on the require
    // function, which no page script can reach. The bundle's own stack names
    // it first, and the bridge attribute is only the fallback.
    (holdsBridgeBase
      ? `var __EXTENSIONJS_BRIDGE_BASE = ${extensionBaseFromFile(takesFromFile)};\n` +
        'try {\n' +
        '  var __EXTENSIONJS_html = document.documentElement;\n' +
        `  if (!__EXTENSIONJS_BRIDGE_BASE) __EXTENSIONJS_BRIDGE_BASE = String(__EXTENSIONJS_html.getAttribute(${baseAttribute}) || "");\n` +
        `  ${unlessExtensionAddress('__EXTENSIONJS_BRIDGE_BASE', baseScheme)}\n` +
        (!takesBridgeBase
          ? ''
          : sharesBridgeBase
            ? `  var __EXTENSIONJS_clearBase = function(){ ${dropsBaseGetter}try { if (__EXTENSIONJS_html.hasAttribute(${baseAttribute})) __EXTENSIONJS_html.removeAttribute(${baseAttribute}); } catch (error) {} };\n` +
              '  try { Promise.resolve().then(__EXTENSIONJS_clearBase); } catch (error) { __EXTENSIONJS_clearBase(); }\n'
            : `  ${dropsBaseGetter}if (__EXTENSIONJS_html.hasAttribute(${baseAttribute})) __EXTENSIONJS_html.removeAttribute(${baseAttribute});\n`) +
        '  if (__EXTENSIONJS_BRIDGE_BASE && typeof __webpack_require__ === "function") __webpack_require__.extjsBase = __EXTENSIONJS_BRIDGE_BASE;\n' +
        '} catch (error) {}\n'
      : '') +
    at('after-bridge-base') +
    `var __EXTENSIONJS_NO_FOREIGN_ADOPT=${JSON.stringify(isBuiltInCompanion)};\n` +
    // Distinct extensions run this wrapper with identical owner keys, so the
    // runtime extension id qualifies the key.
    'function __EXTENSIONJS_ownerToken(){\n' +
    '  var extId = "";\n' +
    '  try {\n' +
    '    var rt = (typeof globalThis === "object" && globalThis && ((globalThis.browser && globalThis.browser.runtime) || (globalThis.chrome && globalThis.chrome.runtime))) || null;\n' +
    '    if (rt && rt.id) extId = String(rt.id);\n' +
    '  } catch (error) {}\n' +
    `  return String(${CONTENT_SCRIPT_OWNER_KEY_GLOBAL} || "") + (extId ? "@" + extId : "");\n` +
    '}\n' +
    at('after-owner-token') +
    // Roots that predate our mount must never be adopted. Only the hydration
    // and an extension that adopts roots read this list, so a bundle with
    // neither keeps the stub and never walks the document to fill it.
    (adoptsRoots || bundleCssHydrationEnabled
      ? 'var __EXTENSIONJS_PRE_MOUNT_ROOTS = [];\n' +
        'function __EXTENSIONJS_snapshotPreMountRoots(){\n' +
        '  try {\n' +
        '    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;\n' +
        '    __EXTENSIONJS_PRE_MOUNT_ROOTS = Array.from(document.querySelectorAll("#extension-root,[data-extension-root]"));\n' +
        '  } catch (error) { __EXTENSIONJS_PRE_MOUNT_ROOTS = []; }\n' +
        '}\n' +
        '__EXTENSIONJS_snapshotPreMountRoots();\n'
      : 'function __EXTENSIONJS_snapshotPreMountRoots(){}\n') +
    `${cssAssetUrlsInline}` +
    at('after-style-urls') +
    'var __EXTENSIONJS_REGISTERED_CLEANUPS=[];\n' +
    at('after-cleanup-list') +
    // A teardown that throws is the author's to fix, so the page console
    // names the script once and the rest of the cleanup still runs.
    'var __EXTENSIONJS_CLEANUP_FAILED = false;\n' +
    'function __EXTENSIONJS_cleanupFailed(error){\n' +
    '  if (__EXTENSIONJS_CLEANUP_FAILED) return;\n' +
    '  __EXTENSIONJS_CLEANUP_FAILED = true;\n' +
    `  try { console.warn(${JSON.stringify(
      `Extension.js W_CONTENT_SCRIPT_CLEANUP: the cleanup of ${projectRelativePath} failed, so what it left on the page may stay.`
    )}, error); } catch (ignored) {}\n` +
    '}\n' +
    'function __EXTENSIONJS_runCleanups(list){\n' +
    '  try {\n' +
    '    if (!Array.isArray(list)) return;\n' +
    '    for (var i = list.length - 1; i >= 0; i--) {\n' +
    '      try { if (typeof list[i] === "function") list[i](); } catch (error) { __EXTENSIONJS_cleanupFailed(error); }\n' +
    '    }\n' +
    '  } catch (error) {}\n' +
    '}\n' +
    'function __EXTENSIONJS_registerCleanup(fn){\n' +
    '  if (typeof fn === "function") __EXTENSIONJS_REGISTERED_CLEANUPS.push(fn);\n' +
    '  return fn;\n' +
    '}\n' +
    at('after-register-cleanup') +
    'function __EXTENSIONJS_composeCleanup(primaryCleanup){\n' +
    '  return function(){\n' +
    '    try { if (typeof primaryCleanup === "function") primaryCleanup(); } catch (error) { __EXTENSIONJS_cleanupFailed(error); }\n' +
    '    try { __EXTENSIONJS_runCleanups(__EXTENSIONJS_REGISTERED_CLEANUPS); } catch (error) {}\n' +
    at('in-composed-cleanup') +
    '  };\n' +
    '}\n' +
    at('after-composed-cleanup') +
    // A shipped MAIN world bundle runs on the host page's own window, where
    // the global would tell any page script an extension is installed.
    (isShippedBundle && isMainWorld
      ? ''
      : 'try {\n' +
        '  if (typeof globalThis === "object" && globalThis) {\n' +
        '    globalThis.__EXTENSIONJS_registerCleanup = __EXTENSIONJS_registerCleanup;\n' +
        '  }\n' +
        '} catch (error) {}\n') +
    at('before-asset-base') +
    // The public path only matters to a bundle that resolves something its
    // module graph brought in, an emitted asset or a split chunk, or to an
    // extension whose runtime loads files of the extension.
    (loadsFiles || hasModuleGraph
      ? 'function __EXTENSIONJS_syncAssetBase(){\n' +
        '  try {\n' +
        '    var base = "";\n' +
        asksRuntime(
          '    try {\n' +
            '      if (typeof globalThis === "object" && globalThis && globalThis.browser && globalThis.browser.runtime && typeof globalThis.browser.runtime.getURL === "function") base = String(globalThis.browser.runtime.getURL("/"));\n' +
            '      else if (typeof globalThis === "object" && globalThis && globalThis.chrome && globalThis.chrome.runtime && typeof globalThis.chrome.runtime.getURL === "function") base = String(globalThis.chrome.runtime.getURL("/"));\n' +
            '    } catch (error) {}\n'
        ) +
        (holdsBridgeBase
          ? '    if (!base) base = __EXTENSIONJS_BRIDGE_BASE;\n'
          : '') +
        '    if (!base) {\n' +
        '      try {\n' +
        `        if (typeof document === "object" && document && document.documentElement) base = String(document.documentElement.getAttribute(${baseAttribute}) || "");\n` +
        '      } catch (error) {}\n' +
        '    }\n' +
        `    ${unlessExtensionAddress('base', baseScheme)}\n` +
        '    if (!base) return false;\n' +
        (takesFromFile
          ? '    if (base[base.length - 1] !== "/") base += "/";\n'
          : '    if (base.charAt(base.length - 1) !== "/") base += "/";\n') +
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
      : '')

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
    at('mount-without-function') +
    '    try { __EXTENSIONJS_scheduleBundleCssHydration(); } catch (error) {}\n' +
    '    return __EXTENSIONJS_composeCleanup(null);\n' +
    '  }\n' +
    '  function apply(){\n' +
    '    try {\n' +
    '      __EXTENSIONJS_snapshotPreMountRoots();\n' +
    '      var nextCleanup = mount();\n' +
    '      cleanup = __EXTENSIONJS_composeCleanup(nextCleanup);\n' +
    at('after-mount') +
    '      try { __EXTENSIONJS_scheduleBundleCssHydration(); } catch (error) {}\n' +
    '    } catch (error) {\n' +
    '      try { console.warn("Extension.js W_CONTENT_SCRIPT_MOUNT: the content script default export failed to run.", error); } catch (ignored) {}\n' +
    at('mount-failed') +
    '    }\n' +
    '  }\n' +
    "  function unmount(){ try { cancelReady && cancelReady(); } catch (error) {} try { if (typeof cleanup === 'function') cleanup(); } catch (error) {} }\n" +
    '  cancelReady = __EXTENSIONJS_whenReady(runAt, apply);\n' +
    '  return unmount;\n' +
    '}\n'

  const projectLoaders = loadersOfTheProject(this, packageJsonDir)
  const defaultExport = readDefaultExport(
    rewrittenSource,
    this.resourcePath,
    projectRelativePath,
    undefined,
    projectLoaders
  )

  const readModule = (
    read: ContentScriptWrapperReadModule['defaultExport']
  ) => {
    for (const extension of extensions) {
      extension.readModule?.({
        source: rewrittenSource,
        isMainWorld,
        file: projectRelativePath,
        resourcePath: resourceAbsPath,
        browser: String(browser),
        isDeclaredEntry: Boolean(declaredEntry),
        defaultExport: read
      })
    }
  }

  if (defaultExport.kind === 'none' && projectLoaders.length > 0) {
    let authored = rewrittenSource

    try {
      authored = fs.readFileSync(this.resourcePath, 'utf8')
    } catch {
      // A module with no file on disk has nothing written to compare.
    }

    if (authored !== rewrittenSource) {
      refuseDefaultExportLostToLoaders(
        authored,
        this.resourcePath,
        projectRelativePath,
        projectLoaders
      )
    }
  }

  if (defaultExport.kind !== 'found') {
    refuseTopLevelAwait(
      rewrittenSource,
      this.resourcePath,
      projectRelativePath,
      Boolean(declaredEntry),
      () => {
        try {
          return fs.readFileSync(this.resourcePath, 'utf8')
        } catch {
          return undefined
        }
      }
    )

    readModule({kind: defaultExport.kind})

    const prefix = `${bootstrap}${runtimeInline}`
    const suffix =
      at('end-before-styles') +
      `try { __EXTENSIONJS_scheduleBundleCssHydration() } catch (error) {
        // Ignore
      }\n` +
      at('end-after-styles')
    // executeScript resolves with the value an injected file ends on. Only
    // a scripts/ file can be injected, and a module it imports is no entry.
    const endsOnItsValue =
      Boolean(isScriptsFolderScript) &&
      !declaredEntry &&
      (options.mainWorldBundle !== true || isRuntimeMainWorld)
    const body = endsOnItsValue
      ? keepCompletionValue(rewrittenSource, this.resourcePath, {
          importsAnotherScript: importsScriptsFile(
            rewrittenSource,
            resourceAbsPath,
            String(scriptsDir)
          )
        })
      : rewrittenSource
    const wrapped = `${prefix}${body}\n${suffix}`

    return returnWithMap(
      this,
      wrapped,
      adjustLoaderSourceMap(
        inputOrIdentityMap(inputSourceMap, this.resourcePath, rewrittenSource),
        {prefix, before: rewrittenSource, after: rewrittenSource}
      )
    )
  }

  const cleaned = defaultExport.code
  const defaultName = String(defaultExport.localName)

  if (defaultExport.removedCalls > 0) {
    this.emitWarning?.(
      new Error(
        messages.topLevelMountCallRemoved(projectRelativePath, defaultName)
      )
    )
  }

  readModule({
    kind: 'found',
    name: defaultName,
    callsElsewhere: defaultExport.keptCalls
  })

  const wrapPrefix = `${bootstrap}${runtimeInline}`
  const wrapSuffix =
    `;\n` +
    defaultExport.binding +
    `var __EXTENSIONJS_cleanup = function(){};\n` +
    // A copy the next injection retired while it waited mounts nothing.
    `try { ${at('before-mount-call')}__EXTENSIONJS_cleanup = __EXTENSIONJS_mount(${MOUNT_NAME}, ${JSON.stringify(
      runAt
    )}) } catch (error) {
      // Ignore
    }\n` +
    at('after-mount-call') +
    (defaultExport.keepsOwnExport ? '' : `export default ${MOUNT_NAME}\n`)
  const wrappedResult = `${wrapPrefix}${cleaned}\n${wrapSuffix}`

  return returnWithMap(
    this,
    wrappedResult,
    adjustLoaderSourceMap(
      inputOrIdentityMap(inputSourceMap, this.resourcePath, rewrittenSource),
      {prefix: wrapPrefix, before: rewrittenSource, after: cleaned}
    )
  )
}
