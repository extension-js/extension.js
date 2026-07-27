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
    `${prefix('info')} Install the ${integration} dependencies.\n` +
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

export function youAreAllSet(name: string) {
  return `${prefix('success')} ${name} is installed.`
}

export function creatingTSConfig() {
  return `${prefix('info')} Create a default tsconfig.json.`
}

export function failedToInstallIntegration(
  integration: string,
  error: unknown
) {
  return (
    `${prefix('error')} Could not install the ${colors.brightBlue(integration)} dependencies.\n` +
    `${colors.red('Extension.js could not detect a package manager.')}\n` +
    `Install the dependencies by hand, then run the command again.\n` +
    `${colors.red(String(error ?? ''))}`
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
