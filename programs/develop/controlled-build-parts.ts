// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {ControlledBuildParts} from './dev-server/production-control'
import {buildDevProducerSource} from './plugin-reload/reload-lib/producer-reload'
import {RELAY_TARGETS} from './plugin-reload/steps/inject-bridge-relay'
import {withAddedSources} from './plugin-web-extension/feature-manifest/steps/apply-dev-defaults-lib/patch-csp'
import {BACKGROUND_ASSET} from './plugin-web-extension/shared/background-asset'

// A controlled start or preview runs the producer and relay a dev session
// does. A command wires them, since lib may not reach into a plugin folder.
export const controlledBuildParts: ControlledBuildParts = {
  producerSource: buildDevProducerSource,
  relayTargets: RELAY_TARGETS,
  backgroundAsset: BACKGROUND_ASSET,
  addPolicySources: withAddedSources
}
