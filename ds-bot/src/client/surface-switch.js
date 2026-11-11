// The mode switch in the window band: DS Bot on one side, the native DSH surface on
// the other. It is the one control that stays on screen in both surfaces, so a user
// never gets locked into either.
//
// Why this is DOM and not a slot: the band that carries the shell's own view switch
// (应用 / 编辑) is not part of the DSH slot tree. On the Desktop, the Electron preload
// injects it as <div data-windows-menu> with an open shadow root holding the buttons —
// a plugin cannot register into it, and must not modify it. What a plugin can do is
// anchor to that host and place its own control beside it, which is what this does:
// the host's right edge is exactly where the menubar ends.
import { language } from './i18n.js'

// The preload-injected caption menubar. Stable across re-renders; its buttons live in
// the shadow root, which is why they are addressed through the host and never queried.
const MENU_HOST = '[data-windows-menu]'
// Used only before the first measurement lands.
const DEFAULT_LEFT = 96
const DEFAULT_TOP = 8
// Gap between the menubar and this switch.
const GAP = 10
// How far below the top of the window a fallback label scan looks, in px.
const BAND = 96
// Text of the shell's own view switch, either language (fallback only).
const SHELL_LABELS = ['应用', '编辑', 'App', 'Edit']
const WIDEST_LABEL = 220
const TALLEST_LABEL = 48
const LONGEST_TEXT = 12
// A self-heal tick: one querySelector and one rect read, so the switch follows the band
// even when the resize event or the observer misses the frame (window drag, DPI change).
const TICK_MS = 1000

export const SURFACE_SWITCH_CSS = `
.bt-surface-switch{position:fixed;z-index:60;display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:999px;background:rgba(127,127,127,.16);-webkit-app-region:no-drag;font-family:inherit;font-size:12px;line-height:16px;color:inherit;user-select:none;pointer-events:auto}
.bt-surface-switch[data-hidden]{display:none}
.bt-surface-switch-btn{border:0;margin:0;padding:3px 10px;border-radius:999px;background:none;color:inherit;font:inherit;font-size:12px;line-height:16px;cursor:pointer;opacity:.7;white-space:nowrap;transition:background-color .12s ease,opacity .12s ease}
.bt-surface-switch-btn:hover{opacity:1}
.bt-surface-switch-btn:active{transform:scale(.97)}
.bt-surface-switch-btn[data-on]{background:rgba(127,127,127,.30);opacity:1;font-weight:600}
`

const label = (mode) => (mode === 'bot' ? 'DS Bot' : language().startsWith('zh') ? '原生 DSH' : 'Native DSH')
const hint = (mode) => (mode === 'bot'
  ? (language().startsWith('zh') ? '前往 DS Bot 模式' : 'Go to DS Bot')
  : (language().startsWith('zh') ? '返回原生 DSH 模式' : 'Back to native DSH'))

// Elements under `root`, open shadow roots included.
function* deepElements(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    yield node
    if (node.shadowRoot !== null) yield* deepElements(node.shadowRoot)
  }
}

// Fallback anchor: the menubar host is missing (a different shell, a cold start before
// the preload injects), so look for the labels themselves in the top band.
function scanLabels() {
  if (typeof document === 'undefined' || document.body === null) return []
  const found = new Set()
  const inBand = (rect) => rect.width > 0 && rect.height > 0 && rect.height <= TALLEST_LABEL && rect.width <= WIDEST_LABEL && rect.top >= 0 && rect.top <= BAND
  for (const el of deepElements(document.body)) {
    if (el.closest?.('.bt-surface-switch') != null) continue
    const text = (el.textContent ?? '').trim()
    if (text.length === 0 || text.length > LONGEST_TEXT) continue
    if (!SHELL_LABELS.some(name => text === name || text.startsWith(name))) continue
    if (!inBand(el.getBoundingClientRect())) continue
    found.add(el)
  }
  return [...found]
}

// The host is cached: a document-wide query on every animation frame (the mutation
// observer fires on every chat token) is the one cost this must not pay. A host that
// left the document is looked up again on the next measurement.
let hostEl = null
function menuHost() {
  if (hostEl !== null && hostEl.isConnected) return hostEl
  hostEl = typeof document === 'undefined' ? null : document.querySelector(MENU_HOST)
  return hostEl
}

