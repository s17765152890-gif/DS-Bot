// The mode switch in the window band: DS Bot on one side, the native DSH surface on
// the other. It is the one control that stays on screen in both surfaces, so a user
// never gets locked into either.
//
// The band belongs to the shell (and to whoever draws the shell's own view switch,
// 应用 / 编辑). We do not register into it and never modify it: this element is our
// own, fixed-positioned in the band, and it only *reads* where the shell's switch
// ends so it can sit right after it. Everything else about the band is untouched.
import { language } from './i18n.js'

// How far below the top of the window the band is searched, in px.
const BAND = 96
// Gap between the shell's own switch and ours.
const GAP = 10
// Used until the first measurement lands (and if the shell's switch is not found).
const FALLBACK_RIGHT = 180
const FALLBACK_TOP = 8
// Text of the shell's own view switch, either language.
const SHELL_LABELS = ['应用', '编辑', 'App', 'Edit']
const WIDEST_LABEL = 220
const TALLEST_LABEL = 48
const LONGEST_TEXT = 12
// While the band has no switch yet, rescan at this interval instead of every frame.
const EMPTY_RESCAN_MS = 300

export const SURFACE_SWITCH_CSS = `
.bt-surface-switch{position:fixed;z-index:60;display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:999px;background:rgba(127,127,127,.16);-webkit-app-region:no-drag;font-family:inherit;font-size:12px;line-height:16px;color:inherit;user-select:none;pointer-events:auto}
.bt-surface-switch-btn{border:0;margin:0;padding:3px 10px;border-radius:999px;background:none;color:inherit;font:inherit;font-size:12px;line-height:16px;cursor:pointer;opacity:.7;white-space:nowrap;transition:background-color .12s ease,opacity .12s ease}
.bt-surface-switch-btn:hover{opacity:1}
.bt-surface-switch-btn:active{transform:scale(.97)}
.bt-surface-switch-btn[data-on]{background:rgba(127,127,127,.30);opacity:1;font-weight:600}
.bt-surface-switch[data-fallback]{right:${FALLBACK_RIGHT}px}
`

const label = (mode) => (mode === 'bot' ? 'DS Bot' : language().startsWith('zh') ? '原生 DSH' : 'Native DSH')
const hint = (mode) => (mode === 'bot'
  ? (language().startsWith('zh') ? '前往 DS Bot 模式' : 'Go to DS Bot')
  : (language().startsWith('zh') ? '返回原生 DSH 模式' : 'Back to native DSH'))

// Every element of the shell's own view switch in the top band. The scan takes the
// union of the labels: the shell may split the switch into several nodes (one per
// label, or one wrapper holding them), and anchoring on a single node put this switch
// over the label that came next.
// Elements under `root`, open shadow roots included: the desktop chrome may render
// its title band inside one, where document.querySelectorAll cannot see it.
function* deepElements(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    yield node
    if (node.shadowRoot !== null) yield* deepElements(node.shadowRoot)
  }
}

function scanBand() {
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
    // The wrapper that holds the labels is the real end of the shell's switch: its
    // right edge is what the next control must clear. Only a wrapper whose text is
    // nothing but the labels counts, so the whole header row can never be picked.
    for (let up = el.parentElement, step = 0; up !== null && step < 2; up = up.parentElement, step++) {
      const wrapperText = (up.textContent ?? '').trim()
      if (wrapperText.length === 0 || wrapperText.length > LONGEST_TEXT) break
      const rest = SHELL_LABELS.reduce((text, name) => text.split(name).join(''), wrapperText).replace(/\s/g, '')
      if (rest.length > 0) break
      if (up.closest('.bt-surface-switch') !== null) break
      if (inBand(up.getBoundingClientRect())) found.add(up)
    }
  }
  return [...found]
}

// Installs the switch and returns its disposer. `surface` is the plugin's surface
// source; `actions.setSurface` is the same entry the Settings page and the return
// button use, so both surfaces stay in step with one saved preference.
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

  // The element set is cached, the rects are not: a stale rect is what makes two
  // switches overlap, and the band re-renders its labels. Re-reading a handful of
  // rects each frame is cheap; rescanning the whole document is not, so the scan runs
  // only when a cached element left the document (or the band was empty).
  let band = []
  let scannedAt = 0
  let raf = 0
  const measure = () => {
    const connected = band.length > 0 && band.every(el => el.isConnected)
    if (!connected) {
      const now = Date.now()
      if (band.length > 0 || now - scannedAt >= EMPTY_RESCAN_MS) {
        band = scanBand()
        scannedAt = now
      }
    }
    let right = null
    let top = null
    let bottom = null
    for (const el of band) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      right = right === null ? rect.right : Math.max(right, rect.right)
      top = top === null ? rect.top : Math.min(top, rect.top)
      bottom = bottom === null ? rect.bottom : Math.max(bottom, rect.bottom)
    }
    return right === null ? null : { left: right + GAP, middle: (top + bottom) / 2 }
  }
  const place = () => {
    raf = 0
    const at = measure()
    const box = root.getBoundingClientRect()
    // The shell's switch was not found (a cold start, another chrome): sit at the far
    // end of the band instead of guessing a left offset that would crowd its labels.
    if (at === null) {
      root.dataset.fallback = ''
      root.style.left = ''
      root.style.top = `${FALLBACK_TOP}px`
      return
    }
    delete root.dataset.fallback
    root.style.left = `${Math.round(at.left)}px`
    root.style.top = `${Math.round(at.middle - box.height / 2)}px`
  }
  const schedule = () => { if (raf === 0) raf = requestAnimationFrame(place) }
  const reanchor = () => { band = []; schedule() }

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

  // The band is not ours, so we follow it: a resize, a window state change, or any
  // re-render of the chrome re-places the switch.
  const observer = new MutationObserver(() => schedule())
  observer.observe(document.documentElement, { childList: true, subtree: true, attributeFilter: ['data-sidebar-collapsed', 'data-fullscreen', 'data-platform', 'data-windows-titlebar'] })
  window.addEventListener('resize', reanchor)
  // A cold start mounts the band a moment after the plugin does.
  const timers = [0, 60, 200, 600, 1500].map(delay => setTimeout(reanchor, delay))

  return () => {
    offSurface()
    observer.disconnect()
    window.removeEventListener('resize', reanchor)
    for (const timer of timers) clearTimeout(timer)
    if (raf !== 0) cancelAnimationFrame(raf)
    root.remove()
  }
}
