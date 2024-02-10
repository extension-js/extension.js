import path from 'path'
import {type Manifest} from '../../types'

export default function storage(
  manifestPath: string,
  manifest: Manifest
): string | undefined {
  if (!manifest || !manifest.storage || !manifest.storage.managed_schema) {
    return undefined
  }

  const storageManagedSchema = manifest.storage.managed_schema

  const storageManagedSchemaAbsolutePath = path.join(
    path.dirname(manifestPath),
    storageManagedSchema
  )

  return storageManagedSchemaAbsolutePath
}
