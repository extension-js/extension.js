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
const workflowsDir = path.join(root, '.github', 'workflows')
const scripts = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
).scripts

function workflow(file) {
  return fs.readFileSync(path.join(workflowsDir, file), 'utf8')
}

function jobSection(text, job) {
  const start = text.indexOf(`\n  ${job}:\n`)
  assert.notEqual(start, -1, job)
  const rest = text.slice(start + 1)
  const end = rest.search(/\n {2}[a-z-]+:\n/)

  return end === -1 ? rest : rest.slice(0, end)
}

function matrixSuites(text, job) {
  const section = jobSection(text, job)
  const matrix = section.slice(0, section.indexOf('\n    steps:'))

  return [...matrix.matchAll(/^\s+- (ci:test:[a-z-]+)$/gm)].map((m) => m[1])
}

function step(text, name) {
  const start = text.indexOf(`- name: ${name}`)
  assert.notEqual(start, -1, name)
  const rest = text.slice(start + 1)
  const end = rest.search(/\n\s+- name: /)

  return end === -1 ? rest : rest.slice(0, end)
}

test('every ci test matrix entry runs a suite no other entry runs', () => {
  const ci = workflow('ci.yml')

  for (const job of ['tests', 'tests-node']) {
    const suites = matrixSuites(ci, job)
    assert.ok(suites.length > 0, job)

    const commands = suites.map((suite) => scripts[suite])

    for (const [i, suite] of suites.entries()) {
      assert.ok(commands[i], `${job}: ${suite}`)
    }

    assert.equal(new Set(commands).size, commands.length, suites.join(', '))
  }
})

