import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {
  FILES,
  GATES,
  movePin,
  onlyBotCommits,
  pinnedSha
} from '../bump-release-gates.mjs'
import {anyStep, expr, job, readWorkflow} from '../lib/workflow-yaml.mjs'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const workflow = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'publish-release.yml'),
  'utf8'
)
const release = readWorkflow('publish-release.yml')
const SHA = 'abc1234def5678900000000000000000000000ff'
const CANARY = '4.1.40-canary.9.abc1234'

// The step's run block as Actions hands it to the shell.
function runBlock(name) {
  return anyStep(release, name).run
}

function stub(bin, name, body) {
  fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, {
    mode: 0o755
  })
}

// npm, gh, git and sleep are stand-ins that read a state folder: the canary
// shows up on npm at the call numbered `appearsAt` (0 for never), and the
// dispatched run answers `runState` once `gh run list` names it.
function findCanary({
  appearsAt = 1,
  runId = '77',
  runState = 'in_progress ',
  skip = 'false'
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gates-'))
  const bin = path.join(dir, 'bin')
  const output = path.join(dir, 'github-output')

  fs.mkdirSync(bin)
  fs.writeFileSync(output, '')
  fs.writeFileSync(path.join(dir, 'calls'), '0')
  fs.writeFileSync(path.join(dir, 'gh.log'), '')
  stub(bin, 'git', 'exit 0')
  stub(bin, 'sleep', 'exit 0')
  stub(
    bin,
    'npm',
    `n=$(( $(cat "${dir}/calls") + 1 )); echo "$n" > "${dir}/calls"
if [ "${appearsAt}" != "0" ] && [ "$n" -ge "${appearsAt}" ]; then
  echo '["4.1.39","${CANARY}"]'
else
  echo '["4.1.39","4.1.40-canary.8.0000000"]'
fi`
  )

  stub(
    bin,
    'gh',
    `echo "$*" >> "${dir}/gh.log"
case "$1 $2" in
  "run list") printf '%s' "${runId}" ;;
  "run view") printf '%s' "${runState}" ;;
esac`
  )

  const script = path.join(dir, 'find.sh')

  fs.writeFileSync(script, runBlock('Find the canary built from this commit'))

  const result = spawnSync('bash', [script], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      VERSION: '4.1.40',
      SKIP: skip,
      GITHUB_SHA: SHA,
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_REF_NAME: 'main',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_OUTPUT: output,
      POLL_SECONDS: '0',
      POLL_LIMIT: '8'
    }
  })
  const log = fs.readFileSync(path.join(dir, 'gh.log'), 'utf8')
  const outputs = fs.readFileSync(output, 'utf8').trim()

  fs.rmSync(dir, {recursive: true, force: true})

  return {...result, outputs, log}
}

test('reads the canary of the commit when npm already has it, and dispatches nothing', () => {
  const result = findCanary({appearsAt: 1})

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.outputs, `canary=${CANARY}`)
  assert.equal(result.log, '')
})

test('cuts the canary itself when npm has none, and waits for it', () => {
  const result = findCanary({appearsAt: 4})

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.outputs, `canary=${CANARY}`)
  assert.match(
    result.log,
    /^workflow run publish-release\.yml --repo o\/r --ref main -f channel=canary -f readings=false\n/
  )

  assert.equal(result.log.match(/workflow run/g).length, 1)
  assert.match(result.log, new RegExp(`run list .*--commit ${SHA}`))
})

test('stops when the canary run it dispatched fails', () => {
  const result = findCanary({appearsAt: 0, runState: 'completed failure'})

  assert.equal(result.status, 1)
  assert.equal(result.outputs, '')
  assert.match(
    result.stderr,
    /The canary run ended as failure: https:\/\/github\.com\/o\/r\/actions\/runs\/77/
  )
})

test('stops when no canary run of the commit starts, which means the branch moved', () => {
  const result = findCanary({appearsAt: 0, runId: ''})

  assert.equal(result.status, 1)
  assert.match(result.stderr, /The branch moved after this run began/)
})

