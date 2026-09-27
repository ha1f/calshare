import { DEFAULT_EVENT_DURATION_MINUTES } from '../../core/config/limits'
import type { ParseIssue } from '../../core/parse/types'
import { addDays, formatDateLabel, jstDate, toJstParts } from '../../core/time/jst'
import { createElement } from '../lib/dom'
import {
  effectiveDatetime,
  effectiveFields,
  effectiveLocation,
  effectiveMemo,
  effectiveTitle,
} from './preview'
import type { CreateState, DatetimeValue } from './preview'

/** 項目タップ〜編集〜「自動に戻す」の 4 項目分を組み立てる（§6.1） */
export interface PreviewView {
  render(): void
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function toDatetimeLocalValue(date: Date): string {
  const p = toJstParts(date)
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}T${pad2(p.h)}:${pad2(p.mi)}`
}

function toDateValue(date: Date): string {
  const p = toJstParts(date)
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`
}

const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function parseDatetimeLocalValue(value: string): Date | null {
  const m = DATETIME_LOCAL_PATTERN.exec(value)
  if (m === null) return null
  const [, y, mo, d, h, mi] = m
  return jstDate(Number(y), Number(mo), Number(d), Number(h), Number(mi))
}

function parseDateValue(value: string): Date | null {
  const m = DATE_PATTERN.exec(value)
  if (m === null) return null
  const [, y, mo, d] = m
  return jstDate(Number(y), Number(mo), Number(d))
}

/**
 * 日時編集欄の入力文字列から手動の値を組み立てる（§6.1）。開始が無ければ日時未定として扱い、
 * 終了が空欄なら開始 + `DEFAULT_EVENT_DURATION_MINUTES` を補う（パーサの既定と揃える）
 */
export function computeManualDatetimeFromInputs(
  startValue: string,
  endValue: string,
  isAllDay: boolean,
): DatetimeValue {
  if (isAllDay) {
    const startDate = parseDateValue(startValue)
    if (startDate === null) return { start: null, end: null, isAllDay }
    const inclusiveEndDate = parseDateValue(endValue) ?? startDate
    return { start: startDate, end: addDays(inclusiveEndDate, 1), isAllDay: true }
  }
  const start = parseDatetimeLocalValue(startValue)
  if (start === null) return { start: null, end: null, isAllDay: false }
  const end = parseDatetimeLocalValue(endValue)
  const resolvedEnd = end ?? new Date(start.getTime() + DEFAULT_EVENT_DURATION_MINUTES * 60_000)
  return { start, end: resolvedEnd, isAllDay: false }
}

/**
 * 日時編集欄に入れる文字列を組み立てる（§6.1）。終日表示への切り替え時、切り替え元がまだ
 * 終日でなければ `end` の JST 日付をそのまま最終日にする（終日の排他的翌日 00:00 前提で 1 日
 * 引くのは、切り替え元もすでに終日のときだけでよい）
 */
export function computeDatetimeInputValues(
  value: DatetimeValue,
  isAllDay: boolean,
): { start: string; end: string } {
  if (value.start === null) return { start: '', end: '' }
  if (isAllDay) {
    const inclusiveEnd =
      value.end === null ? value.start : value.isAllDay ? addDays(value.end, -1) : value.end
    return { start: toDateValue(value.start), end: toDateValue(inclusiveEnd) }
  }
  return {
    start: toDatetimeLocalValue(value.start),
    end: value.end === null ? '' : toDatetimeLocalValue(value.end),
  }
}

/** §5.7 の draft/past/beyond のプレビュー文言。auto かつ start が無いときだけ出す */
function datetimeIssueMessage(issues: ParseIssue[]): string | null {
  if (issues.includes('beyond_max_lead_time')) return '作成できるのは13ヶ月先までです'
  if (issues.includes('past_date')) return '過去の日付のようです'
  if (issues.includes('no_datetime')) {
    return '日時を認識できませんでした。タップして直せます（このままだと7日で消えます）'
  }
  return null
}

