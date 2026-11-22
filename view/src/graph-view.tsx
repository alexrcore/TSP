import { memo } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import type { Layout, Point } from './layout'

export type GraphItem = { kind: 'node' | 'edge'; index: number }
export type Inspection = { item: GraphItem; anchor: Point }

export const number = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 12 })
const edgeLabel = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

function isItem(a: GraphItem | null, b: GraphItem) {
  return a?.kind === b.kind && a.index === b.index
}

function onKey(event: KeyboardEvent<SVGGElement>, activate: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  event.stopPropagation()
  activate()
}

function edgeAnchor(event: PointerEvent<SVGGElement> | MouseEvent<SVGGElement>, fallback: Point) {
  const matrix = event.currentTarget.getScreenCTM()
  if (!matrix || event.detail === 0 && event.clientX === 0 && event.clientY === 0) return fallback
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
}

export const GraphView = memo(function GraphView({
  layout, selected, showNodes, showEdges, hover, activate, beginDrag, routeLayer,
}: {
  layout: Layout
  routeLayer: (element: SVGGElement | null) => void
  selected: GraphItem | null
  showNodes: boolean
  showEdges: boolean
  hover: (inspection: Inspection | null) => void
  activate: (inspection: Inspection) => void
  beginDrag: (event: PointerEvent<SVGGElement>, index: number, point: Point) => void
}) {
  const selectedNode = selected?.kind === 'node' ? layout.nodes[selected.index] : undefined
  const selectedEdge = selected?.kind === 'edge' ? layout.edges[selected.index] : undefined
  const adjacent = new Set([selectedNode?.id, selectedEdge?.source, selectedEdge?.target])
  const isIncident = (source: string, target: string) => source === selectedNode?.id || target === selectedNode?.id
  if (selectedNode) {
    for (const { source, target } of layout.edges) {
      if (!isIncident(source, target)) continue
      adjacent.add(source)
      adjacent.add(target)
    }
  }

  return (
    <>
      <g className="edges">
        {layout.edges.map(({ source, target, weight, path, midpoint }, index) => {
          const item = { kind: 'edge', index } as const
          const inspection = { item, anchor: midpoint }
          const pressed = isItem(selected, item)
          const className = pressed || isIncident(source, target) ? 'edge related' : selected ? 'edge muted' : 'edge'
          return (
            <g key={index} role="button" tabIndex={-1} data-edge={index} aria-pressed={pressed}
              aria-label={`Edge ${source} to ${target}, weight ${number.format(weight)}`} className={className}
              onPointerMove={(event) => {
                if (event.pointerType !== 'touch' && !event.buttons) hover({ item, anchor: edgeAnchor(event, midpoint) })
              }}
              onPointerLeave={() => hover(null)}
              onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) hover(inspection) }}
              onBlur={() => hover(null)}
              onClick={(event) => { event.stopPropagation(); activate({ item, anchor: edgeAnchor(event, midpoint) }) }}
              onKeyDown={(event) => onKey(event, () => activate(inspection))}>
              <path className="edge-line" d={path} vectorEffect="non-scaling-stroke" />
              <path className="edge-hit" d={path} vectorEffect="non-scaling-stroke" />
            </g>
          )
        })}
      </g>

      <g ref={routeLayer} pointerEvents="none" />
      {showEdges && <g className="weights edge-weights" aria-hidden="true">
        {layout.edges.map(({ midpoint, weight }, index) => (
          <g key={index} transform={`translate(${midpoint.x},${midpoint.y})`}>
            <text dy=".35em" textAnchor="middle" vectorEffect="non-scaling-stroke">{weight > 0 && weight < 0.01 ? number.format(weight) : edgeLabel.format(weight)}</text>
          </g>
        ))}
      </g>}

      {layout.nodes.map(({ id, label, weight, radius, x, y, isStart }, index) => {
        const item = { kind: 'node', index } as const
        const inspection = { item, anchor: { x, y } }
        const pressed = isItem(selected, item)
        const name = isStart ? (layout.vrp ? 'Depot' : `Start node ${label ?? id}`) : label ?? id
        const measure = layout.vrp ? 'demand' : 'weight'
        return (
          <g key={id} role="button" tabIndex={-1} data-node={index} aria-pressed={pressed}
            aria-label={`${name}, ${measure} ${number.format(weight)}`}
            className={`node${isStart ? ' start-node' : ''}${pressed ? ' selected' : selected && !adjacent.has(id) ? ' muted' : ''}`}
            transform={`translate(${x},${y})`}
            onPointerDown={(event) => beginDrag(event, index, inspection.anchor)}
            onPointerEnter={(event) => { if (event.pointerType !== 'touch' && !event.buttons) hover(inspection) }}
            onPointerLeave={() => hover(null)}
            onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) hover(inspection) }}
            onBlur={() => hover(null)}
            onClick={(event) => { event.stopPropagation(); activate(inspection) }}
            onKeyDown={(event) => onKey(event, () => activate(inspection))}>
            <circle className="node-hit" />
            <circle className="node-ring" vectorEffect="non-scaling-stroke" />
            <circle className="node-dot" style={{ r: `calc(var(--unit) * ${isStart ? 9 : radius})` }} />
            {isStart && <text className="start-mark" dy=".35em" textAnchor="middle" aria-hidden="true">{layout.vrp ? 'D' : 'S'}</text>}
          </g>
        )
      })}

      {showNodes && <g className="weights node-weights" aria-hidden="true">
        {layout.nodes.filter((node) => !layout.vrp || !node.isStart).map(({ id, x, y, weight, isStart }) => (
          <g key={id} transform={`translate(${x},${y})`}>
            <text dy={isStart ? '-1.35em' : '-.95em'} textAnchor="middle" vectorEffect="non-scaling-stroke">{number.format(weight)}</text>
          </g>
        ))}
      </g>}
    </>
  )
})

