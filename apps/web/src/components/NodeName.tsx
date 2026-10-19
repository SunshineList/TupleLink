import { memo, useEffect, useRef } from 'react'

// Measure only the name being read, rather than observing every node in a large subscription.
export const NodeName = memo(({ name }: { name: string }) => {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const element = ref.current
    const target = element?.closest('[data-name-card]') || element?.closest('button')
    if (!element || !target) return
    let observer: ResizeObserver | undefined
    const measure = () => {
      const distance = Math.max(0, (element.firstElementChild?.scrollWidth || 0) - element.clientWidth)
      element.dataset.overflow = String(distance > 1)
      element.style.setProperty('--name-travel', `-${distance}px`)
      element.style.setProperty('--name-duration', `${Math.min(12, Math.max(3, distance / 35))}s`)
    }
    const activate = () => {
      measure()
      observer ??= new ResizeObserver(measure)
      observer.observe(element)
    }
    const stop = () => {
      observer?.disconnect()
      observer = undefined
    }
    target.addEventListener('pointerenter', activate)
    target.addEventListener('focusin', activate)
    target.addEventListener('pointerleave', stop)
    target.addEventListener('focusout', stop)
    return () => {
      stop()
      target.removeEventListener('pointerenter', activate)
      target.removeEventListener('focusin', activate)
      target.removeEventListener('pointerleave', stop)
      target.removeEventListener('focusout', stop)
    }
  }, [name])
  return (
    <span ref={ref} className="node-name" title={name}>
      <span className="node-name-text">{name}</span>
    </span>
  )
})
