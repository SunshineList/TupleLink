import { useEffect, useRef } from 'react'

// Measure only the name being read, rather than observing every node in a large subscription.
export function NodeName({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const element = ref.current
    const target = element?.closest('button')
    if (!element || !target) return
    const measure = () => {
      const distance = Math.max(0, (element.firstElementChild?.scrollWidth || 0) - element.clientWidth)
      element.dataset.overflow = String(distance > 1)
      element.style.setProperty('--name-travel', `-${distance}px`)
      element.style.setProperty('--name-duration', `${Math.min(12, Math.max(3, distance / 35))}s`)
    }
    target.addEventListener('pointerenter', measure)
    target.addEventListener('focus', measure)
    return () => {
      target.removeEventListener('pointerenter', measure)
      target.removeEventListener('focus', measure)
    }
  }, [name])
  return (
    <span ref={ref} className="node-name" title={name}>
      <span className="node-name-text">{name}</span>
    </span>
  )
}
