import path from 'path'
import {type Manifest} from '../../../../types'

export function storage(
  context: string,
  manifest: Manifest
): string | undefined {
  if (!manifest || !manifest.storage || !manifest.storage.managed_schema) {
    return undefined
  }

  const storageManagedSchema: string = manifest.storage.managed_schema

  return path.join(context, storageManagedSchema)
}
