// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {CDPClient} from './cdp-client'

export async function getExtensionInfo(
  cdp: CDPClient,
  extensionId: string
): Promise<{extensionInfo?: {name?: string; version?: string}}> {
  return (await cdp.sendCommand('Extensions.getExtensionInfo', {
    extensionId
  })) as {extensionInfo?: {name?: string; version?: string}}
}

export async function loadUnpackedExtension(cdp: CDPClient, absPath: string) {
  const response = (await cdp.sendCommand('Extensions.loadUnpacked', {
    extensionPath: absPath,
    options: {failOnError: false}
  })) as {extensionId?: string}

  return String(response?.extensionId || '')
}

export async function unloadExtension(cdp: CDPClient, extensionId: string) {
  try {
    await cdp.sendCommand('Extensions.unload', {extensionId})
    return true
  } catch {
    return false
  }
}
