import checkForUpdate from 'update-check'
import * as messages from './cli-lib/messages'
import * as semver from 'semver'

function isStableVersion(version: string) {
  const v = semver.parse(version)
  return Boolean(v && v.prerelease.length === 0)
}

export default async function checkUpdates(packageJson: Record<string, any>) {
  let update = null

  try {
    update = await checkForUpdate(packageJson)
  } catch (err) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.error(messages.updateFailed(err))
    }
  }

  if (update && isStableVersion(update.latest)) {
    console.log(messages.checkUpdates(packageJson, update))
  }
}
