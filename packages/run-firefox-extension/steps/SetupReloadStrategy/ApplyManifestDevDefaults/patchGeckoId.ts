import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

export default function patchGeckoId(manifestPath: string) {
  // Generate a unique ID using a hash of the extension path
  const hash = crypto
    .createHash('md5')
    .update(path.dirname(manifestPath))
    .digest('hex')

  // Format similar to temporary IDs used by Firefox
  return `extension-${hash}@temporary-addon`
}
