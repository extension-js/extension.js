import {spawn} from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'

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

const pkg = parseArg('--package', 'extension@canary')
const browser = parseArg('--browser', 'chromium')
const timeoutMs = Number(parseArg('--timeout-ms', '120000'))
const keepTemp = parseFlag('--keep-temp')

const nodeDir = dirname(process.execPath)
const pathDelim = process.platform === 'win32' ? ';' : ':'
const childEnv = {
  ...process.env,
  EXTENSION_AUTHOR_MODE: 'true',
  PATH: `${nodeDir}${pathDelim}${process.env.PATH || process.env.Path || ''}`
}

const failurePatterns = [
  /Failed to force-reload extension/i,
  /'Extensions\.reload' wasn't found/i,
  /\[plugin-browsers\] CDP post-launch setup failed/i
]

function runCollect(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
      ...opts
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if ((code || 0) !== 0) {
        reject(
          new Error(
            `[${cmd} ${cmdArgs.join(' ')}] failed with code ${code}\n${stdout}\n${stderr}`
          )
        )
        return
      }
      resolve({stdout, stderr})
    })
  })
}

function runDevAndValidate(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'dev', '--', `--browser=${browser}`], {
      cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let output = ''
    let firstCompileSeen = false
    let settled = false

    const finish = (err) => {
      if (settled) return
      settled = true
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }, 1000)

      if (err) {
        reject(err)
      } else {
        resolve(output)
      }
    }

    const timeout = setTimeout(() => {
      finish(
        new Error(
          `Timeout waiting for deterministic dev validation (${timeoutMs}ms)`
        )
      )
    }, timeoutMs)

    const postCompileGuard = () => {
      setTimeout(() => {
        clearTimeout(timeout)
        finish()
      }, 8000)
    }

    const onChunk = (chunk) => {
      const text = chunk.toString()
      output += text

      for (const pattern of failurePatterns) {
        if (pattern.test(text) || pattern.test(output)) {
          clearTimeout(timeout)
          finish(
            new Error(
              `Detected failure pattern: ${String(pattern)}\n\nCaptured output:\n${output}`
            )
          )
          return
        }
      }

      if (!firstCompileSeen && /compiled successfully/i.test(output)) {
        firstCompileSeen = true
        postCompileGuard()
      }
    }

    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)

    child.on('error', (error) => {
      clearTimeout(timeout)
      finish(error)
    })
    child.on('close', (code) => {
      if (settled) return
      clearTimeout(timeout)
      finish(
        new Error(`dev process exited early with code ${code}\n\n${output}`)
      )
    })
  })
}

function extractProfilePath(logs) {
  const m = logs.match(/Chrome profile:\s+([^\n\r]+)/)
  return m ? m[1].trim() : null
}

function extractExtensionId(logs) {
  const m = logs.match(/Extension ID\s+([a-z]{32})/i)
  return m ? m[1].trim() : null
}

function resolveSecurePreferencesPath(projectDir, logs) {
  const profilePath = extractProfilePath(logs)
  const candidates = []

  if (profilePath) {
    candidates.push(join(profilePath, 'Default', 'Secure Preferences'))
    candidates.push(join(profilePath, 'Secure Preferences'))
  }

  candidates.push(
    join(
      projectDir,
      'dist',
      `extension-profile-${browser}`,
      'Default',
      'Secure Preferences'
    )
  )

  const direct = candidates.find((p) => existsSync(p))
  if (direct) return direct

  // Best-effort fallback for profile layouts that do not follow the default path.
  const distDir = join(projectDir, 'dist')
  if (existsSync(distDir)) {
    const found = findByBasename(distDir, 'Secure Preferences', 4)
    if (found.length > 0) return found[0]
  }

  return null
}

function findByBasename(root, targetName, maxDepth) {
  const out = []
  const walk = (dir, depth) => {
    if (depth > maxDepth) return
    let entries = []
    try {
      entries = readdirSync(dir, {withFileTypes: true})
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
      } else if (entry.name === targetName) {
        out.push(full)
      }
    }
  }
  walk(root, 0)
  return out
}

function assertExtensionEnabledInPrefs(projectDir, logs) {
  const extensionId = extractExtensionId(logs)
  if (!extensionId) {
    throw new Error(`Could not parse extension ID from logs.\n\n${logs}`)
  }

  const securePrefsPath = resolveSecurePreferencesPath(projectDir, logs)
  if (!securePrefsPath) {
    return {
      checked: false,
      reason: `Secure Preferences not found under ${projectDir}`
    }
  }

  const st = statSync(securePrefsPath)
  if (!st.isFile()) {
    throw new Error(`Secure Preferences path is not a file: ${securePrefsPath}`)
  }
  const raw = readFileSync(securePrefsPath, 'utf-8')
  const prefs = JSON.parse(raw)
  const settings = prefs?.extensions?.settings || {}
  const ext = settings[extensionId]

  if (!ext) {
    throw new Error(
      `Extension ${extensionId} not found in ${securePrefsPath}. Available IDs: ${Object.keys(
        settings
      ).slice(0, 20)}`
    )
  }

  const reasons = ext.disable_reasons
  if (Array.isArray(reasons) && reasons.length > 0) {
    throw new Error(
      `Extension ${extensionId} is disabled in profile (disable_reasons=${JSON.stringify(
        reasons
      )})`
    )
  }

  return {checked: true, reason: null}
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'extjs-first-dev-'))
  const projectDir = join(root, 'my-extensionz')

  console.log(`Using temp root: ${root}`)
  console.log(`Creating with: npx -y ${pkg} create my-extensionz`)

  try {
    await runCollect('npx', ['-y', pkg, 'create', 'my-extensionz'], {cwd: root})

    console.log('Booting dev and validating first-run behavior...')
    const logs = await runDevAndValidate(projectDir)

    const prefsCheck = assertExtensionEnabledInPrefs(projectDir, logs)

    console.log('PASS: no reload regression pattern detected')
    if (prefsCheck.checked) {
      console.log('PASS: extension is enabled in browser profile preferences')
    } else {
      console.log(`WARN: profile-enabled check skipped (${prefsCheck.reason})`)
    }
    console.log(`Validated package: ${pkg}`)
  } finally {
    if (!keepTemp) {
      try {
        rmSync(root, {recursive: true, force: true})
      } catch (error) {
        // Best-effort cleanup only; do not mask validation result.
        console.warn(`Cleanup warning for ${root}: ${String(error)}`)
      }
    } else {
      console.log(`Temp directory preserved: ${root}`)
    }
  }
}

main().catch((error) => {
  console.error('FAIL: deterministic first-dev validation failed')
  console.error(String(error?.stack || error))
  process.exit(1)
})
