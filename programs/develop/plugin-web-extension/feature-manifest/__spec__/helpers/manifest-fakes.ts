import type {DevOptions, Manifest} from '../../../../types'

// A manifest fixture or a manifest read back from a step, seen through the
// engine's own type. Fixtures that hold an invalid shape on purpose go here.
export function asManifest(value: unknown): Manifest {
  return value as Manifest
}

// A browser name the type does not list, to prove how a step treats a fork
// or an unknown target at runtime.
export function asBrowser(name: string): DevOptions['browser'] {
  return name as DevOptions['browser']
}
