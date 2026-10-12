import { React, type AllWidgetProps } from 'jimu-core'
import { JimuMapViewComponent, type JimuMapView } from 'jimu-arcgis'
import { Button, Select, Option, Checkbox, Label, Switch, TextInput, Alert } from 'jimu-ui'
import GraphicsLayer from 'esri/layers/GraphicsLayer'
import Graphic from 'esri/Graphic'
import Polygon from 'esri/geometry/Polygon'
import SimpleFillSymbol from 'esri/symbols/SimpleFillSymbol'
import SketchViewModel from 'esri/widgets/Sketch/SketchViewModel'
import SpatialReference from 'esri/geometry/SpatialReference'
import type GeographicTransformation from 'esri/geometry/operators/support/GeographicTransformation'

import type { IMConfig } from '../config'
import defaultMessages from './translations/default'
import { FORMATS, ALL_FORMATS, buildExport, type FormatId } from './lib/exporters'
import { crsLabel, getCrsInfo, suggestGridWkids } from './lib/crs'
import type { ExportLayer } from './lib/types'
import {
  collectLayers, queryFeaturesInArea, planFields, resolveTarget, listTransformations, describeTransformation,
  convertFeatures, buildAreaLayer, areaSqKm, toLonLat, loadOperators, downloadBlob, isAbortError, type LayerEntry
} from './engine'

const { useState, useEffect, useRef, useMemo, useCallback } = React

type DrawTool = 'rectangle' | 'polygon' | 'freehand' | 'circle'
type CrsChoice = 'map' | 'custom' | `wkid:${number}`
interface Message { type: 'info' | 'success' | 'warning' | 'error', text: string }

const SKETCH_LAYER_ID = 'area-data-export-sketch'

const css = `
.ade { display:flex; flex-direction:column; gap:14px; padding:12px; height:100%; overflow:auto; font-size:13px;
  background: var(--sys-color-surface-paper, var(--light-100, #fff)); color: var(--sys-color-surface-paper-text, inherit); }
.ade h3 { font-size:13px; font-weight:600; margin:0 0 6px; }
.ade-tools { display:grid; grid-template-columns: repeat(3, 1fr); gap:6px; }
.ade-hint { opacity:.75; font-size:12px; margin-top:6px; }
.ade-layers { max-height:200px; overflow:auto; border:1px solid var(--sys-color-divider-secondary, #ddd); border-radius:4px; padding:4px 6px; }
.ade-layer { display:flex; align-items:center; gap:6px; padding:3px 0; cursor:pointer; margin:0; }
.ade-layer .ade-tag { font-size:11px; opacity:.6; margin-left:auto; }
.ade-row { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:6px; }
.ade-row label { margin:0; }
.ade-field { display:flex; flex-direction:column; gap:4px; margin-top:8px; }
.ade-links { display:flex; gap:8px; }
.ade-links button { padding:0; font-size:12px; }
.ade-actions { display:flex; gap:8px; margin-top:4px; }
.ade-actions > * { flex:1; }
.ade-status { font-size:12px; }
`

