// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

const toPosix = (value) => value.split(path.sep).join('/')

// The root typecheck reads workspace packages from source, so the declarations
// a build emits are read by nothing until a consumer installs the package.
export function listPublishedPackages(root = repoRoot) {
  const programsDir = path.join(root, 'programs')

  return fs
    .readdirSync(programsDir)
    .sort()
    .map((entry) => path.join(programsDir, entry))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
    .map((dir) => ({
      dir,
      manifest: JSON.parse(
        fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
      )
    }))
    .filter(({manifest}) => manifest.private !== true && manifest.name)
}

// One entry per export that names a declaration file. A pattern export has no
// single file to import, and an export without types is not a typed entry.
export function typedEntries(manifest) {
  const entries = []
  const exportsField = manifest.exports

  if (exportsField && typeof exportsField === 'object') {
    for (const [subpath, target] of Object.entries(exportsField)) {
      if (subpath.includes('*')) continue
      if (!target || typeof target !== 'object') continue
      if (typeof target.types !== 'string') continue

      entries.push({
        specifier: path.posix.join(manifest.name, subpath),
        types: target.types
      })
    }
  }

  if (entries.length === 0 && typeof manifest.types === 'string') {
    entries.push({specifier: manifest.name, types: manifest.types})
  }

  return entries
}

export function consumerSource(specifiers) {
  return `${specifiers.map((specifier) => `import '${specifier}'`).join('\n')}\n\nexport {}\n`
}

// Entries that declare the same global in two ways. The generated
// extension-env.d.ts names one of them, so no project loads both.
export const exclusiveEntries = [['extension/types', 'extension/types/legacy']]

// Each entry alone shows what it borrows from a sibling. The joint programs
// show two entries that clash, with one member of an exclusive group each.
export function consumerPrograms(specifiers, exclusive = exclusiveEntries) {
  const programs = specifiers.map((specifier) => [specifier])
  const groups = exclusive
    .map((group) => group.filter((member) => specifiers.includes(member)))
    .filter((group) => group.length > 1)

  /** @type {string[][]} */
  let choices = [[]]

  for (const group of groups) {
    choices = choices.flatMap((chosen) =>
      group.map((member) => [...chosen, member])
    )
  }

  const grouped = new Set(groups.flat())

  for (const chosen of choices) {
    const joint = specifiers.filter(
      (specifier) => !grouped.has(specifier) || chosen.includes(specifier)
    )

    if (joint.length > 1) programs.push(joint)
  }

  return programs
}

// No source paths here, so each import resolves the way an installed copy
// does: through the types target of the export.
export function consumerTsconfig(file = 'consumer.ts') {
  return {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2023', 'DOM'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      noEmit: true,
      strict: true,
      skipLibCheck: false,
      noUncheckedSideEffectImports: true,
      types: ['node']
    },
    files: [file]
  }
}

// tsc prints "file(line,col): error TS1234: text" with pretty output off.
export function parseDiagnostics(output, cwd) {
  const diagnostics = []

  for (const line of output.split(/\r?\n/)) {
    const match = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line)

    if (match) {
      diagnostics.push({
        file: path.resolve(cwd, match[1]),
        line: Number(match[2]),
        code: match[4],
        message: match[5]
      })

      continue
    }

    const global = /^error (TS\d+): (.*)$/.exec(line)

    if (global) {
      diagnostics.push({
        file: null,
        line: 0,
        code: global[1],
        message: global[2]
      })
    }
  }

  return diagnostics
}

function isInside(file, dir) {
  const relative = path.relative(dir, file)

  return (
    relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  )
}

// A declaration of ours is one a package ships. An error inside a dependency's
// own types is that dependency's to fix and would fail every consumer alike.
export function ownedDiagnostics(diagnostics, packageDirs, workDir) {
  return diagnostics.filter((diagnostic) => {
    if (diagnostic.file === null) return true
    if (isInside(diagnostic.file, workDir)) return true

    return packageDirs.some(
      (dir) =>
        isInside(diagnostic.file, dir) &&
        !toPosix(path.relative(dir, diagnostic.file))
          .split('/')
          .includes('node_modules')
    )
  })
}

