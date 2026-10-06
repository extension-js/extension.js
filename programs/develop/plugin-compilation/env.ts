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
import {getPreloadedEnvKeys} from '../lib/config-loader'
import {
  CHROMIUM_FAMILY_ALIASES,
  GECKO_FAMILY_ALIASES,
  isChromiumBasedBrowser,
  isGeckoBasedBrowser
} from '../lib/constants'
import {debugLine, isDebug} from '../lib/messaging'
import {setCurrentManifestContent} from '../plugin-web-extension/feature-manifest/manifest-lib/manifest'
import type {DevOptions, PluginInterface} from '../types'
import * as messages from './compilation-lib/messages'
import {WatchEnvFilesPlugin} from './watch-env-files'

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

// The literal lands inside emitted code. JSON.stringify leaves "</script>",
// U+2028/U+2029 and other non-ASCII intact, so those become \u escapes too.
export function toJsStringLiteral(value: string): string {
  return JSON.stringify(value).replace(
    /[<>\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  )
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

function resolveProcessShim(): string | undefined {
  const candidate = path.join(__dirname, '..', 'runtime', 'process-shim.cjs')

  try {
    return fs.existsSync(candidate) ? candidate : undefined
  } catch {
    return undefined
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

function resolveEnvPaths(projectPath: string, envFiles: string[]) {
  const localEnvPath =
    envFiles
      .map((file) => path.join(projectPath, file))
      .find((filePath) => fs.existsSync(filePath)) || ''
  const localDefaultsPath = path.join(projectPath, '.env.defaults')

  if (localEnvPath) {
    return {
      envPath: localEnvPath,
      defaultsPath: localDefaultsPath
    }
  }

  const workspaceRoot = findNearestWorkspaceRoot(projectPath)

  if (workspaceRoot && workspaceRoot !== projectPath) {
    const workspaceEnvPath =
      envFiles
        .map((file) => path.join(workspaceRoot, file))
        .find((filePath) => fs.existsSync(filePath)) || ''
    const workspaceDefaultsPath = path.join(workspaceRoot, '.env.defaults')

    if (workspaceEnvPath || fs.existsSync(workspaceDefaultsPath)) {
      return {
        // .env.defaults is the always-merged layer and is deliberately not a
        // selectable file, so a local one must not cancel the root search.
        // A local one still wins over the root's for the keys it declares.
        envPath: workspaceEnvPath,
        defaultsPath: fs.existsSync(localDefaultsPath)
          ? localDefaultsPath
          : workspaceDefaultsPath,
        fallbackDefaultsPath: fs.existsSync(localDefaultsPath)
          ? workspaceDefaultsPath
          : undefined
      }
    }
  }

  if (fs.existsSync(localDefaultsPath)) {
    return {
      envPath: localEnvPath,
      defaultsPath: localDefaultsPath
    }
  }

  return {
    envPath: '',
    defaultsPath: localDefaultsPath
  }
}

// Env files resolve family-wide, mirroring the manifest-prefix contract; the
// exact browser name wins, Safari/webkit inherit the chromium family.
export function getEnvFileCandidates(
  browser: DevOptions['browser'],
  mode: string
): string[] {
  const browserName = String(browser)
  const isChromiumTarget =
    isChromiumBasedBrowser(browserName) ||
    browserName === 'safari' ||
    browserName.includes('webkit')

  const familyNames = isChromiumTarget
    ? CHROMIUM_FAMILY_ALIASES
    : isGeckoBasedBrowser(browserName)
      ? GECKO_FAMILY_ALIASES
      : []
  const names = [
    browserName,
    ...familyNames.filter((name) => name !== browserName)
  ]

  return [
    ...names.flatMap((name) => [`.env.${name}.${mode}`, `.env.${name}`]),
    `.env.${mode}`,
    '.env.local',
    '.env'
  ]
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

    const {envPath, defaultsPath, fallbackDefaultsPath} = resolveEnvPaths(
      projectPath,
      envFiles
    )

    if (isDebug()) {
      debugLine(messages.envSelectedFile(envPath))
    }

    // Watch every path resolveEnvPaths consults, not only the one it picked,
    // so creating a better match mid-session counts as a change as well.
    if (projectPath && compiler.options.watchOptions) {
      new WatchEnvFilesPlugin([
        ...envFiles.map((file) => path.join(projectPath, file)),
        path.join(projectPath, '.env.defaults'),
        envPath,
        defaultsPath,
        fallbackDefaultsPath
      ]).apply(compiler)
    }

    // The project ships .env files but none match this browser/mode; every
    // EXTENSION_PUBLIC_* read would be undefined, so surface a build warning.
    if (!envPath && projectPath) {
      let unmatchedEnvFiles: string[] = []

      try {
        unmatchedEnvFiles = fs
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

      if (unmatchedEnvFiles.length > 0) {
        compiler.hooks.thisCompilation.tap(
          'env:warn-unmatched',
          (compilation) => {
            const warn = new WebpackError(
              messages.envNoMatchingFile(
                String(this.browser),
                String(mode),
                unmatchedEnvFiles,
                envFiles
              )
            ) as Error & {file?: string; name?: string}
            warn.name = 'EnvNoMatchingFile'
            compilation.warnings.push(warn)
          }
        )
      }
    }

    // dotenv.parse (not .config) on purpose: .config mutates process.env, which
    // wins the merge, so the first build's values would leak into later builds.
    const envVars = envPath ? dotenv.parse(fs.readFileSync(envPath)) : {}
    const readDefaults = (filePath: string | undefined) =>
      filePath && fs.existsSync(filePath)
        ? dotenv.parse(fs.readFileSync(filePath))
        : {}
    const defaultsVars = {
      ...readDefaults(fallbackDefaultsPath),
      ...readDefaults(defaultsPath)
    }

    // process.env is the highest precedence layer because a shell or CI value
    // must win. Keys the config loader itself put there by reading a dotenv
    // file are not shell values, so they are dropped back to their file layer,
    // otherwise .env.defaults would outrank the selected .env.<browser> file.
    const preloadedKeys = getPreloadedEnvKeys()
    const systemEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !preloadedKeys.has(key))
    )

    const combinedVars = {
      ...defaultsVars,
      ...envVars,
      ...systemEnv
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
    const importMetaEnvObject: Record<string, unknown> = {}

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

    // Provide a real browser process object so free process.* reads don't throw;
    // EXTENSION_PUBLIC_* reads are still statically inlined and tree-shakeable.
    const processShim = resolveProcessShim()

    if (!processShim) {
      // Fallback (shim missing from the install): merge a minimal-but-complete
      // stub into the single DefinePlugin so bundled `process` access is safe.
      filteredEnvVars['process.env'] = '{}'
      filteredEnvVars.process =
        '({env:{},argv:[],platform:"browser",browser:true,versions:{},nextTick:function(cb){Promise.resolve().then(function(){cb()})}})'
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

    if (processShim) {
      new ProvidePlugin({process: processShim}).apply(compiler)
    }

    // JSON/HTML `$VAR` templating must resolve to the same values JS sees at
    // runtime (DefinePlugin + env files). Build one lookup shared by every asset.
    const templateVars = buildTemplateVars(combinedVars, this.browser, mode)

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
    if (typeof value === 'string' && key.startsWith('EXTENSION_')) {
      vars[key] = value
    }
  }

  // Always win: same overrides DefinePlugin applies after reading .env files.
  const browserValue = String(browser)
  const modeValue = String(mode)
  vars.EXTENSION_BROWSER = browserValue
  vars.EXTENSION_PUBLIC_BROWSER = browserValue
  vars.EXTENSION_MODE = modeValue
  vars.EXTENSION_PUBLIC_MODE = modeValue

  return vars
}