export default function Widget (props: AllWidgetProps<IMConfig>) {
  const { config } = props
  const t = useCallback((id: keyof typeof defaultMessages, values?: Record<string, string | number>) =>
    props.intl.formatMessage({ id, defaultMessage: defaultMessages[id] }, values) as string, [props.intl])

  const [jmv, setJmv] = useState<JimuMapView | null>(null)
  const [area, setArea] = useState<Polygon | null>(null)
  const [activeTool, setActiveTool] = useState<DrawTool | null>(null)
  const [layers, setLayers] = useState<LayerEntry[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [clip, setClip] = useState<boolean>(config.clipToArea ?? true)
  const [includeArea, setIncludeArea] = useState<boolean>(config.includeAreaBoundary ?? true)

  const enabledFormats = useMemo<FormatId[]>(() => {
    const list = Array.from(config.formats ?? ALL_FORMATS).filter((f): f is FormatId => f in FORMATS)
    return list.length ? list : ALL_FORMATS
  }, [config.formats])
  const [format, setFormat] = useState<FormatId>(enabledFormats.includes(config.defaultFormat) ? config.defaultFormat : enabledFormats[0])

  const [crsChoice, setCrsChoice] = useState<CrsChoice>(config.defaultWkid ? `wkid:${config.defaultWkid}` : 'map')
  const [customWkid, setCustomWkid] = useState('')
  const [transformations, setTransformations] = useState<GeographicTransformation[]>([])
  const [transformationIndex, setTransformationIndex] = useState(0)
  const [operatorsReady, setOperatorsReady] = useState(false)

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [messages, setMessages] = useState<Message[]>([])

  const sketchLayerRef = useRef<GraphicsLayer | null>(null)
  const svmRef = useRef<SketchViewModel | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const seenLayerIds = useRef<Set<string>>(new Set())

  useEffect(() => { loadOperators().then(() => setOperatorsReady(true)).catch(() => setOperatorsReady(false)) }, [])

  // ------------------------------------------------------------- map + sketch setup
  useEffect(() => {
    const view = jmv?.view
    const map = view?.map
    if (!view || !map) return
    const layer = new GraphicsLayer({ id: SKETCH_LAYER_ID, title: 'Export area', listMode: 'hide' })
    map.add(layer)
    const svm = new SketchViewModel({
      view,
      layer,
      polygonSymbol: new SimpleFillSymbol({ color: [0, 121, 193, 0.12], outline: { color: [0, 121, 193, 1], width: 2 } }),
      defaultUpdateOptions: { tool: 'reshape', toggleToolOnClick: true }
    })
    const onCreate = svm.on('create', (e: any) => {
      if (e.state === 'complete') { setArea(e.graphic.geometry as Polygon); setActiveTool(null) }
      if (e.state === 'cancel') setActiveTool(null)
    })
    const onUpdate = svm.on('update', (e: any) => {
      const g = e.graphics?.[0]
      if (g && (e.state === 'complete' || e.toolEventInfo?.type?.endsWith('-stop'))) setArea(g.geometry as Polygon)
    })
    const onDelete = svm.on('delete', () => setArea(null))
    sketchLayerRef.current = layer
    svmRef.current = svm

    const refresh = () => {
      collectLayers(map, new Set([SKETCH_LAYER_ID])).then(list => {
        setLayers(list)
        setSelected(prev => {
          const next = new Set([...prev].filter(id => list.some(l => l.id === id)))
          for (const l of list) {
            if (!seenLayerIds.current.has(l.id)) {
              seenLayerIds.current.add(l.id)
              if (l.visible || !config.preselectVisibleOnly) next.add(l.id)
            }
          }
          return next
        })
      }).catch(() => setLayers([]))
    }
    refresh()
    const onLayersChange = map.allLayers.on('change', refresh)

    return () => {
      onCreate.remove(); onUpdate.remove(); onDelete.remove(); onLayersChange.remove()
      svm.destroy()
      map.remove(layer)
      layer.destroy()
      sketchLayerRef.current = null
      svmRef.current = null
      setArea(null)
      setLayers(null)
    }
  }, [jmv, config.preselectVisibleOnly])

  // Cancel any in-progress drawing when the widget is closed (e.g. in a widget controller).
  useEffect(() => {
    if ((props as any).state === 'CLOSED') { svmRef.current?.cancel(); setActiveTool(null) }
  }, [(props as any).state])

  const startDraw = (tool: DrawTool) => {
    const svm = svmRef.current
    if (!svm) return
    svm.cancel()
    sketchLayerRef.current?.removeAll()
    setArea(null)
    setMessages([])
    setActiveTool(tool)
    if (tool === 'freehand') svm.create('polygon', { mode: 'freehand' })
    else svm.create(tool)
  }

  const useMapExtent = () => {
    const view = jmv?.view
    if (!view?.extent) return
    svmRef.current?.cancel()
    const polygon = Polygon.fromExtent(view.extent.clone())
    sketchLayerRef.current?.removeAll()
    sketchLayerRef.current?.add(new Graphic({ geometry: polygon, symbol: svmRef.current?.polygonSymbol }))
    setActiveTool(null)
    setArea(polygon)
  }

  const clearArea = () => {
    svmRef.current?.cancel()
    sketchLayerRef.current?.removeAll()
    setActiveTool(null)
    setArea(null)
    setMessages([])
  }

  // ------------------------------------------------------------- derived values
  const mapSR: SpatialReference | null = jmv?.view?.spatialReference ?? null
  const forcesWgs84 = !!FORMATS[format].forcesWgs84

  const sqKm = useMemo(() => (area && operatorsReady ? areaSqKm(area) : null), [area, operatorsReady])
  const tooLarge = !!(config.maxAreaSqKm && sqKm !== null && sqKm > config.maxAreaSqKm)

  const suggestions = useMemo(() => {
    if (!config.suggestGridZone || !area || !operatorsReady) return []
    const ll = toLonLat(area)
    return ll ? suggestGridWkids(ll[0], ll[1]) : []
  }, [area, operatorsReady, config.suggestGridZone])

  const configuredWkids = useMemo(() => Array.from(config.spatialReferences ?? []).map(Number).filter(n => n > 0), [config.spatialReferences])

  const chosenWkid: 'map' | number | null = useMemo(() => {
    if (forcesWgs84) return 4326
    if (crsChoice === 'map') return 'map'
    if (crsChoice === 'custom') { const n = parseInt(customWkid, 10); return n > 0 ? n : null }
    return parseInt(crsChoice.slice(5), 10)
  }, [crsChoice, customWkid, forcesWgs84])

  // Available datum transformations for the chosen output CRS.
  useEffect(() => {
    setTransformationIndex(0)
    if (!mapSR || !operatorsReady || chosenWkid === null || chosenWkid === 'map') { setTransformations([]); return }
    const wkid = getCrsInfo(chosenWkid)?.wkid ?? chosenWkid
    setTransformations(listTransformations(mapSR, new SpatialReference({ wkid }), area))
  }, [chosenWkid, mapSR, operatorsReady, area])

  const mapCrsName = mapSR ? (mapSR.wkid ? (getCrsInfo(mapSR.wkid)?.name ?? `EPSG:${mapSR.wkid}`) : 'custom') : ''

  // ------------------------------------------------------------- export
  const runExport = async () => {
    const view = jmv?.view
    if (!view || !area || chosenWkid === null) {
      if (chosenWkid === null) setMessages([{ type: 'error', text: t('invalidWkid') }])
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller
    const warnings: Message[] = []
    setBusy(true)
    setMessages([])
    setStatus(t('preparing'))
    try {
      await loadOperators()
      const target = await resolveTarget(chosenWkid, view.spatialReference, config.wktLookupUrl ?? '', signal)
      if (!target.crs.wkt) warnings.push({ type: 'warning', text: t('noPrj') })
      const transformation = config.showTransformationChoice
        ? (transformations[transformationIndex] ?? null)
        : (listTransformations(view.spatialReference, target.sr, area)[0] ?? null)
      const convertOpts = { area, clip, target: target.sr, transformation, labels: format === 'dxf' && (config.dxfLabels ?? true) }
      const maxFeatures = Math.max(1, config.maxFeaturesPerLayer || 50000)

      const out: ExportLayer[] = []
      const chosen = (layers ?? []).filter(l => selected.has(l.id))
      for (const entry of chosen) {
        if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
        setStatus(t('querying', { layer: entry.title, done: 0, total: '…' }))
        try {
          const res = await queryFeaturesInArea(entry.source, area, view.spatialReference, maxFeatures, signal,
            (done, total) => setStatus(t('querying', { layer: entry.title, done: done.toLocaleString(), total: total.toLocaleString() })))
          if (res.truncated) warnings.push({ type: 'warning', text: t('truncated', { layer: entry.title, max: maxFeatures.toLocaleString(), total: res.total.toLocaleString() }) })
          const plan = planFields(entry.source, res.graphics, !!config.useDomainDescriptions)
          let features
          try {
            features = convertFeatures(res.graphics, entry.geometryKind, convertOpts, plan.convert)
          } catch (e) {
            if ((e as Error)?.message === 'projection-failed') throw new Error(t('projectionFailed', { wkid: String(target.crs.wkid ?? '') }))
            throw e
          }
          if (features.length) {
            out.push({
              name: entry.source.title || entry.title,
              geometryKind: entry.geometryKind,
              hasZ: !!entry.source.hasZ,
              fields: plan.fields,
              features,
              labelField: plan.labelField
            })
          }
        } catch (e) {
          if (isAbortError(e)) throw e
          if ((e as Error)?.message?.startsWith('The coordinate system')) throw e
          warnings.push({ type: 'warning', text: t('layerFailed', { layer: entry.title, message: (e as Error)?.message ?? String(e) }) })
        }
      }

      const featureCount = out.reduce((s, l) => s + l.features.length, 0)
      if (includeArea) out.push(buildAreaLayer(area, convertOpts))
      if (!featureCount && !includeArea) {
        setMessages([...warnings, { type: 'info', text: t('noFeatures') }])
        return
      }

      setStatus(t('writing', { format: FORMATS[format].label }))
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '_')
      const crsTag = target.crs.wkid ? `EPSG${target.crs.wkid}` : 'mapcrs'
      const built = await buildExport(format, out, target.crs, {
        baseName: `${config.fileNamePrefix || 'area_export'}_${stamp}_${crsTag}`,
        dxfLabels: config.dxfLabels ?? true
      })
      downloadBlob(built.blob, built.fileName)
      const layerCount = out.filter(l => l.name !== 'Export_Area').length
      setMessages([{ type: featureCount ? 'success' : 'info', text: featureCount ? t('done', { file: built.fileName, count: featureCount.toLocaleString(), layers: layerCount }) : t('noFeatures') }, ...warnings])
    } catch (e) {
      if (isAbortError(e) || signal.aborted) setMessages([{ type: 'info', text: t('cancelled') }])
      else setMessages([...warnings, { type: 'error', text: (e as Error)?.message ?? String(e) }])
    } finally {
      setBusy(false)
      setStatus('')
      abortRef.current = null
    }
  }

  // ------------------------------------------------------------- render
  const mapWidgetId = props.useMapWidgetIds?.[0]
  if (!mapWidgetId) {
    return <div className='ade'><style>{css}</style><Alert type='info' text={t('selectMap')} withIcon open /></div>
  }

  const toggleLayer = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const extraSuggestions = suggestions.filter(w => !configuredWkids.includes(w))
  const canExport = !!area && !busy && !tooLarge && chosenWkid !== null && (selected.size > 0 || includeArea) && !!jmv

  return (
    <div className='ade jimu-widget'>
      <style>{css}</style>
      <JimuMapViewComponent useMapWidgetId={mapWidgetId} onActiveViewChange={(v: JimuMapView) => setJmv(v)} />

      <section>
        <h3>{t('stepArea')}</h3>
        <div className='ade-tools'>
          {(['rectangle', 'polygon', 'freehand', 'circle'] as DrawTool[]).map(tool => (
            <Button key={tool} size='sm' type={activeTool === tool ? 'primary' : 'default'} disabled={!jmv || busy} onClick={() => startDraw(tool)} aria-pressed={activeTool === tool}>
              {t(tool)}
            </Button>
          ))}
          <Button size='sm' disabled={!jmv || busy} onClick={useMapExtent}>{t('mapExtent')}</Button>
          <Button size='sm' disabled={!area || busy} onClick={clearArea}>{t('clear')}</Button>
        </div>
        <div className='ade-hint'>
          {area && sqKm !== null
            ? t('areaSize', { area: sqKm < 1 ? `${(sqKm * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })} ha` : `${sqKm.toLocaleString(undefined, { maximumFractionDigits: 2 })} km²` })
            : t('drawHint')}
        </div>
        {tooLarge && <Alert className='mt-2' type='warning' text={t('areaTooLarge', { max: config.maxAreaSqKm })} withIcon open />}
      </section>

      <section>
        <div className='ade-row' style={{ marginTop: 0 }}>
          <h3>{t('stepLayers')}</h3>
          {!!layers?.length && (
            <div className='ade-links'>
              <Button type='tertiary' size='sm' onClick={() => setSelected(new Set(layers.map(l => l.id)))}>{t('selectAll')}</Button>
              <Button type='tertiary' size='sm' onClick={() => setSelected(new Set())}>{t('selectNone')}</Button>
            </div>
          )}
        </div>
        <div className='ade-layers' role='group' aria-label={t('stepLayers')}>
          {layers === null && <div className='ade-hint'>{t('loadingLayers')}</div>}
          {layers?.length === 0 && <div className='ade-hint'>{t('noLayers')}</div>}
          {layers?.map(l => (
            <Label key={l.id} className='ade-layer' title={l.title}>
              <Checkbox checked={selected.has(l.id)} onChange={() => toggleLayer(l.id)} disabled={busy} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title}</span>
              <span className='ade-tag'>{l.visible ? l.geometryKind : `${l.geometryKind} · ${t('hidden')}`}</span>
            </Label>
          ))}
        </div>
        <div className='ade-row'>
          <Label for='ade-clip'>{t('clipToArea')}</Label>
          <Switch id='ade-clip' checked={clip} disabled={busy} onChange={(e: any) => setClip(e.target.checked)} />
        </div>
        <div className='ade-row'>
          <Label for='ade-area'>{t('includeArea')}</Label>
          <Switch id='ade-area' checked={includeArea} disabled={busy} onChange={(e: any) => setIncludeArea(e.target.checked)} />
        </div>
      </section>

      <section>
        <h3>{t('stepOutput')}</h3>
        <div className='ade-field'>
          <Label for='ade-format'>{t('format')}</Label>
          <Select id='ade-format' size='sm' value={format} disabled={busy} onChange={(e: any) => setFormat(e.target.value as FormatId)}>
            {enabledFormats.map(f => <Option key={f} value={f}>{FORMATS[f].label}</Option>)}
          </Select>
        </div>

        <div className='ade-field'>
          <Label for='ade-crs'>{t('coordinateSystem')}</Label>
          {forcesWgs84
            ? <div className='ade-hint' style={{ marginTop: 0 }}>{t('kmlWgs84')}</div>
            : (
              <Select id='ade-crs' size='sm' value={crsChoice} disabled={busy} onChange={(e: any) => setCrsChoice(e.target.value as CrsChoice)}>
                {config.includeMapSpatialReference !== false && <Option value='map'>{t('sameAsMap', { name: mapCrsName })}</Option>}
                {extraSuggestions.length > 0 && <Option disabled value='__suggested'>— {t('suggested')} —</Option>}
                {extraSuggestions.map(w => <Option key={`s${w}`} value={`wkid:${w}`}>{crsLabel(w)}</Option>)}
                {extraSuggestions.length > 0 && configuredWkids.length > 0 && <Option disabled value='__configured'>— {t('configured')} —</Option>}
                {configuredWkids.map(w => <Option key={w} value={`wkid:${w}`}>{suggestions.includes(w) ? '★ ' : ''}{crsLabel(w)}</Option>)}
                {config.allowCustomWkid !== false && <Option value='custom'>{t('customWkid')}</Option>}
              </Select>
              )}
          {!forcesWgs84 && crsChoice === 'custom' && (
            <TextInput size='sm' type='number' value={customWkid} placeholder={t('customWkidPlaceholder')} disabled={busy}
              onChange={(e: any) => setCustomWkid(e.target.value.replace(/\D/g, ''))} />
          )}
          {format === 'geojson' && chosenWkid !== 4326 && <div className='ade-hint' style={{ marginTop: 0 }}>{t('geojsonNote')}</div>}
        </div>

        {config.showTransformationChoice !== false && transformations.length > 0 && (
          <div className='ade-field'>
            <Label for='ade-gt'>{t('transformation')}</Label>
            <Select id='ade-gt' size='sm' value={String(transformationIndex)} disabled={busy} onChange={(e: any) => setTransformationIndex(Number(e.target.value))}>
              {transformations.map((tr, i) => <Option key={i} value={String(i)}>{describeTransformation(tr)}{i === 0 ? ` — ${t('recommended')}` : ''}</Option>)}
            </Select>
          </div>
        )}
      </section>

      <div className='ade-actions'>
        <Button type='primary' disabled={!canExport} onClick={runExport}>{t('export')}</Button>
        {busy && <Button onClick={() => abortRef.current?.abort()}>{t('cancel')}</Button>}
      </div>

      <div className='ade-status' aria-live='polite'>
        {busy && status && <div className='ade-hint'>{status}</div>}
        {messages.map((m, i) => <Alert key={i} className='mb-2' type={m.type} text={m.text} withIcon open closable={!busy} onClose={() => setMessages(ms => ms.filter((_, j) => j !== i))} />)}
      </div>
    </div>
  )
}
