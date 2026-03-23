#!/usr/bin/env node

import {spawn} from 'node:child_process'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)

function parseArg(name, fallback) {
  const idx = args.indexOf(name)
  if (idx === -1) return fallback
  const next = args[idx + 1]
  if (!next || next.startsWith('--')) return fallback
  return next
}

function parseFlag(name) {
  return args.includes(name)
}

const templateArg = parseArg('--templates', '')
const templates = templateArg
  ? templateArg
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  : ['content-react', 'content-vue', 'content-svelte', 'content-preact']

const timeoutMs = Number(parseArg('--timeout-ms', '180000'))
const keepTemp = parseFlag('--keep-temp')
const keepCache = parseFlag('--keep-cache')
const useIsolatedCache = !parseFlag('--use-default-cache')
const packageSpecifier = parseArg('--package', 'extension@latest')
const devArgsRaw = parseArg('--dev-args', '--no-browser --port 0')
const devArgs = devArgsRaw.split(/\s+/).filter(Boolean)

const successPatterns = [/compiled successfully/i, /compiled with warnings/i]
const readyPattern = /Extension ready for development/i
const failurePatterns = [
  /Optional dependency install reported success but packages are missing/i,
  /could not be resolved after optional dependency installation/i,
  /Module parse failed/i,
  /JavaScript parse error/i,
  /compiled with errors/i,
  /Unhandled rejection/i
]

function commandFor(tool) {
  if (process.platform !== 'win32') return tool
  if (tool === 'npm') return 'npm.cmd'
  if (tool === 'npx') return 'npx.cmd'
  return tool
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function hasOutputMatch(text, patterns) {
  return patterns.some((pattern) => pattern.test(text))
}

function pathExists(targetPath) {
  try {
    fsSync.accessSync(targetPath)
    return true
  } catch {
    return false
  }
}

async function removeDirectoryWithRetries(targetDir, maxAttempts = 20) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await fs.rm(targetDir, {recursive: true, force: true})
      return true
    } catch (error) {
      const code = error && typeof error === 'object' ? error.code : undefined
      const retryable =
        code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY'
      if (!retryable || attempt === maxAttempts) return false
      await wait(Math.min(250 * attempt, 1500))
    }
  }
  return false
}

function runCommand(command, commandArgs, cwd, env) {
  return new Promise((resolve, reject) => {
    const rendered = [commandFor(command), ...commandArgs].join(' ')
    console.log(`\n$ (${cwd}) ${rendered}`)

    const child = spawn(commandFor(command), commandArgs, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    })

    let output = ''
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString()
      output += text
      process.stdout.write(text)
    })
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString()
      output += text
      process.stderr.write(text)
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if ((code || 0) !== 0) {
        reject(
          new Error(
            `Command failed with exit code ${code}: ${rendered}\n\n${output}`
          )
        )
        return
      }
      resolve(output)
    })
  })
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return

  if (process.platform === 'win32' && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn(
        'taskkill',
        ['/PID', String(child.pid), '/T', '/F'],
        {
          stdio: 'ignore',
          windowsHide: true
        }
      )
      killer.once('close', () => resolve())
      killer.once('error', () => resolve())
    })
    return
  }

  try {
    child.kill('SIGTERM')
  } catch {}
  await wait(1000)
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill('SIGKILL')
    } catch {}
  }
}

function runDevOnce(projectDir, env, timeout) {
  return new Promise((resolve, reject) => {
    const command = commandFor('npm')
    const cmdArgs = ['run', 'dev']
    if (devArgs.length > 0) {
      cmdArgs.push('--', ...devArgs)
    }
    console.log(`\n$ (${projectDir}) ${command} ${cmdArgs.join(' ')}`)

    const child = spawn(command, cmdArgs, {
      cwd: projectDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    })

    let output = ''
    let settled = false
    let sawCompileSuccess = false
    let sawReadyBanner = false

    const settle = async (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      await terminateChild(child)
      if (error) {
        reject(error)
      } else {
        resolve({
          output,
          sawCompileSuccess,
          sawReadyBanner
        })
      }
    }

    const timer = setTimeout(() => {
      void settle(
        new Error(
          `Timed out waiting for first dev assertions after ${timeout}ms.\n\n${output.slice(
            -12000
          )}`
        )
      )
    }, timeout)

    const onChunk = (chunk) => {
      const text = chunk.toString()
      output += text
      process.stdout.write(text)

      if (hasOutputMatch(output, failurePatterns)) {
        const firstPattern = failurePatterns.find((pattern) =>
          pattern.test(output)
        )
        void settle(
          new Error(
            `First dev run hit failure pattern: ${String(firstPattern)}\n\n${output}`
          )
        )
        return
      }

      if (hasOutputMatch(output, successPatterns)) {
        sawCompileSuccess = true
      }
      if (readyPattern.test(output)) {
        sawReadyBanner = true
      }

      if (sawCompileSuccess && sawReadyBanner) {
        setTimeout(() => {
          void settle()
        }, 3500)
      }
    }

    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)
    child.on('error', (error) => {
      void settle(error)
    })
    child.on('close', (code) => {
      if (settled) return
      void settle(
        new Error(`Dev process exited early with code ${code}\n\n${output}`)
      )
    })
  })
}

