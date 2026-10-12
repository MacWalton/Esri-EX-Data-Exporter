import { React } from 'jimu-core'
import type { AllWidgetSettingProps } from 'jimu-for-builder'
import { MapWidgetSelector, SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { Checkbox, Label, Select, Option, Switch, TextInput, NumericInput } from 'jimu-ui'

import type { IMConfig, Config } from '../config'
import defaultMessages from './translations/default'
import { FORMATS, ALL_FORMATS, type FormatId } from '../runtime/lib/exporters'
import { crsLabel, getCrsInfo } from '../runtime/lib/crs'

const { useState, useEffect } = React

const parseWkids = (text: string): number[] =>
  Array.from(new Set(text.split(/[\s,;]+/).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n) && n > 0)))

export default function Setting (props: AllWidgetSettingProps<IMConfig>) {
  const { config, id } = props
  const t = (key: keyof typeof defaultMessages, values?: Record<string, string | number>) =>
    props.intl.formatMessage({ id: key, defaultMessage: defaultMessages[key] }, values) as string

  const set = <K extends keyof Config>(key: K, value: Config[K]) =>
    props.onSettingChange({ id, config: config.set(key, value) })

  const formats: FormatId[] = Array.from(config.formats ?? ALL_FORMATS)
  const wkids: number[] = Array.from(config.spatialReferences ?? []).map(Number)
  const [wkidText, setWkidText] = useState(wkids.join(', '))
  useEffect(() => { setWkidText(Array.from(config.spatialReferences ?? []).join(', ')) }, [config.spatialReferences])
  const unknown = parseWkids(wkidText).filter(w => !getCrsInfo(w))

  const toggleFormat = (f: FormatId, on: boolean) => {
    const next = ALL_FORMATS.filter(x => (x === f ? on : formats.includes(x)))
    if (!next.length) return
    let cfg = config.set('formats', next)
    if (!next.includes(config.defaultFormat)) cfg = cfg.set('defaultFormat', next[0])
    props.onSettingChange({ id, config: cfg })
  }

  const row = (label: string, control: React.ReactNode) => (
    <SettingRow label={label} flow='no-wrap'>{control}</SettingRow>
  )

  return (
    <div className='widget-setting-area-data-export'>
      <SettingSection title={t('map')}>
        <SettingRow>
          <MapWidgetSelector useMapWidgetIds={props.useMapWidgetIds} onSelect={(ids: string[]) => props.onSettingChange({ id, useMapWidgetIds: ids })} />
        </SettingRow>
      </SettingSection>

      <SettingSection title={t('formats')}>
        {ALL_FORMATS.map(f => (
          <SettingRow key={f}>
            <Label className='d-flex align-items-center' style={{ gap: 8, margin: 0, cursor: 'pointer' }}>
              <Checkbox checked={formats.includes(f)} onChange={(_e: unknown, checked: boolean) => toggleFormat(f, checked)} />
              {FORMATS[f].label}
            </Label>
          </SettingRow>
        ))}
        <SettingRow label={t('defaultFormat')} flow='wrap'>
          <Select size='sm' value={config.defaultFormat} onChange={(e: any) => set('defaultFormat', e.target.value as FormatId)}>
            {formats.map(f => <Option key={f} value={f}>{FORMATS[f].label}</Option>)}
          </Select>
        </SettingRow>
      </SettingSection>

      <SettingSection title={t('coordinateSystems')}>
        <SettingRow label={t('wkidList')} flow='wrap'>
          <TextInput size='sm' className='w-100' value={wkidText}
            onChange={(e: any) => setWkidText(e.target.value)}
            onAcceptValue={(v: string) => set('spatialReferences', parseWkids(v))} />
        </SettingRow>
        {unknown.length > 0 && (
          <SettingRow><div style={{ fontSize: 12, opacity: 0.75 }}>{t('unknownWkids', { list: unknown.join(', ') })}</div></SettingRow>
        )}
        <SettingRow label={t('defaultCrs')} flow='wrap'>
          <Select size='sm' value={String(config.defaultWkid ?? 0)} onChange={(e: any) => set('defaultWkid', Number(e.target.value))}>
            <Option value='0'>{t('sameAsMap')}</Option>
            {wkids.map(w => <Option key={w} value={String(w)}>{crsLabel(w)}</Option>)}
          </Select>
        </SettingRow>
        {row(t('includeMapSr'), <Switch checked={config.includeMapSpatialReference !== false} onChange={(e: any) => set('includeMapSpatialReference', e.target.checked)} />)}
        {row(t('allowCustom'), <Switch checked={config.allowCustomWkid !== false} onChange={(e: any) => set('allowCustomWkid', e.target.checked)} />)}
        {row(t('suggestZone'), <Switch checked={config.suggestGridZone !== false} onChange={(e: any) => set('suggestGridZone', e.target.checked)} />)}
        {row(t('transformationChoice'), <Switch checked={config.showTransformationChoice !== false} onChange={(e: any) => set('showTransformationChoice', e.target.checked)} />)}
        <SettingRow label={t('wktLookupUrl')} flow='wrap'>
          <TextInput size='sm' className='w-100' defaultValue={config.wktLookupUrl ?? ''} onAcceptValue={(v: string) => set('wktLookupUrl', v.trim())} />
        </SettingRow>
      </SettingSection>

      <SettingSection title={t('behaviour')}>
        {row(t('clipToArea'), <Switch checked={config.clipToArea !== false} onChange={(e: any) => set('clipToArea', e.target.checked)} />)}
        {row(t('includeArea'), <Switch checked={config.includeAreaBoundary !== false} onChange={(e: any) => set('includeAreaBoundary', e.target.checked)} />)}
        {row(t('preselectVisible'), <Switch checked={config.preselectVisibleOnly !== false} onChange={(e: any) => set('preselectVisibleOnly', e.target.checked)} />)}
        {row(t('useDomains'), <Switch checked={!!config.useDomainDescriptions} onChange={(e: any) => set('useDomainDescriptions', e.target.checked)} />)}
        {row(t('dxfLabels'), <Switch checked={config.dxfLabels !== false} onChange={(e: any) => set('dxfLabels', e.target.checked)} />)}
      </SettingSection>

      <SettingSection title={t('limits')}>
        <SettingRow label={t('maxFeatures')} flow='wrap'>
          <NumericInput size='sm' className='w-100' min={1} step={1000} value={config.maxFeaturesPerLayer ?? 50000}
            onAcceptValue={(v: number) => set('maxFeaturesPerLayer', Math.max(1, Math.round(Number(v) || 50000)))} />
        </SettingRow>
        <SettingRow label={t('maxArea')} flow='wrap'>
          <NumericInput size='sm' className='w-100' min={0} value={config.maxAreaSqKm ?? 0}
            onAcceptValue={(v: number) => set('maxAreaSqKm', Math.max(0, Number(v) || 0))} />
        </SettingRow>
        <SettingRow label={t('fileNamePrefix')} flow='wrap'>
          <TextInput size='sm' className='w-100' defaultValue={config.fileNamePrefix ?? ''} onAcceptValue={(v: string) => set('fileNamePrefix', v.trim())} />
        </SettingRow>
      </SettingSection>
    </div>
  )
}
