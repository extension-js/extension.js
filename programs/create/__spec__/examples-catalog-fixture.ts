import {spawn} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {strToU8, zipSync} from 'fflate'

// A stand-in for the extension-js/examples archive. The bytes are fixture bytes,
// never the published starter's: a spec that needs the real corpus goes in a
// *.remote.spec.ts file, which the gates skip.
export interface ExamplesCatalogFixture {
  url: string
  close(): Promise<void>
}

const ARCHIVE_ROOT = 'examples-fixture'

// Its own process, because a caller that drives the CLI with spawnSync blocks
// its event loop and a server living there never accepts the child's connection.
const SERVER_SOURCE = `
const http = require('node:http')
const fs = require('node:fs')
const body = fs.readFileSync(process.argv[1])
const server = http.createServer((_request, response) => {
  response.writeHead(200, {'content-type': 'application/zip'})
  response.end(body)
})
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(String(server.address().port) + '\\n')
})
`

export function fixtureExtensionFiles(name: string): Record<string, string> {
  return {
    'package.json': `${JSON.stringify(
      {private: true, name, version: '1.0.0', type: 'module'},
      null,
      2
    )}\n`,
    'README.md': `# ${name}\n`,
    'tsconfig.json': `${JSON.stringify(
      {compilerOptions: {target: 'esnext', module: 'esnext', strict: true}},
      null,
      2
    )}\n`,
    'src/manifest.json': `${JSON.stringify(
      {
        manifest_version: 3,
        name,
        version: '1.0.0',
        background: {service_worker: 'background.ts'}
      },
      null,
      2
    )}\n`,
    'src/background.ts': 'export {}\n'
  }
}

export function buildExamplesArchive(
  templates: Record<string, Record<string, string>>
): Buffer {
  const entries: Record<string, Uint8Array> = {}

  for (const [template, files] of Object.entries(templates)) {
    for (const [file, contents] of Object.entries(files)) {
      entries[`${ARCHIVE_ROOT}/examples/${template}/${file}`] =
        strToU8(contents)
    }
  }

  return Buffer.from(zipSync(entries))
}

export async function serveExamplesCatalog(
  templates: Record<string, Record<string, string>>
): Promise<ExamplesCatalogFixture> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-catalog-fixture-'))
  const archivePath = path.join(dir, 'examples.zip')
  fs.writeFileSync(archivePath, buildExamplesArchive(templates))

  const child = spawn(process.execPath, ['-e', SERVER_SOURCE, archivePath], {
    stdio: ['ignore', 'pipe', 'inherit']
  })

  const close = async () => {
    child.kill()
    fs.rmSync(dir, {recursive: true, force: true})
  }

  const port = await new Promise<string>((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => {
      reject(new Error('the examples catalog fixture never reported a port'))
    }, 20_000)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      out += chunk
      const [line] = out.split('\n')

      if (out.includes('\n') && line.trim()) {
        clearTimeout(timer)
        resolve(line.trim())
      }
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  }).catch(async (error) => {
    await close()

    throw error
  })

  return {url: `http://127.0.0.1:${port}/examples.zip`, close}
}
