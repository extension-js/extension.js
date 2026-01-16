//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import checkForUpdate from 'update-check'
import * as messages from './cli-lib/messages'
import * as semver from 'semver'
import {getCliPackageJson} from './cli-package-json'

function isStableVersion(version: string) {
  const v = semver.parse(version)
  return Boolean(v && v.prerelease.length === 0)
}

export default async function checkUpdates(): Promise<string | null> {
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
    return messages.checkUpdates(packageJson, update)
  }

  return null
}
