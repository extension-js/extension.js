import path from 'path'
import {type ManifestData} from '../../types'

export default function storage(
  manifestPath: string,
  manifest: ManifestData
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
