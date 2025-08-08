import {InstanceManager} from '../lib/instance-manager'
import * as messages from '../webpack/lib/messages'

export async function cleanupCommand(): Promise<void> {
  console.log('🧹 Cleaning up orphaned instances...')

  const instanceManager = new InstanceManager(process.cwd())

  // Get stats before cleanup
  const statsBefore = await instanceManager.getStats()
  console.log(
    `Before cleanup: ${statsBefore.running} running, ${statsBefore.total} total instances`
  )

  // Force cleanup
  await instanceManager.forceCleanupOrphanedInstances()

  // Get stats after cleanup
  const statsAfter = await instanceManager.getStats()
  console.log(
    `After cleanup: ${statsAfter.running} running, ${statsAfter.total} total instances`
  )

  const cleaned = statsBefore.total - statsAfter.total
  if (cleaned > 0) {
    console.log(`✅ Cleaned up ${cleaned} orphaned instance(s)!`)
  } else {
    console.log('✅ No orphaned instances found.')
  }
}
