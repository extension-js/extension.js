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

// The adapter over solid-js/h keeps a Solid project compiling, but only
// Solid's own compiler turns a signal read in child position into an effect.
export function solidIsNotSupported() {
  return (
    `${prefix('warn')} Solid is not a supported framework, so this project compiles through the JSX runtime only.\n` +
    `A signal read in a child position, like ${colors.yellow('{count()}')}, renders once and does not update.\n` +
    `Only Solid's own compiler makes that expression reactive, and the JSX runtime cannot recover it.`
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
