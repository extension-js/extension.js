//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import colors from 'pintor'

// Prefix candidates (try swapping if desired): '►', '›', '→', '—'
function getLoggingPrefix(type: 'warn' | 'info' | 'error' | 'success'): string {
  const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'

  if (isAuthor) {
    // Author mode: magenta, clearly branded, keeps three-element prefix shape
    const base = type === 'error' ? 'ERROR Author says' : '►►► Author says'
    return colors.brightMagenta(base)
  }

  if (type === 'error') return colors.red('ERROR')
  if (type === 'warn') return colors.brightYellow('►►►')
  if (type === 'info') return colors.gray('►►►')
  return colors.green('►►►')
}

// Standard code style across all messages
const code = (text: string) => colors.blue(text)
// Helper to ensure arguments are gray
const arg = (text: string) => colors.gray(text)

// Pretty-format helpers for human-readable, Vercel-like tone
export const fmt = {
  heading: (title: string) => colors.underline(colors.blue(title)),
  label: (k: string) => colors.gray(k.toUpperCase()),
  val: (v: string) => colors.underline(v),
  code: (v: string) => colors.blue(v),
  bullet: (s: string) => `- ${s}`,
  block(title: string, rows: Array<[string, string]>): string {
    const head = fmt.heading(title)
    const body = rows.map(([k, v]) => `${fmt.label(k)} ${v}`).join('\n')
    return `${head}\n${body}`
  },
  truncate(input: unknown, max = 800): string {
    const s = (() => {
      try {
        return typeof input === 'string' ? input : JSON.stringify(input)
      } catch {
        return String(input)
      }
    })()
    return s.length > max ? s.slice(0, max) + '…' : s
  }
}

export const commandDescriptions = {
  create:
    'Creates a new extension from a template (React, TypeScript, Vue, Svelte, etc.)',
  dev: 'Starts the development server with hot reloading',
  start: 'Builds and starts the extension in production mode',
  preview: 'Previews the extension in production mode without building',
  build: 'Builds the extension for packaging/distribution',
  install: 'Installs a managed browser binary into Extension.js cache',
  uninstall: 'Removes managed browser binaries from Extension.js cache'
} as const

export function unhandledError(err: unknown) {
  const message =
    err instanceof Error
      ? err.stack || err.message
      : typeof err === 'string'
        ? err
        : fmt.truncate(err)
  return `${getLoggingPrefix('error')} ${colors.red(String(message || 'Unknown error'))}`
}

export function updateFailed(err: any) {
  return `${getLoggingPrefix('error')} Failed to check for updates.\n${colors.red(String(err?.message || err))}`
}

export function checkUpdates(
  packageJson: Record<string, any>,
  update: {latest: string}
) {
  const suffix = colors.gray(`(version ${String(update.latest)} is available!)`)
  const message =
    `${getLoggingPrefix('info')} 🧩 ${colors.blue('Extension.js')} update available.\n\n` +
    `You are currently using version ${colors.red(String(packageJson.version))}. ` +
    `Latest stable is ${colors.green(String(update.latest))}.\n` +
    `Update to the latest stable to get fixes and new features.`

  return {suffix, message}
}

export function unsupportedNodeVersion() {
  return (
    `${getLoggingPrefix('error')} You are using an unsupported Node version.\n` +
    `${colors.red(`${process.version}. Please update to a version higher than 18.`)}`
  )
}

export function noURLWithoutStart(argument: string) {
  return (
    `The default ${colors.gray('create')} command does not accept URLs.\n` +
    `If you meant to start from a URL, use ${colors.gray('start')}:\n` +
    `${code(`npx extension@latest start ${arg(argument)}`)}`
  )
}

export function notImplemented(argument: string) {
  return `${getLoggingPrefix('error')} ${arg(argument)} command not implemented yet.\n${colors.red('NOT IMPLEMENTED')}`
}

