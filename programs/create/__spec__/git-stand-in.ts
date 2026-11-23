import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const WINDOWS = process.platform === 'win32'
const SOURCE = path.join(__dirname, 'git-stand-in.cs')

// Answers every setup step at once and does on the pull what the row asks
// through EXTJS_STAND_IN_PULL: hang, fill the folder, or fail.
function shellScript(pidFile: string): string {
  return [
    '#!/bin/sh',
    'case "$1" in',
    '  --version) echo "git version 2.99.0" ;;',
    '  pull)',
    '    case "$EXTJS_STAND_IN_PULL" in',
    `      hang) echo $$ > "${pidFile}"; exec sleep 30 ;;`,
    `      fill) echo '{"name":"cloned"}' > manifest.json ;;`,
    '      *) echo "fatal: couldn\'t find remote ref" >&2; exit 1 ;;',
    '    esac ;;',
    'esac',
    'exit 0',
    ''
  ].join('\n')
}

let compiled: string | undefined

// The compiler ships with Windows, so no binary is committed or downloaded.
// It writes only the target it is given, inside the folder the spec made.
function compileOrCopy(target: string) {
  if (compiled && fs.existsSync(compiled)) {
    fs.copyFileSync(compiled, target)

    return
  }

  const windows = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  const compiler = ['Framework64', 'Framework']
    .map((folder) =>
      path.join(windows, 'Microsoft.NET', folder, 'v4.0.30319', 'csc.exe')
    )
    .find((file) => fs.existsSync(file))

  if (!compiler) {
    throw new Error(
      `No csc.exe under ${windows}\\Microsoft.NET, so the git stand-in cannot be built.`
    )
  }

  const args = ['/nologo', '/optimize+', `/out:${target}`, SOURCE]
  const built = spawnSync(compiler, args, {encoding: 'utf8', windowsHide: true})

  if (built.error || built.status !== 0 || !fs.existsSync(target)) {
    // Printed as well as thrown: a job cut short prints no failure summary.
    const report = [
      'The git stand-in did not compile.',
      `COMMAND ${compiler} ${args.join(' ')}`,
      `EXIT ${built.status} ${built.error?.message ?? ''}`.trim(),
      `STDOUT ${built.stdout}`,
      `STDERR ${built.stderr}`
    ].join('\n')

    console.error(report)

    throw new Error(report)
  }

  compiled = target
}

// Plants a program named git in a folder the spec made, to be put first on
// PATH. A hanging pull writes its pid to pidFile. No real git is involved.
export function plantGitStandIn(binDir: string, pidFile: string): string {
  fs.mkdirSync(binDir, {recursive: true})

  if (WINDOWS) {
    // go-git-it starts git with no shell, which only a real program answers.
    const git = path.join(binDir, 'git.exe')
    compileOrCopy(git)
    fs.writeFileSync(
      `${git}.conf`,
      `pidFile=${pidFile}\nfillInside=${path.basename(os.tmpdir())}\n`
    )

    return git
  }

  const git = path.join(binDir, 'git')
  fs.writeFileSync(git, shellScript(pidFile))
  fs.chmodSync(git, 0o755)

  return git
}