interface TextItemConfig {
  key: 'title' | 'location' | 'memo'
  label: string
  multiline: boolean
  emptyPlaceholder: string
  getEffective(state: CreateState): string | null
  setManual(state: CreateState, value: string | null): void
  resetToAuto(state: CreateState): void
}

function buildTextItem(
  config: TextItemConfig,
  state: CreateState,
  onChange: () => void,
): { element: HTMLElement; update(): void; focusInput(): void } {
  const root = createElement('div', { className: 'preview-item' })
  root.dataset.field = config.key

  const labelId = `label-${config.key}`
  const valueId = `value-${config.key}`
  root.appendChild(
    createElement('span', {
      className: 'preview-item-label',
      text: config.label,
      attrs: { id: labelId },
    }),
  )

  const valueText = createElement('span', {
    className: 'preview-item-value',
    attrs: { id: valueId },
  })
  const viewButton = createElement('button', {
    className: 'preview-item-view',
    // 値も読み上げさせるため label と value の両方を参照する（input 側は value が入力値そのもの）
    attrs: { type: 'button', 'aria-labelledby': `${labelId} ${valueId}` },
  })
  viewButton.dataset.testid = `view-${config.key}`
  viewButton.appendChild(valueText)

  const input: HTMLInputElement | HTMLTextAreaElement = config.multiline
    ? createElement('textarea', {
        className: 'preview-item-input',
        attrs: { 'aria-labelledby': labelId },
      })
    : createElement('input', {
        className: 'preview-item-input',
        attrs: { type: 'text', 'aria-labelledby': labelId },
      })
  input.dataset.testid = `input-${config.key}`
  input.hidden = true

  const resetLink = createElement('button', {
    className: 'reset-link',
    text: '自動に戻す',
    attrs: { type: 'button' },
  })
  resetLink.dataset.testid = `reset-${config.key}`
  resetLink.hidden = true

  root.append(viewButton, input, resetLink)

  viewButton.addEventListener('click', () => {
    config.setManual(state, config.getEffective(state))
    onChange()
    input.focus()
  })

  input.addEventListener('input', () => {
    const raw = input.value
    config.setManual(state, raw.trim() === '' ? (config.key === 'title' ? '' : null) : raw)
    onChange()
  })

  resetLink.addEventListener('click', () => {
    config.resetToAuto(state)
    onChange()
    viewButton.focus()
  })

  return {
    element: root,
    update: () => updateTextItem(config, state, root, viewButton, valueText, input, resetLink),
    focusInput: () => input.focus(),
  }
}

function updateTextItem(
  config: TextItemConfig,
  state: CreateState,
  root: HTMLElement,
  viewButton: HTMLButtonElement,
  valueText: HTMLElement,
  input: HTMLInputElement | HTMLTextAreaElement,
  resetLink: HTMLButtonElement,
): void {
  const manual = isManualField(state, config.key)
  root.classList.toggle('is-manual', manual)
  viewButton.hidden = manual
  input.hidden = !manual
  resetLink.hidden = !manual
  // getEffective は manual 中も現在値を返すので、表示先が view/input のどちらでも同じ値で揃う
  const value = config.getEffective(state)
  if (manual) {
    // 編集中の入力欄には書き戻さない。他項目の変更による render でも呼ばれるため、
    // 操作中の欄まで上書きすると入力途中の空白や改行が消える
    if (document.activeElement !== input) input.value = value ?? ''
  } else {
    valueText.textContent = value === null || value === '' ? config.emptyPlaceholder : value
  }
}

function isManualField(state: CreateState, key: 'title' | 'location' | 'memo'): boolean {
  return state[key].mode === 'manual'
}

