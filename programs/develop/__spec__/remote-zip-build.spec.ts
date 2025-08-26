import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {createServer, type Server} from 'http'
import {describe, it, expect, afterEach} from 'vitest'
import {spawn} from 'child_process'
import AdmZip from 'adm-zip'

function makeZipBuffer(structure: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip()
  for (const [name, content] of Object.entries(structure)) {
    zip.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(content))
  }
  return zip.toBuffer()
}

describe('remote zip handling (downloadAndExtractZip)', () => {
  let server: Server | undefined
  let baseUrl = ''

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      try {
        server?.close(() => resolve())
      } catch {
        resolve()
      }
    })
    server = undefined
  })

  it('builds from a valid remote zip URL', async () => {
    // Prepare a minimal web-only extension as a zip
    const manifest = JSON.stringify(
      {
        name: 'Remote Zip Sample',
        version: '0.0.1',
        manifest_version: 3,
        action: {default_title: 'ok'}
      },
      null,
      0
    )
    const zipBuf = makeZipBuffer({
      'manifest.json': manifest
    })

    // Start a local HTTP server to serve the zip
    const host = '127.0.0.1'
    const port = await new Promise<number>((resolve) => {
      const srv = createServer((req, res) => {
        if (req.url?.startsWith('/sample.zip')) {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/zip')
          res.end(zipBuf)
          return
        }
        res.statusCode = 404
        res.end('not found')
      })
      srv.listen(0, host, () => {
        server = srv
        // @ts-ignore
        resolve((srv.address() as any).port as number)
      })
    })

    baseUrl = `http://${host}:${port}/sample.zip`

    const repoRoot = path.resolve(__dirname, '..', '..', '..')
    const cli = path.join(repoRoot, 'programs', 'cli', 'dist', 'cli.js')

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [cli, 'build', baseUrl, '--browser', 'chrome', '--silent'],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            EXTENSION_ENV: 'development'
          }
        }
      )
      let out = ''
      let err = ''
      const timeout = setTimeout(() => {
        try {
          child.kill('SIGTERM')
        } catch {}
        reject(new Error('Timed out building from remote zip'))
      }, 60000)
      child.stdout.on('data', (d) => (out += String(d)))
      child.stderr.on('data', (d) => (err += String(d)))
      child.on('exit', (code) => {
        clearTimeout(timeout)
        if (
          code === 0 &&
          /ready for deployment|Build Status: Success/i.test(out)
        ) {
          resolve()
        } else {
          reject(
            new Error(
              `build failed: code=${code}\nstdout=\n${out}\nstderr=\n${err}`
            )
          )
        }
      })
      child.on('error', reject)
    })
  }, 90000)

  it('fails clearly for non-zip http URLs', async () => {
    const host = '127.0.0.1'
    const port = await new Promise<number>((resolve) => {
      const srv = createServer((req, res) => {
        if (req.url?.startsWith('/notzip.txt')) {
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/plain')
          res.end('hello world')
          return
        }
        res.statusCode = 404
        res.end('not found')
      })
      srv.listen(0, host, () => {
        server = srv
        // @ts-ignore
        resolve((srv.address() as any).port as number)
      })
    })

    const url = `http://${host}:${port}/notzip.txt`
    const repoRoot = path.resolve(__dirname, '..', '..', '..')
    const cli = path.join(repoRoot, 'programs', 'cli', 'dist', 'cli.js')

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [cli, 'build', url, '--browser', 'chrome', '--silent'],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            EXTENSION_ENV: 'development'
          }
        }
      )
      let err = ''
      const timeout = setTimeout(() => {
        try {
          child.kill('SIGTERM')
        } catch {}
        reject(new Error('Timed out expecting non-zip failure'))
      }, 60000)
      child.stderr.on('data', (d) => (err += String(d)))
      child.on('exit', (code) => {
        clearTimeout(timeout)
        if (code !== 0 && /does not appear to be a ZIP archive/i.test(err)) {
          resolve()
        } else {
          reject(
            new Error(
              `expected non-zip failure, got code=${code}\nstderr=\n${err}`
            )
          )
        }
      })
      child.on('error', reject)
    })
  }, 90000)
})
