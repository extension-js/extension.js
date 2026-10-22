import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import type {AddonLintLine} from '../addon-lint'
import {
  ADDON_REVIEWER_NOTE_FILE,
  addonReviewerNotePath,
  classifyAddonLintLines,
  lockfilePackageVersion,
  packageFacts,
  renderAddonReviewerNote,
  writeAddonReviewerNote
} from '../addon-reviewer-note'
import type {ChunkProvenance} from '../chunk-dependency-provenance'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-reviewer-note-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({name: 'note-me', version: '0.0.0', private: true})
  )

  return root
}

function installed(
  root: string,
  name: string,
  packageJson: Record<string, unknown>
) {
  const dir = path.join(root, 'node_modules', name)
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(packageJson))
}

function line(
  code: string,
  message: string,
  location: string,
  level: AddonLintLine['level'] = 'warning'
): AddonLintLine {
  return {level, code, message, location}
}

const PROVENANCE = new Map<string, ChunkProvenance>([
  [
    'shared/framework.js',
    {packages: ['react', 'react-dom', 'scheduler'], onlyDependencies: true}
  ],
  [
    'background/scripts.js',
    {packages: ['onnxruntime-web', 'tesseract.js'], onlyDependencies: false}
  ]
])

const LINES: AddonLintLine[] = [
  line(
    'UNSAFE_VAR_ASSIGNMENT',
    'Unsafe assignment to innerHTML',
    'shared/framework.js:2'
  ),
  line('DANGEROUS_EVAL', 'eval can be harmful.', 'background/scripts.js:102'),
  line(
    'UNSUPPORTED_API',
    'offscreen.createDocument is not supported',
    'background/scripts.js:29'
  ),
  line('DANGEROUS_EVAL', 'eval can be harmful.', 'options/scripts.js:7')
]

const FACTS = (name: string) => ({version: `1.0.0-${name}`, license: 'MIT'})

describe('reviewer note classification', () => {
  it('files a finding under every package its chunk bundles', () => {
    const note = classifyAddonLintLines(LINES, PROVENANCE, FACTS)
    expect(note.packages.map((pkg) => pkg.name)).toEqual([
      'onnxruntime-web',
      'react',
      'react-dom',
      'scheduler',
      'tesseract.js'
    ])

    const react = note.packages.find((pkg) => pkg.name === 'react')
    expect(react?.version).toBe('1.0.0-react')
    expect(react?.license).toBe('MIT')
    expect(react?.findings.map((f) => f.line.code)).toEqual([
      'UNSAFE_VAR_ASSIGNMENT'
    ])

    expect(react?.findings[0].mixed).toBe(false)
  })

  it('keeps an UNSUPPORTED_API finding out of the library list even in a mixed chunk', () => {
    const note = classifyAddonLintLines(LINES, PROVENANCE, FACTS)
    const onnx = note.packages.find((pkg) => pkg.name === 'onnxruntime-web')
    expect(onnx?.findings.map((f) => f.line.code)).toEqual(['DANGEROUS_EVAL'])
    expect(onnx?.findings[0].mixed).toBe(true)
    expect(note.own.map((own) => `${own.code} ${own.location}`)).toEqual([
      'UNSUPPORTED_API background/scripts.js:29',
      'DANGEROUS_EVAL options/scripts.js:7'
    ])
  })

  it('calls every finding the author own when the build passed no provenance', () => {
    const note = classifyAddonLintLines(LINES, undefined, FACTS)
    expect(note.packages).toEqual([])
    expect(note.own).toHaveLength(LINES.length)
  })
})

describe('reviewer note rendering', () => {
  it('writes one block per package and a separate author list', () => {
    const text = renderAddonReviewerNote(
      classifyAddonLintLines(LINES, PROVENANCE, FACTS),
      'dist/firefox'
    )

    expect(text).toContain('# Notes to reviewer')
    expect(text).toContain('## Bundled libraries')
    expect(text).toContain('### react 1.0.0-react')
    expect(text).toContain(
      'react 1.0.0-react (MIT) is unmodified from npm. It accounts for:'
    )

    expect(text).toContain(
      '- UNSAFE_VAR_ASSIGNMENT: Unsafe assignment to innerHTML (shared/framework.js:2)'
    )

    expect(text).toContain(
      '- DANGEROUS_EVAL: eval can be harmful. (background/scripts.js:102) (this file also carries the extension author code, confirm before pasting)'
    )

    expect(text).toContain('## Findings in the extension author code')
    expect(text).toContain('must not be presented as such')

    const [libraries, own] = text.split(
      '## Findings in the extension author code'
    )
    expect(libraries).not.toContain('UNSUPPORTED_API')
    expect(own).toContain(
      '- UNSUPPORTED_API: offscreen.createDocument is not supported (background/scripts.js:29)'
    )

    expect(own).toContain(
      '- DANGEROUS_EVAL: eval can be harmful. (options/scripts.js:7)'
    )

    expect(text).not.toContain('\u2014')
  })

  it('says when a version or license could not be read', () => {
    const text = renderAddonReviewerNote(
      classifyAddonLintLines(LINES.slice(0, 1), PROVENANCE, () => ({
        version: null,
        license: null
      })),
      'dist/firefox'
    )

    expect(text).toContain('version not found in node_modules or a lockfile')
    expect(text).toContain('license not found in its package.json')
  })

  it('says so when nothing is the author own', () => {
    const text = renderAddonReviewerNote(
      classifyAddonLintLines(LINES.slice(0, 1), PROVENANCE, FACTS),
      'dist/firefox'
    )

    expect(text).toMatch(/must not be presented as such\.\n\nNone\.\n/)
  })
})

