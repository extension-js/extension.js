//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {isEmulatorLaneEnabled, isEmulatorVendor} from './vendors'

export const EMULATOR_LOGS_REFUSAL =
  'emulated Chromium runs in a web page; read its console in that page.'

export function emulatorRefusalFor(command: string): string {
  if (command === 'logs') return EMULATOR_LOGS_REFUSAL

  return `emulated Chromium runs in a web page with no debugging protocol, so extension ${command} cannot reach it; use that page directly.`
}

interface ReadyDocumentReader {
  readReadyContractDocument?: (
    projectPath: string,
    browser: string
  ) => Record<string, unknown> | null
}

export function isEmulatorSession(
  bridge: unknown,
  projectPath: string,
  browser: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (isEmulatorVendor(browser) && isEmulatorLaneEnabled(env)) return true

  const reader = (bridge as ReadyDocumentReader | null)
    ?.readReadyContractDocument

  if (typeof reader !== 'function') return false

  try {
    return reader(projectPath, browser)?.engine === 'emulator'
  } catch {
    return false
  }
}

export function emulatorSessionRefusal(
  bridge: unknown,
  projectPath: string,
  browser: string,
  command: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  return isEmulatorSession(bridge, projectPath, browser, env)
    ? emulatorRefusalFor(command)
    : null
}
