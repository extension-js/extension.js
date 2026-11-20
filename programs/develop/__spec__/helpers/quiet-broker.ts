import type {ReloadBroker} from '../../plugin-reload/reload-dispatch'

// A broker with no producer behind it: nothing is delivered, nothing is
// acked and nothing restarts. A spec names only the answers it is about.
export function quietBroker<Overrides extends Partial<ReloadBroker>>(
  overrides?: Overrides
): ReloadBroker & Overrides {
  const quiet: ReloadBroker = {
    broadcastReload: () => 0,
    runsBuild: () => false,
    undeliveredReloadWarning: () => null,
    deliverLatchedReload: () => Promise.resolve(false),
    awaitReloadAck: () => Promise.resolve('not-expected'),
    reloadReplayedTabs: () => 0,
    awaitReloadRestart: () => Promise.resolve('not-expected'),
    awaitLateReloadRestart: () => Promise.resolve(null),
    awaitBootRegistrations: () => Promise.resolve('settled'),
    noteReloadApplied: () => {}
  }

  return {...quiet, ...overrides} as ReloadBroker & Overrides
}
