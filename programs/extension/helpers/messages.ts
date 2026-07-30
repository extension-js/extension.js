//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import colors from 'pintor'
import {type Channel, fmt, prefix} from './messaging'
import {
  DEFAULT_TEMPLATE,
  listTemplates,
  TEMPLATE_ALIASES,
  TEMPLATE_CATALOG_URL,
  TEMPLATE_GROUPS
} from './template-catalog'

function getLoggingPrefix(type: Channel): string {
  return prefix(type)
}

const code = (text: string) => colors.blue(text)
const arg = (text: string) => colors.gray(text)

// Imported for local use and re-exported: consumers and snapshots read fmt
// from this module, and the definition now lives in messaging.ts.
export {fmt}

export interface CommandArgSpec {
  // Positional name exactly as commander registers it. The args contract pins
  // this against `Command.registeredArguments`, so a rename cannot go unnoticed.
  readonly name: string
  readonly required: boolean
  // Closed value set, rendered in help in place of the name.
  readonly values?: readonly string[]
  // Help label used when the registered name misnames what the argument takes.
  readonly label?: string
}

export interface CommandNoteSpec {
  // Option-shaped usage that is worth its own help row but is not a command.
  readonly usage: string
  readonly description: string
}

interface CommandTableEntry {
  readonly name: string
  readonly positionals: readonly CommandArgSpec[]
  readonly description: string
  readonly detail?: string
  readonly supportsSourceInspection: boolean
  readonly notes?: readonly CommandNoteSpec[]
}

function renderArgToken(spec: CommandArgSpec): string {
  const token = spec.values ? spec.values.join('|') : (spec.label ?? spec.name)
  return spec.required ? `<${token}>` : `[${token}]`
}

// Reader-facing signature: enums and labels replace the registered name.
export function commandArgSignature(
  positionals: readonly CommandArgSpec[]
): string {
  return positionals.map(renderArgToken).join(' ')
}

// Registration-facing signature: names and arity as commander stores them.
export function registeredArgSignature(
  positionals: readonly CommandArgSpec[]
): string {
  return positionals
    .map((spec) => (spec.required ? `<${spec.name}>` : `[${spec.name}]`))
    .join(' ')
}

