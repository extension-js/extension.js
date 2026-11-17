// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {ChildProcess} from 'node:child_process'
import locateBrave from 'brave-location'
import locateChromium from 'chromium-location'
import locateEdge from 'edge-location'
import locateOpera from 'opera-location2'
import locateVivaldi from 'vivaldi-location2'
import locateYandex from 'yandex-location'
import {locateChromeIn} from '../../browsers-lib/binary-env-override'
import {
  claimDebugPortNear,
  type DebugPortClaim
} from '../../browsers-lib/debug-port-claim'
import {
  type InstallableTarget,
  offerManagedInstall
} from '../../browsers-lib/first-run-install'
import {
  gracefulTerminateChild,
  wasTerminatedByUs
} from '../../browsers-lib/process-teardown'
import {probeChromiumBinaryVersion} from '../../browsers-lib/version-probe'
import type {BrowserType} from '../../browsers-types'
import {checkChromeRemoteDebugging} from '../cdp/discovery'
import {setupProcessSignalHandlers} from './process-handlers'
import {spawnChromiumProcess} from './wsl-support'

type SystemLocator = (env: NodeJS.ProcessEnv) => string | null

export type ChromiumLocatorName =
  | 'chrome'
  | 'chromium'
  | 'edge'
  | 'brave'
  | 'opera'
  | 'vivaldi'
  | 'yandex'

// Everything a launch does to the machine outside its own project folder, so
// a caller can stand in for the browser. Left out, each is the real thing.
export interface ChromiumLaunchDependencies {
  locate: Record<ChromiumLocatorName, SystemLocator>
  offerInstall: (target: InstallableTarget) => Promise<boolean>
  probeVersion: (binary: string, browser: string) => Promise<string>
  claimPort: (startPort: number) => Promise<DebugPortClaim>
  spawn: typeof spawnChromiumProcess
  watchSignals: typeof setupProcessSignalHandlers
  portIsOpen: (port: number) => Promise<boolean>
  loadCdpSetup: () => Promise<typeof import('./setup-cdp-after-launch')>
  terminate: (child: ChildProcess | null, browser: BrowserType) => void
  terminatedByUs: (child: ChildProcess | null) => boolean
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export const chromiumLaunchDefaults: ChromiumLaunchDependencies = {
  locate: {
    chrome: (env) => locateChromeIn(env),
    chromium: (env) => locateChromium({env}),
    edge: (env) => locateEdge({env}),
    brave: (env) => locateBrave(true, {env}),
    opera: (env) => locateOpera(true, {env}),
    vivaldi: (env) => locateVivaldi(true, {env}),
    yandex: (env) => locateYandex(true, {env})
  },
  offerInstall: (target) => offerManagedInstall(target),
  probeVersion: (binary, browser) =>
    probeChromiumBinaryVersion(binary, browser),
  claimPort: (startPort) => claimDebugPortNear(startPort),
  spawn: spawnChromiumProcess,
  watchSignals: setupProcessSignalHandlers,
  portIsOpen: (port) => checkChromeRemoteDebugging(port),
  // Loaded on demand, as before: a dry run and a refusal never need it.
  loadCdpSetup: () => import('./setup-cdp-after-launch'),
  terminate: gracefulTerminateChild,
  terminatedByUs: wasTerminatedByUs,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now()
}
