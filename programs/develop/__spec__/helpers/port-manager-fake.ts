import type {PortManager} from '../../dev-server/port-manager'

// A port manager that carries only the members a spec names. Each given
// member is checked against the real class, and a call to any other throws.
export function portManagerFake<Overrides extends Partial<PortManager>>(
  overrides: Overrides
): PortManager & Overrides {
  return overrides as PortManager & Overrides
}
