import type { Point, PositionedNode } from './layout'
import type { Spring } from './placement'

function hops(from: PositionedNode, adjacent: Map<PositionedNode, PositionedNode[]>) {
  const distances = new Map([[from, 0]])
  const queue = [from]
  for (const node of queue) {
    for (const next of adjacent.get(node)!) {
      if (distances.has(next)) continue
      distances.set(next, distances.get(node)! + 1)
      queue.push(next)
    }
  }
  return distances
}

function axis(bands: { total: number; count: number }[], vertical = false) {
  const offsets: Point[] = [{ x: 0, y: 0 }]
  // A gentle bend keeps rows and columns distinct without locking the drawing to right angles.
  // Both axes stay monotone and their sideways slopes stay below one, so the grid cannot fold.
  for (const [index, band] of bands.entries()) {
    const angle = bands.length === 1 ? 0 : 0.34 * (index / (bands.length - 1) - 0.5)
    const magnitude = band.total / band.count
    const along = magnitude * Math.cos(angle), sideways = magnitude * Math.sin(angle)
    const previous = offsets.at(-1)!
    offsets.push({ x: previous.x + (vertical ? -sideways : along), y: previous.y + (vertical ? along : sideways) })
  }
  const end = offsets.at(-1)!
  return offsets.map(({ x, y }) => ({ x: x - end.x / 2, y: y - end.y / 2 }))
}

export function placeGrid(nodes: PositionedNode[], links: Spring[]): boolean {
  if (nodes.length < 4) return false
  const adjacent = new Map(nodes.map((node) => [node, [] as PositionedNode[]]))
  for (const { source, target } of links) {
    const outgoing = adjacent.get(source)!
    if (outgoing.includes(target)) return false
    outgoing.push(target)
    adjacent.get(target)!.push(source)
  }

  const corners = nodes.filter((node) => adjacent.get(node)!.length === 2)
  if (corners.length !== 4) return false
  const origin = corners.find((node) => node.isStart) ?? corners[0]
  const fromOrigin = hops(origin, adjacent)

  // Distances from two adjacent corners recover row and column from connectivity.
  // Reject any candidate that does not reconstruct the whole rectangular grid.
  for (const corner of corners) {
    const width = fromOrigin.get(corner)!
    if (width < 1 || nodes.length % (width + 1) !== 0) continue
    const height = nodes.length / (width + 1) - 1
    if (height < 1 || width < height || links.length !== width * (height + 1) + height * (width + 1)) continue
    const fromCorner = hops(corner, adjacent)
    const cells = new Map<PositionedNode, { column: number; row: number }>()
    const occupied = new Set<number>()
    for (const node of nodes) {
      const originDistance = fromOrigin.get(node)!
      const column = (originDistance - fromCorner.get(node)! + width) / 2
      const row = originDistance - column
      const index = row * (width + 1) + column
      if (!Number.isInteger(column) || column < 0 || column > width || row < 0 || row > height || occupied.has(index)) break
      occupied.add(index)
      cells.set(node, { column, row })
    }
    if (cells.size !== nodes.length) continue

    const columns = Array.from({ length: width }, () => ({ total: 0, count: 0 }))
    const rows = Array.from({ length: height }, () => ({ total: 0, count: 0 }))
    const compatible = links.every(({ source, target, distance }) => {
      const a = cells.get(source)!, b = cells.get(target)!
      if (Math.abs(a.column - b.column) + Math.abs(a.row - b.row) !== 1) return false
      const band = a.row === b.row ? columns[Math.min(a.column, b.column)] : rows[Math.min(a.row, b.row)]
      band.total += distance
      band.count++
      return true
    })
    if (!compatible) continue

    const horizontal = axis(columns), vertical = axis(rows, true)
    for (const node of nodes) {
      const { column, row } = cells.get(node)!
      node.x = horizontal[column].x + vertical[row].x
      node.y = horizontal[column].y + vertical[row].y
    }
    return true
  }
  return false
}

