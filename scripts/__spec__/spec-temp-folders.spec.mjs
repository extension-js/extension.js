import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

const CREATES = ['mkdtemp']
// Any of these in the file is taken as its own removal of what it made.
const REMOVES = [
  'useTempFolders',
  'rmSync(',
  '.rm(',
  'rmdirSync(',
  'removeDirectoryWithRetries('
]

function walkSpecs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue

    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) walkSpecs(full, out)
    else if (/\.spec\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) out.push(full)
  }

  return out
}

export function leavesTempFolders(source) {
  return (
    CREATES.some((needle) => source.includes(needle)) &&
    !REMOVES.some((needle) => source.includes(needle))
  )
}

test('a spec that makes a temp folder and never removes one is caught', () => {
  assert.equal(
    leavesTempFolders(
      "const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'))"
    ),
    true
  )

  assert.equal(
    leavesTempFolders(
      'const dir = fs.mkdtempSync(prefix)\nfs.rmSync(dir, {recursive: true})'
    ),
    false
  )

  assert.equal(leavesTempFolders("const dir = makeTempFolder('x-')"), false)
})

test('every spec that makes a temp folder also removes it', () => {
  const self = fileURLToPath(import.meta.url)
  const specs = [
    ...walkSpecs(path.join(root, 'programs')),
    ...walkSpecs(path.join(root, 'scripts'))
  ].filter((file) => file !== self)
  const leaking = specs
    .filter((file) => leavesTempFolders(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file))

  assert.ok(specs.length > 100, 'the walk found the spec files')
  assert.deepEqual(
    leaking,
    [],
    'make the folder with useTempFolders, or remove it in afterAll'
  )
})
