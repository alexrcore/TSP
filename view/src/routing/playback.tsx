import { LoaderCircle, Pause, Play, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import type { Layout, Point } from '../layout'
import { GraphStatistics } from './statistics'
import type { Route } from './solver'
import { solversFor } from './catalog'
import type { SolverId } from './catalog'
import { SolverPicker } from './solver-picker'
import { useSolvers } from './use-solvers'

const speeds = [0.5, 1, 2, 4, 8]
const blend = (a: Point, b: Point, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const xy = (p: Point) => `${p.x},${p.y}`

function schedule(routes: Route[], layout: Layout) {
  // All vehicles share a clock. Scale costs to keep the longest route watchable.
  const maxWeight = routes.reduce((max, r) => r.edges.reduce((m, i) => Math.max(m, layout.edges[i].weight), max), 0) || 1
  const tracks = routes.map(route => {
    let elapsed = 0
    const legs = route.edges.map((index, j) => {
      const start = elapsed
      elapsed += Math.max(0.015, layout.edges[index].weight / maxWeight)
      return { index, from: route.stops[j], start, end: elapsed }
    })
    return { legs, length: elapsed }
  })
  const longest = tracks.reduce((max, track) => Math.max(max, track.length), 0)
  const duration = Math.min(45, tracks.reduce((max, track) => Math.max(max, track.legs.length * 0.85), 4)) * 1000
  return { tracks, longest, duration }
}

function VehicleTrail({ layout, legs, time, vehicle, reduced }: {
  layout: Layout; legs: ReturnType<typeof schedule>['tracks'][number]['legs']; time: number; vehicle: number; reduced: boolean
}) {
  // Find the road in progress. Completed paths only change when a stop is reached or dragged.
  let low = 0, high = legs.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (legs[middle].end <= time) low = middle + 1
    else high = middle
  }
  const completed = useMemo(() => legs.slice(0, low).map((leg, i) =>
    <path key={i} d={layout.edges[leg.index].path} vectorEffect="non-scaling-stroke" />), [legs, low, layout.edges])
  const leg = legs[Math.min(low, legs.length - 1)]
  const edge = layout.edges[leg.index]
  const forward = layout.nodes[edge.from].id === leg.from
  const a = layout.nodes[forward ? edge.from : edge.to], b = layout.nodes[forward ? edge.to : edge.from]
  const fraction = low === legs.length ? 1 : reduced ? 0 : (time - leg.start) / (leg.end - leg.start)
  const control = edge.controls[0]
  const q = control && blend(a, control, fraction)
  const head = q ? blend(q, blend(control, b, fraction), fraction) : blend(a, b, fraction)
  return <g data-vehicle={vehicle + 1} style={{ '--vehicle-index': vehicle } as CSSProperties}>
    {completed}
    {fraction > 0 && low < legs.length && <path className="current-leg" vectorEffect="non-scaling-stroke"
      d={'M' + xy(a) + (q ? 'Q' + xy(q) + ' ' : 'L') + xy(head)} />}
    <circle className="traveler" cx={head.x} cy={head.y} vectorEffect="non-scaling-stroke" />
  </g>
}

function Trails({ layout, clock, progress, reduced }: {
  layout: Layout; clock: ReturnType<typeof schedule>; progress: number; reduced: boolean
}) {
  return <g className="route-trails" aria-hidden="true">{clock.tracks.map((track, vehicle) =>
    <VehicleTrail key={vehicle} layout={layout} legs={track.legs} vehicle={vehicle}
      time={progress * clock.longest} reduced={reduced} />)}</g>
}

export function RoutePlayback({ base, layout, layer, disabled, speed, setSpeed }: {
  base: Layout; layout: Layout; layer: SVGGElement | null; disabled: boolean; speed: number; setSpeed: (speed: number) => void
}) {
  const fleet = Boolean(base.vrp)
  const preference = fleet ? 'vrp-solver' : 'tsp-solver'
  const [selected, setSelected] = useState<SolverId>(() => {
    try {
      const id = localStorage.getItem(preference) as SolverId
      return solversFor(fleet).includes(id) ? id : 'cp-sat'
    } catch { return 'cp-sat' }
  })
  const { results, run, cancel } = useSolvers(base)
  const result = results[selected]
  const solution = result && result !== 'running' && 'routes' in result ? result : null
  const [phase, setPhase] = useState<'idle'|'solving'|'playing'|'paused'|'done'>('idle')

  const [elapsed, setElapsed] = useState(0)
  const position = useRef(0)
  const [message, setMessage] = useState('')
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const clock = useMemo(() => solution && schedule(solution.routes, base), [solution, base])

  useEffect(() => {
    if (phase !== 'solving' || !result || result === 'running') return
    if ('routes' in result) { setPhase('playing'); return }
    const reasons = { error: 'Route search failed. Try again.', unsupported: 'These weights exceed the solver’s numeric range.',
      infeasible: 'No valid tour on these roads.', unknown: 'No route found within the search.' }
    setMessage(reasons[result.status])
    setPhase('idle')
  }, [phase, result])
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (phase !== 'playing' || !clock) return
    let previous: number | undefined
    let frame: number
    function tick(now: number) {
      const delta = previous === undefined ? 0 : now - previous
      previous = now
      position.current = Math.min(clock!.duration, position.current + delta * speed)
      setElapsed(position.current)
      if (position.current >= clock!.duration) setPhase('done')
      else frame = requestAnimationFrame(tick)
    }
    const visibility = () => { previous = undefined }
    document.addEventListener('visibilitychange', visibility)
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility) }
  }, [phase, speed, clock])

  function choose(id: SolverId) {
    if (id === selected) return
    try { localStorage.setItem(preference, id) } catch { /* The session still remembers the selection. */ }
    setSelected(id)
    setMessage('')
    position.current = 0
    setElapsed(0)
    setPhase(phase === 'playing' || phase === 'solving' ? 'solving' : 'idle')
    run(id)
  }

  function toggle() {
    if (phase === 'playing') { setPhase('paused'); return }
    if (phase === 'solving') { cancel(selected); setPhase('idle'); return }
    if (phase === 'done') { position.current = 0; setElapsed(0) }
    setMessage('')
    if (solution) { setPhase('playing'); return }
    setPhase('solving')
    run(selected)
  }
  const label = { idle: 'Solve and play', solving: 'Cancel route search', playing: 'Pause routes', paused: 'Resume routes', done: 'Replay routes' }[phase]
  const Icon = { idle: Play, solving: LoaderCircle, playing: Pause, paused: Play, done: RotateCcw }[phase]
  return <>
    <GraphStatistics graph={base} solution={solution} />
    <div className="playback">
      {message && <div role="alert" className="playback-error">{message}</div>}
      <div className="pill playback-controls" role="group" aria-label="Route playback">
        <button onClick={toggle} disabled={disabled} aria-label={label} title={label}><Icon size={16} /></button>
        <SolverPicker fleet={fleet} selected={selected} results={results} choose={choose}
          compare={() => solversFor(fleet).forEach(run)} disabled={disabled} />
        <button className="playback-speed" aria-label={`Playback speed ${speed}×. Change speed`} title="Change playback speed"
          onClick={() => setSpeed(speeds[(speeds.indexOf(speed) + 1) % speeds.length])}>{speed}×</button>
      </div>
    </div>
    {layer && clock && createPortal(<Trails layout={layout} clock={clock} progress={elapsed / clock.duration} reduced={reduced} />, layer)}
  </>
}
