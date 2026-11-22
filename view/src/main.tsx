import { CircleDot, FileUp, LoaderCircle, Maximize, Minus, Moon, Plus, Route, Slash, Sun, Truck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, PointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { useCamera } from './camera'
import { RoutePlayback } from './routing/playback'
import { fixedLengthDrag } from './fixed-length-drag'
import { GraphView, number } from './graph-view'
import type { GraphItem, Inspection } from './graph-view'
import { moveNodes } from './layout'
import type { Layout, Point } from './layout'
import './style.css'

const zoomStep = 1.25

type NodeGesture = {
  target: SVGGElement
  pointer: number
  start: Point
  offset: Point
  solve: (target: Point) => Point[]
}

function scenePoint(scene: SVGGElement | null, event: PointerEvent): Point | undefined {
  const matrix = scene?.getScreenCTM()
  if (matrix) return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
}

function savedDarkMode() {
  try {
    return localStorage.getItem('graph-theme') === 'dark'
  } catch {
    return false
  }
}

function Metric({ icon: Icon = CircleDot, title, value }: { icon?: LucideIcon; title?: string; value: number }) {
  return <span className="metric" aria-hidden="true" title={title}><Icon size={14} />{number.format(value)}</span>
}

function ZoomInput({ level, setLevel, disabled }: { level: number; setLevel: (level: number) => void; disabled: boolean }) {
  const [draft, setDraft] = useState<string | null>(null)
  function commit() {
    setDraft(null)
    const value = draft?.trim().replace(/%$/, '').trim()
    if (value && /^\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value))) setLevel(Math.round(Number(value)))
  }
  return (
    <label className="zoom-field">
      <input aria-label="Zoom percentage" inputMode="numeric" autoComplete="off" spellCheck={false}
        disabled={disabled} value={draft ?? String(level)} onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') setDraft(null)
        }} />
      <span aria-hidden="true">%</span>
    </label>
  )
}

