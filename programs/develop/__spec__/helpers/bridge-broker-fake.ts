import type {BridgeBroker} from '../../dev-server/control-bridge/broker'

// A bridge broker that carries only the members a spec names. Each given
// member is checked against the real broker, and a call to any other throws.
export function bridgeBrokerFake<Overrides extends Partial<BridgeBroker>>(
  overrides: Overrides
): BridgeBroker & Overrides {
  return overrides as BridgeBroker & Overrides
}
