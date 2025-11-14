import * as messages from '../../browsers-lib/messages'

export function logFirefoxDryRun(
  browserBinaryLocation: string,
  firefoxConfig: string
) {
  console.log(messages.firefoxLaunchCalled())
  console.log(messages.firefoxDryRunNotLaunching())
  console.log(messages.firefoxDryRunBinary(browserBinaryLocation))
  console.log(messages.firefoxDryRunConfig(firefoxConfig))
}