export function programUserHelp() {
  return `\n${getLoggingPrefix('info')} ${colors.underline('Help center for the Extension.js program')}

${'Usage:'} extension [command] [options]

${'Notes'}
- All high-level commands offer their own \`--help\` with usage and flag lists.

${'Example'}
- ${code('extension create --help')} outputs information about the "create" command.

${'Available Commands'}
- ${code('extension create ' + arg('<project-name|project-path>'))}
  ${commandDescriptions.create}

- ${code('extension dev ' + arg('[project-path|remote-url]'))}
  ${commandDescriptions.dev}

- ${code('extension start ' + arg('[project-path|remote-url]'))}
  ${commandDescriptions.start}

- ${code('extension preview ' + arg('[project-path|remote-url]'))}
  ${commandDescriptions.preview}

- ${code('extension build ' + arg('[project-path|remote-url]'))}
  ${commandDescriptions.build}

- ${code('extension install ' + arg('--browser <chrome|chromium|edge|firefox|chromium-based|gecko-based|firefox-based|all>'))}
  ${commandDescriptions.install}

- ${code('extension install --where')}
  Prints the managed browser cache root (or browser install path(s) when --browser is provided)

- ${code('extension uninstall ' + arg('<chrome|chromium|edge|firefox> | --all'))}
  ${commandDescriptions.uninstall}

- ${code('extension uninstall --where')}
  Prints the managed browser cache root (or browser install path(s) when --browser/--all is provided)

${'Common Options'}
- ${code('--browser')} ${arg('<chrome|edge|firefox|chromium|chromium-based|gecko-based|firefox-based>')} Target browser/engine (default: chromium)
- ${code('--profile')} ${arg('<path|boolean>')}        Browser profile configuration
- ${code('--polyfill')} ${arg('[boolean]')}            Enable/disable cross-browser polyfill
- ${code('--no-telemetry')}                            Disable anonymous telemetry for this run
- ${code('--ai-help')}                                 Show AI-assistant oriented help and tips
- ${code('--format')} ${arg('<pretty|json>')}          Output format for ${code('--ai-help')} (default: pretty)
- ${code('--help')}                                    Show help output
- ${code('--port')} ${arg('<number>')}                 Development server port (default: 8080)
- ${code('--starting-url')} ${arg('<url>')}            Initial URL to load in browser
- ${code('--silent')} ${arg('[boolean]')}              Suppress console output during build

${'Source Inspection (dev command)'}
- ${code('--source')} ${arg('<url|boolean>')}         Open URL and print HTML after content scripts inject (dev only)
  - When provided without a URL, falls back to ${arg('--starting-url')} or ${arg('https://example.com')}
  - For ${code('extension dev')}, watch mode is enabled by default when ${code('--source')} is present
- ${arg('Note:')} ${code('extension preview')} and ${code('extension start')} do not run source inspection in run-only preview mode.
- ${code('--watch-source')} ${arg('[boolean]')}       Re-print HTML on rebuilds or file changes
- ${code('--source-format')} ${arg('<pretty|json|ndjson>')} Output format for page HTML (defaults to ${code('--log-format')} when present)
- ${code('--source-summary')} ${arg('[boolean]')}     Output a compact summary instead of full HTML
- ${code('--source-meta')} ${arg('[boolean]')}        Output page metadata (readyState, viewport, frames)
- ${code('--source-probe')} ${arg('<selectors>')}     Comma-separated CSS selectors to probe
- ${code('--source-tree')} ${arg('<off|root-only>')}  Output a compact extension root tree
- ${code('--source-console')} ${arg('[boolean]')}     Output console summary (best-effort)
- ${code('--source-dom')} ${arg('[boolean]')}         Output DOM snapshots and diffs
- ${code('--source-max-bytes')} ${arg('<bytes>')}      Limit HTML output size (0 disables truncation)
- ${code('--source-redact')} ${arg('<off|safe|strict>')} Redact sensitive HTML content (default: safe for JSON/NDJSON)
- ${code('--source-include-shadow')} ${arg('<off|open-only|all>')} Control Shadow DOM inclusion (default: open-only)
- ${code('--source-diff')} ${arg('[boolean]')}        Include diff metadata on watch updates

${'Browser-Specific Options'}
- ${code('--chromium-binary')} ${arg('<path>')}        Custom Chromium binary path
- ${code('--gecko-binary')}/${code('--firefox-binary')} ${arg('<path>')}           Custom Firefox/Gecko binary path

${'Build Options'}
- ${code('--zip')} ${arg('[boolean]')}                 Create ZIP archive of built extension
- ${code('--zip-source')} ${arg('[boolean]')}          Include source files in ZIP
- ${code('--zip-filename')} ${arg('<name>')}           Custom ZIP filename

${colors.underline('Centralized Logger (terminal output)')}
- The manager extension embeds a centralized logger that streams events to the CLI.
- Enable and filter logs directly via ${code('extension dev')} flags:
  - ${code('--logs')} ${arg('<off|error|warn|info|debug|trace>')}    Minimum level (default: off)
  - ${code('--log-context')} ${arg('<list|all>')}                     Contexts: background,content,page,sidebar,popup,options,devtools
  - ${code('--log-format')} ${arg('<pretty|json|ndjson>')}            Output format (default: pretty)
  - ${code('--no-log-timestamps')}                                   Hide ISO timestamps in pretty output
  - ${code('--no-log-color')}                                        Disable color in pretty output
  - ${code('--log-url')} ${arg('<substring|/regex/>')}                Filter by event.url
  - ${code('--log-tab')} ${arg('<id>')}                               Filter by tabId
- Example: ${code('extension dev ./my-ext --logs=debug --log-context=all --log-format=pretty')}

${code('extension --help')}
This command outputs a help file with key command options.

${colors.underline('Path Resolution (important)')}
- Leading ${code('/')} in manifest/HTML means extension root (the directory containing ${code('manifest.json')}).
- Relative paths resolve from the ${code('manifest.json')} directory.
- Absolute OS paths are used as-is.


${'AI Assistants'}
- For AI-oriented guidance and deeper tips, run ${code('extension --ai-help')}
- For machine-readable AI guidance, run ${code('extension --ai-help --format json')}

 ${'Report issues'}
 - ${colors.underline('https://github.com/cezaraugusto/extension/issues/new')}`
}

