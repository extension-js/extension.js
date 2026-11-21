import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import yaml from 'js-yaml'

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
)

const GLOB_CHARACTERS = ['*', '?', '{', '}', '[', ']']

// The part of an entry that names a real place: all of a literal path, or the
// folders a glob starts from. `**/dist` names none.
/** @param {string} entry */
export function namedPlace(entry) {
  let rest = entry.trim()

  if (rest.startsWith('!')) rest = rest.slice(1)

  while (rest.startsWith('./')) rest = rest.slice(2)

  const kept = []

  for (const segment of rest.split('/')) {
    if (GLOB_CHARACTERS.some((character) => segment.includes(character))) break
    if (segment) kept.push(segment)
  }

  return kept.join('/')
}

/**
 * @param {string} root
 * @returns {Set<string>}
 */
export function trackedPlaces(root = repoRoot) {
  const files = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
    .split('\0')
    .filter(Boolean)
  const places = new Set(files)

  for (const file of files) {
    let dir = path.posix.dirname(file)

    while (dir !== '.' && !places.has(dir)) {
      places.add(dir)
      dir = path.posix.dirname(dir)
    }
  }

  return places
}

// A local artifact (a build folder, a generated file) is in no clean tree and
// a config may still name it. A folder rule answers for a path inside it.
/**
 * @param {string} place
 * @param {string} root
 */
export function gitIgnores(place, root = repoRoot) {
  return [place, `${place}/inside`].some((candidate) => {
    try {
      execFileSync('git', ['check-ignore', '-q', '--no-index', candidate], {
        cwd: root,
        stdio: 'ignore'
      })

      return true
    } catch {
      return false
    }
  })
}

/**
 * @typedef {object} NamedEntry
 * @property {string} from
 * @property {string} entry
 * @property {string} [base]
 */

// An entry names a tracked place or a local artifact the ignore rules know.
// Anything else points at a file that moved or is gone.
/**
 * @param {NamedEntry[]} entries
 * @param {Set<string>} tracked
 * @param {(place: string) => boolean} ignored
 * @returns {string[]}
 */
export function entriesNamingNothing(entries, tracked, ignored) {
  const dead = []

  for (const {from, entry, base = ''} of entries) {
    const named = namedPlace(entry)

    if (!named) continue

    const place = path.posix.normalize(path.posix.join(base, named))

    if (place === '.' || place.startsWith('..')) continue
    if (tracked.has(place)) continue
    if (ignored(place)) continue

    dead.push(`${from}: ${entry}`)
  }

  return dead
}

// tsconfig files carry line comments and trailing commas that JSON refuses.
/** @param {string} text */
export function parseJsonWithComments(text) {
  let out = ''
  let inString = false

  for (let index = 0; index < text.length; index++) {
    const character = text[index]

    if (inString) {
      out += character

      if (character === '\\') out += text[++index]
      else if (character === '"') inString = false
    } else if (character === '"') {
      inString = true
      out += character
    } else if (character === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index++

      out += '\n'
    } else {
      out += character
    }
  }

  let cleaned = ''

  for (let index = 0; index < out.length; index++) {
    if (out[index] === ',') {
      let next = index + 1

      while (next < out.length && out[next].trim() === '') next++

      if (out[next] === ']' || out[next] === '}') continue
    }

    cleaned += out[index]
  }

  return JSON.parse(cleaned)
}

/** @param {unknown} value */
function strings(value) {
  return Array.isArray(value)
    ? value.flat().filter((entry) => typeof entry === 'string')
    : []
}

/**
 * @param {string} root
 * @returns {Promise<NamedEntry[]>}
 */
export async function lintConfigEntries(root = repoRoot) {
  const loaded = await import(
    pathToFileURL(path.join(root, 'eslint.config.mjs')).href
  )
  /** @type {NamedEntry[]} */
  const entries = []

  for (const block of loaded.default) {
    for (const entry of strings(block.files)) {
      entries.push({from: 'eslint.config.mjs files', entry})
    }

    for (const entry of strings(block.ignores)) {
      entries.push({from: 'eslint.config.mjs ignores', entry})
    }
  }

  return entries
}

/**
 * @param {string} root
 * @returns {NamedEntry[]}
 */
export function biomeConfigEntries(root = repoRoot) {
  const config = JSON.parse(
    fs.readFileSync(path.join(root, 'biome.json'), 'utf8')
  )
  /** @type {NamedEntry[]} */
  const entries = []

  for (const entry of strings(config.files?.includes)) {
    entries.push({from: 'biome.json files.includes', entry})
  }

  for (const override of config.overrides || []) {
    for (const entry of strings(override.includes)) {
      entries.push({from: 'biome.json overrides', entry})
    }
  }

  return entries
}

/**
 * @param {string[]} files
 * @param {string} root
 * @returns {NamedEntry[]}
 */
