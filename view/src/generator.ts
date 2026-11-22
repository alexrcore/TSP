import type { GraphData, GraphNode } from './graph'
import type { Point, VrpPlan } from './layout'
import { layoutFromGeometry } from './layout'
import Delaunator from 'delaunator'
import RBush from 'rbush'
import { quadtree } from 'd3-quadtree'

type Link = { a: number; b: number; length: number }
const turn = Math.PI * 2
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const id = (index: number) => String(index + 1)

// Choose an octave, then a count within it. Every octave can lead to another.
export function randomNodeCount(minimum = 3) {
  let span = 3
  let continuation = 1
  while (Math.random() < continuation) {
    span *= 2
    continuation *= 2 ** (-1 / 9)
  }
  return minimum + Math.floor(Math.random() * span)
}
const centroid = (points: Point[]) => points.reduce((sum, point) => ({
  x: sum.x + point.x / points.length, y: sum.y + point.y / points.length,
}), { x: 0, y: 0 })

function randomCloud(count: number) {
  const aspect = 2 ** (Math.random() * 2.2 - 1.1)
  const bend = Math.random() * 1.4 - 0.7
  const lean = Math.random() * 0.6 - 0.3
  const pocketWeight = Math.random() * 0.85
  const trials = 3 + Math.floor(Math.random() * 9)
  const pockets = Array.from({ length: 1 + Math.floor(Math.random() * 4) }, () => {
    const angle = Math.random() * turn
    const offset = Math.random() * 0.85
    return { x: Math.cos(angle) * offset, y: Math.sin(angle) * offset }
  })

  const points: Point[] = []
  const placed = quadtree<Point>().x(p => p.x).y(p => p.y)
  for (let index = 0; index < count; index++) {
    let selected: Point | undefined
    let bestClearance = -1
    // Keep some space between dots without imposing a lattice on the cloud.
    for (let trial = 0; trial < trials; trial++) {
      const angle = Math.random() * turn
      const radius = Math.sqrt(Math.random())
      const pocket = pockets[Math.floor(Math.random() * pockets.length)]
      const x = Math.cos(angle) * radius * (1 - pocketWeight) + pocket.x * pocketWeight
      const y = Math.sin(angle) * radius * (1 - pocketWeight) + pocket.y * pocketWeight
      const point = { x: x * aspect + y * lean, y: y + bend * x * x }
      const nearest = placed.find(point.x, point.y)
      const clearance = nearest ? distance(point, nearest) : Infinity
      if (clearance <= bestClearance) continue
      selected = point
      bestClearance = clearance
    }
    points.push(selected!)
    placed.add(selected!)
  }
  return points
}

const side = (a: Point, b: Point, p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)

function crosses(points: Point[], left: Link, right: Link) {
  if (left.a === right.a || left.a === right.b || left.b === right.a || left.b === right.b) return false
  const a = points[left.a], b = points[left.b], c = points[right.a], d = points[right.b]
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

function shuffled<T>(items: T[]) {
  const result = items.slice()
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    const item = result[index]
    result[index] = result[other]
    result[other] = item
  }
  return result
}

const pairKey = (count: number, a: number, b: number) => Math.min(a, b) * count + Math.max(a, b)
const road = (points: Point[], a: number, b: number): Link => ({ a, b, length: distance(points[a], points[b]) })

function box(a: Point, b: Point, pad = 0) {
  return { minX: Math.min(a.x, b.x) - pad, minY: Math.min(a.y, b.y) - pad,
    maxX: Math.max(a.x, b.x) + pad, maxY: Math.max(a.y, b.y) + pad }
}

