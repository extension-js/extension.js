import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {afterEach, describe, expect, it} from 'vitest'
import {trackJsonDependencies} from '../track-dependencies'

// Obvious fakes: no file here holds a real value.
const MARKER = 'FAKE-MARKER-NOT-A-REAL-VALUE'
const canLink = process.platform !== 'win32'

const holders: string[] = []

afterEach(() => {
  for (const holder of holders.splice(0)) {
    fs.rmSync(holder, {recursive: true, force: true})
  }
})

// A project one folder down, so a link has an outside to lead to.
function project(files: Record<string, string>) {
  const holder = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-json-watch-'))
  )
  holders.push(holder)

  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(holder, relative)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, contents)
  }

  return {holder, root: path.join(holder, 'project')}
}

function watched(root: string, fields: Record<string, string | string[]>) {
  const compilation = {
    compiler: {options: {context: root}},
    options: {context: root},
    fileDependencies: new Set<string>(),
    missingDependencies: new Set<string>()
  }

  trackJsonDependencies(
    compilation as unknown as Compilation,
    path.join(root, 'manifest.json'),
    fields
  )

  const names = (files: Set<string>) =>
    [...files].map((file) => path.relative(root, file).replace(/\\/g, '/'))

  return {
    files: names(compilation.fileDependencies).sort(),
    missing: names(compilation.missingDependencies).sort()
  }
}

describe('the JSON files a watch session follows', () => {
  it('are the ones a field names and the build may copy', () => {
    const {holder, root} = project({
      'outside.json': `["${MARKER}-outside"]`,
      'project/manifest.json': '{}',
      'project/.env': `PRIVATE_KEY=${MARKER}-env\n`,
      'project/.git/config': `# ${MARKER}-git\n`,
      'project/data/rules.json': '[]',
      'project/node_modules/pkg/rules.json': '[]',
      'project/node_modules/pkg/.npmrc': `# ${MARKER}-npmrc\n`
    })

    if (canLink) {
      fs.symlinkSync(
        path.join(holder, 'outside.json'),
        path.join(root, 'linked.json')
      )
    }

    expect(
      watched(root, {
        'declarative_net_request/rules': [
          'data/rules.json',
          'node_modules/pkg/rules.json',
          '.env',
          '.git/config',
          'node_modules/pkg/.npmrc',
          'linked.json'
        ],
        'storage/managed_schema': 'absent.json'
      })
    ).toEqual({
      files: ['data/rules.json', 'node_modules/pkg/rules.json'],
      missing: ['absent.json']
    })
  })
})
