// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {humanLine, isDebug} from '../../../helpers/messaging'
import * as messages from '../../browsers-lib/messages'

export function logSafariDryRun(converterCmd: string, xcodebuildCmd: string) {
  if (isDebug()) humanLine(messages.safariBuildCalled())
  humanLine(messages.safariDryRunNotBuilding())
  humanLine(messages.safariDryRunConverter(converterCmd))
  humanLine(messages.safariDryRunXcodebuild(xcodebuildCmd))
}