// One source of truth for every command name, argument signature and
// description, in the imperative mood that git, npm and docker use. Commander,
// the help center and --ai-help all read this table; nothing re-types it.
const COMMAND_TABLE = [
  {
    name: 'create',
    positionals: [{name: 'project-name|project-path', required: true}],
    description:
      'Create a new extension from a template (React, TypeScript, Vue, Svelte, etc.)',
    supportsSourceInspection: false
  },
  {
    name: 'dev',
    positionals: [{name: 'project-path|remote-url', required: false}],
    description: 'Start the development server with hot reloading',
    supportsSourceInspection: true
  },
  {
    name: 'start',
    positionals: [{name: 'project-path|remote-url', required: false}],
    description: 'Build and start the extension in production mode',
    supportsSourceInspection: false
  },
  {
    name: 'preview',
    positionals: [
      {
        name: 'project-name',
        required: false,
        label: 'project-path|remote-url'
      }
    ],
    description: 'Preview the extension in production mode without building',
    supportsSourceInspection: false
  },
  {
    name: 'build',
    positionals: [
      {
        name: 'project-name',
        required: false,
        label: 'project-path|remote-url'
      }
    ],
    description: 'Build the extension for packaging and distribution',
    supportsSourceInspection: false
  },
  {
    name: 'logs',
    positionals: [{name: 'project-path', required: false}],
    description:
      'Print or stream logs from every context of a running dev session',
    supportsSourceInspection: false
  },
  {
    name: 'eval',
    positionals: [
      {name: 'expression', required: true},
      {name: 'project-path', required: false}
    ],
    description:
      'Evaluate an expression in a running extension context (requires --allow-eval)',
    supportsSourceInspection: false
  },
  {
    name: 'storage',
    positionals: [
      {name: 'action', required: true, values: ['get', 'set']},
      {name: 'project-path', required: false}
    ],
    description:
      'Read or write chrome.storage in a running extension (requires --allow-control)',
    supportsSourceInspection: false
  },
  {
    name: 'reload',
    positionals: [{name: 'project-path', required: false}],
    description: 'Reload a running extension or tab (requires --allow-control)',
    supportsSourceInspection: false
  },
  {
    name: 'open',
    positionals: [
      {
        name: 'surface',
        required: true,
        values: ['popup', 'options', 'sidebar', 'action', 'command']
      },
      {name: 'project-path', required: false}
    ],
    description:
      'Open an extension surface: popup, options, sidebar, action, or command (requires --allow-control)',
    supportsSourceInspection: false
  },
  {
    name: 'inspect',
    positionals: [{name: 'project-path', required: false}],
    description:
      'Inspect a page or content DOM through the agent bridge (CDP-free, requires --allow-control)',
    supportsSourceInspection: true
  },
  {
    name: 'publish',
    positionals: [{name: 'project-path', required: false}],
    description:
      'Publish to extension.dev and print a shareable URL (requires EXTENSION_DEV_TOKEN)',
    supportsSourceInspection: false
  },
  {
    name: 'install',
    positionals: [{name: 'browser-name', required: false}],
    description: 'Install a managed browser binary into the Extension.js cache',
    detail: 'Defaults to chromium when no browser is named.',
    supportsSourceInspection: false,
    notes: [
      {
        usage:
          '--browser <chrome|chromium|edge|firefox|chromium-based|gecko-based|firefox-based|all>',
        description: 'Install multiple browsers, browser families, or all'
      },
      {
        usage: '--where',
        description:
          'Print the managed browser cache root (or browser install path(s) when a browser name or --browser is provided)'
      }
    ]
  },
  {
    name: 'uninstall',
    positionals: [{name: 'browser-name', required: false}],
    description: 'Remove managed browser binaries from the Extension.js cache',
    supportsSourceInspection: false,
    notes: [
      {usage: '--all', description: 'Remove every managed browser binary'},
      {
        usage: '--where',
        description:
          'Print the managed browser cache root (or browser install path(s) when --browser/--all is provided)'
      }
    ]
  },
  {
    name: 'telemetry',
    positionals: [
      {
        name: 'action',
        required: false,
        values: ['enable', 'disable', 'status']
      }
    ],
    description:
      'Manage anonymous telemetry consent (enable, disable, or show status)',
    supportsSourceInspection: false
  },
  {
    name: 'doctor',
    positionals: [{name: 'project-path', required: false}],
    description:
      'Diagnose a dev session: ready contract, control channel, token, executor, browser',
    supportsSourceInspection: false
  },
  {
    name: 'capabilities',
    positionals: [],
    description:
      'Print the engine version, contract versions, and json-capable commands',
    supportsSourceInspection: false
  }
] as const satisfies readonly CommandTableEntry[]

export type CommandName = (typeof COMMAND_TABLE)[number]['name']

export interface CommandSpec extends CommandTableEntry {
  readonly name: CommandName
  // Derived from `positionals`, never hand-written, so help cannot drift.
  readonly args: string
}

export const COMMANDS: readonly CommandSpec[] = COMMAND_TABLE.map((entry) => ({
  ...entry,
  args: commandArgSignature(entry.positionals)
}))

export function commandSpec(name: CommandName): CommandSpec {
  const spec = COMMANDS.find((entry) => entry.name === name)
  // Unreachable through CommandName, but a runtime guard keeps a bad build loud.
  if (!spec) throw new Error(`No COMMANDS entry for '${name}'.`)
  return spec
}

// Kept as a named export because every command file reads its description from
// here. Derived from COMMANDS so the two can never disagree.
export const commandDescriptions = Object.fromEntries(
  COMMANDS.map((spec) => [spec.name, spec.description])
) as Record<CommandName, string>

function commandHelpEntry(spec: CommandSpec): string {
  const signature = spec.args ? ` ${arg(spec.args)}` : ''
  const lines = [
    `- ${code(`extension ${spec.name}`)}${signature}`,
    `  ${spec.description}`
  ]
  if (spec.detail) lines.push(`  ${spec.detail}`)
  for (const note of spec.notes ?? []) {
    lines.push(
      '',
      `- ${code(`extension ${spec.name}`)} ${arg(note.usage)}`,
      `  ${note.description}`
    )
  }
  return lines.join('\n')
}

export function availableCommandsBlock(): string {
  return COMMANDS.map(commandHelpEntry).join('\n\n')
}

