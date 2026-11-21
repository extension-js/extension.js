import {describe, expect, it} from 'vitest'
import {buildProject} from '../../__spec__/helpers/build-project'
import {cssProjects} from './helpers/css-project'

const makeProject = cssProjects()

const PROJECT = {
  'package.json': JSON.stringify({private: true, name: 'config-findings'}),
  'manifest.json': JSON.stringify({
    manifest_version: 3,
    name: 'config-findings',
    version: '1.0.0',
    action: {default_popup: 'popup.html'}
  }),
  'popup.html':
    '<!doctype html><link rel="stylesheet" href="./styles.css"><p>x</p>\n',
  'styles.css': '.a{color:red}\n'
}

// The warnings a build hands a machine reader: one line each, the code first.
async function warningsOf(files: Record<string, string>): Promise<string[]> {
  const root = makeProject({...PROJECT, ...files})
  const summary = (await buildProject(root, {
    mode: 'production',
    exitOnError: false
  })) as {errors_count: number; warnings?: string[]}

  expect(summary.errors_count).toBe(0)

  return (summary.warnings ?? []).map((warning) => warning.split('\n')[0])
}

// Each finding about the PostCSS setup belongs to the build that read it, so
// it carries a code and reaches the warnings of the JSON output, once.
describe('a PostCSS config finding in the warnings a build returns', () => {
  it.each([
    [
      'a config that throws',
      {'postcss.config.cjs': "throw new Error('boom in config')\n"},
      /^W_CSS_NOT_APPLIED: Could not load the PostCSS config at postcss\.config\.cjs\.$/
    ],
    [
      'a config whose plugins are neither a list nor a map',
      {'postcss.config.cjs': "module.exports = {plugins: 'autoprefixer'}\n"},
      /^W_CSS_NOT_APPLIED: The PostCSS config at postcss\.config\.cjs lists plugins as string\.$/
    ],
    [
      'a config under a name PostCSS does not read',
      {'postcss.config.json': '{"plugins": {}}\n'},
      /^W_CSS_NOT_APPLIED: PostCSS reads no config by this name, so the file was ignored\.$/
    ],
    [
      'a plugin the project does not have',
      {
        'postcss.config.cjs':
          "module.exports = {plugins: {'postcss-not-installed-here': {}}}\n"
      },
      /^W_CSS_NOT_APPLIED: Couldn't resolve the PostCSS plugin postcss-not-installed-here\.$/
    ]
  ])(
    '%s is one coded warning',
    async (_name, files, line) => {
      const warnings = await warningsOf(files)

      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toMatch(line)
    },
    120_000
  )

  it('a project with a sound config returns none', async () => {
    expect(
      await warningsOf({
        'postcss.config.cjs': 'module.exports = {plugins: []}\n'
      })
    ).toEqual([])
  }, 120_000)
})
