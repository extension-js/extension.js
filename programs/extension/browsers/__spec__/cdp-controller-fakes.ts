import type {CDPExtensionController} from '../run-chromium/cdp/cdp-extension-controller'

// A stand-in CDP client: each spec fakes only the calls its rows reach.
export type FakeCdp = Record<string, (...args: never[]) => unknown>

// The private controller members the specs swap or read, next to its
// public surface.
export type ControllerUnderTest = {
  [K in keyof CDPExtensionController]: CDPExtensionController[K]
} & {
  cdp: FakeCdp
  extensionId: string | null
  extensionIdValue: string | null
  deriveExtensionIdFromTargets: (...args: never[]) => unknown
  enableLogging: (...args: never[]) => unknown
  classifyOwnership: (extensionId: string) => unknown
}

export function controllerInternals(
  controller: CDPExtensionController
): ControllerUnderTest {
  return controller as unknown as ControllerUnderTest
}
