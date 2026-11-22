import { layoutGraph } from './layout'
import { parseGraph } from './graph'
import { generateTspLayout, generateVrpLayout } from './generator'

self.onmessage = async ({ data }: MessageEvent<'tsp' | 'vrp' | File>) => {
  try {
    const layout = data === 'tsp' ? generateTspLayout() : data === 'vrp' ? generateVrpLayout() : layoutGraph(parseGraph(await data.text()))
    self.postMessage({ layout })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Couldn’t prepare the graph.' })
  }
}
