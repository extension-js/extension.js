// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'
import {manifestPageOutputTarget} from '../../normalize-manifest-path'

export function declarativeNetRequest(
  manifest: Manifest,
  manifestPath?: string
) {
  // Dynamic-only DNR may omit rule_resources; avoid .map on undefined.
  return (
    manifest.declarative_net_request && {
      declarative_net_request: {
        ...manifest.declarative_net_request,
        ...(Array.isArray(manifest.declarative_net_request.rule_resources) && {
          rule_resources: manifest.declarative_net_request.rule_resources.map(
            (resourceObj: {path: string; id: string}) => {
              return {
                ...resourceObj,
                path:
                  resourceObj.path &&
                  getFilename(
                    manifestPageOutputTarget(
                      resourceObj.path,
                      `declarative_net_request/${resourceObj.id}.json`,
                      manifestPath
                    ),
                    resourceObj.path
                  )
              }
            }
          )
        })
      }
    }
  )
}
