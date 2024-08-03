import path from 'path'
import fs from 'fs'

export default function isFirstRun(profileName: string) {
  return !fs.existsSync(path.resolve(__dirname, profileName))
}
