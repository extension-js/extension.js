//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  Compilation,
  type Compiler,
  DefinePlugin,
  ProvidePlugin,
  sources,
  WebpackError
} from '@rspack/core'
import * as dotenv from 'dotenv'
import {envFileCandidates, getPreloadedEnvKeys} from '../lib/config-loader'
import {
  CHROMIUM_FAMILY_ALIASES,
  GECKO_FAMILY_ALIASES,
  SUPPORTED_BROWSERS,
  WEBKIT_BASED_BROWSERS
} from '../lib/constants'
import {debugLine, isDebug} from '../lib/messaging'
import {setCurrentManifestContent} from '../plugin-web-extension/feature-manifest/manifest-lib/manifest'
import type {DevOptions, PluginInterface} from '../types'
import {toJsStringLiteral} from './compilation-lib/js-literal'
import * as messages from './compilation-lib/messages'
import {processModuleRequest} from './process-module'
import {WatchEnvFilesPlugin} from './watch-env-files'

export {toJsStringLiteral}

// Extension pages and workers keep their own URL, content scripts get the
// extension root, and a MAIN world script without a runtime gets the page URL.
export const IMPORT_META_URL_RUNTIME =
  '(function(){var h=typeof document!=="undefined"&&document.baseURI||self.location.href;try{var g=globalThis,r=(g.browser||g.chrome).runtime.getURL("/");return h.indexOf(r)===0?h:r}catch(_){return h}})()'

// A file the runtime loads by URL is emitted at one known path, so its
// import.meta.url is that path. Without a runtime (MAIN world) the page URL stands in.
export function importMetaUrlForEmitPath(emitPath: string): string {
  const request = emitPath.replace(/\\/g, '/').replace(/^\/+/, '')

  return `(function(){try{var g=globalThis;return (g.browser||g.chrome).runtime.getURL(${toJsStringLiteral(request)})}catch(_){return ${IMPORT_META_URL_RUNTIME}}})()`
}

export function escapeForJsonAsset(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

function rawTextElementAt(content: string, offset: number) {
  const before = content.slice(0, offset).toLowerCase()

  for (const tag of ['script', 'style'] as const) {
    const open = before.lastIndexOf(`<${tag}`)
    const openEnd = before.indexOf('>', open)

    if (
      open !== -1 &&
      open > before.lastIndexOf(`</${tag}`) &&
      openEnd !== -1
    ) {
      return {tag, textStart: openEnd + 1}
    }
  }

  return undefined
}

// Walks code up to the placeholder and reports whether it sits inside a
// string literal. Comments are skipped so a quote in one does not flip it.
function insideStringLiteral(
  text: string,
  quotes: string,
  templates: boolean
): boolean {
  let quote = ''
  // Depth of open braces per template expression the scan is inside
  const expressions: number[] = []

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (quote) {
      if (char === '\\') i++
      else if (quote === '`' && char === '$' && text[i + 1] === '{') {
        expressions.push(0)
        quote = ''
        i++
      } else if (char === quote) quote = ''

      continue
    }

    if (char === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      if (end === -1) return false

      i = end
    } else if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end === -1) return false

      i = end + 1
    } else if (quotes.includes(char) || (templates && char === '`')) {
      quote = char
    } else if (expressions.length && char === '{') {
      expressions[expressions.length - 1]++
    } else if (expressions.length && char === '}') {
      if (expressions[expressions.length - 1] === 0) {
        expressions.pop()
        quote = '`'
      } else {
        expressions[expressions.length - 1]--
      }
    }
  }

  return quote !== ''
}

export function isInsideJsonString(content: string, offset: number): boolean {
  return insideStringLiteral(content.slice(0, offset), '"', false)
}

// A quoted placeholder takes a JSON string body. A bare one stands where a
// JSON value goes, so it is inserted as written and the caller checks it parses.
export function substituteForJsonAsset(
  content: string,
  offset: number,
  value: string
): string {
  return isInsideJsonString(content, offset) ? escapeForJsonAsset(value) : value
}

