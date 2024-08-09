import checkForUpdate from 'update-check'
import * as messages from './cli-lib/messages'

function isStableVersion(version: string) {
  // Check if the version string contains "alpha", "beta", or any other pre-release identifiers
  return !/[a-zA-Z]/.test(version)
}

export default async function checkUpdates(packageJson: Record<string, any>) {
  let update = null

  try {
    update = await checkForUpdate(packageJson)
  } catch (err) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.error(messages.updateFailed(err))
    }
  }

  if (update && isStableVersion(update.latest)) {
    console.log(messages.checkUpdates(packageJson, update))
  }
}
