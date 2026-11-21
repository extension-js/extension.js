import {
  unbuiltDependencyLine,
  unbuiltWorkspaceDependencies
} from './workspace-build-entries.mjs'

// A spec run started without the package's pretest never built the sibling
// packages, and each row that spawns the compiled CLI then fails on its own.
export function requireBuiltWorkspaceDependencies(packageDir = process.cwd()) {
  const unbuilt = unbuiltWorkspaceDependencies(packageDir)

  if (unbuilt.length === 0) return

  const error = new Error(
    unbuilt.map((dependency) => unbuiltDependencyLine(dependency)).join('\n')
  )

  // The line is the whole answer, and a stack would bury it.
  error.stack = error.message

  throw error
}

// Vitest calls this once in its main process, before any worker starts.
export default function setup() {
  requireBuiltWorkspaceDependencies()
}
