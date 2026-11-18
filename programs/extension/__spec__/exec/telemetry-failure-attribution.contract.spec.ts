import http from 'node:http'
import {afterEach, describe, expect, it} from 'vitest'
import {freshCliHome, runCli} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

const makeTempFolder = trackTempFolders()

interface CapturedEvent {
  event: string
  properties: Record<string, unknown>
}

function startCaptureServer(): Promise<{
  port: number
  events: CapturedEvent[]
  close: () => Promise<void>
}> {
  const events: CapturedEvent[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      if (req.url === '/capture/') {
        const parsed = JSON.parse(body) as {batch: CapturedEvent[]}
        events.push(...parsed.batch)
      }

      res.writeHead(200, {'content-type': 'application/json'})
      res.end('{"status":1}')
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        port,
        events,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
          })
      })
    })
  })
}

// Every run fails before a browser is looked for: the folder is empty.
async function run(args: string[], port: number) {
  const result = await runCli(args, {
    cwd: makeTempFolder('extjs-tele-attr-'),
    telemetry: true,
    home: freshCliHome(),
    env: {
      POSTHOG_HOST: `http://127.0.0.1:${port}`,
      EXTENSION_TELEMETRY: '1',
      EXTENSION_TELEMETRY_TIMEOUT_MS: '5000'
    }
  })

  return result.status
}

function failures(events: CapturedEvent[]): CapturedEvent[] {
  return events.filter((event) => event.event === 'command_failed')
}

describe('a failed run names its command and the code the CLI chose', () => {
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (close) await close()

    close = undefined
  })

  // The parser refuses a dev flag placed before the verb, and the report
  // still has to name dev and not the flag's value.
  it('names dev, not chrome, when --browser chrome comes before the verb', async () => {
    const server = await startCaptureServer()
    close = server.close

    const status = await run(['--browser', 'chrome', 'dev'], server.port)

    expect(status).toBe(1)
    expect(failures(server.events)).toHaveLength(1)

    const [failed] = failures(server.events)
    expect(failed.properties.command).toBe('dev')
    expect(failed.properties.code).toBe('E_FLAG_NOT_SUPPORTED_HERE')
  })

  it('reports an unrecognized verb as an unknown command without the verb', async () => {
    const server = await startCaptureServer()
    close = server.close

    const status = await run(['my-secret-project'], server.port)

    expect(status).toBe(1)
    expect(failures(server.events)).toHaveLength(1)

    const [failed] = failures(server.events)
    expect(failed?.properties.command).toBe('unknown')
    expect(failed?.properties.code).toBe('E_UNKNOWN_COMMAND')
    expect(JSON.stringify(server.events)).not.toContain('my-secret-project')
  })

  it('tells an unsupported flag apart from other argument errors', async () => {
    const server = await startCaptureServer()
    close = server.close

    const status = await run(['dev', '--no-such-flag'], server.port)

    expect(status).toBe(1)
    expect(failures(server.events)).toHaveLength(1)

    const [failed] = failures(server.events)
    expect(failed?.properties.command).toBe('dev')
    expect(failed?.properties.code).toBe('E_FLAG_NOT_SUPPORTED_HERE')
  })

  it('reports a refusal that exits before the build starts', async () => {
    const server = await startCaptureServer()
    close = server.close

    const status = await run(['build', '--browser=netscape'], server.port)

    expect(status).toBe(1)
    const [failed] = failures(server.events)
    expect(failed?.properties.command).toBe('build')
    expect(failed?.properties.code).toBe('E_UNSUPPORTED_BROWSER')
    expect(failed?.properties.exit_code).toBe(1)
  })

  it('reports a json build failure with its catalog code', async () => {
    const server = await startCaptureServer()
    close = server.close

    const status = await run(['build', '--output', 'json'], server.port)

    expect(status).toBe(1)
    const [failed] = failures(server.events)
    expect(failed?.properties.command).toBe('build')
    expect(failed?.properties.code).toBe('E_MANIFEST_NOT_FOUND')
  })
})
