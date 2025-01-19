import fs from 'fs'
import {spawnSync} from 'child_process'
import * as messages from '../../browsers-lib/messages'
import {type DevOptions} from '../../../commands/commands-lib/config-types'

interface LaunchSafariOptions {
  startingUrl?: string
  isMacOS: boolean
  browser: DevOptions['browser']
}

function runAppleScript(script: string, browser: DevOptions['browser']): void {
  const result = spawnSync('osascript', ['-e', script], {stdio: 'pipe'})

  if (result.error) {
    console.error(
      messages.browserNotInstalledError(
        browser,
        'osascript not found or failed'
      )
    )
    process.exit(1)
  }

  const output = result.stdout?.toString().trim()
  const errorOutput = result.stderr?.toString().trim()

  if (errorOutput) {
    console.error(`AppleScript Error: ${errorOutput}`)
    console.log(`Output: ${output}`)
    console.error(
      "Failed to enable 'Allow Unsigned Extensions'. Please enable it manually from the Develop menu in Safari."
    )
    process.exit(1)
  }

  console.log(output)
}

function configureSafariExtension(browser: DevOptions['browser']): void {
  // AppleScript to enable "Allow Unsigned Extensions" in Safari's Develop menu
  const script = `
tell application "Safari"
    activate
end tell
delay 1
tell application "System Events"
    tell process "Safari"
        set frontmost to true
        try
            click menu item "Allow Unsigned Extensions" of menu "Develop" of menu bar 1
        on error errMsg
            log "Error: " & errMsg
            display dialog "Could not find 'Allow Unsigned Extensions' in the Develop menu. Please enable it manually." buttons {"OK"}
        end try
    end tell
end tell
  `

  runAppleScript(script, browser)
}

export function launchSafari(options: LaunchSafariOptions): void {
  const {startingUrl, isMacOS, browser} = options

  if (!isMacOS) {
    console.log('RunSafariPlugin is supported only on macOS. Exiting.')
    process.exit(0)
  }

  const safariPath = '/Applications/Safari.app'
  if (!fs.existsSync(safariPath)) {
    console.error(messages.browserNotInstalledError('safari', safariPath))
    process.exit(1)
  }

  // Configure Safari for the development extension
  configureSafariExtension(browser)

  const args = ['open', safariPath]
  if (startingUrl) args.push('--args', startingUrl)

  const result = spawnSync('open', args, {stdio: 'inherit'})
  if (result.error) {
    console.error(`Failed to launch Safari: ${result.error.message}`)
    process.exit(1)
  }
}
