// Per-scenario harness driver.
//
// One run = one scenario from the matrix. The driver:
//   1. Copies the source fixture into a temp directory so edits cannot leak
//      back to the repo. The temp dir is the project root for this run.
//   2. Spawns the dev pipeline against the temp project. Two modes:
//      - "local"  → runs `node <monorepo>/programs/extension/dist/cli.cjs dev`
//                   so we measure what the dev branch produces. This is the
//                   inner-loop mode used for matrix-driven fix iteration.
//      - "remote" → runs `npx -y extension@<tag> dev` so we measure what an
//                   end user installs from npm. This is the publish-gate mode
//                   used after a canary is uploaded; it catches packaging
//                   bugs (missing dist files, wrong cross-package deps, broken
//                   bin entries) that local mode never sees.
//      Both modes parse stdout for the CDP debug port and wait for the dev
//      banner to confirm the browser is up.
//   3. Connects the passive CDP observer to the same Chrome instance.
//   4. Optionally opens extension pages requested by the scenario (the popup,
//      options page, etc.) so we can measure their reload behavior.
//   5. Performs the file edits the scenario specifies, with controlled timing.
//   6. Waits for the observer to fall quiet, snapshots events, classifies
//      them per extension origin (user vs companion), and returns counts.
//   7. Tears everything down: kills the dev process, closes the observer,
//      removes the temp project.

import {spawn} from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {connectObserver} from './cdp-observer.mjs'

// __dirname is `<repo>/scripts/reload-matrix`. The harness lives at the
// monorepo root so it can gate CI. Fixtures are currently pulled by
// template name from `_FUTURE/examples/examples/<name>`; that subtree is
// gitignored on contributors' machines today but contains the canonical
// example templates we validate against. When fixtures move into the
// tracked tree, point TEMPLATES_DIR at the new location.
const HARNESS_DIR = dirname(fileURLToPath(import.meta.url))
const MONOREPO_ROOT = resolve(HARNESS_DIR, '..', '..')
const LOCAL_CLI_PATH = join(MONOREPO_ROOT, 'programs/extension/dist/cli.cjs')
const TEMPLATES_DIR = join(MONOREPO_ROOT, '_FUTURE/examples/examples')

const COMPANION_ORIGINS_HINT = ['extension-js-devtools', 'extension-js-theme']

/**
 * Resolve a fixture path from a template name. Scenarios reference templates
 * by short name (e.g. `'action-locales'`); the harness anchors that name to
 * `_FUTURE/examples/examples/<name>` so paths stay portable across machines
 * and CI.
 */
export function resolveTemplateFixture(templateName) {
  const path = join(TEMPLATES_DIR, templateName)
  if (!existsSync(path)) {
    throw new Error(
      `Template "${templateName}" not found at ${path}. Available templates ` +
        `are listed under ${TEMPLATES_DIR}.`
    )
  }
  return path
}

function nodeBin() {
  return process.execPath
}

function copyFixture(sourceDir) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'reload-matrix-'))
  const projectDir = join(tempRoot, 'project')
  cpSync(sourceDir, projectDir, {recursive: true})
  // Strip any existing dist or profile so we always start clean.
  for (const sub of ['dist', 'node_modules/.cache']) {
    const candidate = join(projectDir, sub)
    if (existsSync(candidate)) rmSync(candidate, {recursive: true, force: true})
  }
  return {tempRoot, projectDir}
}

/**
 * Build the spawn descriptor for the dev process based on the requested
 * mode. The same args/cwd/env shape works for both modes so the harness
 * downstream of this point doesn't care which one is in play.
 */
function buildDevSpawn({projectDir, env, mode = 'local', remoteTag = 'canary'}) {
  if (mode === 'local') {
    if (!existsSync(LOCAL_CLI_PATH)) {
      throw new Error(
        `Local CLI build not found at ${LOCAL_CLI_PATH}. Run ` +
          `\`pnpm --dir programs/extension run compile\` from the monorepo ` +
          `root before running the matrix in local mode.`
      )
    }
    return {
      command: nodeBin(),
      args: [LOCAL_CLI_PATH, 'dev', '--browser=chromium', '--no-telemetry']
    }
  }
  if (mode === 'remote') {
    // `npx -y` accepts the install on first use without a TTY prompt. The
    // remote-tag is honored via the registry's dist-tag (e.g. `extension@canary`).
    return {
      command: 'npx',
      args: [
        '-y',
        `extension@${remoteTag}`,
        'dev',
        '--browser=chromium',
        '--no-telemetry'
      ]
    }
  }
  throw new Error(`Unknown harness mode: ${mode}`)
}