export function unsupportedBrowserFlag(value: string, supported: string[]) {
  return `${getLoggingPrefix('error')} Unsupported --browser value: ${value}. Supported: ${supported.join(', ')}.`
}

export function invalidLogsOptionPipe(value: string) {
  return (
    `${getLoggingPrefix('error')} Invalid value for ${code('--logs')}: ${colors.red(String(value))}\n` +
    `The '|' character is a shell pipe, not a separator for values.\n` +
    `Use a single level, e.g. ${code('--logs warn')} or ${code('--logs=warn')}.\n` +
    `Allowed values: ${arg('off, error, warn, info, debug, trace, all')}`
  )
}

export function invalidLogsOptionValue(value: string, allowed: string[]) {
  return (
    `${getLoggingPrefix('error')} Invalid value for ${code('--logs')}: ${colors.red(String(value))}\n` +
    `Allowed values: ${arg(allowed.join(', '))}. Example: ${code('--logs=warn')}`
  )
}

export function programAIHelp() {
  return `\n${getLoggingPrefix('info')} ${colors.gray('Development tips for extension developers and AI assistants')}

${'Browser-Specific Configuration'}
- Use browser prefixes in manifest.json for browser-specific fields:
  ${code('{"firefox:manifest": 2, "chrome:manifest": 3}')}
  This applies manifest v2 to Firefox only, v3 to Chrome/Edge.

${'Centralized Logger (for AI & CI)'}
- Logs from all contexts are centralized by the manager extension and streamed to the CLI.
- Prefer these flags to control terminal logs during ${code('extension dev')}:
  - ${code('--logs')} ${arg('<off|error|warn|info|debug|trace>')}    Minimum level
  - ${code('--log-context')} ${arg('<list|all>')}                     Contexts to include
  - ${code('--log-format')} ${arg('<pretty|json|ndjson>')}            Pretty for humans; JSON for machines/NDJSON pipelines
  - ${code('--no-log-timestamps')} ${arg(' ')}                        Disable timestamps (pretty)
  - ${code('--no-log-color')} ${arg(' ')}                             Disable ANSI colors (pretty)
  - ${code('--log-url')} ${arg('<substring|/regex/>')}                Filter by URL
  - ${code('--log-tab')} ${arg('<id>')}                               Filter by tabId
- Good CI pattern: ${code('EXTENSION_AUTHOR_MODE=development EXTENSION_AUTO_EXIT_MS=6000 extension dev ./ext --logs=info --log-format=json')}

${'Special Folders for Entrypoints'}
- Use special folders to handle entrypoints and assets not declared in manifest.json:
- ${colors.underline(code('public/'))}  - Static assets automatically copied to build (resolves to output root)
- ${colors.underline(code('pages/'))}   - HTML files not declared in manifest (e.g., welcome pages)
- ${colors.underline(code('scripts/'))} - JavaScript files not declared in manifest (e.g., executable scripts)

${'Predictable Output Paths'}
- Core HTML destinations are standardized across browsers so you can reference them safely in code/tests:
  - ${code('devtools_page')} → ${code('devtools/index.html')}
  - ${code('sidebar_action.default_panel')} (MV2) and ${code('side_panel.default_path')} (MV3) → ${code('sidebar/index.html')}
  - ${code('options_ui.page')} and ${code('options_page')} → ${code('options/index.html')}
  - ${code('background.page')} → ${code('background/index.html')}
  - ${code('action.default_popup')}, ${code('browser_action.default_popup')}, ${code('page_action.default_popup')} → ${code('action/index.html')}
- Other predictable outputs:
  - ${code('chrome_url_overrides.*')} → ${code('chrome_url_overrides/<key>.html')}
  - ${code('content_scripts[n].js/css')} → ${code('content_scripts/content-<n>.{js,css}')}
  - ${code('sandbox.pages[]')} → ${code('sandbox/page-<n>.html')}
  - ${code('user_scripts.api_script')} → ${code('user_scripts/api_script.js')}
  - ${code('icons/*')} → ${code('icons/')} (feature-specific icon folders preserved where applicable)

${'Public & Special Folders (Output Behavior)'}
- ${colors.underline(code('public/'))} is the web root in output. Authors can use ${code('/foo')}, ${code('/public/foo')}, ${code('public/foo')}, or ${code('./public/foo')} and they all emit as ${code('dist/<browser>/foo')}.
- ${colors.underline(code('pages/'))} files emit as ${code('pages/<name>.html')}. Relative assets referenced inside page HTML are emitted under ${code('assets/')} preserving relative structure; public-root URLs are preserved.
- ${colors.underline(code('scripts/'))} files emit as ${code('scripts/<name>.js')} with extracted CSS when applicable.

${'Shadow DOM for Content Scripts'}
- Add ${code('use shadow-dom')} directive to content scripts for style isolation
- Automatically creates ${code('#extension-root')} element with shadow DOM
- All CSS imports are automatically injected into shadow DOM
- Prevents style conflicts with host page

${'Environment Variables'}
- Use ${code(arg('EXTENSION_PUBLIC_*'))} prefix for variables accessible in extension code
- Supported in both ${code('process.env')} and ${code('import.meta.env')}
- Environment file priority: ${colors.underline(code(arg('.env.{browser}.{mode}')))} > ${colors.underline(code(arg('.env.{browser}')))} > ${colors.underline(code(arg('.env.{mode}')))} > ${colors.underline(code(arg('.env')))}
- Example: ${code(arg('EXTENSION_PUBLIC_API_KEY=your_key'))}

${'Available Templates'}
- ${colors.green('Frameworks')}: ${code(arg('react'))}, ${code(arg('preact'))}, ${code(arg('vue'))}, ${code(arg('svelte'))}
- ${colors.green('Languages')}: ${code(arg('javascript'))}, ${code(arg('typescript'))}
- ${colors.green('Contexts')}: ${code(arg('content'))} (content scripts), ${code(arg('new'))} (new tab), ${code(arg('action'))} (popup)
- ${colors.green('Styling')}: ${code(arg('tailwind'))}, ${code(arg('sass'))}, ${code(arg('less'))}
- ${colors.green('Configs')}: ${code(arg('eslint'))}, ${code(arg('prettier'))}, ${code(arg('stylelint'))}

${'Webpack/Rspack Configuration'}
- Create ${colors.underline(code(arg('extension.config.js')))} for custom webpack configuration
- Function receives base config, return modified config
- Supports all webpack/rspack loaders and plugins
- Example:
  ${code('export default {')}
  ${code('  config: (config) => {')}
  ${code("    config.module.rules.push({ test: /\\.svg$/, use: ['@svgr/webpack'] })")}
  ${code('    return config')}
  ${code('  }')}
  ${code('}')}

${'Managed Dependencies (Important)'}
- ${colors.green('Do not add')} packages that ${colors.blue('Extension.js')} already ships in its own toolchain.
- The guard only triggers when a managed package is declared in your ${code('package.json')} ${colors.gray('and')} is referenced in your ${colors.underline(code('extension.config.js'))}.
- In that case, the program will ${colors.red('print an error and abort')} to avoid version conflicts.
- Remove the duplicate from your project ${code('package.json')} or avoid referencing it in ${colors.underline(code('extension.config.js'))} and rely on the built-in version instead.
- If you truly need a different version, open an issue so we can evaluate a safe upgrade.

${'Framework-Specific Configuration'}
- Create ${colors.underline(code(arg('vue.loader.js')))} for Vue-specific loader configuration
- Create ${colors.underline(code(arg('svelte.loader.js')))} for Svelte-specific loader configuration
- Automatically detected and used by Extension.js
- Example svelte.loader.js:
  ${code('module.exports = {')}
  ${code('  preprocess: require("svelte-preprocess")({')}
  ${code('    typescript: true')}
  ${code('  })')}
  ${code('}')}

${'Hot Module Replacement (HMR)'}
- Automatically enabled in development mode
- CSS changes trigger automatic style updates
- React/Preact/Vue/Svelte components hot reload
- Content scripts automatically re-inject on changes
- Service workers, _locales and manifest changes reload the extension

${'Source Inspection & Real-Time Monitoring'}
- Use ${code('extension dev --source')} ${arg('<url|boolean>')} to inspect page HTML after content script injection
  - When no URL is provided, falls back to ${arg('--starting-url')} or ${arg('https://example.com')}
  - Watch mode is enabled by default when ${code('--source')} is present
- Use ${code('--watch-source')} to re-print HTML on rebuilds or file changes
- Use ${code('--source-format')} ${arg('<pretty|json|ndjson>')} for machine-friendly HTML output
- Use ${code('--source-summary')} to emit a compact JSON summary instead of full HTML
- Use ${code('--source-meta')} to emit page metadata (readyState, viewport, frames)
- Use ${code('--source-probe')} to probe CSS selectors for quick validation
- Use ${code('--source-tree')} to emit a compact extension root tree
- Use ${code('--source-console')} to emit a console summary (best-effort)
- Use ${code('--source-dom')} to emit DOM snapshots and diffs
- Use ${code('--source-redact')} ${arg('<off|safe|strict>')} to redact sensitive content
- Use ${code('--source-max-bytes')} ${arg('<bytes>')} to limit output size
- Use ${code('--source-diff')} ${arg('[boolean]')} to emit diff metadata for watch updates
- Source events include frame context (frameId/frameUrl), and console summaries include best-effort script URLs.
- Action timeline events ${code('action_event')} report navigation, injection, rebuilds, snapshots, and reloads.
- Automatically enables Chrome remote debugging (port 9222) when source inspection is active
- Extracts Shadow DOM content from ${code('#extension-root')} or ${code('[data-extension-root=\"true\"]')} elements
- Useful for debugging content script behavior and style injection
- Example: ${code('extension dev --source=' + arg('https://example.com'))}
- ${arg('Note:')} ${code('preview/start')} run in run-only mode and do not perform source inspection.

${'Non-Destructive Testing in CI'}
- Prefer ${code('EXTENSION_AUTHOR_MODE=development')} to copy local templates and avoid network.
- Reuse Playwright's Chromium via ${code('--chromium-binary')} path when available.
- Set ${code(arg('EXTENSION_AUTO_EXIT_MS'))} and ${code(arg('EXTENSION_FORCE_KILL_MS'))} for non-interactive dev sessions.

${'File Watching & HMR Examples'}
- Content script JS/TS changes trigger reinjection; CSS changes update styles live.
- For watch-source HTML prints, update a visible string in ${code('content/scripts.*')} and assert it appears in stdout.

${'Troubleshooting'}
- If HTML is not printed, ensure ${code('--source')} is provided and browser launched with debugging port.
- Use ${code('--silent true')} during builds to reduce noise; logs still surface errors.
- When ports conflict, pass ${code('--port 0')} to auto-select an available port.

${'Non-Interactive / Auto Mode (CI)'}
- Set ${code(arg('EXTENSION_AUTO_EXIT_MS'))} to enable self-termination after N milliseconds.
  Useful when ${code('pnpm extension dev')} would otherwise hang under Rspack watch.
  Example: ${code(arg('EXTENSION_AUTO_EXIT_MS=6000'))} pnpm extension dev ./templates/react --browser chrome --source ${arg('https://example.com')}
- Optional: ${code(arg('EXTENSION_FORCE_KILL_MS'))} to hard-exit after N ms as a fallback (defaults to auto-exit + 4000).

${'Cross-Browser Compatibility'}
- Use ${code('--polyfill')} flag to enable webextension-polyfill
- Automatically handles browser API differences
- Supports Chrome, Edge, Firefox with single codebase`
}

