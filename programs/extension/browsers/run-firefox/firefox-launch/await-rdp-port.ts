// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as net from 'node:net'
import {RDP_PORT_DEADLINE_MS} from '../../browsers-lib/constants'
import {
  stampReadyRdpPort,
  stampReadyRdpPortError
} from '../../browsers-lib/ready-stamp'

export type RdpPortWait = {open: true} | {open: false; reason: string}

function probePort(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({port, host})

    const finish = (open: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }

    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(1_000, () => finish(false))
  })
}

// Firefox opens its debugger server some time after the process starts. The
// wait ends on the port, on the browser leaving, or on the deadline, and each
// ending says which, so the contract never has to guess.
export async function waitForRdpPort(options: {
  port: number
  host?: string
  deadlineMs?: number
  intervalMs?: number
  isBrowserGone?: () => boolean
}): Promise<RdpPortWait> {
  const host = options.host || '127.0.0.1'
  const deadlineMs = options.deadlineMs ?? RDP_PORT_DEADLINE_MS
  const intervalMs = options.intervalMs ?? 100
  const startedAt = Date.now()

  while (true) {
    if (options.isBrowserGone?.()) {
      return {
        open: false,
        reason: `Firefox exited before it opened its remote debugging port ${options.port}`
      }
    }

    if (await probePort(options.port, host)) return {open: true}

    if (Date.now() - startedAt >= deadlineMs) {
      return {
        open: false,
        reason: `Firefox did not open its remote debugging port ${options.port} within ${deadlineMs}ms`
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

// ready.json takes the port only once Firefox listens on it, and takes the
// reason in its place when Firefox never does.
export async function stampReadyWhenRdpPortOpens(
  extensionOutputPath: string | undefined,
  options: Parameters<typeof waitForRdpPort>[0] & {runId?: string}
): Promise<RdpPortWait> {
  const result = await waitForRdpPort(options)

  if (result.open) stampReadyRdpPort(extensionOutputPath, options.port)
  else stampReadyRdpPortError(extensionOutputPath, result.reason, options.runId)

  return result
}