export function unhandledError(err: unknown) {
  const message =
    err instanceof Error
      ? err.stack || err.message
      : typeof err === 'string'
        ? err
        : fmt.truncate(err)
  return `${getLoggingPrefix('error')} ${colors.red(String(message || 'Unknown error'))}`
}

export function updateFailed(err: unknown) {
  return (
    `${getLoggingPrefix('warn')} Couldn't check for updates.\n` +
    `${colors.yellow('The command continues without the update check.')}\n` +
    `${colors.yellow(String((err as Error | undefined)?.message || err))}`
  )
}

export function checkUpdates(
  packageJson: Record<string, unknown>,
  update: {latest: string}
) {
  const latest = String(update.latest)
  const releaseNotesUrl = `https://github.com/extension-js/extension.js/releases/tag/v${latest}`
  const suffix = colors.gray(`(version ${latest} is available)`)
  const message =
    `${getLoggingPrefix('info')} An ${colors.blue('Extension.js')} update is available.\n\n` +
    `You're on version ${colors.red(String(packageJson.version))}.\n` +
    `The latest stable is ${colors.green(latest)}.\n` +
    `See what's new: ${colors.underline(releaseNotesUrl)}\n` +
    `Update to the latest stable to get fixes and new features.`

  return {suffix, message}
}

export function noURLWithoutStart(argument: string) {
  return (
    `${getLoggingPrefix('error')} The default ${colors.gray('create')} command doesn't accept a URL.\n` +
    `Use ${colors.gray('start')} to run an extension from a URL:\n` +
    `${code(`npx extension@latest start ${arg(argument)}`)}`
  )
}

export function notImplemented(argument: string) {
  return (
    `${getLoggingPrefix('error')} The ${arg(argument)} command isn't implemented yet.\n` +
    `${colors.red('Run')} ${code('extension --help')} ${colors.red('to list the available commands.')}`
  )
}

export function programUserHelp() {
  return `\n${getLoggingPrefix('info')} ${colors.underline('Help center for the Extension.js program')}

${'Usage:'} extension [command] [options]

${'Notes'}
- All high-level commands offer their own \`--help\` with usage and flag lists.
- Telemetry is anonymous and privacy-safe by default, see ${code('docs/TELEMETRY.md')} for the full contract.

${'Example'}
- ${code('extension create --help')} outputs information about the "create" command.

${'Available commands'}
${availableCommandsBlock()}

${'Common options'}
- ${code('--browser')} ${arg('<chrome|edge|firefox|chromium|chromium-based|gecko-based|firefox-based>')} Target browser/engine (default: chromium)
- ${code('--profile')} ${arg('<path|boolean>')}        Browser profile configuration
- ${code('--polyfill')} ${arg('[boolean]')}            Enable/disable cross-browser polyfill
- ${code('--no-telemetry')}                            Disable anonymous telemetry for this run (persistent toggle: ${code('extension telemetry disable')}, or ${code('EXTENSION_TELEMETRY=0')})
- ${code('--ai-help')}                                 Show AI-assistant oriented help and tips
- ${code('--output')} ${arg('<pretty|json>')}          Result format for ${code('--ai-help')} and machine-readable command results (default: pretty)
  ${code('--format')} and ${code('--wait-format')} still work as deprecated aliases of ${code('--output')}
- ${code('--help')}                                    Show help output
- ${code('--port')} ${arg('<number>')}                 Development server port (default: 8080, use 0 for OS-assigned)
- ${code('--host')} ${arg('<address>')}               Dev server host (default: 127.0.0.1, use 0.0.0.0 for Docker/devcontainers)
- ${code('--public-host')} ${arg('<address>')}        Connectable host the browser dials for HMR + reload bridge when it differs from ${code('--host')} (remote/devcontainer, default: the bind host, or 127.0.0.1 when bound to 0.0.0.0)
- ${code('--starting-url')} ${arg('<url>')}            Initial URL to load in browser
- ${code('--silent')} ${arg('[boolean]')}              Suppress console output during build

${'Browser-specific options'}
- ${code('--chromium-binary')} ${arg('<path>')}        Custom Chromium binary path
- ${code('--gecko-binary')}/${code('--firefox-binary')} ${arg('<path>')}           Custom Firefox/Gecko binary path
  Use ${code('flatpak:org.mozilla.firefox')} as the path to launch a Flatpak-installed Firefox

${'Build options'}
- ${code('--zip')} ${arg('[boolean]')}                 Create ZIP archive of built extension
- ${code('--zip-source')} ${arg('[boolean]')}          Include source files in ZIP
- ${code('--zip-filename')} ${arg('<name>')}           Custom ZIP filename

${colors.underline('Centralized logger (terminal output)')}
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

${colors.underline('Path resolution (important)')}
- Leading ${code('/')} in manifest/HTML means extension root (the directory containing ${code('manifest.json')}).
- Relative paths resolve from the ${code('manifest.json')} directory.
- Absolute OS paths are used as-is.

${'AI assistants'}
- For AI-oriented guidance and deeper tips, run ${code('extension --ai-help')}
- For machine-readable AI guidance, run ${code('extension --ai-help --output json')}

 ${'Report issues'}
 - ${colors.underline('https://github.com/extension-js/extension.js/issues/new')}`
}

