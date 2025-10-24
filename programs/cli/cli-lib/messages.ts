//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

import colors from 'pintor'

// Prefix candidates (try swapping if desired): '►', '›', '→', '—'
function getLoggingPrefix(type: 'warn' | 'info' | 'error' | 'success'): string {
  if (type === 'error') return colors.red('ERROR')
  if (type === 'warn') return colors.brightYellow('►►►')
  if (type === 'info') return '►►►'
  return colors.green('►►►')
}

// Standard code style across all messages
const code = (text: string) => colors.blue(text)
// Helper to ensure arguments are gray
const arg = (text: string) => colors.gray(text)

export function updateFailed(err: any) {
  return `${getLoggingPrefix('error')} Failed to check for updates.\n${colors.red(String(err?.message || err))}`
}

export function checkUpdates(
  packageJson: Record<string, any>,
  update: {latest: string}
) {
  return (
    `${getLoggingPrefix('info')} 🧩 ${colors.blue('Extension.js')} update available.\n\n` +
    `You are currently using version ${colors.red(String(packageJson.version))}. ` +
    `Latest stable is ${colors.green(String(update.latest))}.\n` +
    `Please update to enjoy new features and improvements.`
  )
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
    `Are you forgetting a ${colors.gray('start')} command? Try:\n` +
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
  Creates a new extension from a template (React, TypeScript, Vue, Svelte, etc.)

- ${code('extension dev ' + arg('[project-path|remote-url]'))}
  Starts a development server with hot reloading

- ${code('extension start ' + arg('[project-path|remote-url]'))}
  Builds and starts the extension in production mode

- ${code('extension preview ' + arg('[project-path|remote-url]'))}
  Previews the extension in production mode without building

- ${code('extension build ' + arg('[project-path|remote-url]'))}
  Builds the extension for packaging/distribution

- ${code('extension cleanup')}
  Cleans up orphaned instances and frees unused ports

${'Common Options'}
- ${code('--browser')} ${arg('<chrome|edge|firefox>')} Target browser (default: chrome)
- ${code('--profile')} ${arg('<path|boolean>')}        Browser profile configuration
- ${code('--polyfill')} ${arg('[boolean]')}            Enable/disable cross-browser polyfill
- ${code('--no-telemetry')}                            Disable anonymous telemetry for this run
- ${code('--port')} ${arg('<number>')}                 Development server port (default: 8080)
- ${code('--starting-url')} ${arg('<url>')}            Initial URL to load in browser
- ${code('--silent')} ${arg('[boolean]')}              Suppress console output during build

${'Source Inspection'}
- ${code('--source')} ${arg('<url>')}                  Open URL and print HTML after content scripts inject
- ${code('--watch-source')}                  Monitor rebuild events and print HTML on reloads

${'Browser-Specific Options'}
- ${code('--chromium-binary')} ${arg('<path>')}        Custom Chromium binary path
- ${code('--gecko-binary')} ${arg('<path>')}           Custom Firefox/Gecko binary path

${'Build Options'}
- ${code('--zip')} ${arg('[boolean]')}                 Create ZIP archive of built extension
- ${code('--zip-source')} ${arg('[boolean]')}          Include source files in ZIP
- ${code('--zip-filename')} ${arg('<name>')}           Custom ZIP filename

${colors.underline('Centralized Logger (terminal output)')}
- The manager extension embeds a centralized logger that streams events to the CLI.
- Enable and filter logs directly via ${code('extension dev')} flags:
  - ${code('--logs')} ${arg('<off|error|warn|info|debug|trace>')}    Minimum level (default: info)
  - ${code('--log-context')} ${arg('<list|all>')}                     Contexts: background,content,page,sidebar,popup,options,devtools
  - ${code('--log-format')} ${arg('<pretty|json>')}                   Output format (default: pretty)
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
- For AI-oriented guidance and deep-dive tips, run ${code('extension --ai-help')}

 ${'Report issues'}
 - ${colors.underline('https://github.com/cezaraugusto/extension/issues/new')}`
}

export function unsupportedBrowserFlag(value: string, supported: string[]) {
  return `${getLoggingPrefix('error')} Unsupported --browser value: ${value}. Supported: ${supported.join(', ')}.`
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
  - ${code('--log-format')} ${arg('<pretty|json>')}                   Pretty for humans; JSON for machines/NDJSON pipelines
  - ${code('--no-log-timestamps')} ${arg(' ')}                        Disable timestamps (pretty)
  - ${code('--no-log-color')} ${arg(' ')}                             Disable ANSI colors (pretty)
  - ${code('--log-url')} ${arg('<substring|/regex/>')}                Filter by URL
  - ${code('--log-tab')} ${arg('<id>')}                               Filter by tabId
- Good CI pattern: ${code('EXTENSION_ENV=development EXTENSION_AUTO_EXIT_MS=6000 extension dev ./ext --logs=info --log-format=json')}

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
- Use ${code('--source')} ${arg('<url>')} to inspect page HTML after content script injection
- Use ${code('--watch-source')} to monitor real-time changes in stdout
- Automatically enables Chrome remote debugging (port 9222) when source inspection is active
- Extracts Shadow DOM content from ${code('#extension-root')} elements
- Perfect for debugging content script behavior and style injection
- Example: ${code('extension dev --source=' + arg('https://example.com') + ' --watch-source')}

${'Non-Destructive Testing in CI'}
- Prefer ${code('EXTENSION_ENV=development')} to copy local templates and avoid network.
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
