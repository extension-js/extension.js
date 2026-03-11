import type {
  FrameworkPrimary,
  PackageManagerName
} from './project-profile'

export type WorkflowCohort = 'local_only' | 'shipping' | 'automation_heavy'

type WorkflowProjectShape = {
  packageManager?: PackageManagerName
  frameworkPrimary?: FrameworkPrimary
  hasNextDependency?: boolean
  hasTurboDependency?: boolean
}

type WorkflowContext = {
  command:
    | 'create'
    | 'dev'
    | 'start'
    | 'preview'
    | 'build'
    | 'install'
    | 'uninstall'
  isMultiBrowser?: boolean
  isRemoteInput?: boolean
  isWaitMode?: boolean
  isNoBrowserMode?: boolean
  usesMachineReadableOutput?: boolean
  sourceInspectionRequested?: boolean
  companionExtensionsProvided?: boolean
  artifactKind?: 'directory' | 'zip' | 'source_zip' | 'zip_and_source'
  whereMode?: boolean
} & WorkflowProjectShape

type WorkflowReason =
  | 'production_command'
  | 'multi_browser'
  | 'artifact_output'
  | 'companion_extensions'
  | 'headless_sync'
  | 'machine_readable_output'
  | 'source_inspection'
  | 'where_mode'

export type WorkflowProfile = {
  workflow_cohort: WorkflowCohort
  has_shipping_intent: boolean
  has_automation_intent: boolean
  shipping_signal_count: number
  automation_signal_count: number
  primary_workflow_signal: WorkflowReason | 'none'
  package_manager?: PackageManagerName
  framework_primary?: FrameworkPrimary
  has_next_dependency?: boolean
  has_turbo_dependency?: boolean
}

function primaryReason(
  automationReasons: WorkflowReason[],
  shippingReasons: WorkflowReason[]
): WorkflowReason | 'none' {
  if (automationReasons.length > 0) return automationReasons[0]
  if (shippingReasons.length > 0) return shippingReasons[0]
  return 'none'
}

export function collectWorkflowProfile(
  context: WorkflowContext
): WorkflowProfile {
  const shippingReasons: WorkflowReason[] = []
  const automationReasons: WorkflowReason[] = []

  if (
    context.command === 'build' ||
    context.command === 'start' ||
    context.command === 'preview'
  ) {
    shippingReasons.push('production_command')
  }

  if (context.isMultiBrowser) {
    shippingReasons.push('multi_browser')
  }

  if (
    context.artifactKind === 'zip' ||
    context.artifactKind === 'source_zip' ||
    context.artifactKind === 'zip_and_source'
  ) {
    shippingReasons.push('artifact_output')
  }

  if (context.companionExtensionsProvided) {
    shippingReasons.push('companion_extensions')
  }

  if (context.isWaitMode || context.isNoBrowserMode) {
    automationReasons.push('headless_sync')
  }

  if (context.usesMachineReadableOutput) {
    automationReasons.push('machine_readable_output')
  }

  if (context.sourceInspectionRequested) {
    automationReasons.push('source_inspection')
  }

  if (context.whereMode) {
    automationReasons.push('where_mode')
  }

  const hasAutomationIntent = automationReasons.length > 0
  const hasShippingIntent = shippingReasons.length > 0

  return {
    workflow_cohort: hasAutomationIntent
      ? 'automation_heavy'
      : hasShippingIntent
        ? 'shipping'
        : 'local_only',
    has_shipping_intent: hasShippingIntent,
    has_automation_intent: hasAutomationIntent,
    shipping_signal_count: shippingReasons.length,
    automation_signal_count: automationReasons.length,
    primary_workflow_signal: primaryReason(automationReasons, shippingReasons),
    package_manager: context.packageManager,
    framework_primary: context.frameworkPrimary,
    has_next_dependency: context.hasNextDependency,
    has_turbo_dependency: context.hasTurboDependency
  }
}