/** タイトル・場所・メモの 3 項目を組み立てる。日時は buildDatetimeItem が別に担う */
function textItemConfigs(): [TextItemConfig, TextItemConfig, TextItemConfig] {
  return [
    {
      key: 'title',
      label: 'タイトル',
      multiline: false,
      emptyPlaceholder: '（タイトル未設定）',
      getEffective: effectiveTitle,
      setManual: (s, v) => {
        s.title = { mode: 'manual', value: v ?? '' }
      },
      resetToAuto: (s) => {
        s.title = { mode: 'auto' }
      },
    },
    {
      key: 'location',
      label: '場所',
      multiline: false,
      emptyPlaceholder: '（場所なし）',
      getEffective: effectiveLocation,
      setManual: (s, v) => {
        s.location = { mode: 'manual', value: v }
      },
      resetToAuto: (s) => {
        s.location = { mode: 'auto' }
      },
    },
    {
      key: 'memo',
      label: 'メモ',
      multiline: true,
      emptyPlaceholder: '（メモなし）',
      getEffective: effectiveMemo,
      setManual: (s, v) => {
        s.memo = { mode: 'manual', value: v }
      },
      resetToAuto: (s) => {
        s.memo = { mode: 'auto' }
      },
    },
  ]
}

function buildDatetimeItem(
  state: CreateState,
  onChange: () => void,
): { element: HTMLElement; update(): void } {
  const root = createElement('div', { className: 'preview-item' })
  root.dataset.field = 'datetime'
  const labelId = 'label-datetime'
  const valueId = 'value-datetime'
  root.appendChild(
    createElement('span', {
      className: 'preview-item-label',
      text: '日時',
      attrs: { id: labelId },
    }),
  )

  const valueText = createElement('span', {
    className: 'preview-item-value',
    attrs: { id: valueId },
  })
  const viewButton = createElement('button', {
    className: 'preview-item-view',
    attrs: { type: 'button', 'aria-labelledby': `${labelId} ${valueId}` },
  })
  viewButton.dataset.testid = 'view-datetime'
  viewButton.appendChild(valueText)

  const editRoot = createElement('div', { className: 'datetime-edit' })
  editRoot.hidden = true

  const startInput = createElement('input', { attrs: { type: 'datetime-local' } })
  startInput.dataset.testid = 'start-input'
  const endInput = createElement('input', { attrs: { type: 'datetime-local' } })
  endInput.dataset.testid = 'end-input'
  const allDayCheckbox = createElement('input', { attrs: { type: 'checkbox' } })
  allDayCheckbox.dataset.testid = 'all-day-checkbox'
  const allDayLabel = createElement('label', { className: 'all-day-label', text: '終日' })
  allDayLabel.prepend(allDayCheckbox)

  const startLabel = createElement('label', { className: 'datetime-label', text: '開始' })
  startLabel.appendChild(startInput)
  const endLabel = createElement('label', { className: 'datetime-label', text: '終了' })
  endLabel.appendChild(endInput)
  editRoot.append(startLabel, endLabel, allDayLabel)

  const resetLink = createElement('button', {
    className: 'reset-link',
    text: '自動に戻す',
    attrs: { type: 'button' },
  })
  resetLink.dataset.testid = 'reset-datetime'
  resetLink.hidden = true

  root.append(viewButton, editRoot, resetLink)

  function applyManualFromInputs(): void {
    const value = computeManualDatetimeFromInputs(
      startInput.value,
      endInput.value,
      allDayCheckbox.checked,
    )
    state.datetime = { mode: 'manual', value }
    onChange()
  }

  startInput.addEventListener('input', applyManualFromInputs)
  endInput.addEventListener('input', applyManualFromInputs)
  allDayCheckbox.addEventListener('change', () => {
    // 表示形式（date / datetime-local）を切り替えてから現在値を入力欄へ入れ直す
    fillInputsFromValue(effectiveDatetime(state), allDayCheckbox.checked)
    applyManualFromInputs()
  })

  // 編集中の入力欄には書き戻さない。render は他項目の変更でも呼ばれるため、
  // 操作中の欄まで上書きすると入力途中の空白や改行が消える
  function setInputValueUnlessFocused(input: HTMLInputElement, value: string): void {
    if (document.activeElement !== input) input.value = value
  }

  function fillInputsFromValue(value: DatetimeValue, isAllDay: boolean): void {
    startInput.type = isAllDay ? 'date' : 'datetime-local'
    endInput.type = isAllDay ? 'date' : 'datetime-local'
    const values = computeDatetimeInputValues(value, isAllDay)
    setInputValueUnlessFocused(startInput, values.start)
    setInputValueUnlessFocused(endInput, values.end)
  }

  viewButton.addEventListener('click', () => {
    const value = effectiveDatetime(state)
    state.datetime = { mode: 'manual', value }
    // 編集欄を開いた直後はまだ何も入力していないので、update() の「開始が空なら書き戻さない」
    // 判定に関わらずここで表示を揃える
    allDayCheckbox.checked = value.isAllDay
    fillInputsFromValue(value, value.isAllDay)
    onChange()
    startInput.focus()
  })

  resetLink.addEventListener('click', () => {
    state.datetime = { mode: 'auto' }
    onChange()
    viewButton.focus()
  })

  function update(): void {
    const manual = state.datetime.mode === 'manual'
    root.classList.toggle('is-manual', manual)
    viewButton.hidden = manual
    editRoot.hidden = !manual
    resetLink.hidden = !manual
    if (manual) {
      // effectiveDatetime は manual 中も現在値を返すので、入力欄を毎回この値で揃える
      const value = effectiveDatetime(state)
      allDayCheckbox.checked = value.isAllDay
      // 開始欄が未入力扱いだと DatetimeValue は start/end とも null になる。ここで
      // 両方の入力欄を書き戻すと、終了欄にすでに入力済みの文字列まで空にしてしまうため触らない
      if (value.start !== null) fillInputsFromValue(value, value.isAllDay)
    } else {
      const message = datetimeIssueMessage(state.parsed.issues)
      valueText.textContent = message ?? formatDateLabel(effectiveFields(state))
    }
  }

  return { element: root, update }
}