export function unsupportedBrowserFlag(value: string, supported: string[]) {
  return (
    `${getLoggingPrefix('error')} Unsupported --browser value: ${value}.\n` +
    `${colors.red('Choose one of:')} ${supported.join(', ')}${colors.red('.')}`
  )
}

export function safariOnlyOption(flags: string[]) {
  return (
    `${getLoggingPrefix('error')} ${flags.map(code).join(', ')} ` +
    `only appl${flags.length === 1 ? 'ies' : 'y'} to Safari targets.\n` +
    `Add ${code('--browser safari')} (or ${code('webkit-based')}).`
  )
}

export function safariInvalidBundleId(bundleId: string) {
  return (
    `${getLoggingPrefix('error')} Can't use ${code(bundleId)} as a bundle identifier.\n` +
    `Use reverse-DNS form: dot-separated segments of letters, digits and hyphens, ` +
    `each starting with a letter (e.g. ${code('com.example.my-extension')}).`
  )
}

export function safariCommandNotSupported(
  command: 'dev' | 'preview' | 'start'
) {
  return (
    `${getLoggingPrefix('error')} ${code(command)} can't load an extension into Safari automatically.\n` +
    `Safari extensions ship inside a signed app and are enabled by hand, so there's no live ` +
    `browser session to load into, unlike Chromium and Firefox.\n` +
    `Build the Safari app instead: ${code('extension build --browser safari')}\n` +
    `Then open the generated app and enable it in Safari → Settings → Extensions.`
  )
}

