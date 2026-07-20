// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// What does safari-web-extension-converter do with each refusal fixture?
// Records exit code + the error/warning lines. This is Safari's first (and
// scriptable) refusal surface. The converter runs Safari's manifest parse.
import {spawnSync} from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import {fileURLToPath} from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const batches = ['fixtures', 'fixtures2']
const outRoot = path.join(here, 'safari-out')
fs.rmSync(outRoot, {recursive: true, force: true})

const results = []
for (const batch of batches) {
  const root = path.join(here, batch)
  const index = JSON.parse(
    fs.readFileSync(path.join(root, 'index.json'), 'utf8')
  )
  for (const {id, expect} of index) {
    const projectDir = path.join(outRoot, id)
    const proc = spawnSync(
      'xcrun',
      [
        'safari-web-extension-converter',
        path.join(root, id),
        '--project-location',
        projectDir,
        '--app-name',
        `V${id.replace(/[^a-zA-Z0-9]/g, '')}`,
        '--bundle-identifier',
        `dev.extensionjs.verify.${id.replace(/[^a-zA-Z0-9]/g, '')}`,
        '--macos-only',
        '--no-open',
        '--no-prompt',
        '--force'
      ],
      {encoding: 'utf8', timeout: 120000}
    )
    const output = `${proc.stdout || ''}${proc.stderr || ''}`
    const interesting = output
      .split(/\r?\n/)
      .filter((line) =>
        /error|warning|unable|invalid|missing|failed/i.test(line)
      )
      .slice(0, 4)
      .map((line) => line.trim())
    const outcome = proc.status === 0 ? 'CONVERTED' : `FAILED(${proc.status})`
    results.push({id, chromeExpect: expect, outcome, interesting})
    console.log(`${id}\t${outcome}\t${interesting.join(' | ').slice(0, 220)}`)
  }
}
fs.writeFileSync(
  path.join(here, 'results-safari.json'),
  JSON.stringify(results, null, 2)
)
