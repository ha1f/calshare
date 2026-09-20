import type { Clock } from '../../ports/clock'

export function fakeClock(now: Date): Clock & { set(now: Date): void } {
  let current = now
  return {
    now: () => current,
    set: (next: Date) => {
      current = next
    },
  }
}