test('stops when the canary never reaches npm', () => {
  const result = findCanary({appearsAt: 0})

  assert.equal(result.status, 1)
  assert.match(result.stderr, /did not reach npm in time/)
})

test('a skipped gate neither reads npm nor dispatches', () => {
  const result = findCanary({appearsAt: 0, skip: 'true'})

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.outputs, 'resume=true')
  assert.equal(result.log, '')
})

test('a stable publishes only after both gates, and both read the same canary', () => {
  const publish = job(release, 'publish')

  assert.deepEqual(publish.needs, [
    'corpus-target',
    'corpus-gate',
    'templates-gate'
  ])

  assert.match(
    publish.if,
    /needs\.corpus-gate\.result == 'success' && needs\.templates-gate\.result == 'success'/
  )

  for (const id of ['corpus-gate', 'templates-gate']) {
    assert.equal(
      job(release, id).with['cli-version'],
      expr('needs.corpus-target.outputs.canary'),
      id
    )
  }
})

test('every channel reads the corpus and the templates with the published version, unless a stable cut the canary', () => {
  for (const id of ['corpus-published', 'templates-published']) {
    const entry = job(release, id)

    assert.equal(entry.needs, 'publish', id)
    assert.equal(
      entry.if,
      expr(
        "!cancelled() && needs.publish.result == 'success' && (inputs.channel != 'canary' || inputs.readings)"
      ),
      id
    )

    assert.equal(
      entry.with['cli-version'],
      expr('needs.publish.outputs.version'),
      id
    )
  }
})

test('pins each gate repository to one commit, in every job and every ref input', () => {
  const texts = FILES.map((file) =>
    fs.readFileSync(path.join(root, file), 'utf8')
  )
  const pins = GATES.map((repo) => pinnedSha(texts, repo))
  const refs = [...workflow.matchAll(/\n {6}ref: ([0-9a-f]{40})\n/g)].map(
    (match) => match[1]
  )

  assert.equal(new Set(pins).size, GATES.length)
  assert.equal(refs.length, 4)

  for (const pin of pins) {
    assert.equal(refs.filter((ref) => ref === pin).length, 2)
  }
})

test('moves a pin in the uses line, its date and the ref input, and leaves the other gate alone', () => {
  const from = 'a'.repeat(40)
  const to = 'b'.repeat(40)
  const other = 'c'.repeat(40)
  const text = [
    `    uses: extension-js/corpus/.github/workflows/corpus-gate.yml@${from} # main, 2026-01-01`,
    `      ref: ${from}`,
    `    uses: extension-js/templates/.github/workflows/ci.yml@${other} # main, 2026-01-01`,
    `      ref: ${other}`
  ].join('\n')
  const moved = movePin(text, 'extension-js/corpus', from, to, '2026-02-02')

  assert.equal(
    moved,
    [
      `    uses: extension-js/corpus/.github/workflows/corpus-gate.yml@${to} # main, 2026-02-02`,
      `      ref: ${to}`,
      `    uses: extension-js/templates/.github/workflows/ci.yml@${other} # main, 2026-01-01`,
      `      ref: ${other}`
    ].join('\n')
  )

  assert.equal(pinnedSha([moved], 'extension-js/corpus'), to)
  assert.throws(
    () => pinnedSha([text, moved], 'extension-js/corpus'),
    /pinned to 2 commits/
  )
})

test('a pin behind by artifact commits alone is not behind', () => {
  assert.equal(
    onlyBotCommits([
      'chore: update artifacts [skip ci]',
      'chore: update artifacts [skip ci]'
    ]),
    true
  )

  assert.equal(
    onlyBotCommits(['chore: update artifacts [skip ci]', 'Add a template']),
    false
  )

  assert.equal(onlyBotCommits([]), false)
})

test('the gate reads Safari, the published reading only on a canary', () => {
  assert.equal(job(release, 'corpus-gate').with.safari, true)
  assert.equal(
    job(release, 'corpus-published').with.safari,
    expr("inputs.channel == 'canary'")
  )
})
