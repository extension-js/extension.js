import * as fs from 'fs'
import * as os from 'os'
import * as http from 'http'
import * as path from 'path'
import {describe, it, afterEach} from 'vitest'
import {spawn} from 'child_process'
import AdmZip from 'adm-zip'

// Hermetic: start on a local in-memory ZIP served over HTTP (no network)
describe.skip('extension start (remote web-only)', () => {
  let server: http.Server | undefined
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      try {
        server?.close(() => resolve())
      } catch {
        resolve()
      }
    })
  })

  it('builds silently and previews from dist/<browser>', async () => {
    const zip = new AdmZip()
    zip.addFile(
      'manifest.json',
      Buffer.from(
        JSON.stringify({
          manifest_version: 3,
          name: 'Hermetic WebOnly',
          version: '1.0.0',
          action: {default_title: 'ok'}
        })
      )
    )
    const zipBuf = zip.toBuffer()
    server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/zip')
      res.end(zipBuf)
    })
    await new Promise<void>((r) => server!.listen(0, r))
    const address = server.address()
    const port = typeof address === 'string' ? 80 : (address as any).port
    const url = `http://127.0.0.1:${port}/fixture.zip`

    const repoRoot = path.resolve(__dirname, '..', '..', '..')
    const cli = path.join(repoRoot, 'programs', 'cli', 'dist', 'cli.js')

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          cli,
          'start',
          url,
          '--browser',
          'chrome',
          '--profile',
          'false',
          '--open',
          'false'
        ],
        {cwd: repoRoot, env: {...process.env, EXTENSION_ENV: 'test'}}
      )
      let out = ''
      const timeout = setTimeout(() => {
        try {
          child.kill('SIGTERM')
        } catch {}
        reject(new Error('Timed out running start on hermetic zip'))
      }, 60000)
      child.stdout.on('data', (d) => {
        out += String(d)
        if (/Previewing|Extension\.js|running in production/i.test(out)) {
          clearTimeout(timeout)
          try {
            child.kill('SIGTERM')
          } catch {}
          setTimeout(() => resolve(), 200)
        }
      })
      child.stderr?.on('data', () => {})
      child.on('error', (e) => {
        try {
          child.kill('SIGTERM')
        } catch {}
        reject(e)
      })
    })
  }, 90000)
})
