import path from 'path'
import fs from 'fs-extra'

export default function isFirstRun() {
  return !fs.existsSync(path.resolve(__dirname, 'run-edge-data-dir'))
}