function candidateRoads(points: Point[], roads: Link[]) {
  const count = points.length
  const present = new Set(roads.map(({ a, b }) => pairKey(count, a, b)))
  const chords = new Map<number, Link>()
  const existing = new RBush<ReturnType<typeof box> & { edge: Link }>()
    .load(roads.map(edge => ({ ...box(points[edge.a], points[edge.b]), edge })))
  const dots = new RBush<ReturnType<typeof box> & { index: number }>()
    .load(points.map((p, index) => ({ ...box(p, p), index })))
  const clearance = 0.12 / Math.sqrt(count)
  function consider(a: number, b: number) {
    const key = pairKey(count, a, b)
    if (present.has(key)) return
    present.add(key)
    const edge = road(points, a, b)
    const p = points[a], q = points[b]
    if (existing.search(box(p, q)).some(other => crosses(points, edge, other.edge))) return
    const nearNode = dots.search(box(p, q, clearance)).some(({ index }) => {
      if (index === a || index === b) return false
      const point = points[index]
      const along = ((point.x - p.x) * (q.x - p.x) + (point.y - p.y) * (q.y - p.y)) / edge.length
      return along > 0 && along < edge.length && Math.abs(side(p, q, point)) / edge.length < clearance
    })
    if (!nearNode) chords.set(key, edge)
  }
  // A triangulation supplies local roads in linear space. Sample longer chords too.
  const { triangles } = Delaunator.from(points, p => p.x, p => p.y)
  for (let i = 0; i < triangles.length; i += 3) {
    consider(triangles[i], triangles[i + 1])
    consider(triangles[i + 1], triangles[i + 2])
    consider(triangles[i + 2], triangles[i])
  }
  for (let a = 0; a < count; a++) {
    const b = Math.floor(Math.random() * count)
    if (a !== b) consider(a, b)
  }
  return chords
}

function addRoads(points: Point[], links: Link[], chords: Link[], budget: number, reserved: Link[] = []) {
  if (budget <= 0) return
  // candidateRoads already checked the base roads. Only newly accepted chords can conflict.
  const additions = new RBush<ReturnType<typeof box> & { edge: Link }>()
  for (const edge of reserved) additions.insert({ ...box(points[edge.a], points[edge.b]), edge })
  let added = 0
  for (const edge of shuffled(chords)) {
    const bounds = box(points[edge.a], points[edge.b])
    if (additions.search(bounds).some(other => crosses(points, edge, other.edge))) continue
    links.push(edge)
    additions.insert({ ...bounds, edge })
    if (++added >= budget) break
  }
}

