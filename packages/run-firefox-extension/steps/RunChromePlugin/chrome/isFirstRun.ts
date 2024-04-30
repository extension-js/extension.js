import path from 'path'
import fs from 'fs'

export default function isFirstRun() {
  return !fs.existsSync(path.resolve(__dirname, 'run-chrome-data-dir'))
}