/** singleTokenTitle のときだけ出す「場所にする」リンク（§6.1） */
function buildLocationSwapLink(
  state: CreateState,
  onChange: () => void,
  focusAfterSwap: () => void,
): { element: HTMLElement; update(): void } {
  const link = createElement('button', {
    className: 'location-swap-link',
    text: '場所にする',
    attrs: { type: 'button' },
  })
  link.dataset.testid = 'use-as-location'
  link.hidden = true

  link.addEventListener('click', () => {
    const title = effectiveTitle(state)
    const dateLabel = formatDateLabel(effectiveFields(state))
    state.location = { mode: 'manual', value: title }
    state.title = { mode: 'manual', value: dateLabel }
    onChange()
    // 押したリンク自身が hidden になるので、フォーカスを移さないと body に落ちる
    focusAfterSwap()
  })

  function update(): void {
    const canSwap =
      state.title.mode === 'auto' &&
      state.parsed.singleTokenTitle &&
      effectiveLocation(state) === null &&
      effectiveDatetime(state).start !== null
    link.hidden = !canSwap
  }

  return { element: link, update }
}

/** プレビュー領域（タイトル・日時・場所・メモの 4 項目）を組み立てる */
export function createPreviewView(
  container: HTMLElement,
  state: CreateState,
  onChange: () => void,
): PreviewView {
  const [titleConfig, locationConfig, memoConfig] = textItemConfigs()
  const titleItem = buildTextItem(titleConfig, state, onChange)
  const locationItem = buildTextItem(locationConfig, state, onChange)
  const memoItem = buildTextItem(memoConfig, state, onChange)
  const datetimeItem = buildDatetimeItem(state, onChange)
  const locationSwapLink = buildLocationSwapLink(state, onChange, () => titleItem.focusInput())

  titleItem.element.appendChild(locationSwapLink.element)

  container.append(titleItem.element, datetimeItem.element, locationItem.element, memoItem.element)

  function render(): void {
    titleItem.update()
    datetimeItem.update()
    locationItem.update()
    memoItem.update()
    locationSwapLink.update()
  }

  return { render }
}
