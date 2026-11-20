import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {
  expr,
  job,
  readWorkflow,
  readYaml,
  runText,
  step
} from '../lib/workflow-yaml.mjs'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const workflowsDir = path.join(root, '.github', 'workflows')
const scripts = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
).scripts

function workflowText(file) {
  return fs.readFileSync(path.join(workflowsDir, file), 'utf8')
}

const FULL_SUITES = ['ci:test:develop', 'ci:test:cli', 'ci:test:create']

test('every ci test matrix entry runs a suite no other entry runs', () => {
  const ci = readWorkflow('ci.yml')

  for (const id of ['tests', 'tests-node']) {
    const suites = job(ci, id).strategy.matrix.suite
    assert.ok(suites.length > 0, id)

    const commands = suites.map((suite) => scripts[suite])

    for (const [i, suite] of suites.entries()) {
      assert.ok(commands[i], `${id}: ${suite}`)
    }

    assert.equal(new Set(commands).size, commands.length, suites.join(', '))
  }
})

test('no pull request job reruns a spec that a whole package suite already runs', () => {
  const ci = readWorkflow('ci.yml')
  const packageOf = {develop: 'develop', extension: 'cli', install: 'cli'}
  const whole = new Set(['develop', 'cli', 'create'])
  // A step reaches a spec through a root script or a direct vitest call.
  const expand = (text) =>
    text.replace(/pnpm (?:run )?([a-z][a-z0-9:-]+)/g, (all, name) =>
      scripts[name] ? `${all}\n${scripts[name]}` : all
    )

  for (const [id, entry] of Object.entries(ci.jobs)) {
    if (entry.if?.includes("!= 'pull_request'")) continue

    const text = expand(expand(runText(entry)))
    const named = [
      ...text.matchAll(
        /pnpm -C programs\/([a-z]+) exec vitest run ((?:[^\s&|;]+ ?)+)/g
      )
    ].filter(([, , args]) =>
      args.split(' ').some((arg) => !arg.startsWith('-') && /spec/.test(arg))
    )

    for (const [line, pkg] of named) {
      const suite = packageOf[pkg] || pkg

      assert.ok(!whole.has(suite), `${id} reruns ${pkg} specs: ${line}`)
    }
  }
})

test('pull requests run each suite once on the engines floor, newer Node on main and nightly', () => {
  const ci = readWorkflow('ci.yml')
  const floor = JSON.parse(
    fs.readFileSync(
      path.join(root, 'programs', 'extension', 'package.json'),
      'utf8'
    )
  ).engines.node.replace('>=', '')

  const tests = job(ci, 'tests')
  assert.deepEqual(tests.strategy.matrix.suite, FULL_SUITES)
  assert.equal(step(tests, 'Setup Node').with['node-version'], floor)
  assert.equal(tests.if, undefined)

  const current = job(ci, 'tests-node')
  assert.deepEqual(current.strategy.matrix.suite, FULL_SUITES)
  assert.equal(current.if, "github.event_name != 'pull_request'")
  const nodes = current.strategy.matrix.node.map(String)
  assert.ok(!nodes.includes(floor), nodes.join(', '))

  const lane = job(readWorkflow('programs-nightly.yml'), 'nightly-node-current')
  assert.deepEqual(lane.strategy.matrix.suite, FULL_SUITES)
  assert.deepEqual(lane.strategy.matrix.node.map(String), nodes)
  assert.ok(
    lane.steps.some(
      (entry) => entry.with?.['node-version'] === expr('matrix.node')
    )
  )

  assert.match(step(lane, 'Report a red lane').if, /failure\(\)/)
  assert.match(step(lane, 'Close the red lane').if, /success\(\)/)
})