function centered(points: Point[]) {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
  for (const { x, y } of points) {
    left = Math.min(left, x); right = Math.max(right, x)
    top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  const scale = 470 / Math.max(right - left, bottom - top)
  return points.map(({ x, y }) => ({ x: (x - (left + right) / 2) * scale, y: (y - (top + bottom) / 2) * scale }))
}

function buildGraph(nodes: GraphNode[], links: Link[], start: string): GraphData {
  const shortest = links.reduce((length, edge) => Math.min(length, edge.length), Infinity)
  // Use one scale for the whole graph, with at most 1% rounding per edge.
  const unitsPerLength = Math.max(100, 2 ** Math.ceil(Math.log2(50 / shortest)))
  return { nodes, start, edges: links.map(({ a, b, length }) => ({
    source: nodes[a].id, target: nodes[b].id, weight: Math.round(length * unitsPerLength),
  })) }
}

function adjacency(graph: GraphData) {
  const neighbors = new Map(graph.nodes.map(({ id }) => [id, new Set<string>()]))
  for (const { source, target } of graph.edges) {
    neighbors.get(source)?.add(target)
    neighbors.get(target)?.add(source)
  }
  return neighbors
}

function assertTour(graph: GraphData, tour: string[]) {
  const neighbors = adjacency(graph)
  const valid = tour.length >= 3 && tour.length === graph.nodes.length && new Set(tour).size === tour.length &&
    graph.start !== undefined && tour.includes(graph.start) &&
    tour.every((node, index) => neighbors.get(node)?.has(tour[(index + 1) % tour.length]))
  if (!valid) throw new Error('Generated graph is missing its closed tour.')
}

function simpleTour(points: Point[]) {
  const count = points.length
  // Bound work spent untangling; the angular sweep below handles any remaining crossings.
  if (Math.random() < 0.6) {
    // Uncross a random polygon. Each reversal replaces two crossing roads by shorter ones.
    const order = shuffled(points.map((_, i) => i))
    let comparisons = count * Math.ceil(Math.log2(count)) ** 2
    untangle: for (let pass = 0; pass < count; pass++) {
      let changed = false
      for (let i = 0; i < count - 2; i++) {
        for (let j = i + 2; j < count; j++) {
          if (--comparisons < 0) break untangle
          if (!crosses(points, road(points, order[i], order[i + 1]), road(points, order[j], order[(j + 1) % count]))) continue
          for (let left = i + 1, right = j; left < right; left++, right--) {
            const saved = order[left]
            order[left] = order[right]
            order[right] = saved
          }
          changed = true
        }
      }
      if (!changed) return order
    }
  }
  // Two monotone chains on opposite sides of the extreme-point line give another simple polygon.
  if (Math.random() < 0.5) {
    const angle = Math.random() * turn, dx = Math.cos(angle), dy = Math.sin(angle)
    const order = points.map((_, i) => i).sort((a, b) =>
      (points[a].x - points[b].x) * dx + (points[a].y - points[b].y) * dy)
    const first = points[order[0]], last = points[order.at(-1)!]
    const upper: number[] = [], lower: number[] = []
    for (const i of order.slice(1, -1)) (side(first, last, points[i]) >= 0 ? upper : lower).push(i)
    return [order[0], ...upper, order.at(-1)!, ...lower.reverse()]
  }
  const center = centroid(points)
  return points.map(({ x, y }, index) => ({ index, angle: Math.atan2(y - center.y, x - center.x) }))
    .sort((a, b) => a.angle - b.angle).map(({ index }) => index)
}

export function generateTspLayout() {
  const count = randomNodeCount()
  const points = randomCloud(count)
  const tour = simpleTour(points)
  const cycle = tour.map((a, index) => road(points, a, tour[(index + 1) % count]))
  const links = cycle.slice()
  const chords = candidateRoads(points, links)

  // When the shape allows it, reserve a second tour by swapping two separate cycle links.
  const alternatives: [Link, Link][] = []
  const successor = new Map(cycle.map(link => [link.a, link.b]))
  for (const entry of chords.values()) {
    const exit = chords.get(pairKey(count, successor.get(entry.a)!, successor.get(entry.b)!))
    if (exit && !crosses(points, entry, exit)) alternatives.push([entry, exit])
  }
  const extraBudget = Math.round((2 * count - 6) * Math.random() ** 1.25)
  if (extraBudget >= 2 && alternatives.length && Math.random() < 0.75) {
    const extraTour = alternatives[Math.floor(Math.random() * alternatives.length)]
    links.push(...extraTour)
    for (const { a, b } of extraTour) chords.delete(pairKey(count, a, b))
  }

  addRoads(points, links, [...chords.values()], extraBudget - (links.length - count), links.slice(count))
  const degree = points.map(() => 0)
  for (const { a, b } of links) { degree[a]++; degree[b]++ }

  // Well-connected starts appear more often, while every vertex remains eligible.
  const preference = Math.random() * 4
  const scores = degree.map((neighbors) => Math.random() ** (1 / neighbors ** preference))
  const start = scores.reduce((best, score, i) => score > scores[best] ? i : best, 0)
  const weightScale = randomNodeCount(1)
  const nodes = points.map((_, index) => ({ id: id(index), weight: 1 + Math.floor(Math.random() * weightScale) }))
  const graph = buildGraph(nodes, links, id(start))
  assertTour(graph, tour.map(id))
  const offset = tour.indexOf(start)
  const closedTour = [...tour.slice(offset), ...tour.slice(0, offset), start].map(id)
  return { ...layoutFromGeometry(graph, centered(points)), tour: closedTour }
}

function assertRoutes(graph: GraphData, plan: VrpPlan) {
  const neighbors = adjacency(graph)
  const unserved = new Map(graph.nodes.filter((node) => node.id !== plan.depot).map(({ id, weight }) => [id, weight]))
  for (const { route, capacity } of plan.vehicles) {
    if (route.length < 3 || route[0] !== plan.depot || route.at(-1) !== plan.depot) {
      throw new Error('Generated vehicle route must start and end at the depot.')
    }
    let load = 0
    for (let index = 1; index < route.length; index++) {
      const customer = route[index]
      if (!neighbors.get(route[index - 1])?.has(customer)) throw new Error('Generated vehicle route is missing an edge.')
      if (index === route.length - 1) continue
      load += unserved.get(customer) ?? Infinity
      unserved.delete(customer)
    }
    if (load > capacity) throw new Error('Generated vehicle route exceeds capacity or repeats a stop.')
  }
  if (unserved.size) throw new Error('Generated vehicle routes skipped a customer.')
}

function sectorRoutes(points: Point[], depot: number, targetFleet: number) {
  const origin = points[depot]
  const cut = Math.random() * turn
  const customers = points.flatMap(({ x, y }, index) => index === depot ? [] : [{
    index, angle: (Math.atan2(y - origin.y, x - origin.x) - cut + 2 * turn) % turn,
  }]).sort((a, b) => a.angle - b.angle)
  const breaks = new Set(shuffled(customers.slice(1).map((_, index) => index + 1)).slice(0, targetFleet - 1))

  // Random splits vary the fleet and stops per vehicle. Splitting spans of half a turn
  // keeps each initial route inside its own convex sector, even with an off-center depot.
  const groups: number[][] = []
  let firstAngle = -Infinity
  customers.forEach(({ index, angle }, position) => {
    if (!position || breaks.has(position) || angle - firstAngle >= Math.PI) {
      groups.push([])
      firstAngle = angle
    }
    groups.at(-1)!.push(index)
  })
  return groups
}

function splitRoutes(points: Point[], depot: number, targetFleet: number) {
  const tour = simpleTour(points)
  const offset = tour.indexOf(depot)
  const stops = [...tour.slice(offset + 1), ...tour.slice(0, offset)]
  if (targetFleet === 1) return [stops]
  const edgeBox = (a: number, b: number) => ({ ...box(points[a], points[b]), edge: road(points, a, b) })
  const tourEdges = new Map(tour.map((a, i) => [a, edgeBox(a, tour[(i + 1) % tour.length])]))
  const links = new RBush<ReturnType<typeof edgeBox>>().load([...tourEdges.values()])
  const cuts = new Set<number>()
  for (const i of shuffled(stops.slice(1).map((_, i) => i + 1))) {
    const a = stops[i - 1], b = stops[i]
    const outward = edgeBox(depot, b), inward = edgeBox(a, depot)
    if ([outward, inward].some(link => links.search(link).some(other => crosses(points, link.edge, other.edge)))) continue
    links.remove(tourEdges.get(a)!)
    links.insert(outward)
    links.insert(inward)
    cuts.add(i)
    if (cuts.size + 1 === targetFleet) break
  }
  if (!cuts.size) return sectorRoutes(points, depot, targetFleet)
  const groups: number[][] = [[]]
  stops.forEach((stop, i) => { if (cuts.has(i)) groups.push([]); groups.at(-1)!.push(stop) })
  return groups
}

export function generateVrpLayout() {
  const points = randomCloud(randomNodeCount(2))
  const center = centroid(points)
  const bias = Math.random() * 5
  const scores = points.map(point => Math.random() / (1 + bias * distance(point, center)))
  const depot = scores.reduce((best, score, i) => score > scores[best] ? i : best, 0)
  const demandScale = randomNodeCount(1)
  const demandSkew = 0.4 + 2.8 * Math.random()
  const nodes: GraphNode[] = points.map((_, index) => index === depot
    ? { id: 'D', label: 'Depot', weight: 0 }
    : { id: id(index), weight: 1 + Math.floor(Math.random() ** demandSkew * demandScale) })
  const targetFleet = 1 + Math.floor((points.length - 1) * Math.random() ** (0.7 + Math.random() * 3))
  const groups = targetFleet === 1 || Math.random() < 0.5
    ? splitRoutes(points, depot, targetFleet) : sectorRoutes(points, depot, targetFleet)
  const slack = Math.random() < 0.15 ? 0 : 2 * Math.random()

  const links: Link[] = []
  const vehicles = groups.map((group) => {
    group.forEach((customer, index) => links.push(road(points, group[index - 1] ?? depot, customer)))
    if (group.length > 1) links.push(road(points, group.at(-1)!, depot))
    const load = group.reduce((total, stop) => total + nodes[stop].weight, 0)
    const capacity = load + Math.floor(Math.random() * (load + demandScale) * slack)
    return { capacity, route: [depot, ...group, depot].map((index) => nodes[index].id) }
  })
  if (Math.random() < 0.2) {
    const common = vehicles.reduce((largest, v) => Math.max(largest, v.capacity), 0)
    for (const vehicle of vehicles) vehicle.capacity = common
  }

  // Add optional roads both within and between the original routes without changing feasibility.
  const extraBudget = Math.round((3 * points.length - 6 - links.length) * Math.random() ** 1.65)
  if (extraBudget) addRoads(points, links, [...candidateRoads(points, links).values()], extraBudget)

  const plan = { depot: nodes[depot].id, vehicles }
  const graph = buildGraph(nodes, links, plan.depot)
  assertRoutes(graph, plan)
  return { ...layoutFromGeometry(graph, centered(points)), vrp: plan }
}


