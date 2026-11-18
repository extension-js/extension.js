import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  build,
  expectNoWorkspaceAboveTemp,
  MARKER
} from '../../../plugin-special-folders/__spec__/helpers/private-files-project'

// Whole production builds: a manifest at the root or in src/ names, by exact
// path, a file two folders up, with or without a sheet that names it too.

const holders: string[] = []

beforeAll(expectNoWorkspaceAboveTemp)

afterAll(() => {
  for (const holder of holders) {
    fs.rmSync(holder, {recursive: true, force: true})
  }
})

const MATCHES = 'https://outside-project.example/*'

interface Layout {
  manifestIn: '' | 'src'
  sheet: boolean
  marker: boolean
}

function write(file: string, contents: string) {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, contents)
}

function fixture(layout: Layout) {
  const holder = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-war-outside-named-'))
  )
  holders.push(holder)

  const root = path.join(holder, 'project')
  const manifestDir = path.join(root, layout.manifestIn)
  const picture = path.join(holder, 'shared', 'outside-picture.png')
  const fromManifest = path
    .relative(manifestDir, picture)
    .split(path.sep)
    .join('/')
  const content = path.join(manifestDir, 'content')

  // Past the size a sheet inlines, so a url() to it emits a file.
  write(picture, `${MARKER}-picture\n${'x'.repeat(60 * 1024)}\n`)
  write(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'war-outside', version: '1.0.0'})
  )

  if (layout.marker) {
    write(path.join(holder, 'pnpm-workspace.yaml'), 'packages: []\n')
  }

  write(
    path.join(manifestDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'war-outside',
      version: '1.0.0',
      content_scripts: [
        {
          matches: [MATCHES],
          js: ['content/index.js'],
          ...(layout.sheet ? {css: ['content/style.css']} : {})
        }
      ],
      web_accessible_resources: [
        {resources: [fromManifest], matches: [MATCHES]}
      ]
    })
  )

  write(path.join(content, 'index.js'), 'console.log("content")\n')

  if (layout.sheet) {
    const fromSheet = path.relative(content, picture).split(path.sep).join('/')
    write(
      path.join(content, 'style.css'),
      `.shared{background:url('${fromSheet}')}\n`
    )
  }

  return {root, fromManifest}
}

function listed(root: string): string[] {
  const written = JSON.parse(
    fs.readFileSync(path.join(root, 'dist', 'chrome', 'manifest.json'), 'utf8')
  ) as {web_accessible_resources?: Array<{resources: string[]}>}

  return (written.web_accessible_resources || []).flatMap(
    (group) => group.resources
  )
}

const withoutHash = (name: string) =>
  name.replace(/\.[0-9a-f]{8}(?=\.|$)/, '.<hash>')

// A row: the output files that hold the picture, what the written manifest
// lists, and the entries the missing-resource warning names.
interface Row {
  marked: string[]
  listed: string[]
  reported: string[]
}

async function rowFor(layout: Layout): Promise<Row> {
  const {root} = fixture(layout)
  const result = await build(root)
  const reported = new Set<string>()

  for (const match of result.printed.matchAll(
    /Can't find the file (\S+) listed in web_accessible_resources\./g
  )) {
    reported.add(match[1])
  }

  expect(result.errors).toBe(0)

  return {
    marked: result.marked,
    listed: listed(root).map(withoutHash),
    reported: [...reported]
  }
}

const PICTURE = 'assets/outside-picture.<hash>.png'

// The entry alone: the file is refused and the raw entry stays listed.
const refused = (ref: string): Row => ({
  marked: [],
  listed: [ref],
  reported: [ref]
})

// A content script sheet names the same file through url(). The stylesheet
// copies it, and the manifest lists that copy, while the entry is refused.
const copiedBySheet = (ref: string): Row => ({
  marked: [PICTURE],
  listed: [PICTURE],
  reported: [ref]
})

// In a workspace the entry ships the file once, sheet or not.
const SHIPS_ONCE: Row = {marked: [PICTURE], listed: [PICTURE], reported: []}

const FROM_ROOT = '../shared/outside-picture.png'
const FROM_SRC = '../../shared/outside-picture.png'

const ROWS: Array<[string, Layout, Row]> = [
  [
    'at the root, alone',
    {manifestIn: '', sheet: false, marker: false},
    refused(FROM_ROOT)
  ],
  [
    'in src/, alone',
    {manifestIn: 'src', sheet: false, marker: false},
    refused(FROM_SRC)
  ],
  [
    'at the root, with a sheet',
    {manifestIn: '', sheet: true, marker: false},
    copiedBySheet(FROM_ROOT)
  ],
  [
    'in src/, with a sheet',
    {manifestIn: 'src', sheet: true, marker: false},
    copiedBySheet(FROM_SRC)
  ],
  [
    'at the root, alone, in a workspace',
    {manifestIn: '', sheet: false, marker: true},
    SHIPS_ONCE
  ],
  [
    'in src/, alone, in a workspace',
    {manifestIn: 'src', sheet: false, marker: true},
    SHIPS_ONCE
  ],
  [
    'at the root, with a sheet, in a workspace',
    {manifestIn: '', sheet: true, marker: true},
    SHIPS_ONCE
  ],
  [
    'in src/, with a sheet, in a workspace',
    {manifestIn: 'src', sheet: true, marker: true},
    SHIPS_ONCE
  ]
]

describe('a web_accessible_resources entry naming a file above the project', () => {
  it.each(ROWS)(
    'manifest %s',
    async (_name, layout, row) => {
      expect(await rowFor(layout)).toEqual(row)
    },
    120_000
  )
})