// The place this switch belongs, or null when the band is not measurable right now.
// The menubar host comes first: one stable element, and its right edge is the end of
// the shell's own switch. A zero-sized host means the band is not on screen (fullscreen,
// a hidden window), which the caller turns into "hide", not "move somewhere else".
function measure() {
  if (typeof document === 'undefined') return null
  const host = menuHost()
  if (host !== null) {
    const rect = host.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return { hidden: true }
    return { left: rect.right + GAP, middle: rect.top + rect.height / 2 }
  }
  let right = null
  let top = null
  let bottom = null
  for (const el of scanLabels()) {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    right = right === null ? rect.right : Math.max(right, rect.right)
    top = top === null ? rect.top : Math.min(top, rect.top)
    bottom = bottom === null ? rect.bottom : Math.max(bottom, rect.bottom)
  }
  return right === null ? null : { left: right + GAP, middle: (top + bottom) / 2 }
}

// Installs the switch and returns its disposer. `surface` is the plugin's surface
// source; `actions.setSurface` is the same entry the Settings page uses, so both
// surfaces stay in step with one saved preference.
export function installSurfaceSwitch({ surface, actions }) {
  const root = document.createElement('div')
  root.className = 'bt-surface-switch'
  root.setAttribute('role', 'group')
  root.dataset.dshBot = 'surface-switch'
  const buttons = new Map()
  // The native surface sits first, right after the shell's own switch, and the way
  // into DS Bot follows it. The active side is whichever the window is on.
  for (const mode of ['agent', 'bot']) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'bt-surface-switch-btn'
    button.dataset.mode = mode
    // The band is a drag region on Windows; the switch itself is not.
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      actions.setSurface(mode)
    })
    root.appendChild(button)
    buttons.set(mode, button)
  }
  document.body.appendChild(root)

  // The last place that measured. A failed measurement never moves the switch: jumping
  // to a guess is what made it drift away while a window border was being dragged.
  let placed = null
  const place = () => {
    const at = measure()
    if (at === null) return
    if (at.hidden === true) {
      root.dataset.hidden = ''
      return
    }
    delete root.dataset.hidden
    const box = root.getBoundingClientRect()
    const left = Math.round(at.left)
    const top = Math.round(at.middle - box.height / 2)
    if (placed !== null && placed.left === left && placed.top === top) return
    placed = { left, top }
    root.style.left = `${left}px`
    root.style.top = `${top}px`
  }
  // Before the first measurement the switch waits at a neutral spot instead of guessing
  // a band position: it is invisible for that one frame rather than misplaced.
  root.dataset.hidden = ''
  root.style.left = `${DEFAULT_LEFT}px`
  root.style.top = `${DEFAULT_TOP}px`

  let raf = 0
  const schedule = () => { if (raf === 0) raf = requestAnimationFrame(() => { raf = 0; place() }) }

  const paint = () => {
    const mode = surface.getSnapshot().mode
    for (const [key, button] of buttons) {
      const on = key === mode
      if (on) button.dataset.on = ''
      else delete button.dataset.on
      button.setAttribute('aria-pressed', String(on))
      button.textContent = label(key)
      button.title = hint(key)
      button.setAttribute('aria-label', hint(key))
    }
    schedule()
  }

  const offSurface = surface.subscribe(paint)
  paint()

  // Follow the band: a resize (window drag, maximise, DPI change), the band's own
  // re-render, and a slow tick for anything that fires no event at all. None of these
  // can move the switch on their own — only a fresh measurement does.
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { childList: true, subtree: true, attributeFilter: ['data-fullscreen', 'data-platform', 'data-windows-titlebar', 'lang'] })
  window.addEventListener('resize', schedule)
  const resizes = typeof ResizeObserver === 'function'
    ? new ResizeObserver(schedule)
    : null
  const watchBand = () => {
    const host = menuHost()
    if (host !== null && resizes !== null) {
      try { resizes.observe(host) } catch { /* already observed or detached */ }
    }
  }
  watchBand()
  const tick = setInterval(() => { watchBand(); place() }, TICK_MS)
  const first = [0, 60, 200, 600, 1500].map(delay => setTimeout(schedule, delay))

  return () => {
    offSurface()
    observer.disconnect()
    window.removeEventListener('resize', schedule)
    resizes?.disconnect()
    clearInterval(tick)
    for (const timer of first) clearTimeout(timer)
    if (raf !== 0) cancelAnimationFrame(raf)
    root.remove()
  }
}
