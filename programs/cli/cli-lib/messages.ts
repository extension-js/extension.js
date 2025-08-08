//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

import colors from 'pintor'

export function updateFailed(err: any) {
  return '🧩\n' + colors.red(`Failed to check for updates: ${err.message}`)
}

export function checkUpdates(
  packageJson: Record<string, any>,
  update: {latest: string}
) {
  return (
    `🧩` +
    `\n${colors.yellow('Notice:')} A new version of ${colors.green(
      'Extension.js'
    )} is available!` +
    `\nYou are currently using version ${colors.yellow(packageJson.version)}.` +
    `\nThe latest stable version is ${colors.yellow(update.latest)}.` +
    `\nPlease update to the latest version to enjoy new features and improvements.\n`
  )
}

export function unsupportedNodeVersion() {
  return (
    `🧩\n` +
    colors.red(
      `You are using an unsupported Node version (${process.version}).\n`
    ) +
    `Please update to a version higher than ${colors.green('18')}.\n`
  )
}

export function noURLWithoutStart(argument: string) {
  return (
    `🧩\n` +
    `The default ${colors.yellow('create')} command does not accept URLs.` +
    `\nAre you forgetting a ${colors.yellow('start')} command? Maybe:\n\n` +
    `${colors.blue(`npx extension ${colors.yellow('start')} ${argument}`)}`
  )
}

export function notImplemented(argument: string) {
  return `🧩\n` + colors.red(`${argument} command not implemented yet.`)
}

