// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as messages from '../../browsers-lib/messages'

export function logSafariDryRun(converterCmd: string, xcodebuildCmd: string) {
  console.log(messages.safariBuildCalled())
  console.log(messages.safariDryRunNotBuilding())
  console.log(messages.safariDryRunConverter(converterCmd))
  console.log(messages.safariDryRunXcodebuild(xcodebuildCmd))
}
