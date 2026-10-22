import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const workflow = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'publish-release.yml'),
  'utf8'
)
const PACKAGES = [
  'programs/extension',
  'programs/develop',
  'programs/create',
  'programs/install'
]

function step(name) {
  const start = workflow.indexOf(`- name: ${name}`)
  assert.notEqual(start, -1, name)
  const rest = workflow.slice(start + 1)
  const end = rest.search(/\n\s+- name: /)

  return end === -1 ? rest : rest.slice(0, end)
}

// The step's `run: |` block, dedented, so the spec runs the exact shell the
// job runs.
function runBlock(name) {
  const text = step(name)
  const lines = text.split('\n')
  const at = lines.findIndex((line) => /^\s+run: \|$/.test(line))
  assert.notEqual(at, -1, `${name} has a run block`)
  const indent = lines[at + 1].match(/^\s*/)[0].length
  const body = []

  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '') continue
    if (line.match(/^\s*/)[0].length < indent) break

    body.push(line.slice(indent))
  }

  return body.join('\n') + '\n'
}

function git(cwd, ...args) {
  const result = spawnSync(
    'git',
    [
      '-c',
      'user.name=spec',
      '-c',
      'user.email=spec@example.com',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'tag.gpgsign=false',
      '-c',
      'tag.forceSignAnnotated=false',
      ...args
    ],
    {cwd, encoding: 'utf8'}
  )
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)

  return result.stdout.trim()
}

function writeVersions(dir, version) {
  for (const pkg of PACKAGES) {
    fs.mkdirSync(path.join(dir, pkg), {recursive: true})
    fs.writeFileSync(
      path.join(dir, pkg, 'package.json'),
      JSON.stringify({name: path.basename(pkg), version}, null, 2) + '\n'
    )
  }
}

// An origin with a base commit at 1.0.0 and, when asked, a bump commit at
// 1.0.1 under tag v1.0.1 (or the tag on the base commit, a cut that never
// bumped). The clone the step runs in sits on the base commit without the
// tag, which is what a re-run of the dispatching workflow checks out.
function fixture({tag = 'bumped'} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-resume-'))
  const origin = path.join(dir, 'origin.git')
  const seed = path.join(dir, 'seed')
  const clone = path.join(dir, 'clone')
  git(dir, 'init', '--quiet', '--bare', '-b', 'main', origin)
  git(dir, 'init', '--quiet', '-b', 'main', seed)
  writeVersions(seed, '1.0.0')
  git(seed, 'add', '.')
  git(seed, 'commit', '--quiet', '-m', 'base')
  const base = git(seed, 'rev-parse', 'HEAD')
  git(seed, 'remote', 'add', 'origin', origin)
  git(seed, 'push', '--quiet', 'origin', 'main')
  git(dir, 'clone', '--quiet', '--no-tags', origin, clone)

  let bump = ''

  if (tag === 'bumped') {
    writeVersions(seed, '1.0.1')
    git(seed, 'add', '.')
    git(seed, 'commit', '--quiet', '-m', 'bump')
    bump = git(seed, 'rev-parse', 'HEAD')
    git(seed, 'tag', 'v1.0.1')
    git(seed, 'push', '--quiet', 'origin', 'main', 'refs/tags/v1.0.1')
  } else if (tag === 'unbumped') {
    git(seed, 'tag', 'v1.0.1')
    git(seed, 'push', '--quiet', 'origin', 'refs/tags/v1.0.1')
  }

  return {dir, clone, base, bump}
}

function runResume(clone, {version = '1.0.1', channel = 'stable'} = {}) {
  const output = path.join(clone, '..', 'github-output')
  fs.writeFileSync(output, '')
  const script = path.join(clone, '..', 'resume.sh')
  fs.writeFileSync(
    script,
    runBlock('Resume from the release tag when it exists')
  )

  const result = spawnSync('bash', ['-e', script], {
    cwd: clone,
    encoding: 'utf8',
    env: {
      ...process.env,
      INPUT_VERSION: version,
      INPUT_CHANNEL: channel,
      GITHUB_OUTPUT: output
    }
  })

  return {
    ...result,
    outputs: fs.readFileSync(output, 'utf8').trim(),
    head: git(clone, 'rev-parse', 'HEAD')
  }
}

test('checks the tagged commit out when the tag carries the version in every package', () => {
  const {dir, clone, base, bump} = fixture()

  try {
    const result = runResume(clone)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(result.outputs, 'resume=true')
    assert.equal(result.head, bump)
    assert.notEqual(result.head, base)
    assert.match(result.stdout, /resuming the publish from/)
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(clone, 'programs/extension/package.json'),
          'utf8'
        )
      ).version,
      '1.0.1'
    )
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

test('refuses a tag whose packages do not carry the version', () => {
  const {dir, clone, base} = fixture({tag: 'unbumped'})

  try {
    const result = runResume(clone)
    assert.equal(result.status, 1)
    assert.match(
      result.stderr,
      /already exists on origin and its packages are not at 1\.0\.1/
    )

    assert.equal(result.outputs, '')
    assert.equal(result.head, base)
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

test('stays on the checkout when there is no tag', () => {
  const {dir, clone, base} = fixture({tag: 'none'})

  try {
    const result = runResume(clone)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(result.outputs, 'resume=false')
    assert.equal(result.head, base)
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

test('never resumes a canary, which has no tag to resume from', () => {
  const {dir, clone, base} = fixture()

  try {
    const result = runResume(clone, {channel: 'canary'})
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(result.outputs, 'resume=false')
    assert.equal(result.head, base)
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

test('resumes before anything is installed or built, and the later steps read it', () => {
  const order = [
    'Checkout',
    'Resume from the release tag when it exists',
    'Repin the template catalog to the examples corpus head',
    'Setup pnpm',
    'Install dependencies',
    'Build packages',
    'Validate inputs'
  ].map((name) => workflow.indexOf(`- name: ${name}`))
  assert.ok(order.every((at) => at !== -1))
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b)
  )

  assert.match(
    step('Repin the template catalog to the examples corpus head'),
    /steps\.resume\.outputs\.resume != 'true'/
  )

  assert.match(
    step('Validate inputs'),
    /RESUME='\$\{\{ steps\.resume\.outputs\.resume \}\}'/
  )

  assert.match(step('Validate inputs'), /echo "resume=\$RESUME"/)
})