// Markup sinks take entities, which decode the same in attributes and text.
// A <script> never decodes entities: a quoted placeholder takes a JS string
// body, a bare one is code and only loses the power to close the tag.
export function escapeForHtmlAsset(
  content: string,
  offset: number,
  value: string
): string {
  const element = rawTextElementAt(content, offset)

  if (element?.tag === 'script') {
    const script = content.slice(element.textStart, offset)

    if (!insideStringLiteral(script, '"\'', true)) {
      return value.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
    }

    return toJsStringLiteral(value)
      .slice(1, -1)
      .replace(/'/g, '\\u0027')
      .replace(/`/g, '\\u0060')
      .replace(/\$\{/g, '\\u0024{')
  }

  if (element?.tag === 'style') {
    return value
  }

  return value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char])
}

function parsesAsJson(text: string): boolean {
  try {
    JSON.parse(text)

    return true
  } catch {
    return false
  }
}

function findNearestWorkspaceRoot(startDir: string): string | undefined {
  let current = path.isAbsolute(startDir)
    ? path.normalize(startDir)
    : path.resolve(startDir)

  while (true) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current
    }

    const parent = path.dirname(current)

    if (parent === current) {
      return undefined
    }

    current = parent
  }
}

const ENV_DEFAULTS_FILE = '.env.defaults'

// Every matching file of one folder is read, never one folder's files mixed
// with another's. Only .env.defaults falls through from the workspace root.
function resolveEnvLayers(projectPath: string, layerNames: string[]) {
  const matchedIn = (dir: string) =>
    layerNames
      .filter((file) => file !== ENV_DEFAULTS_FILE)
      .map((file) => path.join(dir, file))
      .filter((filePath) => fs.existsSync(filePath))
  const localDefaultsPath = path.join(projectPath, ENV_DEFAULTS_FILE)
  const localMatched = matchedIn(projectPath)

  if (localMatched.length > 0) {
    return {
      envDir: projectPath,
      defaultsPaths: [localDefaultsPath],
      matchedPaths: localMatched
    }
  }

  const workspaceRoot = findNearestWorkspaceRoot(projectPath)

  if (workspaceRoot && workspaceRoot !== projectPath) {
    const workspaceDefaultsPath = path.join(workspaceRoot, ENV_DEFAULTS_FILE)
    const workspaceMatched = matchedIn(workspaceRoot)

    if (workspaceMatched.length > 0 || fs.existsSync(workspaceDefaultsPath)) {
      return {
        envDir: workspaceRoot,
        // .env.defaults is the always-merged layer and matches no target, so
        // a local one does not cancel the root search. It still wins by key.
        defaultsPaths: [workspaceDefaultsPath, localDefaultsPath],
        matchedPaths: workspaceMatched
      }
    }
  }

  return {
    envDir: projectPath,
    defaultsPaths: [localDefaultsPath],
    matchedPaths: [] as string[]
  }
}

// One list for the config file and the bundle, strongest first. The config
// loader owns it, so the two can never read different files or another order.
export function getEnvFileCandidates(
  browser: DevOptions['browser'],
  mode: string
): string[] {
  return envFileCandidates(mode, String(browser))
}

// Weakest first: .env.defaults, then the shared candidates from last to
// first, which is how the config loader layers them before the config runs.
export function getEnvFileLayers(
  browser: DevOptions['browser'],
  mode: string
): string[] {
  return [ENV_DEFAULTS_FILE, ...getEnvFileCandidates(browser, mode).reverse()]
}

// The build sets these from its own target after the env files are read, so
// a file can never change them. BROWSER and MODE are left to other tools.
const RESERVED_ENV_NAMES: Record<string, 'browser' | 'mode'> = {
  EXTENSION_PUBLIC_BROWSER: 'browser',
  EXTENSION_BROWSER: 'browser',
  EXTENSION_PUBLIC_MODE: 'mode',
  EXTENSION_MODE: 'mode'
}

const KNOWN_ENV_MODES = new Set(['development', 'production', 'test', 'none'])
const KNOWN_ENV_BROWSERS = new Set([
  ...SUPPORTED_BROWSERS,
  ...CHROMIUM_FAMILY_ALIASES,
  ...GECKO_FAMILY_ALIASES,
  ...WEBKIT_BASED_BROWSERS
])

// A file named for another mode or browser is kept on purpose, so a production
// build leaves .env.development alone instead of asking for a rename.
export function isEnvFileForAnotherTarget(file: string): boolean {
  const parts = file.split('.').slice(2)

  if (parts.length === 1) {
    return KNOWN_ENV_MODES.has(parts[0]) || KNOWN_ENV_BROWSERS.has(parts[0])
  }

  return (
    parts.length === 2 &&
    KNOWN_ENV_BROWSERS.has(parts[0]) &&
    KNOWN_ENV_MODES.has(parts[1])
  )
}

const SECRET_SEGMENTS = new Set([
  'SECRET',
  'TOKEN',
  'PASSWORD',
  'PASSWD',
  'PRIVATE'
])
const KEY_QUALIFIERS = new Set(['API', 'ACCESS', 'AUTH', 'SECRET', 'PRIVATE'])

// Whole name segments only, so KEYBOARD or TOKENIZER never match. A name that
// says PUBLISHABLE is public by design, the way a Stripe publishable key is.
export function looksLikeSecretName(name: string): boolean {
  const segments = name
    .replace(/^EXTENSION_PUBLIC_/, '')
    .toUpperCase()
    .split('_')
    .filter(Boolean)

  if (segments.includes('PUBLISHABLE')) return false
  if (segments.some((segment) => SECRET_SEGMENTS.has(segment))) return true

  return segments.some(
    (segment, index) =>
      segment === 'KEY' && index > 0 && KEY_QUALIFIERS.has(segments[index - 1])
  )
}

export class EnvPlugin {
  public readonly browser: DevOptions['browser']
  public readonly manifestPath?: string
  public readonly define?: Record<string, unknown>

  constructor(options: Partial<PluginInterface>) {
    this.browser = options.browser || 'chrome'
    this.manifestPath = options.manifestPath
    this.define = options.define
  }

  apply(compiler: Compiler) {
    const projectPath =
      (compiler.options.context as string) ||
      (this.manifestPath ? path.dirname(this.manifestPath) : '')
    const mode = compiler.options.mode || 'development'

    // Collect .env files by browser (family-wide) and mode. .env.example is
    // intentionally NOT included: placeholder values, never a real source.
    const envFiles = getEnvFileCandidates(this.browser, mode)
    const envLayers = getEnvFileLayers(this.browser, mode)
    const {envDir, defaultsPaths, matchedPaths} = resolveEnvLayers(
      projectPath,
      envLayers
    )

    if (isDebug()) {
      debugLine(messages.envSelectedFile(matchedPaths))
    }

    // Watch every layer of each folder consulted, present or not, so writing
    // a file that was missing mid-session counts as a change as well.
    if (projectPath && compiler.options.watchOptions) {
      new WatchEnvFilesPlugin(
        [...new Set([projectPath, envDir])].flatMap((dir) =>
          envLayers.map((file) => path.join(dir, file))
        )
      ).apply(compiler)
    }

    // dotenv.parse (not .config) on purpose: .config mutates process.env, which
    // wins the merge, so the first build's values would leak into later builds.
    const fileVars: Record<string, string> = {}
    const fileOfVar = new Map<string, string>()

    // Later layers override earlier ones key by key, so the last file wins.
    for (const filePath of [...defaultsPaths, ...matchedPaths]) {
      if (!fs.existsSync(filePath)) continue

      for (const [key, value] of Object.entries(
        dotenv.parse(fs.readFileSync(filePath))
      )) {
        fileVars[key] = value
        fileOfVar.set(key, path.basename(filePath))
      }
    }

    // process.env is the highest precedence layer because a shell or CI value
    // must win. Keys the config loader itself put there by reading a dotenv
    // file are not shell values, so they are dropped back to their file layer,
    // otherwise .env.defaults would outrank a stronger .env.<browser> file.
    const preloadedKeys = getPreloadedEnvKeys()
    const systemEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !preloadedKeys.has(key))
    )

    const combinedVars = {
      ...fileVars,
      ...systemEnv
    }

    // The project ships .env files but none match this browser and mode. A
    // file named for another target is skipped quietly, any other earns a warning.
    if (matchedPaths.length === 0 && projectPath) {
      let presentEnvFiles: string[] = []

      try {
        presentEnvFiles = fs
          .readdirSync(projectPath)
          .filter(
            (file) =>
              file.startsWith('.env') &&
              file !== '.env.defaults' &&
              file !== '.env.example'
          )
          .sort()
      } catch {
        // unreadable project dir, nothing to warn about
      }

      const ignoredEnvFiles = presentEnvFiles.filter(isEnvFileForAnotherTarget)
      const unmatchedEnvFiles = presentEnvFiles.filter(
        (file) => !isEnvFileForAnotherTarget(file)
      )

      if (ignoredEnvFiles.length > 0 && isDebug()) {
        debugLine(messages.envIgnoredFiles(ignoredEnvFiles, String(mode)))
      }

      if (unmatchedEnvFiles.length > 0) {
        // Values extension.config.js or the shell put on process.env still
        // reach the bundle, so "undefined" is said only when nothing did.
        const publicValuesDefined = Object.keys(combinedVars).some(
          (key) =>
            key.startsWith('EXTENSION_PUBLIC_') &&
            String(combinedVars[key] ?? '') !== ''
        )

        compiler.hooks.thisCompilation.tap(
          'env:warn-unmatched',
          (compilation) => {
            const warn = new WebpackError(
              messages.envNoMatchingFile(
                String(this.browser),
                String(mode),
                unmatchedEnvFiles,
                envFiles,
                publicValuesDefined
              )
            ) as Error & {file?: string; name?: string}
            warn.name = 'EnvNoMatchingFile'
            compilation.warnings.push(warn)
          }
        )
      }
    }

    // Every EXTENSION_PUBLIC_* value is inlined into the bundle that ships to
    // users and stores, so a production build names any that looks secret.
    if (mode === 'production') {
      const secretLooking = Object.keys(combinedVars)
        .filter((key) => key.startsWith('EXTENSION_PUBLIC_'))
        .filter((key) => String(combinedVars[key] ?? '') !== '')
        .filter(looksLikeSecretName)
        .sort()

      if (secretLooking.length > 0) {
        compiler.hooks.thisCompilation.tap(
          'env:warn-public-secret',
          (compilation) => {
            const warn = new WebpackError(
              messages.envPublicSecretName(secretLooking)
            ) as Error & {name?: string}
            warn.name = 'EnvPublicSecretName'
            compilation.warnings.push(warn)
          }
        )
      }
    }

    // A reserved name in a file loses to the build target without a word, so
    // the build names it. A value that already agrees changes nothing.
    const targetOf = {browser: String(this.browser), mode: String(mode)}
    const reservedInFiles = Object.keys(fileVars)
      .filter(
        (key) =>
          Object.prototype.hasOwnProperty.call(RESERVED_ENV_NAMES, key) &&
          fileVars[key] !== targetOf[RESERVED_ENV_NAMES[key]]
      )
      .sort()
      .map((name) => ({name, file: fileOfVar.get(name) || ''}))

    if (reservedInFiles.length > 0) {
      compiler.hooks.thisCompilation.tap(
        'env:warn-reserved-name',
        (compilation) => {
          const warn = new WebpackError(
            messages.envReservedName(reservedInFiles)
          ) as Error & {name?: string}
          warn.name = 'EnvReservedName'
          compilation.warnings.push(warn)
        }
      )
    }

    const filteredEnvVars = Object.keys(combinedVars)
      .filter((key) => key.startsWith('EXTENSION_PUBLIC_'))
      .reduce(
        (obj, key) => {
          obj[`process.env.${key}`] = JSON.stringify(combinedVars[key])
          obj[`import.meta.env.${key}`] = JSON.stringify(combinedVars[key])

          return obj
        },
        {} as Record<string, string>
      )

    filteredEnvVars['process.env.EXTENSION_PUBLIC_BROWSER'] = JSON.stringify(
      this.browser
    )

    filteredEnvVars['import.meta.env.EXTENSION_PUBLIC_BROWSER'] =
      JSON.stringify(this.browser)

    filteredEnvVars['process.env.EXTENSION_PUBLIC_MODE'] = JSON.stringify(mode)
    filteredEnvVars['import.meta.env.EXTENSION_PUBLIC_MODE'] =
      JSON.stringify(mode)

    filteredEnvVars['process.env.EXTENSION_BROWSER'] = JSON.stringify(
      this.browser
    )

    filteredEnvVars['import.meta.env.EXTENSION_BROWSER'] = JSON.stringify(
      this.browser
    )

    filteredEnvVars['process.env.EXTENSION_MODE'] = JSON.stringify(mode)
    filteredEnvVars['import.meta.env.EXTENSION_MODE'] = JSON.stringify(mode)

    filteredEnvVars['process.env.BROWSER'] = JSON.stringify(this.browser)
    filteredEnvVars['import.meta.env.BROWSER'] = JSON.stringify(this.browser)
    filteredEnvVars['process.env.MODE'] = JSON.stringify(mode)
    filteredEnvVars['import.meta.env.MODE'] = JSON.stringify(mode)

    // Define bare import.meta.env as an object of every injected var (Vite
    // parity); otherwise rspack rewrites it to (void 0) and reads crash at boot.
    const importMetaEnvObject: Record<string, string> = {}

    for (const [key, value] of Object.entries(filteredEnvVars)) {
      if (key.startsWith('import.meta.env.')) {
        importMetaEnvObject[key.slice('import.meta.env.'.length)] =
          JSON.parse(value)
      }
    }

    filteredEnvVars['import.meta.env'] = JSON.stringify(importMetaEnvObject)

    // Neutralize Node-only import.meta.dirname/filename: vendored ESM runtimes
    // reference them in dead branches that otherwise fail classic-chunk minification.
    filteredEnvVars['import.meta.dirname'] = 'undefined'
    filteredEnvVars['import.meta.filename'] = 'undefined'

    // Dependencies written for Node read the free variable `global`. Point it
    // at globalThis, rspack's own global shim is off (node.global in rspack-config).
    filteredEnvVars.global = 'globalThis'

    // User constants from extension.config.js, serialized the way Vite's
    // define does, last so they win over anything the env files produced.
    for (const [key, value] of Object.entries(this.define || {})) {
      filteredEnvVars[key] = JSON.stringify(value)
    }

    const injectedCount = Object.keys(filteredEnvVars).filter((k) =>
      k.startsWith('process.env.EXTENSION_PUBLIC_')
    ).length

    if (isDebug()) {
      debugLine(messages.envInjectedPublicVars(injectedCount))
    }

    new DefinePlugin(filteredEnvVars).apply(compiler)

    // rspack inlines a bare import.meta.url as the module's file:// path, which
    // ships the build machine's folders. new URL(x, import.meta.url) keeps its own rewrite.
    const importMetaUrl = new DefinePlugin({
      'import.meta.url': IMPORT_META_URL_RUNTIME
    })

    // Scoped to this compilation so child compilers do not inherit it: a
    // runtime-loaded file is compiled in one and defines its own emit path.
    importMetaUrl.affectedHooks = 'thisCompilation'
    importMetaUrl.apply(compiler)

    // A dotted process.env.KEY read is inlined above and never gets here. Any
    // other read of process is answered by a module generated for this build.
    new ProvidePlugin({
      process: processModuleRequest(importMetaEnvObject)
    }).apply(compiler)

    // JSON/HTML `$VAR` templating must resolve to the same values JS sees at
    // runtime (DefinePlugin + env files). Build one lookup shared by every asset.
    const templateVars = buildTemplateVars(combinedVars, this.browser, mode)
    const privateNames = findPrivateTemplateNames(combinedVars, templateVars)

    compiler.hooks.thisCompilation.tap(
      'manifest:update-manifest',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'env:module',
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
          },
          (assets) => {
            // Prefer compilation assets to be robust against different bundler versions
            const files = Object.keys(compilation.assets || assets)
            const unfilled = new Map<string, Set<string>>()

            files.forEach((filename) => {
              if (filename.endsWith('.json') || filename.endsWith('.html')) {
                const isJsonAsset = filename.endsWith('.json')
                const original = String(
                  compilation.assets[filename]?.source() ?? ''
                )
                const substituted = new Set<string>()

                // A value is escaped for the sink it lands in, so a quote,
                // a backslash or a < keeps its authored meaning in the asset.
                const resolveVar = (name: string, offset: number): string => {
                  if (
                    !Object.prototype.hasOwnProperty.call(templateVars, name)
                  ) {
                    // A name that is set but private is worth a warning. An
                    // unset name stays quiet, the way a typo always has.
                    if (privateNames.has(name)) {
                      unfilled.set(
                        name,
                        (unfilled.get(name) || new Set()).add(filename)
                      )
                    }

                    // Preserve the placeholder when the var is unknown, matching
                    // the pre-substitution form so authors can spot typos.
                    return `$${name}`
                  }

                  substituted.add(name)

                  return isJsonAsset
                    ? substituteForJsonAsset(
                        original,
                        offset,
                        templateVars[name]
                      )
                    : escapeForHtmlAsset(original, offset, templateVars[name])
                }

                // Digits are valid env-name characters (e.g. EXTENSION_PUBLIC_API_V2).
                const placeholder = /\$EXTENSION_[A-Z0-9_]+/g
                const fileContent = original.replace(
                  placeholder,
                  (match: string, offset: number) =>
                    resolveVar(match.slice(1), offset)
                )

                // Only the substitution is judged: a file that would not parse
                // with a harmless value in each slot was never strict JSON.
                const parsedBefore = () =>
                  parsesAsJson(
                    original.replace(
                      placeholder,
                      (match: string, offset: number) =>
                        !substituted.has(match.slice(1))
                          ? match
                          : isInsideJsonString(original, offset)
                            ? ''
                            : 'null'
                    )
                  )

                if (
                  isJsonAsset &&
                  substituted.size > 0 &&
                  !parsesAsJson(fileContent) &&
                  parsedBefore()
                ) {
                  const error = new WebpackError(
                    messages.envValueBreaksJsonAsset(filename, [...substituted])
                  ) as Error & {file?: string; name?: string}
                  error.name = 'EnvValueBreaksJsonAsset'
                  error.file = filename
                  compilation.errors.push(error)
                }

                compilation.updateAsset(
                  filename,
                  new sources.RawSource(fileContent)
                )

                if (filename === 'manifest.json') {
                  setCurrentManifestContent(compilation, fileContent)
                }
              }
            })

            if (unfilled.size > 0) {
              const warn = new WebpackError(
                messages.envPrivatePlaceholder(
                  [...unfilled.keys()].sort().map((name) => ({
                    name,
                    assets: [...(unfilled.get(name) || [])].sort()
                  }))
                )
              ) as Error & {name?: string}
              warn.name = 'EnvPrivatePlaceholder'
              compilation.warnings.push(warn)
            }
          }
        )
      }
    )
  }
}

export function buildTemplateVars(
  combinedVars: Record<string, unknown>,
  browser: DevOptions['browser'],
  mode: string
): Record<string, string> {
  const vars: Record<string, string> = {}

  for (const [key, value] of Object.entries(combinedVars)) {
    // Same gate as JavaScript: an emitted asset ships to every user, so a
    // value without the public prefix never reaches one.
    if (typeof value === 'string' && key.startsWith('EXTENSION_PUBLIC_')) {
      vars[key] = value
    }
  }

  // Always win: same overrides DefinePlugin applies after reading .env files.
  // These four are the build target, the only names filled without a variable.
  const browserValue = String(browser)
  const modeValue = String(mode)
  vars.EXTENSION_BROWSER = browserValue
  vars.EXTENSION_PUBLIC_BROWSER = browserValue
  vars.EXTENSION_MODE = modeValue
  vars.EXTENSION_PUBLIC_MODE = modeValue

  return vars
}

// Names set in the environment but held back from placeholders, so a build
// can tell a private variable apart from a typo.
export function findPrivateTemplateNames(
  combinedVars: Record<string, unknown>,
  templateVars: Record<string, string>
): Set<string> {
  return new Set(
    Object.keys(combinedVars).filter(
      (key) => !Object.prototype.hasOwnProperty.call(templateVars, key)
    )
  )
}