// A path filter on a folder the repo does not have can never match a change.
test('every workflow path filter starts at a path the repo has', () => {
  for (const file of fs.readdirSync(workflowsDir)) {
    if (!file.endsWith('.yml')) continue

    const workflow = readWorkflow(file)
    const on = workflow.on ?? workflow['true']
    if (!on || typeof on !== 'object') continue

    for (const [event, config] of Object.entries(on)) {
      for (const key of ['paths', 'paths-ignore']) {
        for (const filter of config?.[key] || []) {
          const prefix = filter
            .replace(/^!/, '')
            .split(/[*?[{]/)[0]
            .replace(/\/$/, '')
          if (!prefix) continue

          assert.ok(
            fs.existsSync(path.join(root, prefix)),
            `${file} ${event} ${key}: ${filter}`
          )
        }
      }
    }
  }
})

test('windows runs the suites as parallel jobs, the develop one in two shards', () => {
  const ci = readWorkflow('ci.yml')

  assert.equal(ci.jobs['tests-windows'], undefined)

  const develop = job(ci, 'tests-windows-develop')
  const cli = job(ci, 'tests-windows-cli')

  for (const entry of [develop, cli]) {
    assert.equal(entry['runs-on'], 'windows-latest')
    assert.equal(typeof entry['timeout-minutes'], 'number')
    assert.equal(entry.needs, undefined)
  }

  // Both halves compile first, then each runs its own share of the files.
  assert.deepEqual(develop.strategy.matrix.shard, [1, 2])
  assert.equal(develop.strategy['fail-fast'], false)
  const developRuns = develop.steps.map((entry) => entry.run).filter(Boolean)
  assert.deepEqual(developRuns.slice(-2), [
    'pnpm exec turbo run compile --filter ./programs/develop',
    `pnpm -C programs/develop exec vitest run --shard=${expr('matrix.shard')}/2`
  ])

  const cliRuns = cli.steps.map((entry) => entry.run).filter(Boolean)
  assert.ok(cliRuns.includes('pnpm test:cli'))
  assert.ok(cliRuns.includes('pnpm ci:test:create'))
  assert.match(scripts['test:dev'], /run-test\.mjs develop$/)
  assert.match(scripts['test:cli'], /run-test\.mjs cli$/)

  // The Edge locate proof reads the compiled CLI, so it stays beside it.
  assert.equal(
    workflowText('ci.yml').split('verify-edge-system-locate.mjs').length - 1,
    1
  )

  assert.ok(
    cliRuns.indexOf('pnpm --filter extension compile') <
      cliRuns.indexOf('node scripts/verify-edge-system-locate.mjs')
  )
})

test('the browser install run is weekly, never on pull requests, and gates nothing', () => {
  const lane = readWorkflow('browser-install.yml')
  const install = job(lane, 'install')

  assert.ok(lane.on.schedule.every((entry) => typeof entry.cron === 'string'))
  assert.ok('workflow_dispatch' in lane.on)
  assert.ok(!('pull_request' in lane.on) && !('push' in lane.on))
  assert.deepEqual(install.strategy.matrix.os, [
    'ubuntu-latest',
    'macos-latest',
    'windows-latest'
  ])

  assert.deepEqual(install.strategy.matrix.browser, [
    'chrome',
    'firefox',
    'edge'
  ])

  assert.equal(install.strategy['fail-fast'], false)
  assert.match(
    runText(install),
    /extension\.cjs install "\$BROWSER" --output json/
  )

  assert.match(runText(install), /nightly-dev-smoke\.mjs "\$FIXTURE"/)
  assert.match(
    runText(job(lane, 'pins')),
    /node scripts\/check-installer-pins\.mjs/
  )

  // Nothing in the required run waits on it.
  assert.ok(!workflowText('ci.yml').includes('browser-install'))

  const pins = readWorkflow('installer-pins.yml')
  assert.ok(pins.on.pull_request.paths.includes('programs/install/**'))
  assert.match(
    Object.values(pins.jobs).map(runText).join('\n'),
    /node scripts\/check-installer-pins\.mjs/
  )
})

test('the optional deps smoke keeps macOS off pull requests and names every leg apart', () => {
  const lane = readWorkflow('optional-deps-matrix.yml')
  const main = job(lane, 'optional-deps-smoke')
  const macos = job(lane, 'optional-deps-smoke-macos')

  assert.ok('pull_request' in lane.on)
  assert.ok(
    main.strategy.matrix.include.every((leg) => leg.os !== 'macos-latest')
  )

  assert.equal(main.if, undefined)
  assert.equal(macos['runs-on'], 'macos-latest')
  assert.equal(macos.if, "github.event_name != 'pull_request'")
  assert.deepEqual(macos.strategy.matrix.pm, ['pnpm', 'deno'])
  assert.match(runText(macos), /run-optional-deps-smoke\.mjs --pm "\$SMOKE_PM"/)

  // The helper spec runs once in the CI quality job, not on every leg.
  assert.ok(!workflowText('optional-deps-matrix.yml').includes('__spec__'))

  // The fork legs share os and pm with the plain pnpm leg, so the browser
  // has to be part of the job name or three rows read the same.
  assert.match(main.name, /matrix\.browser/)
  const legs = main.strategy.matrix.include.map((leg) =>
    [leg.os, leg.pm, leg.browser || ''].join(' / ')
  )
  assert.equal(new Set(legs).size, legs.length)
})

test('dependabot groups npm minor and patch bumps and never rebases on its own', () => {
  const {updates} = readYaml('.github', 'dependabot.yml')
  const npm = updates.filter((entry) => entry['package-ecosystem'] === 'npm')

  assert.equal(npm.length, 1)
  assert.ok(updates.length >= 2)

  for (const entry of updates) {
    assert.equal(entry['rebase-strategy'], 'disabled', entry.directory)
  }

  const groups = Object.values(npm[0].groups)

  for (const applies of ['version-updates', 'security-updates']) {
    const group = groups.find((entry) => entry['applies-to'] === applies)

    assert.ok(group, applies)
    assert.deepEqual(group.patterns, ['*'])
    // A major left out of every group gets a pull request of its own.
    assert.deepEqual(group['update-types'], ['minor', 'patch'])
  }
})

test('no ci:test script is an alias of another', () => {
  const bodies = Object.entries(scripts)
    .filter(([name]) => name.startsWith('ci:test:'))
    .map(([, body]) => body)

  assert.ok(bodies.length > 0)
  assert.equal(new Set(bodies).size, bodies.length)
})

test('every ci:test script a workflow names exists', () => {
  for (const file of fs.readdirSync(workflowsDir)) {
    const names = workflowText(file).match(/ci:test:[a-z-]+/g) || []

    for (const name of names) {
      assert.ok(scripts[name], `${file}: ${name}`)
    }
  }
})

test('every test script a workflow runs through pnpm at the root exists', () => {
  let seen = 0

  for (const file of fs.readdirSync(workflowsDir)) {
    for (const entry of Object.values(readWorkflow(file).jobs)) {
      // A step with a working-directory runs another package's scripts, so
      // only the steps that run at the repo root are held to this package.json.
      for (const item of entry.steps || []) {
        if (!item.run || item['working-directory']) continue

        for (const [, name] of item.run.matchAll(
          /pnpm (?:run )?(test:[a-z0-9:-]+)/g
        )) {
          seen += 1
          assert.ok(scripts[name], `${file}: ${name}`)
        }
      }
    }
  }

  assert.ok(seen > 0)
})

test('the nightly templates catalog lane fetches through codeload and reports red', () => {
  const lane = readWorkflow('programs-nightly.yml')
  const entry = job(lane, 'examples-catalog')

  assert.ok(lane.on.schedule?.length > 0)
  assert.equal(entry.permissions.issues, 'write')
  assert.ok(entry.steps.some((item) => item.uses === './.github/actions/setup'))
  assert.ok(!runText(entry).includes('|| true'))
  assert.ok(entry.steps.every((item) => !item['continue-on-error']))

  assert.equal(
    step(entry, 'Scaffold from the real templates catalog').run.trim(),
    'pnpm test:remote'
  )

  const report = step(entry, 'Report a red lane')
  assert.match(report.if, /failure\(\)/)
  assert.match(report.env.RED_LANE_REPRO, /pnpm test:remote/)
  assert.match(report.run, /report-red-lane\.sh "Nightly templates catalog"/)

  const close = step(entry, 'Close the red lane')
  assert.match(close.if, /success\(\)/)
  assert.match(close.run, /close-red-lane\.sh "Nightly templates catalog"/)

  // The script itself must opt into the network and run the one spec that is
  // allowed to reach the catalog, or the lane goes green without a fetch.
  const remote = scripts['test:remote']
  assert.match(remote, /EXTENSION_TEST_REMOTE=true/)
  const specs = [...remote.matchAll(/(\S+\.remote\.spec\.ts)/g)].map(
    (m) => m[1]
  )
  assert.ok(specs.length > 0, remote)

  for (const spec of specs) {
    const file = path.join(root, 'programs', 'create', spec)
    assert.ok(fs.existsSync(file), file)
    assert.match(fs.readFileSync(file, 'utf8'), /codeload\.github\.com/)
  }

  const guard = fs.readFileSync(
    path.join(root, 'programs', 'create', '__spec__', 'forbid-network.ts'),
    'utf8'
  )
  assert.match(guard, /if \(!process\.env\.EXTENSION_TEST_REMOTE\)/)
})

test('the ci passed gate waits on every other job and reads each result', () => {
  const ci = readWorkflow('ci.yml')
  const gate = job(ci, 'ci-passed')
  const others = Object.keys(ci.jobs).filter((id) => id !== 'ci-passed')

  assert.deepEqual([...gate.needs].sort(), others.sort())
  assert.equal(gate.if, 'always()')

  const check = step(gate, 'Check the result of every CI job')
  assert.equal(check.env.RESULTS, expr("join(needs.*.result, ' ')"))
  assert.match(
    check.run,
    /^bash scripts\/check-ci-results\.sh "\$\{RESULTS\}"$/
  )

  // Only a pull request run is cancelled, so a run of main always reports.
  assert.equal(
    ci.concurrency['cancel-in-progress'],
    expr("github.event_name == 'pull_request'")
  )

  assert.equal(gate.permissions.issues, 'write')
  assert.equal(ci.permissions.issues, undefined)

  const report = step(gate, 'Report a red lane')
  assert.equal(report.if, "failure() && github.ref == 'refs/heads/main'")
  assert.ok(report.env.GH_TOKEN)
  assert.match(report.run, /report-red-lane\.sh "CI"/)

  const close = step(gate, 'Close the red lane')
  assert.equal(close.if, "success() && github.ref == 'refs/heads/main'")
  assert.match(close.run, /close-red-lane\.sh "CI"/)
})

test('main keeps one CodeQL overlay base, removed by a job with its own write grant', () => {
  const codeql = readWorkflow('codeql.yml')
  const prune = job(codeql, 'prune-overlay-caches')

  assert.equal(codeql.permissions.actions, undefined)
  assert.equal(prune.needs, 'analyze')
  assert.equal(
    prune.if,
    "github.event_name != 'pull_request' && github.ref == 'refs/heads/main'"
  )

  assert.deepEqual(prune.permissions, {actions: 'write', contents: 'read'})
  assert.equal(
    step(prune, 'Delete older overlay bases').run,
    'node scripts/prune-codeql-overlay-caches.mjs'
  )
})

test('no workflow caches a pnpm store path pnpm does not use', () => {
  for (const file of fs.readdirSync(workflowsDir)) {
    assert.ok(!workflowText(file).includes('.pnpm-store'), file)
  }
})

test('the telemetry lane runs the tree, fails on a failed verb and asserts an event per verb', () => {
  const text = workflowText('telemetry-check.yml')
  const lane = readWorkflow('telemetry-check.yml')

  assert.ok(!text.includes('|| true'))
  assert.ok(!text.includes('--open='))
  assert.ok(!text.includes('extension@latest'))
  assert.match(lane.name, /tree/)
  assert.ok(lane.on.schedule?.length > 0)
  assert.match(text, /--filter extension compile/)
  assert.match(text, /EXTENSION_AUTO_EXIT_MS: '\d+'/)
  assert.match(text, /EXTENSION_TELEMETRY_DEBUG: '1'/)

  const steps = Object.values(lane.jobs).flatMap((entry) => entry.steps)

  const named = (name) => {
    const found = steps.find((entry) => entry.name?.startsWith(name))
    assert.ok(found, name)

    return found.run
  }

  const seed = named('Seed a minimal extension')
  assert.match(seed, /SMOKE_DIR="\$RUNNER_TEMP\//)
  assert.match(seed, /echo "SMOKE_DIR=\$SMOKE_DIR" >> "\$GITHUB_ENV"/)

  const emit = named('Emit telemetry')
  assert.match(emit, /set -euo pipefail/)
  assert.match(emit, /extension dev "\$SMOKE_DIR" .*--no-browser/)
  assert.match(emit, /extension build "\$SMOKE_DIR" /)
  assert.match(emit, /extension preview "\$SMOKE_DIR" .*--no-browser/)

  const check = named('Assert a telemetry event per verb')
  assert.match(check, /for verb in dev build preview/)
  assert.match(check, /grep -Fq "\\"event\\":\\"command_executed\\"/)
  assert.match(check, /\\"command\\":\\"\$verb\\"" "telemetry-\$verb\.log"/)
  assert.match(check, /exit 1/)
})

test('the safari build step carries its own exit status and the lane reports red', () => {
  const lane = readWorkflow('safari-nightly.yml')
  const steps = Object.values(lane.jobs).flatMap((entry) => entry.steps)

  const named = (name) => {
    const found = steps.find((entry) => entry.name?.startsWith(name))
    assert.ok(found, name)

    return found
  }

  const build = named('Build Safari app').run
  assert.match(build, /set -euo pipefail/)
  assert.match(build, /\| tee safari-build\.log/)

  assert.equal(named('Upload build log').if, 'always()')
  assert.ok(
    Object.values(lane.jobs).some(
      (entry) => entry.permissions?.issues === 'write'
    )
  )

  const report = named('Report a red lane')
  assert.match(report.if, /failure\(\)/)
  assert.ok(report.env.RED_LANE_REPRO)
  assert.match(report.run, /report-red-lane\.sh "Nightly safari"/)

  const close = named('Close the red lane')
  assert.match(close.if, /success\(\)/)
  assert.match(close.run, /close-red-lane\.sh "Nightly safari"/)
})

function canarySteps() {
  const lane = readWorkflow('deps-canary.yml')

  return Object.values(lane.jobs).flatMap((entry) => entry.steps)
}

function canaryStep(name) {
  const found = canarySteps().find((entry) => entry.name === name)
  assert.ok(found, name)

  return found
}

test('a canary week that ran no tests cannot close a red lane', () => {
  assert.match(
    canaryStep('Close the red lane').if,
    /success\(\) && steps\.overrides\.outputs\.count != '0'/
  )
})

test('a canary red is allowed only when it names a known upstream break', () => {
  const suite = canaryStep('Run the rspack suite')

  assert.equal(suite.id, 'suite')
  assert.equal(suite['continue-on-error'], true)
  assert.match(suite.run, /set -o pipefail/)
  assert.match(suite.run, /tee "\$RUNNER_TEMP\/canary-suite\.log"/)

  assert.match(
    canaryStep('Name an upstream break').run,
    /deps-canary-known-breaks\.mjs "\$\{\{ matrix\.leg \}\}" "\$\{\{ steps\.suite\.outcome \}\}"/
  )

  assert.match(
    canaryStep('Close the red lane').if,
    /steps\.suite\.outcome == 'success'/
  )

  assert.match(
    canaryStep('Run the frameworks plugin specs').if,
    /^steps\.suite\.outcome == 'success'/
  )
})

test('the cli suite reaches the apt archive only when the image has no Xvfb', () => {
  const ci = readWorkflow('ci.yml')
  const installs = Object.values(ci.jobs)
    .flatMap((entry) => entry.steps || [])
    .filter((entry) => entry.name === 'Install xvfb (cli suite)')

  assert.equal(installs.length, 2)

  for (const install of installs) {
    const guard = install.run.indexOf(
      'if command -v Xvfb >/dev/null 2>&1; then'
    )
    const archive = install.run.indexOf('sudo apt-get')

    assert.notEqual(guard, -1)
    assert.ok(guard < archive)
    assert.match(install.run.slice(guard, archive), /exit 0/)
  }
})
