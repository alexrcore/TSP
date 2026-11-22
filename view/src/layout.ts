import { packSiblings } from 'd3-hierarchy'
import type { GraphData, GraphEdge, GraphNode } from './graph'
import { placeGrid } from './grid-placement'
import { placeCycle, placeLoops } from './loop-placement'
import { settleComponent } from './placement'
import type { Spring } from './placement'

export interface Point {
  x: number
  y: number
}

export interface PositionedNode extends GraphNode, Point {
  radius: number
  isStart: boolean
}

export interface PositionedEdge extends GraphEdge {
  from: number
  to: number
  bend: number
  path: string
  midpoint: Point
  controls: Point[]
}

export interface VrpPlan {
  depot: string
  vehicles: { capacity: number; route: string[] }[]
}

export interface Layout {
  nodes: PositionedNode[]
  edges: PositionedEdge[]
  bounds: { left: number; top: number; right: number; bottom: number }
  vrp?: VrpPlan
  tour?: string[]
}

function bounds(points: Point[], padding = 0): Layout['bounds'] {
  if (points.length === 0) return { left: 0, top: 0, right: 0, bottom: 0 }
  let { x: left, x: right, y: top, y: bottom } = points[0]
  for (const { x, y } of points) {
    left = Math.min(left, x)
    right = Math.max(right, x)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
  return { left: left - padding, top: top - padding, right: right + padding, bottom: bottom + padding }
}

function orient(nodes: PositionedNode[]) {
  const box = bounds(nodes)
  const x = (box.left + box.right) / 2
  const y = (box.top + box.bottom) / 2
  let xx = 0, yy = 0, xy = 0
  for (const node of nodes) {
    node.x -= x
    node.y -= y
    xx += node.x ** 2
    yy += node.y ** 2
    xy += node.x * node.y
  }
  // Keep a slight diagonal while bringing the longest axis into the viewport.
  const angle = 0.12 - Math.atan2(2 * xy, xx - yy) / 2
  const cos = Math.cos(angle), sin = Math.sin(angle)
  for (const node of nodes) {
    const { x, y } = node
    node.x = x * cos - y * sin
    node.y = x * sin + y * cos
  }
  const start = nodes.find(({ isStart }) => isStart)
  if (start && start.x > 0) {
    for (const node of nodes) { node.x = -node.x; node.y = -node.y }
  }
}

function drawEdge(edge: GraphEdge & { from: number; to: number; bend: number }, nodes: PositionedNode[]): PositionedEdge {
  const a = nodes[edge.from], b = nodes[edge.to]
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const start = `M${a.x},${a.y}`
  let path = `${start}L${b.x},${b.y}`
  let controls: Point[] = []
  if (a === b) {
    const r = edge.bend
    controls = [{ x: a.x - r, y: a.y - r * 2 }, { x: a.x + r, y: a.y - r * 2 }]
    midpoint.y = a.y - r * 1.5
    path = `${start}C${controls[0].x},${controls[0].y} ${controls[1].x},${controls[1].y} ${a.x},${a.y}`
  } else if (edge.bend) {
    const dx = b.x - a.x, dy = b.y - a.y
    const offset = edge.bend / Math.max(1, Math.hypot(dx, dy))
    const x = midpoint.x - dy * offset, y = midpoint.y + dx * offset
    controls = [{ x, y }]
    midpoint.x = (midpoint.x + x) / 2
    midpoint.y = (midpoint.y + y) / 2
    path = `${start}Q${x},${y} ${b.x},${b.y}`
  }
  return { ...edge, path, midpoint, controls }
}

function graphBounds(nodes: PositionedNode[], edges: PositionedEdge[]) {
  return bounds([...nodes, ...edges.flatMap(({ controls }) => controls)], 10)
}

export function moveNodes(layout: Layout, points: Point[]): Layout {
  const nodes = layout.nodes.map((node, index) => node.x === points[index].x && node.y === points[index].y
    ? node : { ...node, ...points[index] })
  const edges = layout.edges.map((edge) => nodes[edge.from] === layout.nodes[edge.from] && nodes[edge.to] === layout.nodes[edge.to]
    ? edge : drawEdge(edge, nodes))
  return { ...layout, nodes, edges, bounds: graphBounds(nodes, edges) }
}

function createNodes(graph: GraphData, positions?: Point[]): PositionedNode[] {
  const [min, max] = graph.nodes.reduce(([low, high], node) =>
    [Math.min(low, node.weight), Math.max(high, node.weight)], [Infinity, -Infinity])
  const magnitude = Math.max(1, Math.abs(min), Math.abs(max))
  const range = max / magnitude - min / magnitude
  const start = graph.start ?? graph.nodes[0]?.id
  return graph.nodes.map((node, index) => ({
    ...node,
    x: positions?.[index].x ?? 0,
    y: positions?.[index].y ?? 0,
    isStart: node.id === start,
    radius: 2.35 + (min === max ? 0.7 : 2.3 * Math.sqrt((node.weight / magnitude - min / magnitude) / range)),
  }))
}

function drawGraph(graph: GraphData, nodes: PositionedNode[], length: (weight: number) => number): Layout {
  // Parallel edges share endpoints. Bend the additional paths so each remains visible.
  const parallels = new Map<string, number>()
  const indices = new Map(nodes.map(({ id }, index) => [id, index]))
  const edges = graph.edges.map((edge): PositionedEdge => {
    const [start, end] = edge.source < edge.target ? [edge.source, edge.target] : [edge.target, edge.source]
    const key = JSON.stringify([start, end])
    const index = parallels.get(key) ?? 0
    parallels.set(key, index + 1)
    const bend = start === end ? 13 + length(edge.weight) / 8 + index * 8 : Math.ceil(index / 2) * (index % 2 ? 14 : -14)
    return drawEdge({ ...edge, from: indices.get(start)!, to: indices.get(end)!, bend }, nodes)
  })
  return { nodes, edges, bounds: graphBounds(nodes, edges) }
}

export function layoutFromGeometry(graph: GraphData, positions: Point[]) {
  return drawGraph(graph, createNodes(graph, positions), (weight) => weight)
}

export function layoutGraph(graph: GraphData): Layout {
  const weights = graph.edges.map(({ weight }) => weight).filter((weight) => weight > 0).sort((a, b) => a - b)
  const typical = weights[Math.floor(weights.length / 2)] ?? 1
  // Preserve normal weight ratios, with a visible minimum and a soft cap for outliers.
  const length = (weight: number) => {
    const ratio = weight / typical
    if (ratio < 0.3) return 88 * (0.18 + ratio * 0.4)
    if (ratio <= 1.85) return 88 * ratio
    return 88 * (1.85 + 0.85 * (1 - Math.exp(-(ratio - 1.85) / 1.35)))
  }
  const nodes = createNodes(graph)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const neighbors = new Map(nodes.map((node) => [node.id, new Set<PositionedNode>()]))
  const springs = new Map<string, Spring[]>()
  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue
    const source = byId.get(edge.source)!
    const target = byId.get(edge.target)!
    neighbors.get(source.id)!.add(target)
    neighbors.get(target.id)!.add(source)
    const spring = { source, target, distance: length(edge.weight), weight: edge.weight }
    const outgoing = springs.get(edge.source) ?? []
    outgoing.push(spring)
    springs.set(edge.source, outgoing)
  }

  const seen = new Set<PositionedNode>()
  const components = []
  for (const first of nodes) {
    if (seen.has(first)) continue
    const members = [first]
    const links: Spring[] = []
    seen.add(first)
    for (const node of members) {
      for (const link of springs.get(node.id) ?? []) links.push(link)
      for (const neighbor of neighbors.get(node.id)!) {
        if (seen.has(neighbor)) continue
        seen.add(neighbor)
        members.push(neighbor)
      }
    }
    if (members.length > 1 && !placeCycle(members, links, typical) && !placeLoops(members, links, typical) && !placeGrid(members, links)) {
      settleComponent(members, links)
      orient(members)
    }
    let radius = 0
    for (const node of members) radius = Math.max(radius, Math.hypot(node.x, node.y))
    components.push({ members, r: radius + 30, x: 0, y: 0 })
  }

  if (components.length > 1) {
    packSiblings(components.sort((a, b) => b.r - a.r))
    for (const component of components) {
      for (const node of component.members) {
        node.x += component.x
        node.y += component.y
      }
    }
  }

  return drawGraph(graph, nodes, length)
}
