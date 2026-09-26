import { applyCalendarUaHandling } from '../lib/lineUa'

function main(): void {
  const container = document.querySelector('[data-section="calendar"]')
  if (container === null) return
  applyCalendarUaHandling(container, navigator.userAgent)
}

main()