describe('package facts', () => {
  it('reads version and license from the installed package.json', () => {
    const root = project()
    installed(root, 'react', {
      name: 'react',
      version: '18.3.1',
      license: {type: 'MIT'}
    })

    expect(packageFacts(root, 'react')).toEqual({
      version: '18.3.1',
      license: 'MIT'
    })
  })

  it('walks up to a hoisted node_modules for a scoped package', () => {
    const root = project()
    const member = path.join(root, 'packages', 'app')
    fs.mkdirSync(member, {recursive: true})
    installed(root, '@scope/lib', {
      name: '@scope/lib',
      version: '2.0.0',
      licenses: [{type: 'Apache-2.0'}]
    })

    expect(packageFacts(member, '@scope/lib')).toEqual({
      version: '2.0.0',
      license: 'Apache-2.0'
    })
  })

  it('falls back to the lockfile version when the package is not installed', () => {
    const npm = project()
    fs.writeFileSync(
      path.join(npm, 'package-lock.json'),
      JSON.stringify({
        packages: {
          '': {},
          'node_modules/tesseract.js': {version: '5.1.1'}
        }
      })
    )

    const pnpm = project()
    fs.writeFileSync(
      path.join(pnpm, 'pnpm-lock.yaml'),
      [
        "lockfileVersion: '9.0'",
        'packages:',
        '',
        '  onnxruntime-web@1.17.3:',
        '    resolution: {integrity: sha512-x}',
        '',
        "  'tesseract.js@5.1.1':",
        '    resolution: {integrity: sha512-y}',
        ''
      ].join('\n')
    )

    const yarn = project()
    fs.writeFileSync(
      path.join(yarn, 'yarn.lock'),
      [
        '# yarn lockfile v1',
        '',
        'pdfjs-dist@^4.0.0:',
        '  version "4.4.168"',
        '  resolved "https://registry.yarnpkg.com/pdfjs-dist/-/pdfjs-dist-4.4.168.tgz"',
        ''
      ].join('\n')
    )

    expect(lockfilePackageVersion(npm, 'tesseract.js')).toBe('5.1.1')
    expect(lockfilePackageVersion(pnpm, 'onnxruntime-web')).toBe('1.17.3')
    expect(lockfilePackageVersion(pnpm, 'tesseract.js')).toBe('5.1.1')
    expect(lockfilePackageVersion(yarn, 'pdfjs-dist')).toBe('4.4.168')
    expect(packageFacts(npm, 'tesseract.js')).toEqual({
      version: '5.1.1',
      license: null
    })

    expect(packageFacts(npm, 'never-heard-of-it')).toEqual({
      version: null,
      license: null
    })
  })
})

describe('writing the note', () => {
  it('lands next to the browser folder, never inside the shipped package', () => {
    const root = project()
    const distPath = path.join(root, 'dist', 'firefox')
    fs.mkdirSync(distPath, {recursive: true})

    const written = writeAddonReviewerNote({
      projectPath: root,
      distPath,
      distDisplay: 'dist/firefox',
      lines: LINES,
      chunkProvenance: PROVENANCE
    })

    expect(written).toBe(path.join(root, 'dist', ADDON_REVIEWER_NOTE_FILE))
    expect(written).toBe(addonReviewerNotePath(distPath))
    expect(fs.readdirSync(distPath)).not.toContain(ADDON_REVIEWER_NOTE_FILE)
    expect(fs.readFileSync(written as string, 'utf8')).toContain(
      '### onnxruntime-web'
    )
  })

  it('removes a stale note when a later build has nothing to report', () => {
    const root = project()
    const distPath = path.join(root, 'dist', 'firefox')
    const target = addonReviewerNotePath(distPath)
    fs.mkdirSync(distPath, {recursive: true})
    fs.writeFileSync(target, 'old')

    expect(
      writeAddonReviewerNote({
        projectPath: root,
        distPath,
        distDisplay: 'dist/firefox',
        lines: []
      })
    ).toBe(null)

    expect(fs.existsSync(target)).toBe(false)
  })
})
