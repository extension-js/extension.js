// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {ChildProcess} from 'node:child_process'
import type {Writable} from 'node:stream'

type ChildStreams = Pick<ChildProcess, 'stdout' | 'stderr'>

// A piped stream nobody reads fills its buffer and the browser then blocks on
// its next console write, before the add-on install has finished.
export function attachChildOutput(
  child: ChildStreams,
  opts: {debug: boolean; sinks?: {stdout: Writable; stderr: Writable}}
) {
  const sinks = opts.sinks || {stdout: process.stdout, stderr: process.stderr}

  for (const [stream, sink] of [
    [child.stdout, sinks.stdout],
    [child.stderr, sinks.stderr]
  ] as const) {
    if (!stream) continue

    if (opts.debug) {
      stream.pipe(sink)
    } else {
      stream.resume()
    }
  }
}
