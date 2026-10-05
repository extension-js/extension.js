// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Readable, Writable} from 'node:stream'

type PipeStream = Readable | Writable

interface PipeOwner {
  reportPipeGone(error: Error): void
}

// The client that last used each pipe, so an error the dead browser raises
// after that client detached still reaches it as the transport going away.
const pipeOwners = new WeakMap<PipeStream, PipeOwner>()
const guardedPipes = new WeakSet<PipeStream>()

// A dying browser resets fds 3 and 4, and a pipe 'error' with no listener is an
// uncaught exception that reads as a dev server fault. One sink per stream
// outlives every client, so a detach or a reconnect never leaves it bare.
export function guardCdpPipe(stream: PipeStream | null | undefined) {
  if (!stream || typeof stream.on !== 'function') return
  if (guardedPipes.has(stream)) return

  guardedPipes.add(stream)
  stream.on('error', (error: Error) => {
    pipeOwners.get(stream)?.reportPipeGone(error)
  })
}

export function claimCdpPipe(stream: PipeStream, owner: PipeOwner) {
  pipeOwners.set(stream, owner)
}