export function programHelp() {
  return `🧩
${colors.underline('Help center for the Extension.js program')}

${colors.yellow('Usage:')} extension [command] [options]

${colors.yellow('Note:')} If you are looking for a specific list of options,
all high-level commands offer their own \`--help\` file with
information about usage and a list of command flags available.

For example:

${colors.green('extension create --help')}
outputs information about the "create" command.

${colors.yellow('Available Commands:')}

${colors.green('extension create <project-name|project-path>')}
Creates a new extension from a template. The "create" command
is optional and can be omitted. Supports various templates like
React, TypeScript, Vue, Svelte, and more.

${colors.green('extension dev [project-path|remote-url]')}
Starts a development server with hot reloading. Runs the extension
in development mode with live file watching and automatic browser
reloading when files change.

${colors.green('extension start [project-path|remote-url]')}
Builds and starts the extension in production mode. Compiles the
extension with production optimizations and launches it in a browser
instance for testing.

${colors.green('extension preview [project-path|remote-url]')}
Previews the extension in production mode without building. Useful
for testing pre-built extensions or remote packages that are ready
for manual browser testing.

${colors.green('extension build [project-path|remote-url]')}
Builds the extension for production deployment. Creates optimized
bundles ready for packaging and distribution to browser stores.

${colors.green('extension cleanup')}
Cleans up orphaned instances and frees unused ports. Useful for
removing stale development server instances that weren't properly
terminated during previous sessions.

${colors.yellow('Common Options:')}
${colors.blue('--browser <chrome|edge|firefox>')} - Specify target browser (default: chrome)
${colors.blue('--profile <path|boolean>')} - Browser profile configuration
${colors.blue('--polyfill [boolean]')} - Enable/disable cross-browser polyfill
${colors.blue('--port <number>')} - Development server port (default: 8080)
${colors.blue('--starting-url <url>')} - Initial URL to load in browser
${colors.blue('--silent [boolean]')} - Suppress console output during build

${colors.yellow('Source Inspection Options:')}
${colors.blue('--source <url>')} - Opens URL in Chrome and prints full HTML after content scripts are injected
${colors.blue('--watch-source')} - Continuously monitors rebuild events and prints updated HTML on extension reloads

${colors.yellow('Browser-Specific Options:')}
${colors.blue('--chromium-binary <path>')} - Custom Chromium binary path
${colors.blue('--gecko-binary <path>')} - Custom Firefox/Gecko binary path

${colors.yellow('Build Options:')}
${colors.blue('--zip [boolean]')} - Create ZIP archive of built extension
${colors.blue('--zip-source [boolean]')} - Include source files in ZIP
${colors.blue('--zip-filename <name>')} - Custom ZIP filename

${colors.green('extension --help')}
This command ;) Outputs a help file with key command options.

${colors.yellow('Feels something is wrong? Help by reporting a bug:')}
${colors.underline('https://github.com/cezaraugusto/extension/issues/new')}

## Development tips for extension developers and AI assistants:

${colors.yellow('Browser-Specific Configuration')}
- Use browser prefixes in manifest.json for browser-specific fields:
  ${colors.blue('{"firefox:manifest": 2, "chrome:manifest": 3}')}
  This applies manifest v2 to Firefox only, v3 to Chrome/Edge.

${colors.yellow('Special Folders for Entrypoints')}
- Use special folders to handle entrypoints and assets not declared in manifest.json:
- ${colors.blue('public/')} - Static assets automatically copied to build (resolves to output root)
- ${colors.blue('pages/')} - HTML files not declared in manifest (e.g., welcome pages)
- ${colors.blue('scripts/')} - JavaScript files not declared in manifest (e.g., executable scripts)

${colors.yellow('Shadow DOM for Content Scripts')}
- Add ${colors.blue('use shadow-dom')} directive to content scripts for style isolation
- Automatically creates ${colors.blue('#extension-root')} element with shadow DOM
- All CSS imports are automatically injected into shadow DOM
- Prevents style conflicts with host page

${colors.yellow('Environment Variables')}
- Use ${colors.blue('EXTENSION_PUBLIC_*')} prefix for variables accessible in extension code
- Supported in both ${colors.blue('process.env')} and ${colors.blue('import.meta.env')}
- Environment file priority: ${colors.blue('.env.{browser}.{mode}')} > ${colors.blue('.env.{browser}')} > ${colors.blue('.env.{mode}')} > ${colors.blue('.env')}
- Example: ${colors.blue('EXTENSION_PUBLIC_API_KEY=your_key')}

${colors.yellow('Available Templates')}
- ${colors.green('Frameworks')}: ${colors.blue('react')}, ${colors.blue('preact')}, ${colors.blue('vue')}, ${colors.blue('svelte')}
- ${colors.green('Languages')}: ${colors.blue('javascript')}, ${colors.blue('typescript')}
- ${colors.green('Contexts')}: ${colors.blue('content')} (content scripts), ${colors.blue('new')} (new tab), ${colors.blue('action')} (popup)
- ${colors.green('Styling')}: ${colors.blue('tailwind')}, ${colors.blue('sass')}, ${colors.blue('less')}
- ${colors.green('Configs')}: ${colors.blue('eslint')}, ${colors.blue('prettier')}, ${colors.blue('stylelint')}

${colors.yellow('Webpack/Rspack Configuration')}
- Create ${colors.blue('extension.config.js')} for custom webpack configuration
- Function receives base config, return modified config
- Supports all webpack/rspack loaders and plugins
- Example:
  ${colors.blue('export default {')}
  ${colors.blue('  config: (config) => {')}
  ${colors.blue("    config.module.rules.push({ test: /\\.svg$/, use: ['@svgr/webpack'] })")}
  ${colors.blue('    return config')}
  ${colors.blue('  }')}
  ${colors.blue('}')}

${colors.yellow('Framework-Specific Configuration')}
- Create ${colors.blue('vue.loader.js')} for Vue-specific loader configuration
- Create ${colors.blue('svelte.loader.js')} for Svelte-specific loader configuration
- Automatically detected and used by Extension.js
- Example svelte.loader.js:
  ${colors.blue('module.exports = {')}
  ${colors.blue('  preprocess: require("svelte-preprocess")({')}
  ${colors.blue('    typescript: true')}
  ${colors.blue('  })')}
  ${colors.blue('}')}

${colors.yellow('Hot Module Replacement (HMR)')}
- Automatically enabled in development mode
- CSS changes trigger automatic style updates
- React/Preact/Vue/Svelte components hot reload
- Content scripts automatically re-inject on changes
- Service workers, _locales and manifest changes reload the extension

${colors.yellow('Source Inspection & Real-Time Monitoring')}
- Use ${colors.blue('--source <url>')} to inspect page HTML after content script injection
- Use ${colors.blue('--watch-source')} to monitor real-time changes in stdout
- Automatically enables Chrome remote debugging (port 9222) when source inspection is active
- Extracts Shadow DOM content from ${colors.blue('#extension-root')} elements
- Perfect for debugging content script behavior and style injection
- Example: ${colors.blue('extension dev --source=https://example.com --watch-source')}

${colors.yellow('Cross-Browser Compatibility')}
- Use ${colors.blue('--polyfill')} flag to enable webextension-polyfill
- Automatically handles browser API differences
- Supports Chrome, Edge, Firefox with single codebase`
}
