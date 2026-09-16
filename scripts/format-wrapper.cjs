// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

const path = require('node:path')
const {spawnSync} = require('node:child_process')

const nodeDir = path.dirname(process.execPath)
const existingPath = process.env.PATH || process.env.Path || ''
const childEnv = {
  ...process.env,
  PATH: `${nodeDir}${path.delimiter}${existingPath}`
}

const repoRoot = path.resolve(__dirname, '..')
const biomeBin = require.resolve('@biomejs/biome/bin/biome')
const result = spawnSync(
  process.execPath,
  [biomeBin, 'format', '--write', '.'],
  {
    stdio: 'inherit',
    env: childEnv,
    cwd: repoRoot
  }
)

// Biome wraps a line that crosses the print width, which turns it into a
// multiline expression that `local/padding-line-between-statements` then wants
// a blank line after. Only eslint can add it, so it has to run on Biome's
// output rather than before it, or `pnpm format` leaves the tree lint-dirty.
function runEslintFix() {
  let eslintBin

  try {
    // eslint's `exports` map does not expose its bin, so the path has to come
    // from the manifest rather than from resolving the bin directly.
    const manifestPath = require.resolve('eslint/package.json')
    const declaredBin = require(manifestPath).bin

    eslintBin = path.join(
      path.dirname(manifestPath),
      typeof declaredBin === 'string' ? declaredBin : declaredBin.eslint
    )
  } catch (error) {
    console.error(
      `[Extension.js] Format: could not locate eslint (${error.message}). ` +
        'The tree may be formatted but not lint-clean.'
    )

    return 1
  }

  const eslint = spawnSync(process.execPath, [eslintBin, '.', '--fix'], {
    stdio: 'inherit',
    env: childEnv,
    cwd: repoRoot
  })

  return eslint.status ?? (eslint.signal ? 1 : 0)
}

// Windows ERROR_DLL_NOT_FOUND when Node/native binary can't load (e.g. Windows Node in WSL)
const DLL_NOT_FOUND = 3221225781

if (result.status === DLL_NOT_FOUND) {
  console.warn(
    '[Extension.js] Format skipped: Biome could not load (e.g. missing runtime). Run format on macOS/Linux or install Visual C++ Redistributable on Windows.'
  )

  process.exitCode = 0
} else if (result.status !== 0) {
  process.exitCode = result.status ?? (result.signal ? 1 : 0)
} else {
  // eslint exits non-zero on any remaining error it could not fix, which is a
  // real result for `pnpm format` rather than a reason to hide it.
  process.exitCode = runEslintFix()
}
