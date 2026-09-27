import { formatDateLabel } from '../../core/time/jst'
import { fromEventFieldsJson } from '../../core/types'
import { createElement, requireElement } from '../lib/dom'
import { readHistory } from '../lib/history'
import type { HistoryEntry } from '../lib/history'

interface DisplayEntry {
  id: string
  title: string
  dateLabel: string
  expiresAt: Date
}

// readHistory() は id の形式までは検証済みだが fields の中身までは見ていないため、
// EventFieldsJson として壊れている項目はここで弾く
function toDisplayEntry(entry: HistoryEntry): DisplayEntry | null {
  const expiresAt = new Date(entry.expiresAt)
  if (Number.isNaN(expiresAt.getTime())) return null

  try {
    const fields = fromEventFieldsJson(entry.fields)
    return { id: entry.id, title: fields.title, dateLabel: formatDateLabel(fields), expiresAt }
  } catch {
    return null
  }
}

function renderEntry(entry: DisplayEntry, now: Date): HTMLLIElement {
  const expired = entry.expiresAt.getTime() <= now.getTime()

  const li = createElement('li', {
    className: expired ? 'history-item is-expired' : 'history-item',
    attrs: { 'data-testid': 'history-item' },
  })
  const titleLink = createElement('a', {
    className: 'history-title',
    text: entry.title,
    attrs: { href: `/${entry.id}`, 'data-testid': 'history-title-link' },
  })
  const dateEl = createElement('span', {
    className: 'history-datetime',
    text: entry.dateLabel,
    attrs: { 'data-testid': 'history-datetime' },
  })
  const editLink = createElement('a', {
    className: 'history-edit-link',
    text: '編集',
    attrs: { href: `/${entry.id}/edit`, 'data-testid': 'history-edit-link' },
  })
  li.append(titleLink, dateEl, editLink)

  if (expired) {
    const badge = createElement('span', {
      className: 'history-expired-badge',
      text: '期限切れ',
      attrs: { 'data-testid': 'history-expired-badge' },
    })
    li.append(badge)
  }

  return li
}

function main(): void {
  const listEl = requireElement('history-list', HTMLUListElement)
  const emptyEl = requireElement<HTMLElement>('empty-message')

  const entries: DisplayEntry[] = []
  for (const entry of readHistory()) {
    const displayEntry = toDisplayEntry(entry)
    if (displayEntry !== null) entries.push(displayEntry)
  }

  emptyEl.hidden = entries.length > 0
  const now = new Date()
  for (const entry of entries) {
    listEl.append(renderEntry(entry, now))
  }
}

main()
