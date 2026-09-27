import type { Notifier, ReportNotification } from '../../ports/notifier'

export function createFakeNotifier(): Notifier & { calls: ReportNotification[] } {
  const calls: ReportNotification[] = []
  return {
    calls,
    notifyReport: async (n: ReportNotification) => {
      calls.push(n)
    },
  }
}
