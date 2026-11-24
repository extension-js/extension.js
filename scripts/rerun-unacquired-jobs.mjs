#!/usr/bin/env node

import {spawnSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'

export const MAX_ATTEMPTS = 3

// GitHub can cancel a hosted job it never gave a machine (macOS capacity).
// Such a job has no runner and no steps.
export function neverStarted(job) {
  return (
    ['cancelled', 'failure'].includes(job.conclusion) &&
    !job.runner_name &&
    (job.steps || []).length === 0
  )
}

// Re-run only when the run failed (a run canceled by hand is left alone),
// attempts remain, and every failed job either never started or is a
// "CI passed" roll-up that failed because one of those did.
export function rerunDecision(run, jobs) {
  if (run.conclusion !== 'failure') {
    return {rerun: false, reason: 'run did not fail'}
  }

  if (run.run_attempt >= MAX_ATTEMPTS) {
    return {rerun: false, reason: `attempt ${run.run_attempt} is the last`}
  }

  const failed = jobs.filter((j) =>
    ['cancelled', 'failure', 'timed_out'].includes(j.conclusion)
  )
  const unstarted = failed.filter(neverStarted)

  if (unstarted.length === 0) {
    return {rerun: false, reason: 'every failed job ran'}
  }

  const real = failed.filter(
    (j) => !neverStarted(j) && !/(^|\/ )CI passed$/.test(j.name)
  )

  if (real.length > 0) {
    return {
      rerun: false,
      reason: `jobs that ran also failed: ${real.map((j) => j.name).join(', ')}`
    }
  }

  return {
    rerun: true,
    reason: `no runner took: ${unstarted.map((j) => j.name).join(', ')}`
  }
}

function gh(args) {
  const result = spawnSync('gh', args, {encoding: 'utf8'})
  if (result.status !== 0) throw new Error(result.stderr.trim())

  return result.stdout
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY
  const id = process.env.RUN_ID
  const run = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${id}`]))
  const jobs = JSON.parse(
    gh([
      'api',
      '--paginate',
      '--slurp',
      `repos/${repo}/actions/runs/${id}/attempts/${run.run_attempt}/jobs?per_page=100`
    ])
  ).flatMap((page) => page.jobs)

  const decision = rerunDecision(run, jobs)
  console.log(`Run ${id} attempt ${run.run_attempt}: ${decision.reason}`)

  if (decision.rerun) {
    gh(['run', 'rerun', String(id), '--failed', '--repo', repo])
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main()
