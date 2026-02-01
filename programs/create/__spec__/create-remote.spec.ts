//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {createServer, type Server} from 'http'
import AdmZip from 'adm-zip'
import {describe, it, expect, afterEach} from 'vitest'
import {spawn} from 'child_process'

function makeZip(structure: Record<string, string>): Buffer {
  const zip = new AdmZip()
  for (const [name, content] of Object.entries(structure)) {
    zip.addFile(name, Buffer.from(content))
  }
  return zip.toBuffer()
}

describe('extension create from remote', () => {
  let server: Server | undefined
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

  const repoRoot = path.resolve(__dirname, '..', '..', '..')
  const cli = path.join(repoRoot, 'programs', 'cli', 'dist', 'cli.js')
  const itCli = fs.existsSync(cli) ? it : it.skip

  itCli('creates from a remote zip served over HTTP', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-create-'))
    const dest = path.join(tmp, 'my-remote-ext')
    const manifest = JSON.stringify({
      name: 'Remote Created',
      version: '0.0.1',
      manifest_version: 3
    })
    const zip = makeZip({'manifest.json': manifest})

    const port = await new Promise<number>((resolve) => {
      const srv = createServer((req, res) => {
        if (req.url?.startsWith('/template.zip')) {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/zip')
          res.end(zip)
          return
        }
        res.statusCode = 404
        res.end('not found')
      })
      srv.listen(0, '127.0.0.1', () => {
        server = srv
        // @ts-ignore
        resolve((srv.address() as any).port)
      })
    })
    const url = `http://127.0.0.1:${port}/template.zip`

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [cli, 'create', dest, '--template', url],
        {
          cwd: repoRoot,
          // Ensure production-like behavior so remote template fetch path is used
          env: {...process.env, EXTENSION_ENV: 'test'}
        }
      )
      let err = ''
      const timeout = setTimeout(() => {
        try {
          child.kill('SIGTERM')
        } catch {}
        reject(new Error('Timed out creating from remote zip'))
      }, 60000)
      child.stderr.on('data', (d) => (err += String(d)))
      child.on('exit', (code) => {
        clearTimeout(timeout)
        if (code === 0 && fs.existsSync(path.join(dest, 'manifest.json'))) {
          resolve()
        } else {
          reject(new Error(`create failed: code=${code}\n${err}`))
        }
      })
      child.on('error', reject)
    })

    // Cleanup
    try {
      fs.rmSync(tmp, {recursive: true, force: true})
    } catch {}
  })

  itCli('creates from a remote zip with nested manifest.json', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-create-'))
    const dest = path.join(tmp, 'my-remote-nested-ext')
    const manifest = JSON.stringify({
      name: 'Nested Created',
      description: 'Nested manifest template',
      version: '0.0.1',
      manifest_version: 3
    })
    const zip = makeZip({'extension/manifest.json': manifest})

    const port = await new Promise<number>((resolve) => {
      const srv = createServer((req, res) => {
        if (req.url?.startsWith('/template.zip')) {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/zip')
          res.end(zip)
          return
        }
        res.statusCode = 404
        res.end('not found')
      })
      srv.listen(0, '127.0.0.1', () => {
        server = srv
        // @ts-ignore
        resolve((srv.address() as any).port)
      })
    })
    const url = `http://127.0.0.1:${port}/template.zip`

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [cli, 'create', dest, '--template', url],
        {
          cwd: repoRoot,
          // Ensure production-like behavior so remote template fetch path is used
          env: {...process.env, EXTENSION_ENV: 'test'}
        }
      )
      let err = ''
      const timeout = setTimeout(() => {
        try {
          child.kill('SIGTERM')
        } catch {}
        reject(new Error('Timed out creating from remote zip'))
      }, 60000)
      child.stderr.on('data', (d) => (err += String(d)))
      child.on('exit', (code) => {
        clearTimeout(timeout)
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`create failed: code=${code}\n${err}`))
        }
      })
      child.on('error', reject)
    })

    const nestedManifestPath = path.join(dest, 'extension', 'manifest.json')
    expect(fs.existsSync(nestedManifestPath)).toBeTruthy()
    const manifestJson = JSON.parse(
      fs.readFileSync(nestedManifestPath, 'utf-8')
    )
    expect(manifestJson.name).toBe(path.basename(dest))

    // Cleanup
    try {
      fs.rmSync(tmp, {recursive: true, force: true})
    } catch {}
  })
})
