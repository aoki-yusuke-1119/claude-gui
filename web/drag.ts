import type { PointerEvent as ReactPointerEvent } from 'react'

// ポインタをキャプチャしてドラッグを追う。途中でキャンセルされた場合もリスナーを必ず外す
export function startDrag(
  e: ReactPointerEvent<HTMLElement>,
  onMove: (ev: PointerEvent) => void,
  onEnd?: (ev: PointerEvent) => void
): void {
  const el = e.currentTarget
  el.setPointerCapture(e.pointerId)
  const end = (ev: PointerEvent) => {
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', end)
    el.removeEventListener('pointercancel', end)
    onEnd?.(ev)
  }
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
}
