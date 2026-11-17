// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as http from 'node:http'

export type DebugPortOwner = 'this-browser' | 'another-browser' | 'closed'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// The ids of the targets the listener on a debugging port answers for, or
// null when nothing answers there.
export function targetIdsOnDebugPort(
  port: number,
  host: string = '127.0.0.1',
  timeoutMs: number = 1000
): Promise<string[] | null> {
  return new Promise((resolve) => {
    const request = http.get(
      {host, port, path: '/json/list', timeout: timeoutMs},
      (response) => {
        let body = ''
        response.setEncoding('utf-8')
        response.on('data', (chunk) => {
          body += chunk
        })

        response.on('end', () => {
          try {
            const targets = JSON.parse(body) as Array<{id?: unknown}>

            resolve(
              targets
                .map((target) => target?.id)
                .filter((id): id is string => typeof id === 'string')
            )
          } catch {
            resolve(null)
          }
        })

        response.on('error', () => resolve(null))
      }
    )

    request.on('timeout', () => request.destroy())
    request.on('error', () => resolve(null))
  })
}

// Target ids are random per browser, so one shared id proves the listener on
// the port is the browser this session already talks to over its pipe.
export async function debugPortOwner(
  port: number,
  ownTargetIds: () => Promise<string[]>,
  options: {attempts?: number; intervalMs?: number; host?: string} = {}
): Promise<DebugPortOwner> {
  const attempts = options.attempts ?? 20
  const intervalMs = options.intervalMs ?? 250
  let strangerAnswers = 0

  for (let attempt = 0; attempt < attempts; attempt++) {
    const listed = await targetIdsOnDebugPort(port, options.host)

    if (listed) {
      const own = new Set(await ownTargetIds())
      if (listed.some((id) => own.has(id))) return 'this-browser'

      // A tab opening between the two reads is no stranger, so ask again.
      if (own.size > 0 && ++strangerAnswers >= 4) return 'another-browser'
    }

    await sleep(intervalMs)
  }

  return strangerAnswers > 0 ? 'another-browser' : 'closed'
}