function GraphDetail({ anchor, view, description, value, count }: {
  anchor: Point
  view: ReturnType<typeof useCamera>['view']
  description: string
  value: number
  count?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [x, y] = view.transform.apply(view.rotated ? [-anchor.y, anchor.x] : [anchor.x, anchor.y])
  const visible = x >= 0 && x <= view.width && y >= 0 && y <= view.height

  useLayoutEffect(() => {
    if (!visible || !ref.current) return
    const element = ref.current
    const { offsetWidth: width, offsetHeight: height } = element
    const left = Math.max(8, Math.min(view.width - width - 8, x - width / 2))
    const above = y - height - 13
    const top = above >= 56 ? above : Math.max(8, Math.min(y + 13, view.height - height - 8))
    element.style.transform = `translate(${left}px, ${top}px)`
  }, [x, y, visible, view.width, view.height, value, count])

  if (!visible) return null
  return (
    <div ref={ref} className="graph-detail" role="tooltip" aria-label={description}>
      <Metric value={value} icon={count === undefined ? Slash : CircleDot} />
      {count !== undefined && <Metric value={count} icon={Slash} />}
    </div>
  )
}

function App() {
  const [baseLayout, setBaseLayout] = useState<Layout>({ nodes: [], edges: [], bounds: { left: 0, right: 0, top: 0, bottom: 0 } })
  const [graphVersion, setGraphVersion] = useState(0)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [routeLayer, setRouteLayer] = useState<SVGGElement | null>(null)
  const [editedLayout, setEditedLayout] = useState<Layout | null>(null)
  const layout = editedLayout ?? baseLayout
  const [pinned, setPinned] = useState<Inspection | null>(null)
  const [hovered, setHovered] = useState<Inspection | null>(null)
  const [showNodes, setShowNodes] = useState(false)
  const [showEdges, setShowEdges] = useState(false)
  const [dark, setDark] = useState(savedDarkMode)
  const [pending, setPending] = useState<'tsp' | 'vrp' | 'file' | null>('tsp')
  const loading = pending !== null
  const graphWorker = useRef<Worker | null>(null)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const gesture = useRef<NodeGesture | null>(null)
  const didDrag = useRef(false)
  const camera = useCamera(baseLayout, layout.bounds)
  const scene = camera.scene
  const hasNodes = layout.nodes.length > 0
  const inspection = hovered ?? pinned
  const inspectedNode = inspection?.item.kind === 'node' ? layout.nodes[inspection.item.index] : undefined
  const inspectedEdge = inspection?.item.kind === 'edge' ? layout.edges[inspection.item.index] : undefined
  const degrees = useMemo(() => {
    const values = baseLayout.nodes.map(() => 0)
    for (const { from, to } of baseLayout.edges) {
      values[from]++
      if (to !== from) values[to]++
    }
    return values
  }, [baseLayout])
  const degree = inspection?.item.kind === 'node' ? degrees[inspection.item.index] : 0

  useLayoutEffect(() => {
    const theme = dark ? 'dark' : 'light'
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#080a0d' : '#f7f9fc')
    try {
      localStorage.setItem('graph-theme', theme)
    } catch {
      // The current session can still change themes if browser storage is unavailable.
    }
  }, [dark])

  function clearInspection() {
    setPinned(null)
    setHovered(null)
  }

  const beginDrag = useCallback((event: PointerEvent<SVGGElement>, index: number, point: Point) => {
    if (!event.isPrimary || event.button !== 0 || event.ctrlKey) return
    const cursor = scenePoint(scene.current, event)
    if (!cursor) return
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    gesture.current = {
      target, pointer: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      offset: { x: point.x - cursor.x, y: point.y - cursor.y },
      solve: fixedLengthDrag(layout, baseLayout, index),
    }
  }, [scene, layout, baseLayout])

  function dragNode(event: PointerEvent<SVGSVGElement>) {
    const drag = gesture.current
    if (!drag || drag.pointer !== event.pointerId) return
    if (!didDrag.current) {
      if (Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < 4) return
      didDrag.current = true
      event.currentTarget.dataset.dragging = ''
      clearInspection()
    }
    const cursor = scenePoint(scene.current, event)
    if (!cursor) return
    const moved = { x: cursor.x + drag.offset.x, y: cursor.y + drag.offset.y }
    const adjusted = drag.solve(moved)
    setEditedLayout((current) => moveNodes(current ?? baseLayout, adjusted))
  }

  function finishDrag(viewport: SVGSVGElement) {
    const drag = gesture.current
    gesture.current = null
    if (drag?.target.hasPointerCapture(drag.pointer)) drag.target.releasePointerCapture(drag.pointer)
    delete viewport.dataset.dragging
  }

  function displayGraph(next: Layout) {
    if (camera.viewport.current) finishDrag(camera.viewport.current)
    clearInspection()
    setEditedLayout(null)
    setBaseLayout(next)
    setGraphVersion(version => version + 1)
  }

  function loadGraph(source: 'tsp' | 'vrp' | File) {
    graphWorker.current?.terminate()
    graphWorker.current = null
    setPending(typeof source === 'string' ? source : 'file')
    setError('')
    try {
      const worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })
      graphWorker.current = worker
      const finish = (result: { layout: Layout } | { error: string }) => {
        if (graphWorker.current !== worker) return
        worker.terminate()
        graphWorker.current = null
        setPending(null)
        if ('layout' in result) displayGraph(result.layout)
        else setError(result.error)
      }
      worker.onmessage = event => finish(event.data)
      worker.onerror = () => finish({ error: 'Couldn’t prepare this graph. Try again.' })
      worker.postMessage(source)
    } catch (problem) {
      graphWorker.current?.terminate()
      graphWorker.current = null
      setPending(null)
      setError(problem instanceof Error ? problem.message : 'Couldn’t prepare this graph.')
    }
  }

  useEffect(() => {
    loadGraph('tsp')
    return () => { graphWorker.current?.terminate(); graphWorker.current = null }
  }, [])

  function openFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) loadGraph(file)
  }

  function focusItem({ kind, index }: GraphItem) {
    camera.viewport.current?.querySelector<SVGGElement>(`[data-${kind}="${index}"]`)?.focus()
  }

  function keyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || !hasNodes) return
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }
    const direction = directions[event.key]
    const { node, edge } = (event.target as SVGElement).dataset
    if (direction) {
      const [x, y] = direction
      if (edge !== undefined) {
        const count = layout.edges.length
        focusItem({ kind: 'edge', index: (Number(edge) + x + y + count) % count })
      } else if (node === undefined) {
        camera.actions.current.pan(-x * 48, -y * 48)
      } else {
        const from = layout.nodes[Number(node)]
        const [directionX, directionY] = camera.rotated.current ? [y, -x] : [x, y]
        let best = Infinity, next = -1
        layout.nodes.forEach((candidate, position) => {
          const dx = candidate.x - from.x, dy = candidate.y - from.y
          const forward = dx * directionX + dy * directionY
          if (forward <= 0) return
          const score = (dx * dx + dy * dy) / forward
          if (score < best) { best = score; next = position }
        })
        if (next !== -1) focusItem({ kind: 'node', index: next })
      }
    } else if (event.key === 'Enter' && node === undefined && edge === undefined) {
      const start = layout.nodes.findIndex((candidate) => candidate.isStart)
      focusItem({ kind: 'node', index: pinned?.item.kind === 'node' ? pinned.item.index : Math.max(0, start) })
    } else if (event.key.toLowerCase() === 'e' && layout.edges.length) {
      focusItem({ kind: 'edge', index: pinned?.item.kind === 'edge' ? pinned.item.index : 0 })
    } else if (event.key === 'Escape') {
      clearInspection()
      camera.viewport.current?.focus()
    } else if (event.key === '+' || event.key === '=') {
      camera.actions.current.zoomBy(zoomStep)
    } else if (event.key === '-') {
      camera.actions.current.zoomBy(1 / zoomStep)
    } else if (event.key === '0') {
      camera.actions.current.fit()
    } else {
      return
    }
    event.preventDefault()
  }

  return (
    <main className="workspace" aria-label="Graph visualizer" onClick={clearInspection}>
      <div className="import">
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={openFile} />
        <div className="file-controls" role="group" aria-label="Graph source">
          <button className="pill open-button" aria-label={pending === 'file' ? 'Opening graph' : 'Open JSON'}
            onClick={() => fileInput.current?.click()}>
            {pending === 'file' ? <LoaderCircle size={18} aria-hidden="true" /> : <FileUp size={18} aria-hidden="true" />}
          </button>
          <button className="pill shuffle-button" aria-label="Generate TSP graph" title="Generate TSP graph"
            onClick={() => loadGraph('tsp')} aria-busy={pending === 'tsp'}>{pending === 'tsp' ? <LoaderCircle size={17} /> : <Route size={17} />}</button>
          <button className="pill shuffle-button" aria-label="Generate VRP graph" title="Generate VRP graph"
            onClick={() => loadGraph('vrp')} aria-busy={pending === 'vrp'}>{pending === 'vrp' ? <LoaderCircle size={17} /> : <Truck size={17} />}</button>
        </div>
        {error && <div className="import-error" role="alert">{error}</div>}
      </div>

      <div className="view-controls" role="group" aria-label="Display options">
        <button className="pill mode-button" aria-label={layout.vrp ? 'Customer demands' : 'Node weights'} aria-pressed={showNodes}
          disabled={!hasNodes} onClick={() => setShowNodes(!showNodes)}>
          <CircleDot size={17} aria-hidden="true" />
        </button>
        <button className="pill mode-button" aria-label="Edge weights" aria-pressed={showEdges}
          disabled={!layout.edges.length} onClick={() => setShowEdges(!showEdges)}>
          <Slash size={17} aria-hidden="true" />
        </button>
        <button className="pill theme-button" aria-label="Dark mode" aria-pressed={dark}
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setDark(!dark)}>
          {dark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
        </button>
      </div>

      <RoutePlayback key={graphVersion} base={baseLayout} layout={layout} layer={routeLayer}
        speed={playbackSpeed} setSpeed={setPlaybackSpeed} disabled={loading || !hasNodes} />
      <div className="pill camera-controls" role="group" aria-label="Zoom controls">
        <button aria-label="Zoom out" title="Zoom out (−)" disabled={!hasNodes || camera.level <= camera.minLevel}
          onClick={() => camera.actions.current.zoomBy(1 / zoomStep)}><Minus size={17} /></button>
        <ZoomInput level={camera.level} setLevel={camera.actions.current.zoomTo} disabled={!hasNodes} />
        <button aria-label="Zoom in" title="Zoom in (+)" disabled={!hasNodes || camera.level >= camera.maxLevel}
          onClick={() => camera.actions.current.zoomBy(zoomStep)}><Plus size={17} /></button>
        <button className="fit-button" aria-label="Fit graph" title="Fit graph (0)" disabled={!hasNodes}
          onClick={() => camera.actions.current.fit()}><Maximize size={16} /></button>
      </div>

      <svg ref={camera.viewport} className="viewport" tabIndex={0} role="group" aria-label="Graph canvas"
        aria-describedby="graph-keys" onKeyDown={keyDown} onPointerDown={() => setHovered(null)}
        onPointerDownCapture={(event) => {
          if (!event.isPrimary) finishDrag(event.currentTarget)
          else didDrag.current = false
        }}
        onPointerMove={dragNode}
        onPointerUp={(event) => { if (gesture.current?.pointer === event.pointerId) finishDrag(event.currentTarget) }}
        onPointerCancel={(event) => { if (gesture.current?.pointer === event.pointerId) finishDrag(event.currentTarget) }}
        onLostPointerCapture={(event) => { if (gesture.current?.pointer === event.pointerId) finishDrag(event.currentTarget) }}
        onClickCapture={(event) => {
          if (!didDrag.current || !event.detail) return
          event.stopPropagation()
          didDrag.current = false
        }}>
        <desc id="graph-keys">Arrow keys pan. Plus and minus zoom. Zero fits the graph. Press Enter to navigate nodes or E to navigate edges. Use arrows to move and Enter to inspect. Escape returns to the canvas.</desc>
        <g ref={camera.scene} className="scene">
          <GraphView layout={layout} routeLayer={setRouteLayer} selected={pinned?.item ?? null} showNodes={showNodes} showEdges={showEdges}
            hover={setHovered} activate={setPinned} beginDrag={beginDrag} />
        </g>
      </svg>

      {!hasNodes && !loading && <p className="empty-state">No nodes in this graph.</p>}

      {inspection && inspectedNode && (
        <GraphDetail anchor={inspection.anchor} view={camera.view} value={inspectedNode.weight} count={degree}
          description={`${inspectedNode.label ?? inspectedNode.id}, ${layout.vrp ? 'demand' : 'weight'} ${number.format(inspectedNode.weight)}, ${degree} connected edges`} />
      )}
      {inspection && inspectedEdge && (
        <GraphDetail anchor={inspection.anchor} view={camera.view} value={inspectedEdge.weight}
          description={`${inspectedEdge.source} to ${inspectedEdge.target}, weight ${number.format(inspectedEdge.weight)}`} />
      )}
    </main>
  )
}

createRoot(document.getElementById('app')!).render(<App />)

