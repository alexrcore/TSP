import { select } from 'd3-selection'
import { zoom, zoomIdentity } from 'd3-zoom'
import type { ZoomTransform } from 'd3-zoom'
import { useLayoutEffect, useRef, useState } from 'react'
import type { Layout } from './layout'

const minZoom = 0.25
const maxZoom = 8

export function useCamera(layout: Layout, currentBounds: Layout['bounds']) {
  const viewport = useRef<SVGSVGElement>(null)
  const scene = useRef<SVGGElement>(null)
  const rotated = useRef(false)
  const bounds = useRef(currentBounds)
  const actions = useRef({ fit() {}, zoomBy(_factor: number) {}, zoomTo(_percent: number) {}, pan(_x: number, _y: number) {} })
  const [view, setView] = useState({ transform: zoomIdentity, level: 100, width: 0, height: 0, rotated: false })

  useLayoutEffect(() => { bounds.current = currentBounds }, [currentBounds])

  useLayoutEffect(() => {
    const svg = viewport.current!
    const layer = scene.current!
    const selection = select(svg)
    let fitBounds = layout.bounds
    let width = 0, height = 0, fitScale = 1
    let current: ZoomTransform = zoomIdentity
    let isFitted = true
    const behavior = zoom<SVGSVGElement, unknown>()
      .filter((event) => {
        if ((event.ctrlKey && event.type !== 'wheel') || event.button) return false
        const startsOnNode = (event.target as Element).closest('[data-node]')
        return !startsOnNode || (event.type !== 'mousedown' && (event.type !== 'touchstart' || event.touches.length > 1))
      })
      .extent(() => [[0, 0], [width, height]])
      .clickDistance(4)
      .duration(0)
      .on('zoom', (event) => {
        current = event.transform
        const fitted = fitTransform()
        isFitted = Math.abs(current.k - fitted.k) < 0.00001 &&
          Math.abs(current.x - fitted.x) < 1 && Math.abs(current.y - fitted.y) < 1
        layer.setAttribute('transform', `${current}${rotated.current ? ' rotate(90)' : ''}`)
        layer.style.setProperty('--unit', `${1 / current.k}px`)
        layer.style.setProperty('--label-rotation', rotated.current ? '-90deg' : '0deg')
        setView({ transform: current, level: Math.round(current.k / fitScale * 100), width, height, rotated: rotated.current })
      })

    function fitTransform() {
      const { left, top, right, bottom } = fitBounds
      const centerX = (left + right) / 2, centerY = (top + bottom) / 2
      const [x, y] = rotated.current ? [-centerY, centerX] : [centerX, centerY]
      return zoomIdentity.translate(width / 2, height / 2).scale(fitScale)
        .translate(-x, -y)
    }

    function resize(forceFit = false) {
      const { clientWidth, clientHeight } = svg
      if (!forceFit && clientWidth === width && clientHeight === height) return
      let [centerX, centerY] = current.invert([width / 2, height / 2])
      const relativeZoom = current.k / fitScale
      width = clientWidth
      height = clientHeight
      fitBounds = bounds.current
      const { left, top, right, bottom } = fitBounds
      const graphWidth = right - left, graphHeight = bottom - top
      const portrait = width / height < 0.8 && graphWidth > graphHeight * 1.2
      if (portrait !== rotated.current) [centerX, centerY] = portrait ? [-centerY, centerX] : [centerY, -centerX]
      rotated.current = portrait
      const [spanX, spanY] = portrait ? [graphHeight, graphWidth] : [graphWidth, graphHeight]
      const padX = Math.max(24, Math.min(116, width * 0.095))
      const padY = Math.max(63, Math.min(88, height * 0.115))
      fitScale = Math.min(1.65,
        Math.max(1, width - 2 * padX) / Math.max(20, spanX),
        Math.max(height / 2, height - 2 * padY) / Math.max(20, spanY))
      behavior.scaleExtent([fitScale * minZoom, fitScale * maxZoom])
      const next = forceFit || isFitted ? fitTransform() : zoomIdentity.translate(width / 2, height / 2)
        .scale(fitScale * relativeZoom).translate(-centerX, -centerY)
      selection.call(behavior.transform, next)
    }

    selection.call(behavior).on('dblclick.zoom', null)
    actions.current = {
      fit: () => resize(true),
      zoomBy: (factor) => selection.call(behavior.scaleBy, factor),
      zoomTo: (percent) => selection.call(behavior.scaleTo, fitScale * percent / 100),
      pan: (x, y) => selection.call(behavior.translateBy, x / current.k, y / current.k),
    }
    resize()
    const observer = new ResizeObserver(() => resize())
    observer.observe(svg)
    return () => {
      observer.disconnect()
      selection.on('.zoom', null)
    }
  }, [layout])

  return { viewport, scene, actions, rotated, view, level: view.level, minLevel: minZoom * 100, maxLevel: maxZoom * 100 }
}
