import type {
  DevelopBridge,
  DevelopModule,
  DevelopPreviewModule
} from '../../helpers/extension-develop-runtime'

// A stand-in may name only what the engine entry exports, so a renamed or
// removed export fails the typecheck instead of a spec passing on a stale name.
type StandIn<Entry, K extends keyof Entry> = {[P in K]: unknown}

export function bridgeStandIn<K extends keyof DevelopBridge>(
  members: StandIn<DevelopBridge, K>
): DevelopBridge {
  return members as unknown as DevelopBridge
}

export function developStandIn<K extends keyof DevelopModule>(
  members: StandIn<DevelopModule, K>
): DevelopModule {
  return members as unknown as DevelopModule
}

export function previewStandIn<K extends keyof DevelopPreviewModule>(
  members: StandIn<DevelopPreviewModule, K>
): DevelopPreviewModule {
  return members as unknown as DevelopPreviewModule
}
