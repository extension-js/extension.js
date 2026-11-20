import {beforeEach, expect} from 'vitest'

process.env.FORCE_COLOR = '0'
process.env.NO_COLOR = '1'

// Same contract for verbosity: author-mode envs add debug lines that break
// exact-output assertions. Specs that test debug behavior set these
// themselves per-test; the suite baseline is the default tier.
Reflect.deleteProperty(process.env, 'EXTENSION_AUTHOR_MODE')
Reflect.deleteProperty(process.env, 'EXTENSION_DEBUG')

// Six command specs run the real command in-process and posted to PostHog on
// every local run; CI escaped it only through the CI gate inside the decision.
// The soft form, so a spec that drives a child with telemetry ON still can.
process.env.EXTENSION_TELEMETRY = '0'

// No spec may be asked to download a browser, on a terminal or off one. A
// child that copies this process's variables takes the same answer.
process.env.EXTENSION_NO_INSTALL_PROMPT = '1'

// The guard below covers this process only, and a CLI child may ask a
// registry for updates. Its check reads this name first, npm does not.
process.env.npm_registry = 'http://127.0.0.1:9/'

// This suite is a required gate too, so it takes create's loopback-only rule.
// The catalog drift cases are the only specs here that leave loopback and they
// run under their own flag.
if (!process.env.EXTENSION_TEMPLATE_CATALOG_LIVE) {
  await import('../../../create/__spec__/forbid-network')
}

// A test that asserts nothing passes whatever the CLI does. The launcher specs
// under browsers/ are not held to it yet, and cli-exec installs from a registry.
const MUST_ASSERT =
  /[/\\]programs[/\\]extension[/\\](?:__spec__[/\\](?!exec[/\\]cli-exec\.)|helpers[/\\]|commands[/\\])/

beforeEach(() => {
  if (MUST_ASSERT.test(expect.getState().testPath ?? '')) {
    expect.hasAssertions()
  }
})
