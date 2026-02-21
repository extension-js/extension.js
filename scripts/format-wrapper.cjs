/**
 * Runs biome format with the same Node as the current process on PATH,
 * so child processes use a consistent Node (cross-platform fix for Windows/WSL).
 * If format fails with the known "DLL not found" exit code, warn and exit 0
 * so the install+format+compile pipeline can succeed.
 */
const path = require('path')
const { spawnSync } = require('child_process')

const nodeDir = path.dirname(process.execPath)
const existingPath = process.env.PATH || process.env.Path || ''
const childEnv = {
  ...process.env,
  PATH: `${nodeDir}${path.delimiter}${existingPath}`
}

const biomeBin = require.resolve('@biomejs/biome/bin/biome')
const result = spawnSync(process.execPath, [biomeBin, 'format', '--write', '.'], {
  stdio: 'inherit',
  env: childEnv,
  cwd: path.resolve(__dirname, '..')
})

// Windows ERROR_DLL_NOT_FOUND when Node/native binary can't load (e.g. Windows Node in WSL)
const DLL_NOT_FOUND = 3221225781
if (result.status === DLL_NOT_FOUND) {
  console.warn(
    '[Extension.js] Format skipped: Biome could not load (e.g. missing runtime). Run format on macOS/Linux or install Visual C++ Redistributable on Windows.'
  )
  process.exitCode = 0
} else {
  process.exitCode = result.status ?? (result.signal ? 1 : 0)
}
