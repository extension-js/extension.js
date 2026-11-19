// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {CODES} from '../../helpers/messaging'
import {
  describeLaunchFailure,
  launchFailureCode,
  readReadyRunId,
  stampReadyCdpFault
} from './ready-stamp'

type LogCapture = {
  enableUnifiedLogging(opts: Record<string, unknown>): Promise<void>
}

// The browser already runs with the extension when log capture fails, so the
// contract names the fault under a warning code and the caller still says ready.
export function stampLogCaptureFaults<T extends LogCapture>(
  controller: T,
  outputPath: string
): T {
  const runId = readReadyRunId(outputPath)
  const enable = controller.enableUnifiedLogging.bind(controller)

  controller.enableUnifiedLogging = async (logOpts) => {
    try {
      await enable(logOpts)
    } catch (error) {
      stampReadyCdpFault(
        outputPath,
        launchFailureCode(error) ?? CODES.W_CDP_OP_FAILED,
        `browser log capture failed: ${describeLaunchFailure(error) || 'no reason given'}`,
        runId
      )

      throw error
    }
  }

  return controller
}
