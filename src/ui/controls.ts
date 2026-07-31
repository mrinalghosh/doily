import type { Mode } from '../model'

const closed = new Set<string>(JSON.parse(localStorage.getItem('doily.closed') ?? '[]'))
const saveClosed = () =>
  localStorage.setItem('doily.closed', JSON.stringify([...closed]))

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

export function section(title: string, children: HTMLElement[]): HTMLElement {
  const sec = h('div', 'sec')
  const head = h('div', 'sec-h')
  head.append(h('span', undefined, title), h('span', undefined, closed.has(title) ? '+' : '–'))
  const body = h('div', 'sec-b')
  body.append(...children)
  if (closed.has(title)) sec.classList.add('closed')
  head.onclick = () => {
    if (closed.has(title)) closed.delete(title)
    else closed.add(title)
    sec.classList.toggle('closed')
    head.lastElementChild!.textContent = closed.has(title) ? '+' : '–'
    saveClosed()
  }
  sec.append(head, body)
  return sec
}

export function slider(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (v: number) => void,
  onDone?: () => void,
): HTMLElement {
  const row = h('div', 'row')
  const val = h('span', 'val', fmt(value, step))
  const input = h('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  input.oninput = () => {
    const v = Number(input.value)
    val.textContent = fmt(v, step)
    onInput(v)
  }
  if (onDone) input.onchange = () => onDone()
  row.append(h('label', undefined, label), input, val)
  return row
}

const fmt = (v: number, step: number) => {
  const dp = step < 0.1 ? 2 : step < 1 ? 1 : 0
  return v.toFixed(dp)
}

export function toggle(
  label: string,
  value: boolean,
  onChange: (v: boolean) => void,
  sub?: string,
): HTMLElement {
  const wrap = h('div')
  const lab = h('label', 'chk')
  const input = h('input')
  input.type = 'checkbox'
  input.checked = value
  input.onchange = () => onChange(input.checked)
  lab.append(input, h('span', undefined, label))
  wrap.append(lab)
  if (sub) {
    const s = h('div', 'note')
    s.textContent = sub
    s.style.paddingLeft = '20px'
    wrap.append(s)
  }
  return wrap
}

export function tristate(label: string, value: Mode, onChange: (m: Mode) => void): HTMLElement {
  const row = h('div', 'tri')
  const opts = h('div', 'opts')
  for (const m of ['off', 'warn', 'enforce'] as Mode[]) {
    const b = h('button', m === value ? 'on' : undefined, m)
    b.onclick = () => onChange(m)
    opts.append(b)
  }
  row.append(h('label', undefined, label), opts)
  return row
}

export function button(label: string, onClick: () => void, pri = false): HTMLButtonElement {
  const b = h('button', pri ? 'b pri' : 'b', label)
  b.onclick = onClick
  return b
}

export function btnRow(...b: HTMLElement[]): HTMLElement {
  const r = h('div', 'btns')
  r.append(...b)
  return r
}

export function note(text: string): HTMLElement {
  return h('div', 'note', text)
}