export function programAIHelp() {
  return `\n${getLoggingPrefix('info')} ${colors.gray('Development tips for extension developers and AI assistants')}

${'Browser-specific configuration'}
- Use browser prefixes in manifest.json for browser-specific fields:
  ${code('{"firefox:manifest": 2, "chrome:manifest": 3}')}
  This applies manifest v2 to Firefox only, v3 to Chrome/Edge.

${'Centralized logger (for AI & CI)'}
- Logs from all contexts are centralized by the manager extension and streamed to the CLI.
- Prefer these flags to control terminal logs during ${code('extension dev')}:
  - ${code('--logs')} ${arg('<off|error|warn|info|debug|trace>')}    Minimum level
  - ${code('--log-context')} ${arg('<list|all>')}                     Contexts to include
  - ${code('--log-format')} ${arg('<pretty|json|ndjson>')}            Pretty for humans, JSON for machines/NDJSON pipelines
  - ${code('--no-log-timestamps')} ${arg(' ')}                        Disable timestamps (pretty)
  - ${code('--no-log-color')} ${arg(' ')}                             Disable ANSI colors (pretty)
  - ${code('--log-url')} ${arg('<substring|/regex/>')}                Filter by URL
  - ${code('--log-tab')} ${arg('<id>')}                               Filter by tabId
- Good CI pattern: ${code('EXTENSION_DEBUG=1 EXTENSION_AUTO_EXIT_MS=6000 extension dev ./ext --logs=info --log-format=json')}

${'Special folders for entrypoints'}
- Use special folders to handle entrypoints and assets not declared in manifest.json:
- ${colors.underline(code('public/'))}  - Static assets automatically copied to build (resolves to output root)
- ${colors.underline(code('pages/'))}   - HTML files not declared in manifest (e.g., welcome pages)
- ${colors.underline(code('scripts/'))} - JavaScript files not declared in manifest (e.g., executable scripts)

${'Predictable output paths'}
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

${'Public & special folders (output behavior)'}
- ${colors.underline(code('public/'))} is the web root in output. Authors can use ${code('/foo')}, ${code('/public/foo')}, ${code('public/foo')}, or ${code('./public/foo')} and they all emit as ${code('dist/<browser>/foo')}.
- ${colors.underline(code('pages/'))} files emit as ${code('pages/<name>.html')}. Relative assets referenced inside page HTML are emitted under ${code('assets/')} preserving relative structure, public-root URLs are preserved.
- ${colors.underline(code('scripts/'))} files emit as ${code('scripts/<name>.js')} with extracted CSS when applicable.

${'Shadow DOM for content scripts'}
- Add ${code('use shadow-dom')} directive to content scripts for style isolation
- Automatically creates ${code('#extension-root')} element with shadow DOM
- All CSS imports are automatically injected into shadow DOM
- Prevents style conflicts with host page

${'Environment variables'}
- Use ${code(arg('EXTENSION_PUBLIC_*'))} prefix for variables accessible in extension code
- Supported in both ${code('process.env')} and ${code('import.meta.env')}
- Environment file priority: ${colors.underline(code(arg('.env.{browser}.{mode}')))} > ${colors.underline(code(arg('.env.{browser}')))} > ${colors.underline(code(arg('.env.{mode}')))} > ${colors.underline(code(arg('.env')))}
- Example: ${code(arg('EXTENSION_PUBLIC_API_KEY=your_key'))}

${'Available templates'}
${TEMPLATE_GROUPS.map(
  (group) =>
    `- ${colors.green(group.title)} ${arg(`(${group.summary})`)}: ${group.templates
      .map((template) => code(template))
      .join(', ')}`
).join('\n')}
- ${colors.green('Alias')}: ${TEMPLATE_ALIASES.map((alias) => `${code(alias.name)} ${arg(alias.note)}`).join(', ')}
- ${code(DEFAULT_TEMPLATE)} is the default when ${code('--template')} is omitted; it ships inside the CLI and needs no network.
- Every other name is downloaded from ${code(TEMPLATE_CATALOG_URL)} at create time. A GitHub or ZIP URL works in place of a name.
- A name that is not on this list fails with ${code('TemplateNotFoundError')}; run ${code('extension create --help')} for the same list.

${'Webpack/Rspack configuration'}
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

${'Managed dependencies (important)'}
- ${colors.green('Do not add')} packages that ${colors.blue('Extension.js')} already ships in its own toolchain.
- The guard only triggers when a managed package is declared in your ${code('package.json')} ${colors.gray('and')} is imported (as a module specifier) in your ${colors.underline(code('extension.config.js'))}.
- In that case, the program will ${colors.red('print an error and abort')} to avoid version conflicts.
- Remove the duplicate from your project ${code('package.json')} or avoid referencing it in ${colors.underline(code('extension.config.js'))} and rely on the built-in version instead.
- If you truly need a different version, open an issue so we can evaluate a safe upgrade.

${'Framework-specific configuration'}
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
- React components fast-refresh, Svelte components hot-update
- Preact and Vue rebuild with a live reload (component state resets)
- Content scripts automatically re-inject on changes
- Service workers, _locales and manifest changes reload the extension

${'Non-destructive testing in CI'}
- Prefer ${code('EXTENSION_DEBUG=1')} to copy local templates and avoid network.
- Reuse Playwright's Chromium via ${code('--chromium-binary')} path when available.
- Set ${code(arg('EXTENSION_AUTO_EXIT_MS'))} and ${code(arg('EXTENSION_FORCE_KILL_MS'))} for non-interactive dev sessions.

${'File watching & HMR examples'}
- Content script JS/TS changes trigger reinjection, CSS changes update styles live.
- For watch-source HTML prints, update a visible string in ${code('content/scripts.*')} and assert it appears in stdout.

${'Troubleshooting'}
- Use ${code('--silent true')} during builds to reduce noise, logs still surface errors.
- When ports conflict, pass ${code('--port 0')} to auto-select an available port.
- In Docker/devcontainers, pass ${code('--host 0.0.0.0')} so the dev server is reachable from the host.

${'Non-interactive / auto mode (CI)'}
- Set ${code(arg('EXTENSION_AUTO_EXIT_MS'))} to enable self-termination after N milliseconds.
  Useful when ${code('pnpm extension dev')} would otherwise hang under Rspack watch.
  Example: ${code(arg('EXTENSION_AUTO_EXIT_MS=6000'))} pnpm extension dev ./templates/react --browser chrome --starting-url ${arg('https://example.com')}
- Optional: ${code(arg('EXTENSION_FORCE_KILL_MS'))} to hard-exit after N ms as a fallback (defaults to auto-exit + 4000).

${'Docker / Devcontainers / Codespaces'}
- Use ${code('--host 0.0.0.0')} to bind the dev server on all interfaces so HMR is reachable from the host.
- Use ${code('--no-browser')} inside the container and load the extension manually from ${code('dist/<browser>/')} in your host browser.
- Chromium sandbox flags (${code('--no-sandbox')}) are added automatically when Docker, Podman, devcontainers, or Codespaces are detected.
- File watching uses polling by default (1 s interval), which works across bind-mounted volumes.
- Example: ${code('extension dev ./my-ext --host 0.0.0.0 --no-browser --port 8080')}

${'Flatpak Firefox'}
- Use ${code('--gecko-binary flatpak:org.mozilla.firefox')} (or ${code('--firefox-binary')}) to launch a Flatpak-installed Firefox.
- Extension.js rewrites the binary path to ${code('flatpak run')} with the correct filesystem grants automatically.

${'Cross-browser compatibility'}
- Use ${code('--polyfill')} flag to enable webextension-polyfill
- Automatically handles browser API differences
- Supports Chrome, Edge, Firefox with single codebase`
}

