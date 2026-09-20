import type {ReadStream} from 'node:fs'
import type {IncomingMessage, ServerResponse} from 'node:http'
import * as path from 'node:path'
import {PassThrough} from 'node:stream'
import {describe, expect, it} from 'vitest'
import {createResponseDataRepair} from '../dev-middleware-body'

const OUTPUT = path.join(path.sep, 'out', 'chromium')

function repairWith(files: Record<string, Buffer>) {
  return createResponseDataRepair({
    outputPath: () => OUTPUT,
    outputFileSystem: () => ({
      readFileSync(filePath: string) {
        const relative = path.relative(OUTPUT, filePath).split(path.sep).join('/')
        const buffer = files[relative]

        if (!buffer) throw new Error(`ENOENT ${filePath}`)

        return buffer
      }
    })
  })
}

function request(url: string, headers: Record<string, string> = {}) {
  return {url, headers} as unknown as IncomingMessage
}

function response(statusCode = 200) {
  return {statusCode} as unknown as ServerResponse
}

function readStream() {
  return new PassThrough() as unknown as ReadStream
}

describe('createResponseDataRepair', () => {
  it('gives a one-byte asset its byte back when the stream was sized zero', () => {
    const repair = repairWith({'content_scripts/content-0.css': Buffer.from('\n')})
    const stream = readStream()

    const out = repair(
      request('/content_scripts/content-0.css'),
      response(),
      stream,
      0
    )

    expect(out.byteLength).toBe(1)
    expect(Buffer.isBuffer(out.data) && out.data.toString()).toBe('\n')
    expect(stream.destroyed).toBe(true)
  })

  it('leaves an empty asset empty', () => {
    const repair = repairWith({'empty.css': Buffer.alloc(0)})
    const stream = readStream()

    const out = repair(request('/empty.css'), response(), stream, 0)

    expect(out).toEqual({data: stream, byteLength: 0})
    expect(stream.destroyed).toBe(false)
  })

  it('leaves a sized response alone', () => {
    const repair = repairWith({'a.js': Buffer.from('ab')})
    const stream = readStream()

    const out = repair(request('/a.js'), response(), stream, 2)

    expect(out).toEqual({data: stream, byteLength: 2})
  })

  it('leaves a ranged request alone, its end can sit at offset zero', () => {
    const repair = repairWith({'a.js': Buffer.from('abc')})
    const stream = readStream()

    const out = repair(
      request('/a.js', {range: 'bytes=0-0'}),
      response(206),
      stream,
      0
    )

    expect(out).toEqual({data: stream, byteLength: 0})
  })

  it('reads the file the url names, query and fragment stripped', () => {
    const repair = repairWith({'x/y.css': Buffer.from('a')})

    const out = repair(
      request('/x/y.css?v=1#top'),
      response(),
      readStream(),
      0
    )

    expect(out.byteLength).toBe(1)
  })

  it('never reads outside the output directory', () => {
    const repair = repairWith({'a.css': Buffer.from('a')})
    const stream = readStream()

    const out = repair(request('/../a.css'), response(), stream, 0)

    expect(out).toEqual({data: stream, byteLength: 0})
  })

  it('does nothing without a compiler to read from', () => {
    const repair = createResponseDataRepair({
      outputPath: () => undefined,
      outputFileSystem: () => undefined
    })
    const stream = readStream()

    const out = repair(request('/a.css'), response(), stream, 0)

    expect(out).toEqual({data: stream, byteLength: 0})
  })
})
