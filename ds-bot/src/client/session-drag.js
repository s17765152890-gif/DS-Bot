// A drag source for the Session rows the shell does not make draggable itself.
//
// DSH gives a row `draggable` only while its parent passes a drag controller and the
// Session is reorderable; a pinned Session at the top of the sidebar is rendered by a
// section that passes neither, so it cannot be picked up at all. Every Session row does
// carry `data-row-key="session:<id>"`, so the panel can still be fed from one: this adds
// the missing `draggable` and the one thing a drop target needs, the Session id in
// `text/plain`. It never moves a row, and rows the shell already made draggable are left
// exactly as they are.
const ROW = '[data-row-key^="session:"]'
const PREFIX = 'session:'

// Rows already wired by this installer. A row element is reused across renders, so the
// listener is added once; the attribute is re-checked every pass in case a re-render
// dropped it.
const wired = new WeakSet()

export function installSessionDrag() {
  if (typeof document === 'undefined') return () => {}
  const patch = () => {
    for (const row of document.querySelectorAll(ROW)) {
      const key = row.getAttribute('data-row-key') ?? ''
      const sessionId = key.startsWith(PREFIX) ? key.slice(PREFIX.length) : ''
      if (sessionId === '') continue
      if (row.getAttribute('draggable') !== 'true') row.setAttribute('draggable', 'true')
      if (wired.has(row)) continue
      wired.add(row)
      row.addEventListener('dragstart', (event) => {
        if (event.dataTransfer === null) return
        // A copy: the Session is read where it is, never moved into the Bot.
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData('text/plain', sessionId)
      })
    }
  }
  const observer = new MutationObserver(patch)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['draggable'],
  })
  patch()
  return () => observer.disconnect()
}
