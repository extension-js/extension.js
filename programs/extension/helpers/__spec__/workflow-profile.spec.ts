import {collectWorkflowProfile} from '../workflow-profile'

it('classifies local-only workflows when no shipping or automation signals exist', () => {
  expect(
    collectWorkflowProfile({
      command: 'create'
    })
  ).toEqual({
    workflow_cohort: 'local_only',
    has_shipping_intent: false,
    has_automation_intent: false,
    shipping_signal_count: 0,
    automation_signal_count: 0,
    primary_workflow_signal: 'none'
  })
})

it('classifies shipping workflows for production artifact runs', () => {
  expect(
    collectWorkflowProfile({
      command: 'build',
      isMultiBrowser: true,
      artifactKind: 'zip'
    })
  ).toEqual({
    workflow_cohort: 'shipping',
    has_shipping_intent: true,
    has_automation_intent: false,
    shipping_signal_count: 3,
    automation_signal_count: 0,
    primary_workflow_signal: 'production_command'
  })
})

it('classifies automation-heavy workflows ahead of shipping', () => {
  expect(
    collectWorkflowProfile({
      command: 'start',
      isWaitMode: true,
      isNoBrowserMode: true,
      usesMachineReadableOutput: true,
      packageManager: 'pnpm',
      frameworkPrimary: 'react',
      hasNextDependency: true,
      hasTurboDependency: true
    })
  ).toEqual({
    workflow_cohort: 'automation_heavy',
    has_shipping_intent: true,
    has_automation_intent: true,
    shipping_signal_count: 1,
    automation_signal_count: 2,
    primary_workflow_signal: 'headless_sync',
    package_manager: 'pnpm',
    framework_primary: 'react',
    has_next_dependency: true,
    has_turbo_dependency: true
  })
})
