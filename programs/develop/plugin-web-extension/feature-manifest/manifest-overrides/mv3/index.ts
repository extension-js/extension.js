// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../../types'
import {pageAction} from '../common/page_action'
import {action} from './action'
import {backgroundServiceWorker} from './background'
import {declarativeNetRequest} from './declarative_net_request'
import {hostPermissions} from './host_permissions'
import {sidePanel} from './side_panel'

export function manifestV3(manifest: Manifest, manifestPath?: string) {
  return {
    ...action(manifest),
    ...pageAction(manifest),
    ...backgroundServiceWorker(manifest),
    ...declarativeNetRequest(manifest, manifestPath),
    ...hostPermissions(manifest),
    ...sidePanel(manifest)
  }
}
