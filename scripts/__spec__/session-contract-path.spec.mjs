import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {
  eventsContractPath,
  readyContractPath,
  sessionArtifactsDir
} from '../lib/session-contract.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function engineSource(file) {
  return readFileSync(
    path.join(root, 'programs', 'develop', 'lib', file),
    'utf8'
  ).replace(/\r\n/g, '\n')
}

// The quoted path segments one engine function joins, read off its source.
// The scripts cannot import TypeScript, so the text is what they are held to.
function segmentsOf(source, name) {
  const start = source.indexOf(`export function ${name}(`)

  assert.notEqual(start, -1, `${name} is declared in the engine`)

  const body = source.slice(start, source.indexOf('\n}\n', start))
  const returned = body.slice(body.lastIndexOf('return '))

  return Array.from(returned.matchAll(/'([^']+)'/g), (match) => match[1])
}

const contract = engineSource('session-contract.ts')
const paths = engineSource('session-paths.ts')
const rootSegments = segmentsOf(contract, 'sessionArtifactsRootDir')
const readyFile = segmentsOf(contract, 'readyContractPath')
const eventsFile = segmentsOf(paths, 'eventsPath')

const project = path.resolve('some', 'project')

test('the engine source still names the segments this spec reads', () => {
  assert.deepEqual(rootSegments, ['dist', 'extension-js'])
  assert.deepEqual(readyFile, ['ready.json'])
  assert.deepEqual(eventsFile, ['events.ndjson'])
  assert.match(
    contract,
    /return path\.join\(sessionArtifactsRootDir\(projectPath\), browser\)/
  )
})

test('the scripts find the session folder where the engine puts it', () => {
  assert.equal(
    sessionArtifactsDir(project, 'chrome'),
    path.join(project, ...rootSegments, 'chrome')
  )
})

test('the scripts find ready.json where the engine writes it', () => {
  assert.equal(
    readyContractPath(project, 'firefox'),
    path.join(project, ...rootSegments, 'firefox', ...readyFile)
  )
})

test('the scripts find the events file where the engine writes it', () => {
  assert.equal(
    eventsContractPath(project, 'edge'),
    path.join(project, ...rootSegments, 'edge', ...eventsFile)
  )
})
