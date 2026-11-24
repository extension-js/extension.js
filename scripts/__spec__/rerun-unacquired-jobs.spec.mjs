import assert from 'node:assert/strict'
import test from 'node:test'
import {readWorkflow} from '../lib/workflow-yaml.mjs'
import {MAX_ATTEMPTS, rerunDecision} from '../rerun-unacquired-jobs.mjs'

const ran = (name, conclusion = 'success') => ({
  name,
  conclusion,
  runner_name: 'GitHub Actions 1',
  steps: [{name: 'Set up job'}]
})
const unstarted = (name) => ({
  name,
  conclusion: 'cancelled',
  runner_name: '',
  steps: []
})
const failedRun = (attempt = 1) => ({
  conclusion: 'failure',
  run_attempt: attempt
})

// The shape of 4.4.0 run 45415640536 attempt 1.
const release440 = [
  ran('corpus-gate / safari'),
  unstarted('templates-gate / build-safari'),
  ran('templates-gate / CI passed', 'failure'),
  {name: 'publish', conclusion: 'skipped', runner_name: '', steps: []}
]

test('re-runs a release stopped only by a job no runner took', () => {
  const decision = rerunDecision(failedRun(), release440)
  assert.equal(decision.rerun, true)
  assert.match(decision.reason, /templates-gate \/ build-safari/)
})

test('leaves a run alone when a job that ran also failed', () => {
  const jobs = [...release440, ran('templates-gate / e2e-firefox', 'failure')]
  const decision = rerunDecision(failedRun(), jobs)
  assert.equal(decision.rerun, false)
  assert.match(decision.reason, /e2e-firefox/)
})

test('leaves a run canceled by hand alone', () => {
  const run = {conclusion: 'cancelled', run_attempt: 1}
  assert.equal(rerunDecision(run, release440).rerun, false)
})

test('stops after the last attempt', () => {
  assert.equal(rerunDecision(failedRun(MAX_ATTEMPTS), release440).rerun, false)
})

test('does nothing when every failed job ran', () => {
  const jobs = [ran('publish', 'failure')]
  assert.equal(rerunDecision(failedRun(), jobs).rerun, false)
})

test('the follower listens to the release workflow by its name', () => {
  const release = readWorkflow('publish-release.yml')
  const follower = readWorkflow('rerun-unacquired-jobs.yml')
  assert.deepEqual(follower.on.workflow_run.workflows, [release.name])
})
