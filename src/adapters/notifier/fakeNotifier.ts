import type { Notifier, ReportNotification } from '../../ports/notifier'

export function createFakeNotifier(): Notifier & { calls: ReportNotification[] } {
  const calls: ReportNotification[] = []
  return {
    calls,
    notifyReport: (n: ReportNotification) => {
      calls.push(n)
      return Promise.resolve()
    },
  }
}
