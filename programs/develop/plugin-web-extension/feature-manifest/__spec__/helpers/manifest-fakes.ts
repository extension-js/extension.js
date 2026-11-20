import type {Manifest} from '../../../../types'

// A manifest fixture or a manifest read back from a step, seen through the
// engine's own type. Fixtures that hold an invalid shape on purpose go here.
export function asManifest(value: unknown): Manifest {
  return value as Manifest
}