function spawnDev({projectDir, env, mode, remoteTag}) {
  const {command, args} = buildDevSpawn({projectDir, env, mode, remoteTag})
  const child = spawn(command, args, {
    cwd: projectDir,
    env: {
      ...process.env,
      EXTENSION_AUTHOR_MODE: 'true',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  return {
    child,
    getStdout: () => stdout,
    getStderr: () => stderr,
    spawnDescription: `${command} ${args.join(' ')}`
  }
}

async function waitForCdpPort(getStdout, deadlineMs) {
  const start = Date.now()
  // The CLI logs `Chromium debug port: NNNN (requested ...)`. We grab the
  // assigned port (first number) so a port-conflict shift is honored.
  while (Date.now() - start < deadlineMs) {
    const out = getStdout()
    const match = out.match(/Chromium debug port:\s*(\d+)/)
    if (match) return Number(match[1])
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('Timed out waiting for CDP debug port in dev stdout')
}

async function waitForDevReady(getStdout, getStderr, deadlineMs) {
  const start = Date.now()
  while (Date.now() - start < deadlineMs) {
    if (/(Chrome|Chromium|Edge|Firefox) Extension ready for development/.test(getStdout())) return
    await new Promise((r) => setTimeout(r, 100))
  }
  const error = new Error('Timed out waiting for "Chrome Extension ready" banner')
  error.stdoutTail = getStdout().split('\n').slice(-40).join('\n')
  error.stderrTail = getStderr().split('\n').slice(-40).join('\n')
  throw error
}

async function killTree(child) {
  if (!child || child.killed) return
  try {
    child.kill('SIGTERM')
  } catch {}
  await new Promise((resolve) => {
    if (child.exitCode != null) return resolve()
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {}
      resolve()
    }, 4_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function classifyEvents(events) {
  const buckets = new Map()
  for (const event of events) {
    const origin = event.extensionOrigin
    if (!origin) continue
    if (!buckets.has(origin)) {
      buckets.set(origin, {
        origin,
        serviceWorkerCreated: 0,
        serviceWorkerDestroyed: 0,
        extensionPageNavigated: 0
      })
    }
    const bucket = buckets.get(origin)
    if (event.category === 'serviceWorkerCreated')
      bucket.serviceWorkerCreated++
    if (event.category === 'serviceWorkerDestroyed')
      bucket.serviceWorkerDestroyed++
    if (event.category === 'extensionPageNavigated')
      bucket.extensionPageNavigated++
  }
  return Array.from(buckets.values())
}

function findUserExtensionOrigin(buckets, devManifestName) {
  // Companion extensions are well-known by name in their manifests; the user
  // extension is the one that doesn't match those. The harness only needs to
  // pick out the user origin so the matrix can assert against it.
  // We resolve via auxiliary data when we have it; otherwise we pick the
  // origin with the most lifecycle activity that is NOT a companion.
  const ranked = buckets
    .filter(
      (b) =>
        !COMPANION_ORIGINS_HINT.some((name) =>
          (b.manifestName || '').includes(name)
        )
    )
    .sort((a, b) => b.serviceWorkerCreated - a.serviceWorkerCreated)
  return ranked[0]?.origin
}

function readManifestName(projectDir) {
  for (const candidate of ['manifest.json', 'src/manifest.json']) {
    const path = join(projectDir, candidate)
    if (!existsSync(path)) continue
    try {
      const json = JSON.parse(readFileSync(path, 'utf-8'))
      if (typeof json.name === 'string') return json.name
    } catch {}
  }
  return undefined
}

/**
 * Run a single scenario.
 *
 * @param {object} scenario
 * @param {string} scenario.name              Display label.
 * @param {string} scenario.fixturePath       Absolute path to the source fixture.
 * @param {Array<{
 *   relativePath: string,
 *   transform?: (current: string) => string,
 *   waitMsAfter?: number
 * }>} scenario.edits                         Sequence of file edits.
 * @param {number} [scenario.startupQuietMs]  Quiet period to wait for
 *                                            after launch before edits.
 * @param {number} [scenario.afterEditsQuietMs] Quiet period to wait for
 *                                              after the last edit.
 * @returns {Promise<{
 *   name: string,
 *   userManifestName: string|undefined,
 *   buckets: ReturnType<typeof classifyEvents>,
 *   events: any[],
 *   stdout: string,
 *   stderr: string
 * }>}
 */
export async function runScenario(scenario) {
  const {tempRoot, projectDir} = copyFixture(scenario.fixturePath)
  const userManifestName = readManifestName(projectDir)

  const dev = spawnDev({
    projectDir,
    env: scenario.env || {},
    mode: scenario.mode || 'local',
    remoteTag: scenario.remoteTag || 'canary'
  })
  let observer
  try {
    const port = await waitForCdpPort(dev.getStdout, 30_000)
    await waitForDevReady(dev.getStdout, dev.getStderr, 30_000)

    observer = await connectObserver({port})

    // Drain the post-launch flurry of attach events so the scenario starts
    // from a quiet baseline. Lifecycle events recorded BEFORE the first edit
    // are kept in the transcript but excluded from the per-edit deltas.
    await observer.waitForQuiescence(
      scenario.startupQuietMs ?? 1_500,
      scenario.startupTimeoutMs ?? 8_000
    )

    // Identify the user extension origin from the extension ID printed by
    // the CLI banner. We need this to (a) classify origins later and (b)
    // open user-extension pages on request.
    const userExtensionId = extractExtensionIdFromStdout(dev.getStdout())

    // Open any extension pages the scenario asks for (popup, options, etc.)
    const openedTargets = []
    for (const open of scenario.openPages || []) {
      if (!userExtensionId) {
        throw new Error(
          `Scenario "${scenario.name}" asked to open ${open} but the user ` +
            `extension ID was not found in dev stdout`
        )
      }
      const url = `chrome-extension://${userExtensionId}/${open.replace(/^\//, '')}`
      const targetId = await observer.openTarget(url)
      if (targetId) openedTargets.push(targetId)
    }
    if (openedTargets.length > 0) {
      await observer.waitForQuiescence(800, 5_000)
    }

    const baselineEventCount = observer.events.length

    for (const edit of scenario.edits || []) {
      const target = join(projectDir, edit.relativePath)
      if (!existsSync(target)) {
        throw new Error(
          `Scenario "${scenario.name}" referenced missing file: ${edit.relativePath}`
        )
      }
      const current = readFileSync(target, 'utf-8')
      const next =
        typeof edit.transform === 'function'
          ? edit.transform(current)
          : current + ' '
      writeFileSync(target, next, 'utf-8')
      if (edit.waitMsAfter) {
        await new Promise((r) => setTimeout(r, edit.waitMsAfter))
      }
    }

    await observer.waitForQuiescence(
      scenario.afterEditsQuietMs ?? 2_500,
      scenario.afterEditsTimeoutMs ?? 12_000
    )

    const editEvents = observer.events.slice(baselineEventCount)
    const buckets = classifyEvents(editEvents)
    const userOrigin = userExtensionId || findUserExtensionOrigin(buckets, userManifestName)

    // Best-effort close on the way out so the next scenario starts clean.
    for (const targetId of openedTargets) {
      await observer.closeTarget(targetId)
    }

    return {
      name: scenario.name,
      userManifestName,
      userExtensionId,
      userOrigin,
      buckets,
      events: editEvents,
      baselineBuckets: classifyEvents(observer.events.slice(0, baselineEventCount)),
      baselineEventCount,
      stdout: dev.getStdout(),
      stderr: dev.getStderr()
    }
  } finally {
    if (observer) {
      try {
        await observer.close()
      } catch {}
    }
    await killTree(dev.child)
    try {
      rmSync(tempRoot, {recursive: true, force: true})
    } catch {}
  }
}

function extractExtensionIdFromStdout(stdout) {
  const match = stdout.match(/Extension ID\s+([a-p]{32})/)
  return match ? match[1] : undefined
}