test('pull requests run each suite once on the engines floor, newer Node on main and nightly', () => {
  const ci = workflow('ci.yml')
  const floor = JSON.parse(
    fs.readFileSync(
      path.join(root, 'programs', 'extension', 'package.json'),
      'utf8'
    )
  ).engines.node.replace('>=', '')
  const suites = ['ci:test:develop', 'ci:test:cli', 'ci:test:create']

  const tests = jobSection(ci, 'tests')
  assert.deepEqual(matrixSuites(ci, 'tests'), suites)
  assert.match(tests, new RegExp(`node-version: '${floor}'\n`))
  assert.doesNotMatch(tests, /^ {4}if: /m)

  const current = jobSection(ci, 'tests-node')
  assert.deepEqual(matrixSuites(ci, 'tests-node'), suites)
  assert.match(current, /^ {4}if: github\.event_name != 'pull_request'$/m)
  const nodes = /^ {8}node: \[(.+)\]$/m.exec(current)[1]
  assert.ok(!nodes.includes(floor), nodes)

  const nightly = workflow('programs-nightly.yml')
  const lane = jobSection(nightly, 'nightly-node-current')
  assert.deepEqual(matrixSuites(nightly, 'nightly-node-current'), suites)
  assert.equal(/^ {8}node: \[(.+)\]$/m.exec(lane)[1].replace(/'/g, ''), nodes)
  assert.match(lane, /node-version: \$\{\{ matrix\.node \}\}/)
  assert.match(step(lane, 'Report a red lane'), /if: failure\(\)/)
  assert.match(step(lane, 'Close the red lane'), /if: success\(\)/)
})

test('windows runs the suites as two parallel jobs, each with its own timeout', () => {
  const ci = workflow('ci.yml')

  assert.equal(ci.includes('\n  tests-windows:\n'), false)

  const develop = jobSection(ci, 'tests-windows-develop')
  const cli = jobSection(ci, 'tests-windows-cli')

  for (const job of [develop, cli]) {
    assert.match(job, /^ {4}runs-on: windows-latest$/m)
    assert.match(job, /^ {4}timeout-minutes: \d+$/m)
    assert.doesNotMatch(job, /^ {4}needs: /m)
  }

  assert.match(develop, /run: pnpm test:dev$/m)
  assert.match(cli, /run: pnpm test:cli$/m)
  assert.match(cli, /run: pnpm ci:test:create$/m)
  assert.match(scripts['test:dev'], /run-test\.mjs develop$/)
  assert.match(scripts['test:cli'], /run-test\.mjs cli$/)

  // The Edge locate proof reads the compiled CLI, so it stays beside it.
  assert.equal(ci.split('verify-edge-system-locate.mjs').length - 1, 1)
  assert.ok(
    cli.indexOf('--filter extension compile') <
      cli.indexOf('verify-edge-system-locate.mjs')
  )
})

test('the optional deps smoke keeps macOS off pull requests and names every leg apart', () => {
  const lane = workflow('optional-deps-matrix.yml')
  const main = jobSection(lane, 'optional-deps-smoke')
  const macos = jobSection(lane, 'optional-deps-smoke-macos')

  assert.match(lane, /^ {2}pull_request:$/m)
  assert.doesNotMatch(main, /macos/)
  assert.doesNotMatch(main, /^ {4}if: /m)
  assert.match(macos, /^ {4}runs-on: macos-latest$/m)
  assert.match(macos, /^ {4}if: github\.event_name != 'pull_request'$/m)
  assert.match(macos, /^ {8}pm: \[pnpm, deno\]$/m)
  assert.match(macos, /run-optional-deps-smoke\.mjs --pm "\$SMOKE_PM"/)

  // The helper spec runs once in the CI quality job, not on every leg.
  assert.ok(!lane.includes('__spec__'))

  // The fork legs share os and pm with the plain pnpm leg, so the browser
  // has to be part of the job name or three rows read the same.
  assert.match(
    main,
    /name: smoke \(\$\{\{ matrix\.os \}\} \/ \$\{\{ matrix\.pm \}\}\$\{\{ matrix\.browser && format\(' \/ \{0\}', matrix\.browser\) \|\| '' \}\}\)/
  )
})

test('dependabot groups npm minor and patch bumps and never rebases on its own', () => {
  const config = fs.readFileSync(
    path.join(root, '.github', 'dependabot.yml'),
    'utf8'
  )
  const entries = config.split(/\n {2}- package-ecosystem: /).slice(1)
  const npm = entries.filter((entry) => entry.startsWith('"npm"'))

  assert.equal(npm.length, 1)
  assert.ok(entries.length >= 2)

  for (const entry of entries) {
    assert.match(entry, /^ {4}rebase-strategy: "disabled"$/m)
  }

  for (const applies of ['version-updates', 'security-updates']) {
    assert.match(
      npm[0],
      new RegExp(
        `applies-to: ${applies}\\n\\s+patterns:\\n\\s+- "\\*"\\n\\s+update-types:\\n\\s+- "minor"\\n\\s+- "patch"\\n`
      )
    )
  }

  // A major left out of every group gets a pull request of its own.
  assert.doesNotMatch(npm[0], /- "major"/)
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
    const names = workflow(file).match(/ci:test:[a-z-]+/g) || []

    for (const name of names) {
      assert.ok(scripts[name], `${file}: ${name}`)
    }
  }
})

test('every test script a workflow runs through pnpm at the root exists', () => {
  let seen = 0

  for (const file of fs.readdirSync(workflowsDir)) {
    // A step with a working-directory runs another package's scripts, so
    // only the steps that run at the repo root are held to this package.json.
    const steps = workflow(file)
      .split(/\n\s+- (?=name: |uses: )/)
      .filter((chunk) => !/^\s+working-directory: /m.test(chunk))

    for (const chunk of steps) {
      const names = [
        ...chunk.matchAll(/pnpm (?:run )?(test:[a-z0-9:-]+)/g)
      ].map((m) => m[1])

      for (const name of names) {
        seen += 1
        assert.ok(scripts[name], `${file}: ${name}`)
      }
    }
  }

  assert.ok(seen > 0)
})

test('the nightly templates catalog lane fetches through codeload and reports red', () => {
  const lane = workflow('programs-nightly.yml')
  const job = jobSection(lane, 'examples-catalog')

  assert.match(lane, /cron: /)
  assert.match(job, /issues: write/)
  assert.match(job, /uses: \.\/\.github\/actions\/setup/)
  assert.ok(!job.includes('|| true'))
  assert.ok(!job.includes('continue-on-error'))

  const fetch = step(job, 'Scaffold from the real templates catalog')
  assert.match(fetch, /^\s+run: pnpm test:remote$/m)

  assert.match(
    step(job, 'Report a red lane'),
    /if: failure\(\)[\s\S]*RED_LANE_REPRO[\s\S]*pnpm test:remote[\s\S]*report-red-lane\.sh "Nightly templates catalog"/
  )

  assert.match(
    step(job, 'Close the red lane'),
    /if: success\(\)[\s\S]*close-red-lane\.sh "Nightly templates catalog"/
  )

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
  const ci = workflow('ci.yml')
  const jobs = [
    ...ci.slice(ci.indexOf('\njobs:\n')).matchAll(/^ {2}([a-z-]+):\n/gm)
  ]
    .map((m) => m[1])
    .filter((job) => job !== 'ci-passed')
  const gate = jobSection(ci, 'ci-passed')
  const needs = [...gate.matchAll(/^ {6}- ([a-z-]+)$/gm)].map((m) => m[1])

  assert.deepEqual(needs.sort(), jobs.sort())
  assert.match(gate, /if: always\(\)/)
  assert.match(gate, /join\(needs\.\*\.result, ' '\)/)
  assert.match(gate, /bash scripts\/check-ci-results\.sh "\$\{RESULTS\}"/)

  // Only a pull request run is cancelled, so a run of main always reports.
  assert.match(
    ci,
    /^ {2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/m
  )

  assert.match(gate, /^ {6}issues: write$/m)
  assert.doesNotMatch(ci.slice(0, ci.indexOf('\njobs:\n')), /issues: write/)
  assert.match(
    step(gate, 'Report a red lane'),
    /if: failure\(\) && github\.ref == 'refs\/heads\/main'[\s\S]*GH_TOKEN[\s\S]*report-red-lane\.sh "CI"/
  )

  assert.match(
    step(gate, 'Close the red lane'),
    /if: success\(\) && github\.ref == 'refs\/heads\/main'[\s\S]*close-red-lane\.sh "CI"/
  )
})

test('the telemetry lane runs the tree, fails on a failed verb and asserts an event per verb', () => {
  const lane = workflow('telemetry-check.yml')

  assert.ok(!lane.includes('|| true'))
  assert.ok(!lane.includes('--open='))
  assert.ok(!lane.includes('extension@latest'))
  assert.match(lane, /^name: .*tree/m)
  assert.match(lane, /cron: /)
  assert.match(lane, /--filter extension compile/)
  assert.match(lane, /EXTENSION_AUTO_EXIT_MS: '\d+'/)
  assert.match(lane, /EXTENSION_TELEMETRY_DEBUG: '1'/)

  const seed = step(lane, 'Seed a minimal extension')
  assert.match(seed, /SMOKE_DIR="\$RUNNER_TEMP\//)
  assert.match(seed, /echo "SMOKE_DIR=\$SMOKE_DIR" >> "\$GITHUB_ENV"/)

  const emit = step(lane, 'Emit telemetry')
  assert.match(emit, /set -euo pipefail/)
  assert.match(emit, /extension dev "\$SMOKE_DIR" .*--no-browser/)
  assert.match(emit, /extension build "\$SMOKE_DIR" /)
  assert.match(emit, /extension preview "\$SMOKE_DIR" .*--no-browser/)

  const check = step(lane, 'Assert a telemetry event per verb')
  assert.match(check, /for verb in dev build preview/)
  assert.match(check, /grep -Fq "\\"event\\":\\"command_executed\\"/)
  assert.match(check, /\\"command\\":\\"\$verb\\"" "telemetry-\$verb\.log"/)
  assert.match(check, /exit 1/)
})

test('the safari build step carries its own exit status and the lane reports red', () => {
  const lane = workflow('safari-nightly.yml')

  const build = step(lane, 'Build Safari app')
  assert.match(build, /set -euo pipefail/)
  assert.match(build, /\| tee safari-build\.log/)

  assert.match(step(lane, 'Upload build log'), /if: always\(\)/)
  assert.match(lane, /issues: write/)
  assert.match(
    step(lane, 'Report a red lane'),
    /if: failure\(\)[\s\S]*RED_LANE_REPRO[\s\S]*report-red-lane\.sh "Nightly safari"/
  )

  assert.match(
    step(lane, 'Close the red lane'),
    /if: success\(\)[\s\S]*close-red-lane\.sh "Nightly safari"/
  )
})

test('a canary week that ran no tests cannot close a red lane', () => {
  const lane = workflow('deps-canary.yml')

  assert.match(
    step(lane, 'Close the red lane'),
    /if: success\(\) && steps\.overrides\.outputs\.count != '0'/
  )
})

test('a canary red is allowed only when it names a known upstream break', () => {
  const lane = workflow('deps-canary.yml')
  const suite = step(lane, 'Run the rspack suite')

  assert.match(suite, /id: suite/)
  assert.match(suite, /continue-on-error: true/)
  assert.match(suite, /set -o pipefail/)
  assert.match(suite, /tee "\$RUNNER_TEMP\/canary-suite\.log"/)

  assert.match(
    step(lane, 'Name an upstream break'),
    /deps-canary-known-breaks\.mjs "\$\{\{ matrix\.leg \}\}" "\$\{\{ steps\.suite\.outcome \}\}"/
  )

  assert.match(
    step(lane, 'Close the red lane'),
    /steps\.suite\.outcome == 'success'/
  )

  assert.match(
    step(lane, 'Run the frameworks plugin specs'),
    /if: steps\.suite\.outcome == 'success'/
  )
})

test('the cli suite reaches the apt archive only when the image has no Xvfb', () => {
  const installs = workflow('ci.yml')
    .split('- name: Install xvfb (cli suite)')
    .slice(1)
    .map((rest) => rest.split('\n      - name: ')[0])

  assert.equal(installs.length, 2)

  for (const install of installs) {
    const guard = install.indexOf('if command -v Xvfb >/dev/null 2>&1; then')
    const archive = install.indexOf('sudo apt-get')

    assert.notEqual(guard, -1)
    assert.ok(guard < archive)
    assert.match(install.slice(guard, archive), /exit 0/)
  }
})
