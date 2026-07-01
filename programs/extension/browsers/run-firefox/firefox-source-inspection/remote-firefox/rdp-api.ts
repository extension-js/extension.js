// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {RdpTransport} from './transport'
import type {RdpTarget} from './rdp-types'

export async function listTabs(transport: RdpTransport): Promise<RdpTarget[]> {
  const response = (await transport.request({
    to: 'root',
    type: 'listTabs'
  })) as {
    tabs?: RdpTarget[]
  }
  return response.tabs || []
}

export async function getTargetFromDescriptor(
  transport: RdpTransport,
  descriptorId: string
) {
  return (await transport.request({to: descriptorId, type: 'getTarget'})) as {
    frame?: {actor?: string; consoleActor?: string}
    actor?: string
    target?: {actor?: string; consoleActor?: string}
    tab?: {actor?: string} | string
    webConsoleActor?: string
    consoleActor?: string
  }
}
