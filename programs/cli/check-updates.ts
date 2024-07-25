import checkForUpdate from 'update-check'
import {bold, red} from '@colors/colors/safe'

export default async function checkUpdates(packageJson: Record<string, any>) {
  let update = null

  try {
    update = await checkForUpdate(packageJson)
  } catch (err) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.error(red(`Failed to check for updates: ${err}`))
    }
  }

  if (update) {
    console.log(
      `\nYour 🧩 ${'Extension.js'} version is ${red(
        'outdated'
      )}.\nThe latest version is ${update.latest}. Please update!\n`
    )
  }
}
