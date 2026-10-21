// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as http from 'node:http'
import type * as net from 'node:net'
import {holdPortNow, type PortReservation} from './port-manager'

const BIND_ERROR_CODES = new Set(['EADDRINUSE', 'EACCES', 'EADDRNOTAVAIL'])

type ListenTarget = {host?: string; port?: number | string}

function isBindError(error: unknown): error is NodeJS.ErrnoException {
  const code = (error as NodeJS.ErrnoException | null)?.code

  return typeof code === 'string' && BIND_ERROR_CODES.has(code)
}

function targetMatches(target: unknown, reservation: PortReservation): boolean {
  if (!target || typeof target !== 'object') return false

  const {host, port} = target as ListenTarget

  return (
    Number(port) === reservation.port && (!host || host === reservation.host)
  )
}

export interface ReservedHttpServerOptions {
  takeReservation: () => PortReservation | null
  onBindError: (error: NodeJS.ErrnoException) => void
  holdOnClose?: () => boolean
  onHeld?: (reservation: PortReservation) => void
}

export function reservedHttpServer(options: ReservedHttpServerOptions) {
  return (
    serverOptions: http.ServerOptions | undefined,
    app: http.RequestListener
  ): http.Server => {
    const server = http.createServer(serverOptions ?? {}, app)
    const listen = server.listen.bind(server) as (
      ...args: unknown[]
    ) => http.Server
    const emit = server.emit.bind(server) as (
      event: string | symbol,
      ...args: unknown[]
    ) => boolean
    const close = server.close.bind(server)
    let binding = false
    let listenHost: string | undefined

    server.emit = ((event: string | symbol, ...args: unknown[]) => {
      // The dev server rethrows a listen error from inside the event, which
      // ended the process with no code. A bind failure is a start failure.
      if (event === 'error' && binding && isBindError(args[0])) {
        binding = false
        options.onBindError(args[0])

        return true
      }

      return emit(event, ...args)
    }) as typeof server.emit

    server.listen = ((...args: unknown[]) => {
      const last = args[args.length - 1]
      const callback = typeof last === 'function' ? (last as () => void) : null
      const target = args[0]
      const reservation = options.takeReservation()
      listenHost =
        target && typeof target === 'object'
          ? (target as ListenTarget).host
          : undefined

      const listening = () => {
        binding = false
        server.ref()
        callback?.()
      }

      binding = true

      if (reservation && targetMatches(target, reservation)) {
        try {
          return listen(reservation.server as net.Server, listening)
        } catch {
          // Ignore
        }
      }

      if (reservation) {
        void reservation.release().then(() => listen(target, listening))

        return server
      }

      return listen(target, listening)
    }) as typeof server.listen

    server.close = ((callback?: (error?: Error) => void) => {
      const address = server.address()
      const hold =
        options.holdOnClose?.() === true &&
        address !== null &&
        typeof address === 'object'
      const result = close(callback)

      if (hold) {
        options.onHeld?.(
          holdPortNow(
            address.port,
            listenHost || address.address,
            address.address
          )
        )
      }

      return result
    }) as typeof server.close

    return server
  }
}