function detectDefaultOptionalDepsRoot() {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData) {
      return path.join(localAppData, 'extensionjs', 'optional-deps')
    }
    return null
  }

  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'extensionjs',
      'optional-deps'
    )
  }

  if (process.platform === 'linux') {
    return path.join(
      process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
      'extensionjs',
      'optional-deps'
    )
  }

  return null
}

async function readExtensionVersion(projectDir) {
  const pkgPath = path.join(
    projectDir,
    'node_modules',
    'extension',
    'package.json'
  )
  if (!pathExists(pkgPath)) return null
  try {
    const raw = await fs.readFile(pkgPath, 'utf8')
    const parsed = JSON.parse(raw)
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

function inspectReactOptionalDeps(cacheBaseDir, extensionVersion) {
  if (!cacheBaseDir || !extensionVersion) {
    return {
      cacheBaseDir,
      extensionVersion,
      installRoot: null,
      reactRefreshExists: false,
      reactRefreshPluginExists: false
    }
  }

  const installRoot = path.join(cacheBaseDir, extensionVersion)
  const reactRefreshPath = path.join(
    installRoot,
    'node_modules',
    'react-refresh'
  )
  const pluginPath = path.join(
    installRoot,
    'node_modules',
    '@rspack',
    'plugin-react-refresh'
  )

  return {
    cacheBaseDir,
    extensionVersion,
    installRoot,
    reactRefreshExists: pathExists(reactRefreshPath),
    reactRefreshPluginExists: pathExists(pluginPath)
  }
}

async function verifyTemplate(template) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), `extjs-first-dev-${template}-`)
  )
  const projectName = 'my-extension'
  const projectDir = path.join(root, projectName)
  const isolatedCacheRoot = path.join(root, 'cache', 'optional-deps')
  const env = {...process.env}

  if (useIsolatedCache) {
    env.EXTENSION_JS_CACHE_DIR = path.join(root, 'cache')
  } else {
    delete env.EXTENSION_JS_CACHE_DIR
  }

  let firstRun = null
  let secondRun = null

  try {
    await runCommand(
      'npx',
      ['-y', packageSpecifier, 'create', projectName, `--template=${template}`],
      root,
      env
    )
    await runCommand('npm', ['i', '--no-audit', '--no-fund'], projectDir, env)

    try {
      firstRun = await runDevOnce(projectDir, env, timeoutMs)
    } catch (error) {
      // Capture second run behavior to enforce "first run only" contract.
      try {
        secondRun = await runDevOnce(projectDir, env, timeoutMs)
      } catch (secondError) {
        const extensionVersion = await readExtensionVersion(projectDir)
        const cacheBaseDir = useIsolatedCache
          ? isolatedCacheRoot
          : detectDefaultOptionalDepsRoot()
        const cacheState = inspectReactOptionalDeps(
          cacheBaseDir,
          extensionVersion
        )
        const firstMessage = String(error?.stack || error)
        const secondMessage = String(secondError?.stack || secondError)
        throw new Error(
          [
            `[${template}] first dev failed and second dev also failed.`,
            '',
            'First run error:',
            firstMessage,
            '',
            'Second run error:',
            secondMessage,
            '',
            'Cache diagnostics:',
            JSON.stringify(cacheState, null, 2)
          ].join('\n')
        )
      }

      const extensionVersion = await readExtensionVersion(projectDir)
      const cacheBaseDir = useIsolatedCache
        ? isolatedCacheRoot
        : detectDefaultOptionalDepsRoot()
      const cacheState = inspectReactOptionalDeps(
        cacheBaseDir,
        extensionVersion
      )
      throw new Error(
        [
          `[${template}] first dev failed but second dev succeeded.`,
          'One-run contract is broken.',
          '',
          'Cache diagnostics:',
          JSON.stringify(cacheState, null, 2)
        ].join('\n')
      )
    }

    if (!firstRun?.sawCompileSuccess || !firstRun?.sawReadyBanner) {
      throw new Error(
        `[${template}] first dev did not emit all success signals. sawCompileSuccess=${Boolean(
          firstRun?.sawCompileSuccess
        )} sawReadyBanner=${Boolean(firstRun?.sawReadyBanner)}`
      )
    }

    const extensionVersion = await readExtensionVersion(projectDir)
    const cacheBaseDir = useIsolatedCache
      ? isolatedCacheRoot
      : detectDefaultOptionalDepsRoot()
    const cacheState = inspectReactOptionalDeps(cacheBaseDir, extensionVersion)

    console.log(
      `[${template}] PASS first dev succeeded. cache=${JSON.stringify(cacheState)}`
    )
    return {template, ok: true, firstRun, secondRun, cacheState, root}
  } finally {
    if (keepTemp || keepCache) {
      console.log(`[${template}] keeping temp root: ${root}`)
    } else {
      await wait(3000)
      const removed = await removeDirectoryWithRetries(root)
      if (!removed) {
        console.warn(
          `[${template}] cleanup flaky; keeping temp directory: ${root}`
        )
      }
    }
  }
}

async function main() {
  const results = []
  for (const template of templates) {
    console.log(`\n=== Verifying template: ${template} ===`)
    const result = await verifyTemplate(template)
    results.push(result)
  }

  console.log('\nAll template first-dev checks passed.')
}

main().catch((error) => {
  console.error('\nWindows optional-deps first-dev verification failed.')
  console.error(String(error?.stack || error))
  process.exit(1)
})