export type ProgramAIHelpJSON = {
  version: string
  commands: Array<{
    name:
      | 'create'
      | 'dev'
      | 'start'
      | 'preview'
      | 'build'
      | 'install'
      | 'uninstall'
    summary: string
    supportsSourceInspection: boolean
  }>
  globalOptions: Array<{
    name: '--ai-help' | '--format' | '--no-telemetry'
    values?: string[]
    default?: string
    description: string
  }>
  capabilities: {
    sourceInspection: {
      supportedIn: string[]
      unsupportedIn: string[]
      notes: string[]
    }
    logger: {
      levels: string[]
      formats: string[]
      notes: string[]
    }
    managedDependencies: {
      enforcement: string
      trigger: string
      action: string
    }
  }
  examples: string[]
}

export function programAIHelpJSON(version: string): ProgramAIHelpJSON {
  return {
    version,
    commands: [
      {
        name: 'create',
        summary: commandDescriptions.create,
        supportsSourceInspection: false
      },
      {
        name: 'dev',
        summary: commandDescriptions.dev,
        supportsSourceInspection: true
      },
      {
        name: 'start',
        summary: commandDescriptions.start,
        supportsSourceInspection: false
      },
      {
        name: 'preview',
        summary: commandDescriptions.preview,
        supportsSourceInspection: false
      },
      {
        name: 'build',
        summary: commandDescriptions.build,
        supportsSourceInspection: false
      },
      {
        name: 'install',
        summary: commandDescriptions.install,
        supportsSourceInspection: false
      },
      {
        name: 'uninstall',
        summary: commandDescriptions.uninstall,
        supportsSourceInspection: false
      }
    ],
    globalOptions: [
      {
        name: '--ai-help',
        description: 'Show AI-assistant oriented help and tips'
      },
      {
        name: '--format',
        values: ['pretty', 'json'],
        default: 'pretty',
        description: 'Output format for --ai-help'
      },
      {
        name: '--no-telemetry',
        description: 'Disable anonymous telemetry for this run'
      }
    ],
    capabilities: {
      sourceInspection: {
        supportedIn: ['dev'],
        unsupportedIn: [
          'start',
          'preview',
          'build',
          'create',
          'install',
          'uninstall'
        ],
        notes: [
          '--source supports URL fallback to --starting-url or https://example.com',
          'run-only preview mode does not perform source inspection'
        ]
      },
      logger: {
        levels: ['off', 'error', 'warn', 'info', 'debug', 'trace', 'all'],
        formats: ['pretty', 'json', 'ndjson'],
        notes: [
          'centralized logger streams logs from multiple extension contexts',
          '--logs defaults to off unless explicitly enabled'
        ]
      },
      managedDependencies: {
        enforcement: 'guarded',
        trigger:
          'when managed packages are declared in package.json and referenced in extension.config',
        action: 'print an error and abort'
      }
    },
    examples: [
      'extension --ai-help',
      'extension --ai-help --format json',
      'extension dev ./my-ext --source https://example.com --source-format json',
      'extension dev ./my-ext --logs=info --log-format=json',
      'extension install chromium',
      'extension install --where',
      'extension uninstall --where',
      'extension uninstall --all'
    ]
  }
}

export function invalidAIHelpFormat(value: string) {
  return (
    `${getLoggingPrefix('error')} Invalid value for ${code('--format')}: ${colors.red(String(value))}\n` +
    `Allowed values: ${arg('pretty, json')}. Example: ${code(
      'extension --ai-help --format json'
    )}`
  )
}

export function sourceInspectionNotSupported(command: 'start' | 'preview') {
  return (
    `${getLoggingPrefix('error')} ${code(
      `extension ${command}`
    )} currently runs in run-only preview mode and does not support source inspection.\n` +
    `Use ${code('extension dev --source <url>')} for source inspection features.`
  )
}
