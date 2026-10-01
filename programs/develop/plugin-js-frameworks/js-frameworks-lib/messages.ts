//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import colors from 'pintor'
import {prefix} from '../../lib/messaging'

export function installingRootDependencies(integration: string) {
  return (
    `${prefix('info')} Installing the ${integration} dependencies…\n` +
    `This only happens for core contributors.`
  )
}

export function integrationInstalledSuccessfully(integration: string) {
  return `${prefix('success')} ${integration} dependencies are installed.`
}

// The caller owns the prefix here: every call site already wraps this in a
// debug line, so a glyph inside the string would print twice.
export function isUsingIntegration(name: string) {
  return `integration use=${name}`
}

// vue-loader 15 throws on the layer keys the content script rules carry,
// and the Vue 2 runtime is end of life, so the build stops here by name.
export function vueTwoIsNotSupported(version: string) {
  return (
    `${prefix('error')} Vue ${version} is installed, and Extension.js builds Vue 3 only.\n` +
    `Vue 2 reached end of life in December 2023 and vue-loader 15 cannot read the loader rules this build uses.\n` +
    `Upgrade to ${colors.yellow('vue@3')} with ${colors.yellow('vue-loader@17')}, or build with your own tooling and point Extension.js at the output.`
  )
}

export function youAreAllSet(name: string) {
  return `${prefix('success')} ${name} is installed.`
}

export function creatingTSConfig() {
  return `${prefix('info')} Creating a default tsconfig.json…`
}

export function failedToInstallIntegration(
  integration: string,
  error: unknown
) {
  const detail = String(error ?? '').trim()

  return (
    `${prefix('error')} Couldn't install the ${integration} dependencies.\n` +
    `${colors.red("Extension.js couldn't detect a package manager.")}\n` +
    (detail ? `${colors.gray('REASON')} ${colors.red(detail)}\n` : '') +
    `Install the dependencies by hand, then run the command again.`
  )
}

// svelte-loader compiles with the svelte that sits beside it, so a project
// whose lockfile pins an older one gets output its runtime cannot link.
export function svelteCompilerRuntimeMismatch(
  compilerVersion: string,
  projectVersion: string
) {
  return (
    `${prefix('warn')} Svelte ${colors.blue(compilerVersion)} compiles this project, ` +
    `which pins svelte ${colors.blue(projectVersion)}.\n` +
    `The build uses ${colors.blue(compilerVersion)} for both, so the output links. ` +
    `Add ${colors.blue('svelte-loader')} to the project to compile with ${colors.blue(projectVersion)} instead.`
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

export function jsFrameworksHmrSummary(enabled: boolean, frameworks: string[]) {
  const names = frameworks.length > 0 ? frameworks.join(',') : 'none'

  return (
    `${prefix('debug')} js       hmr=${enabled ? 'enabled' : 'disabled'} ` +
    `frameworks=${names}`
  )
}
