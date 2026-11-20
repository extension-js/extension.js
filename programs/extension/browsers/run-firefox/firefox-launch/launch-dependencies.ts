// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {ChildProcess} from 'node:child_process'
import * as fs from 'node:fs'
import locateFirefox from 'firefox-location2'
import locateFloorp from 'floorp-location'
import locateLibreWolf from 'librewolf-location'
import locateWaterfox from 'waterfox-location'
import locateZen from 'zen-location'
import {
  claimDebugPortNear,
  type DebugPortClaim
} from '../../browsers-lib/debug-port-claim'
import {
  gracefulTerminateChild,
  gracefulTerminatePid,
  wasPidTerminatedByUs,
  wasTerminatedByUs
} from '../../browsers-lib/process-teardown'
import {
  isPidAlive,
  listProcesses,
  type ProcessRow,
  pidStartId,
  resolveLiveBrowserPid
} from '../../browsers-lib/resolve-live-pid'
import {probeGeckoBinaryVersion} from '../../browsers-lib/version-probe'
import type {BrowserType} from '../../browsers-types'
import {stampReadyWhenRdpPortOpens} from './await-rdp-port'
import {librewolfRemoteDebuggingEnabled} from './librewolf-overrides'
import {setupFirefoxProcessHandlers} from './process-handlers'
import {setupRdpAfterLaunch} from './setup-rdp-after-launch'
import {spawnFirefoxProcess} from './wsl-support'

type SystemLocator = (env: NodeJS.ProcessEnv) => string | null

export type GeckoLocatorName =
  | 'firefox'
  | 'waterfox'
  | 'librewolf'
  | 'zen'
  | 'floorp'

// Everything a launch does to the machine outside its own project folder, so
// a caller can stand in for the browser. Left out, each is the real thing.
export interface FirefoxLaunchDependencies {
  locate: Record<GeckoLocatorName, SystemLocator>
  librewolfRemoteDebugging: () => {enabled: boolean; expectedPath: string}
  probeVersion: (binary: string) => Promise<string>
  claimPort: (startPort: number) => Promise<DebugPortClaim>
  spawn: typeof spawnFirefoxProcess
  watchSignals: typeof setupFirefoxProcessHandlers
  awaitRdpPort: typeof stampReadyWhenRdpPortOpens
  setupRdp: (
    ...args: Parameters<typeof setupRdpAfterLaunch>
  ) => ReturnType<typeof setupRdpAfterLaunch>
  terminate: (child: ChildProcess | null, browser: BrowserType) => void
  terminatePid: (pid: number | null | undefined, browser: BrowserType) => void
  terminatedByUs: (child: ChildProcess | null) => boolean
  pidTerminatedByUs: (pid: number | null | undefined) => boolean
  isPidAlive: (pid: number | null | undefined) => boolean
  pidStartId: (pid: number) => string | undefined
  listProcesses: () => ProcessRow[]
  resolveLivePid: typeof resolveLiveBrowserPid
  exit: (code: number) => void
}

export const firefoxLaunchDefaults: FirefoxLaunchDependencies = {
  locate: {
    firefox: (env) => locateFirefox(true, {env}),
    waterfox: (env) => locateWaterfox(true, {env}),
    librewolf: (env) => locateLibreWolf(true, {env}),
    zen: (env) => locateZen(true, {env}),
    floorp: (env) => locateFloorp(true, {env})
  },
  librewolfRemoteDebugging: () =>
    librewolfRemoteDebuggingEnabled(fs, process.env, process.platform),
  probeVersion: (binary) => probeGeckoBinaryVersion(binary),
  claimPort: (startPort) => claimDebugPortNear(startPort),
  spawn: spawnFirefoxProcess,
  watchSignals: setupFirefoxProcessHandlers,
  awaitRdpPort: stampReadyWhenRdpPortOpens,
  setupRdp: (plugin, compilation, debugPort) =>
    setupRdpAfterLaunch(plugin, compilation, debugPort),
  terminate: gracefulTerminateChild,
  terminatePid: gracefulTerminatePid,
  terminatedByUs: wasTerminatedByUs,
  pidTerminatedByUs: wasPidTerminatedByUs,
  isPidAlive,
  pidStartId: (pid) => pidStartId(pid),
  listProcesses: () => listProcesses(),
  resolveLivePid: resolveLiveBrowserPid,
  exit: (code) => process.exit(code)
}