function linkPackage(workDir, name, target) {
  const link = path.join(workDir, 'node_modules', ...name.split('/'))

  fs.mkdirSync(path.dirname(link), {recursive: true})
  // A junction needs no privilege on Windows, and it is ignored elsewhere.
  fs.symlinkSync(target, link, 'junction')
}

function resolveTsc(root) {
  const entry = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')

  if (!fs.existsSync(entry)) {
    throw new Error(`TypeScript is not installed at ${entry}.`)
  }

  return entry
}

export function checkEmittedTypes(options = {}) {
  const root = options.root ?? repoRoot
  const packages = options.packages ?? listPublishedPackages(root)
  const cacheDir = path.join(root, 'node_modules', '.cache')

  fs.mkdirSync(cacheDir, {recursive: true})

  const workDir = fs.realpathSync(
    fs.mkdtempSync(path.join(cacheDir, 'check-emitted-types-'))
  )
  const problems = []
  const specifiers = []

  try {
    for (const {dir, manifest} of packages) {
      const entries = typedEntries(manifest)

      if (entries.length === 0) {
        problems.push(`${manifest.name}: no export names a types file.`)
        continue
      }

      for (const entry of entries) {
        if (!fs.existsSync(path.join(dir, entry.types))) {
          problems.push(
            `${entry.specifier}: ${entry.types} does not exist. Compile the package first.`
          )

          continue
        }

        specifiers.push(entry.specifier)
      }

      linkPackage(workDir, manifest.name, dir)
    }

    const packageDirs = packages.map(({dir}) => fs.realpathSync(dir))
    const programs = consumerPrograms(specifiers, options.exclusive)
    const seen = new Set(problems)
    const foreign = new Set()
    const tsc = options.tsc ?? resolveTsc(root)

    for (const [index, program] of programs.entries()) {
      const consumer = `consumer-${index}.ts`
      const tsconfig = path.join(workDir, `tsconfig-${index}.json`)

      fs.writeFileSync(path.join(workDir, consumer), consumerSource(program))

      fs.writeFileSync(
        tsconfig,
        `${JSON.stringify(consumerTsconfig(consumer), null, 2)}\n`
      )

      const run = spawnSync(
        process.execPath,
        [tsc, '-p', tsconfig, '--pretty', 'false'],
        {cwd: workDir, encoding: 'utf8'}
      )

      if (run.error) throw run.error

      const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
      const diagnostics = parseDiagnostics(output, workDir)
      const owned = ownedDiagnostics(diagnostics, packageDirs, workDir)

      for (const diagnostic of diagnostics) {
        if (owned.includes(diagnostic)) continue

        foreign.add(
          `${diagnostic.file}:${diagnostic.line}: ${diagnostic.code} ${diagnostic.message}`
        )
      }

      for (const diagnostic of owned) {
        // An error in the consumer file belongs to the entries it imports.
        const where =
          diagnostic.file === null
            ? 'tsc'
            : path.basename(diagnostic.file) === consumer
              ? `consumer of ${program.join(', ')}`
              : `${toPosix(path.relative(root, diagnostic.file))}:${diagnostic.line}`
        const problem = `${where}: ${diagnostic.code} ${diagnostic.message}`

        if (seen.has(problem)) continue

        seen.add(problem)
        problems.push(problem)
      }

      // A failed run that names no file of ours still has to be read by someone.
      if (run.status !== 0 && diagnostics.length === 0) {
        problems.push(`tsc exited ${run.status}: ${output.trim()}`)
      }
    }

    return {
      ok: problems.length === 0,
      problems,
      specifiers,
      programs,
      foreign: foreign.size
    }
  } finally {
    fs.rmSync(workDir, {recursive: true, force: true})
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (invokedDirectly) {
  const result = checkEmittedTypes()

  if (!result.ok) {
    console.error('The emitted declarations do not type-check for a consumer:')

    for (const problem of result.problems) console.error(`  ${problem}`)

    process.exit(1)
  }

  console.log(
    `Emitted declarations are sound for ${result.specifiers.length} typed entries, each alone and together in ${result.programs.length} programs: ${result.specifiers.join(', ')}.`
  )

  if (result.foreign > 0) {
    console.log(
      `Skipped ${result.foreign} errors inside the declarations of dependencies.`
    )
  }
}