export type ProgramAIHelpJSON = {
  version: string
  commands: Array<{
    name: CommandName
    summary: string
    supportsSourceInspection: boolean
  }>
  globalOptions: Array<{
    name: string
    values?: string[]
    default?: string
    description: string
  }>
  templates: {
    default: string
    bundled: string[]
    catalogUrl: string
    names: string[]
    groups: Array<{title: string; summary: string; templates: string[]}>
    aliases: Array<{name: string; resolvesTo: string; note: string}>
    notes: string[]
  }
  capabilities: {
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
    readyContract: {
      readyPath: string
      eventsPath: string
      waitFlag: string
      statuses: string[]
      readyFields: string[]
      eventTypes: string[]
      notes: string[]
    }
    dockerAndContainers: {
      hostFlag: string
      sandboxDetection: string[]
      notes: string[]
    }
  }
  examples: string[]
}

export function programAIHelpJSON(version: string): ProgramAIHelpJSON {
  return {
    version,
    // `summary` stays the description alone: `detail` is help-center copy and
    // adding it here would move a published --ai-help value.
    commands: COMMANDS.map((spec) => ({
      name: spec.name,
      summary: spec.description,
      supportsSourceInspection: spec.supportsSourceInspection
    })),
    globalOptions: [
      {
        name: '--ai-help',
        description: 'Show AI-assistant oriented help and tips'
      },
      {
        name: '--output',
        values: ['pretty', 'json'],
        default: 'pretty',
        description:
          'Result format for --ai-help (--format is a deprecated alias)'
      },
      {
        name: '--no-telemetry',
        description:
          'Disable anonymous telemetry for this run. Persistent toggle: `extension telemetry disable`. Hard override: `EXTENSION_TELEMETRY=0`.'
      },
      {
        name: '--browser',
        values: [
          'chrome',
          'edge',
          'firefox',
          'chromium',
          'chromium-based',
          'gecko-based',
          'firefox-based'
        ],
        default: 'chromium',
        description: 'Target browser/engine'
      },
      {
        name: '--port',
        default: '8080',
        description:
          'Development server port (use 0 for OS-assigned available port)'
      },
      {
        name: '--host',
        default: '127.0.0.1',
        description:
          'Dev server host address (use 0.0.0.0 for Docker/devcontainers)'
      },
      {
        name: '--public-host',
        default: 'bind host (127.0.0.1 when bound to 0.0.0.0)',
        description:
          'Connectable host the browser dials for HMR + the reload bridge when it differs from the bind host (remote/devcontainer)'
      }
    ],
    templates: {
      default: DEFAULT_TEMPLATE,
      bundled: [DEFAULT_TEMPLATE],
      catalogUrl: TEMPLATE_CATALOG_URL,
      names: listTemplates(),
      groups: TEMPLATE_GROUPS.map((group) => ({
        title: group.title,
        summary: group.summary,
        templates: [...group.templates]
      })),
      aliases: TEMPLATE_ALIASES.map((alias) => ({...alias})),
      notes: [
        `extension create <name> with no --template scaffolds ${DEFAULT_TEMPLATE}`,
        `${DEFAULT_TEMPLATE} is bundled with the CLI and scaffolds offline; every other name downloads the examples archive at create time`,
        'a GitHub URL or a ZIP URL is accepted in place of a catalog name',
        'a name outside names[] fails with TemplateNotFoundError and creates nothing',
        'this list ships with the CLI, so it is the list this CLI version can scaffold, not necessarily the current contents of the catalog repository'
      ]
    },
    capabilities: {
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
          'when managed packages are declared in package.json and imported as a module specifier in extension.config',
        action: 'print an error and abort'
      },
      readyContract: {
        readyPath: 'dist/extension-js/<browser>/ready.json',
        eventsPath: 'dist/extension-js/<browser>/events.ndjson',
        waitFlag:
          '--wait blocks until ready.json reports ready (or error) then exits, pair with --output json for machine output (--wait-format is a deprecated alias)',
        statuses: ['starting', 'ready', 'error'],
        readyFields: [
          'status',
          'command',
          'browser',
          'runId',
          'startedAt',
          'distPath',
          'manifestPath',
          'port',
          'pid',
          'ts',
          'compiledAt',
          'errors'
        ],
        eventTypes: [
          'compile_start',
          'compile_success',
          'compile_error',
          'shutdown'
        ],
        notes: [
          'ready.json is written atomically by the build (dev/start) on each compile',
          'events.ndjson is an append-only build timeline with durationMs and errorCount per entry',
          '--wait requires a local project path (remote URLs are not supported)',
          'consumers should verify pid liveness and recency before trusting a contract'
        ]
      },
      dockerAndContainers: {
        hostFlag: '--host 0.0.0.0 binds the dev server to all interfaces',
        sandboxDetection: [
          '/.dockerenv',
          '/run/.containerenv',
          'REMOTE_CONTAINERS=true',
          'CODESPACES=true',
          'container env var'
        ],
        notes: [
          'Use --no-browser inside the container and load dist/<browser>/ in the host browser',
          'File watching uses polling (1s interval) for bind-mount compatibility',
          '--no-sandbox is added automatically when a container environment is detected'
        ]
      }
    },
    examples: [
      'extension --ai-help',
      'extension --ai-help --output json',
      'extension dev ./my-ext --logs=info --log-format=json',
      'extension dev ./my-ext --host 0.0.0.0 --no-browser',
      'extension dev ./my-ext --wait --browser=chromium --output json',
      'extension start ./my-ext --wait --browser=chromium --output json',
      'extension dev ./my-ext --gecko-binary flatpak:org.mozilla.firefox',
      'extension install chromium',
      'extension install --where',
      'extension uninstall --where',
      'extension uninstall --all'
    ]
  }
}

export function invalidAIHelpFormat(value: string) {
  return (
    `${getLoggingPrefix('error')} Can't use ${colors.red(String(value))} as a value for ${code('--output')}.\n` +
    `${colors.red('Pass')} ${arg('pretty')} ${colors.red('or')} ${arg('json')}${colors.red(', for example')} ${code('extension --ai-help --output json')}${colors.red('.')}`
  )
}

export function removedNoRunnerFlag() {
  return (
    `${getLoggingPrefix('error')} ${code('--no-runner')} was removed.\n` +
    `Use ${code('--no-browser')} instead.`
  )
}

export function deprecatedOutputAlias(flag: string) {
  return (
    `${getLoggingPrefix('warn')} ${code(flag)} is deprecated and maps to ${code('--output')}.\n` +
    `Pass ${code('--output')} ${arg('<pretty|json>')} instead.`
  )
}

export function noBrowserNotSupportedForCommand(command?: string) {
  return (
    `${getLoggingPrefix('error')} ${code(
      '--no-browser'
    )} is only supported for ${code('dev')}, ${code('start')}, and ${code(
      'preview'
    )}.\n` + `${fmt.label('GOT')} ${code(command || '(none)')}`
  )
}
