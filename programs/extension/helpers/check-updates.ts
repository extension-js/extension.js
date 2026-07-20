//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as semver from 'semver'
import checkForUpdate from 'update-check'
import {getCliPackageJson} from './cli-package-json'
import * as messages from './messages'

function isStableVersion(version: string) {
  const v = semver.parse(version)
  return Boolean(v && v.prerelease.length === 0)
}

export default async function checkUpdates(): Promise<{
  suffix: string
  message: string
} | null> {
  const packageJson = getCliPackageJson()
  let update = null

  try {
    update = await checkForUpdate(packageJson)
  } catch (err) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.error(messages.updateFailed(err))
    }
  }

  if (update && isStableVersion(update.latest)) {
    if (isStableVersion(packageJson.version)) {
      return messages.checkUpdates(packageJson, update)
    }
  }

  return null
}
