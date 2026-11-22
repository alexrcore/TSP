import { Award, Check, ChevronUp } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { number } from '../graph-view'
import { labels, solversFor } from './catalog'
import type { RunState, SolverId } from './catalog'

const unavailable = { error: 'Failed', unsupported: 'Precision limit', infeasible: 'Infeasible', unknown: 'No route found' }

export function SolverPicker({ fleet, selected, results, choose, compare, disabled }: {
  fleet: boolean; selected: SolverId; results: RunState; choose: (id: SolverId) => void; compare: () => void; disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const group = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const ids = solversFor(fleet)
  const scores = Object.values(results).flatMap(r => r && r !== 'running' && 'cost' in r ? [r.cost] : [])
  const lowest = Math.min(...scores)
  useEffect(() => {
    if (!open) return
    group.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    const close = (event: PointerEvent) => {
      if (!group.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  function dismiss() { trigger.current?.focus(); setOpen(false) }
  function show() { setOpen(true); compare() }
  return <div className="solver-picker" ref={group}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}>
    <button ref={trigger} className="solver-trigger" aria-label={`Compare solvers, selected ${labels[selected]}`}
      title={`Compare solvers · ${labels[selected]}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      disabled={disabled} onClick={() => { if (open) setOpen(false); else show() }}
      onKeyDown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); show() } }}>
      <span>{({ 'cp-sat': 'CP-SAT', highs: 'HiGHS', guided: 'GLS', custom: 'Custom', 'held-karp': 'Held–Karp', savings: 'Savings' })[selected]}</span><ChevronUp size={14} />
    </button>
    {open && <div id={menuId} role="menu" aria-label="Solver comparison" className="solver-menu"
      onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); dismiss(); return }
        const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = { ArrowUp: (index + items.length - 1) % items.length, ArrowDown: (index + 1) % items.length,
          Home: 0, End: items.length - 1 }[e.key]
        if (next !== undefined) { e.preventDefault(); items[next].focus() }
      }}>
      {ids.map(id => {
        const result = results[id]
        const solved = result && result !== 'running' && 'cost' in result ? result : undefined
        const best = solved && (solved.cost === lowest || (!Number.isInteger(lowest) &&
          Math.abs(solved.cost - lowest) <= 4 * Number.EPSILON * Math.abs(lowest)))
        let score = '—', detail = 'Waiting'
        if (solved) {
          score = number.format(solved.cost)
          detail = solved.status === 'optimal' ? 'Proven minimum' : solved.startingPlan ? 'Feasible starting plan' : 'Feasible route'
        } else if (result === 'running') { score = '…'; detail = 'Solving' }
        else if (result && !('routes' in result)) { score = detail = unavailable[result.status] }
        return <button key={id} role="menuitemradio" tabIndex={-1} aria-checked={selected === id}
          aria-label={`${labels[id]}, ${score}, ${detail}${best ? ', lowest cost found' : ''}`}
          title={`${detail}${best ? ' · Lowest cost found' : ''}`}
          onClick={() => { choose(id); dismiss() }}>
          <span className="selected-mark">{selected === id && <Check size={13} />}</span>
          <span>{labels[id]}{solved?.startingPlan && <small>Starting plan</small>}</span>
          <span className="best-mark">{best && <Award size={14} />}</span>
          <span className="solver-score">{score}</span>
        </button>
      })}
    </div>}
  </div>
}
