import { CircleDot, Package, Route as RouteIcon, Slash, Truck, Weight } from 'lucide-react'
import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { number } from '../graph-view'
import type { Layout } from '../layout'
import type { Route, Solution } from './solver'

type Solved = Extract<Solution, { routes: Route[] }>

function FleetCosts({ vehicles, nodes, solution }: {
  vehicles: NonNullable<Layout['vrp']>['vehicles']; nodes: Layout['nodes']; solution: Solved | null
}) {
  const loads = useMemo(() => {
    if (!solution) return null
    const demand = new Map(nodes.map(node => [node.id, node.weight]))
    return solution.routes.map(route =>
      route.stops.slice(1, -1).reduce((load, customer) => load + demand.get(customer)!, 0))
  }, [nodes, solution])
  const [open, setOpen] = useState(false)
  const pinned = useRef(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  function close() {
    pinned.current = false
    setOpen(false)
  }
  useEffect(() => {
    if (!open) return
    const outside = (event: globalThis.PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close()
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (root.current?.contains(document.activeElement)) trigger.current?.focus()
      close()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return <div className="fleet-analysis" ref={root}
    onPointerEnter={event => { if (event.pointerType === 'mouse') setOpen(true) }}
    onPointerLeave={() => { if (!pinned.current && !root.current?.contains(document.activeElement)) setOpen(false) }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close() }}>
    <button ref={trigger} className="pill fleet-status" aria-label={`Vehicle details for ${vehicles.length} drivers`}
      aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => { pinned.current = !pinned.current; setOpen(pinned.current) }}>
      <Truck size={14} aria-hidden="true" />{vehicles.length}
    </button>
    {open && <div className="fleet-popover">
      <div id={panelId} className="fleet-scroll" tabIndex={0} role="region" aria-label="Driver details">
        <table><thead><tr><th scope="col">Driver</th><th scope="col">Load / capacity</th>{solution && <th scope="col">Cost</th>}</tr></thead>
          <tbody>{vehicles.map((vehicle, i) => <tr key={i}>
            <th scope="row"><span className="driver-swatch" style={{ '--vehicle-index': i } as CSSProperties} />{i + 1}</th>
            <td>{loads ? number.format(loads[i]) : '—'} / {number.format(vehicle.capacity)}</td>
            {solution && <td>{number.format(solution.routes[i].cost)}</td>}</tr>)}</tbody>
        </table>
      </div>
    </div>}
  </div>
}

export const GraphStatistics = memo(function GraphStatistics({ graph, solution }: { graph: Layout; solution: Solved | null }) {
  const fleet = graph.vrp
  const WeightIcon = fleet ? Package : Weight
  const weightLabel = fleet ? 'Total packages' : 'Total node weight'
  const totalWeight = graph.nodes.reduce((sum, node) => node.id === fleet?.depot ? sum : sum + node.weight, 0)
  const costLabel = fleet ? 'Total fleet route cost' : 'Round-trip tour cost'
  const proof = solution?.status === 'optimal' ? 'Proven minimum' : 'Feasible route'
  return <div className="statistics" role="group" aria-label="Graph statistics">
    <div className="pill graph-status">
      <span className="metric" title="Nodes"><CircleDot size={14} />{number.format(graph.nodes.length)}<span className="sr-only"> nodes</span></span>
      <span className="metric" title="Edges"><Slash size={14} />{number.format(graph.edges.length)}<span className="sr-only"> edges</span></span>
    </div>
    <div className="pill graph-status solution-summary" role="status">
      <span className="metric" title={weightLabel}><WeightIcon size={14} />
        <span className="sr-only">{weightLabel} </span>{number.format(totalWeight)}</span>
      {solution && <span className="metric route-cost" title={`${costLabel} · ${proof}`}>
        <RouteIcon size={14} /><span className="sr-only">{costLabel}, {proof} </span>
        {solution.status === 'feasible' ? '≤ ' : ''}{number.format(solution.cost)}</span>}
    </div>
    {fleet && <FleetCosts vehicles={fleet.vehicles} nodes={graph.nodes} solution={solution} />}
  </div>
})
