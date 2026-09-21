import {PassThrough} from 'node:stream'
import {describe, expect, it} from 'vitest'
import {attachChildOutput} from '../run-firefox/firefox-launch/child-output'

function chattyChild() {
  return {stdout: new PassThrough(), stderr: new PassThrough()}
}

function collector() {
  const chunks: Buffer[] = []
  const sink = new PassThrough()
  sink.on('data', (chunk: Buffer) => chunks.push(chunk))

  return {sink, text: () => Buffer.concat(chunks).toString()}
}

describe('attachChildOutput', () => {
  it('drains a browser that logs more than a pipe holds when nobody is reading', async () => {
    const child = chattyChild()
    attachChildOutput(child, {debug: false})

    expect(child.stdout.readableFlowing).toBe(true)
    expect(child.stderr.readableFlowing).toBe(true)

    const line = Buffer.alloc(64 * 1024, 'x')
    let writes = 0

    for (let i = 0; i < 8; i++) {
      await new Promise<void>((resolve) => {
        child.stderr.write(line, () => {
          writes++
          resolve()
        })
      })
    }

    expect(writes).toBe(8)
  })

  it('forwards the browser output to the sinks in debug mode', async () => {
    const child = chattyChild()
    const out = collector()
    const err = collector()
    attachChildOutput(child, {
      debug: true,
      sinks: {stdout: out.sink, stderr: err.sink}
    })

    child.stdout.write('hello from stdout\n')
    child.stderr.write('hello from stderr\n')
    await new Promise((resolve) => setImmediate(resolve))

    expect(out.text()).toContain('hello from stdout')
    expect(err.text()).toContain('hello from stderr')
  })

  it('tolerates a child spawned without pipes', () => {
    expect(() =>
      attachChildOutput({stdout: null, stderr: null}, {debug: false})
    ).not.toThrow()
  })
})
