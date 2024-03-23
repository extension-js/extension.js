import checkForUpdate from 'update-check'
import {bold, red} from '@colors/colors/safe'

export default async function checkUpdates(packageJson: Record<string, any>) {
  let update = null

  try {
    update = await checkForUpdate(packageJson)
  } catch (err) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.error(bold(red(`Failed to check for updates: ${err}`)))
    }
  }

  if (update) {
    console.log(
      `Your 🧩 ${bold('extension-create')} version is ${red('outdated')}.\nThe latest version is ${bold(update.latest)}. Please update!`
    )
  }
}