export function typeConfigEntries(files, root = repoRoot) {
  /** @type {NamedEntry[]} */
  const entries = []

  for (const file of files) {
    const config = parseJsonWithComments(
      fs.readFileSync(path.join(root, file), 'utf8')
    )
    const base = path.posix.dirname(file)

    for (const key of ['include', 'files']) {
      for (const entry of strings(config[key])) {
        entries.push({from: `${file} ${key}`, entry, base})
      }
    }

    for (const entry of strings(config.exclude)) {
      entries.push({from: `${file} exclude`, entry, base})
    }
  }

  return entries
}

// A path filter that names a moved file stops starting its workflow, and
// nothing reports a workflow that did not run.
/**
 * @param {string} root
 * @returns {NamedEntry[]}
 */
export function workflowPathEntries(root = repoRoot) {
  const dir = path.join(root, '.github', 'workflows')
  /** @type {NamedEntry[]} */
  const entries = []

  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue

    /** @type {any} */
    const workflow = yaml.load(fs.readFileSync(path.join(dir, name), 'utf8'))
    const triggers = workflow?.on

    if (!triggers || typeof triggers !== 'object') continue

    for (const trigger of Object.values(triggers)) {
      if (!trigger || typeof trigger !== 'object') continue

      for (const key of ['paths', 'paths-ignore']) {
        for (const entry of strings(/** @type {any} */ (trigger)[key])) {
          entries.push({from: `.github/workflows/${name} ${key}`, entry})
        }
      }
    }
  }

  return entries
}

/**
 * @param {string} file
 * @param {string} root
 * @returns {Promise<Record<string, any>>}
 */
async function specRunnerConfig(file, root) {
  const loaded = await import(pathToFileURL(path.join(root, file)).href)
  const config =
    typeof loaded.default === 'function'
      ? await loaded.default({mode: 'test', command: 'serve'})
      : loaded.default

  return config.test || {}
}

// A setup file that moved fails the run. An include that names a moved folder
// does not: the specs under it stop running and the run stays green.
/**
 * @param {string[]} files
 * @param {string} root
 * @returns {Promise<NamedEntry[]>}
 */
export async function specRunnerEntries(files, root = repoRoot) {
  /** @type {NamedEntry[]} */
  const entries = []

  for (const file of files) {
    const options = await specRunnerConfig(file, root)
    const base = path.posix.dirname(file)

    for (const key of ['include', 'exclude', 'setupFiles', 'globalSetup']) {
      for (const entry of strings(options[key])) {
        entries.push({from: `${file} ${key}`, entry, base})
      }
    }
  }

  return entries
}

/**
 * @param {string} name
 * @param {string} pattern
 */
function segmentMatches(name, pattern) {
  const parts = pattern.split('*')

  if (parts.length === 1) return name === pattern
  if (!name.startsWith(parts[0])) return false

  let at = parts[0].length

  for (const part of parts.slice(1, -1)) {
    const found = name.indexOf(part, at)

    if (found < 0) return false

    at = found + part.length
  }

  const last = parts[parts.length - 1]

  return name.length - at >= last.length && name.endsWith(last)
}

/**
 * @param {string[]} names
 * @param {string[]} patterns
 * @returns {boolean}
 */
function segmentsMatch(names, patterns) {
  if (patterns.length === 0) return names.length === 0

  const [pattern, ...rest] = patterns

  if (pattern === '**') {
    for (let skipped = 0; skipped <= names.length; skipped++) {
      if (segmentsMatch(names.slice(skipped), rest)) return true
    }

    return false
  }

  return (
    names.length > 0 &&
    segmentMatches(names[0], pattern) &&
    segmentsMatch(names.slice(1), rest)
  )
}

// The glob forms the spec runners use: `**` for any folders and `*` inside a
// name. Any other form is refused so a pattern is never half understood.
/**
 * @param {string} file
 * @param {string} pattern
 */
export function matchesGlob(file, pattern) {
  let rest = pattern

  while (rest.startsWith('./')) rest = rest.slice(2)

  if (['?', '{', '}', '[', ']', '!'].some((sign) => rest.includes(sign))) {
    throw new Error(`glob form not read by this guard: ${pattern}`)
  }

  return segmentsMatch(file.split('/'), rest.split('/'))
}

// A spec file no include reaches never runs, and no run says so.
/**
 * @param {string[]} files
 * @param {Set<string>} tracked
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function specsNoRunnerReaches(files, tracked, root = repoRoot) {
  const unreached = []

  for (const file of files) {
    const options = await specRunnerConfig(file, root)
    const base = path.posix.dirname(file)
    const includes = strings(options.include)

    for (const place of tracked) {
      if (!place.startsWith(`${base}/`)) continue
      if (!/\.spec\.[cm]?[jt]sx?$/.test(place)) continue
      if (place.includes('/templates/')) continue

      const inside = place.slice(base.length + 1)

      if (!includes.some((pattern) => matchesGlob(inside, pattern))) {
        unreached.push(place)
      }
    }
  }

  return unreached.sort()
}

/**
 * @param {string} root
 * @returns {NamedEntry[]}
 */
export function workspaceEntries(root = repoRoot) {
  /** @type {any} */
  const workspace = yaml.load(
    fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')
  )

  return strings(workspace?.packages).map((entry) => ({
    from: 'pnpm-workspace.yaml packages',
    entry
  }))
}
