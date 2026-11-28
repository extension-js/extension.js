//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import colors from 'pintor'
import {fmt, prefix} from '../../lib/messaging'

export {isUsingIntegration} from '../../lib/integration-message'

// Only a single-file component needs vue-loader, so only that is refused:
// a Vue 2 project written with render functions builds like any script.
export function vueTwoSingleFileComponent(version: string, files: string[]) {
  const list = files.map((file) => `- ${colors.underline(file)}`).join('\n')

  return (
    `Vue ${version} is installed, and Extension.js compiles .vue files for Vue 3 only.\n` +
    `${list}\n` +
    `Vue 2 reached end of life in December 2023 and vue-loader 15 cannot read the loader rules this build uses.\n` +
    `Upgrade to ${colors.yellow('vue@3')} with ${colors.yellow('vue-loader@17')}, or write these components as render functions.`
  )
}

export function creatingTSConfig() {
  return `${prefix('info')} Creating a default tsconfig.json…`
}

// svelte-loader compiles with the svelte that sits beside it, so a project
// that installs another release gets output its own runtime cannot run.
export function svelteCompilerRuntimeMismatch(
  compilerVersion: string,
  projectVersion: string
) {
  return (
    `${prefix('warn')} Svelte ${colors.blue(compilerVersion)} compiles this project, ` +
    `which installs svelte ${colors.blue(projectVersion)}.\n` +
    `The build uses ${colors.blue(compilerVersion)} for both, so the page mounts. ` +
    `Add ${colors.blue('svelte-loader')} to the project to compile with ${colors.blue(projectVersion)} instead.`
  )
}

// What a vue.loader or svelte.loader file threw while it was imported.
export function loaderOptionsLoadFailed(configPath: string, cause: unknown) {
  const thrown =
    cause instanceof Error ? cause.message.trim() : String(cause ?? '').trim()
  const reason = thrown || 'The file threw an error with no message.'

  return (
    `${prefix('error')} Couldn't load ${colors.blue(path.basename(configPath))}.\n` +
    `${fmt.label('PATH')} ${fmt.val(configPath)}\n` +
    `${colors.red(reason)}\n` +
    `Fix the loader options file, then run the command again.`
  )
}

export function isUsingCustomLoader(loaderPath: string) {
  return `${prefix('debug')} loader   custom=${loaderPath}`
}

export function jsFrameworksIntegrationsEnabled(integrations: string[]) {
  const names = integrations.length > 0 ? integrations.join(',') : 'none'

  return (
    `${prefix('debug')} js       integrations=${integrations.length} ` +
    `names=${names}`
  )
}

export function jsFrameworksConfigsDetected(
  tsConfigPath?: string,
  tsRoot?: string,
  targets?: string[]
) {
  const val = (v?: string) => v || 'none'
  const tgt = targets?.length ? targets.join(',') : 'default'

  return (
    `${prefix('debug')} js       config tsconfig=${val(tsConfigPath)} ` +
    `tsRoot=${val(tsRoot)} swcTargets="${tgt}"`
  )
}

export function jsFrameworksBabelConfig(configPath: string) {
  return `${prefix('debug')} js       babel config=${configPath}`
}

export function jsFrameworksHmrSummary(enabled: boolean, frameworks: string[]) {
  const names = frameworks.length > 0 ? frameworks.join(',') : 'none'

  return (
    `${prefix('debug')} js       hmr=${enabled ? 'enabled' : 'disabled'} ` +
    `frameworks=${names}`
  )
}
