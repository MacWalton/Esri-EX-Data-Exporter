# Area Data Export — ArcGIS Experience Builder widget

Lets a user mark an area on a web map and download the features inside it in a
CAD or GIS format, projected into a coordinate system they choose. Everything
runs in the browser: no geoprocessing service or server component is needed.

## What the user can do

1. **Mark the area** — rectangle, polygon, freehand, circle, or the current map
   extent. Click the shape afterwards to reshape it. The area size is shown.
2. **Choose layers** — every queryable layer in the map is listed (feature
   layers, GeoJSON/CSV/WFS/OGC layers, and map-image sublayers). Visible layers
   are pre-selected. Options: clip features to the area, and include the area
   boundary as its own layer.
3. **Pick the output**
   - **Format**
     | Format | Output | Notes |
     |---|---|---|
     | AutoCAD DXF | `.dxf` (R12/AC1009) | One CAD layer per GIS layer, holes kept, optional text labels on `<LAYER>_LABELS`. Opens in AutoCAD, Civil 3D, MicroStation, BricsCAD, QGIS, ArcGIS Pro. |
     | Esri Shapefile | `.zip` | One shapefile per layer with `.prj` and UTF-8 `.cpg`. Z values kept. |
     | GeoJSON | `.geojson` (or `.zip` for several layers) | RFC 7946 ring order. A `crs` member is added when not WGS 84. |
     | KML | `.kml` | Always WGS 84; one folder per layer, attributes in ExtendedData. |
     | CSV | `.zip` | One CSV per layer with WKT geometry (and X/Y for points), plus `.prj`. |
   - **Coordinate system** — "same as map", the admin's list, a suggested
     MGA/UTM zone for the drawn area, or any EPSG code.
   - **Datum transformation** — when the output datum differs from the map's
     (e.g. WGS 84 → GDA2020/GDA94), the user can choose among the
     transformations the projection engine offers; the first is its
     recommendation.

## Install (Experience Builder Developer Edition)

Requires Experience Builder Developer Edition 1.20 or later (ArcGIS Maps SDK
for JavaScript 5.x). Built and type-checked against 1.21 / SDK 5.1.

1. Clone this repository into the widgets folder, using the widget's name as
   the folder name:
   ```
   cd <ExB install>/client/your-extensions/widgets
   git clone https://github.com/MacWalton/Esri-EX-Data-Exporter.git area-data-export
   ```
   (Or download the ZIP from GitHub and extract it to
   `your-extensions/widgets/area-data-export`.)
2. If your Developer Edition isn't 1.21, set `exbVersion` (and `version`) in
   `manifest.json` to your version.
3. Restart the client (`npm start` in `client/`). The widget appears in the
   builder's widget panel as **Area Data Export**.
4. Add it to a page, then in its settings select the **Map** widget it should
   work with.

To use it in ArcGIS Online / Enterprise Experience Builder, build the widget
with the Developer Edition and register it as a custom widget per Esri's
documentation for your platform.

## Settings (builder panel)

| Setting | Default |
|---|---|
| Output formats offered / default format | all / DXF |
| EPSG codes offered | WA project grids PCG2020, ALB2020, ESP2020, GDA2020 MGA 49–56, GDA94 MGA 49–56, GDA2020, GDA94, WGS 84, Web Mercator, GDA2020 Albers |
| Default coordinate system | Same as map |
| Offer "Same as map", allow any EPSG code, suggest MGA/UTM zone, pick datum transformation | on |
| `.prj` lookup URL for codes not built in | `https://spatialreference.org/ref/epsg/{wkid}/esriwkt.txt` |
| Clip to area, include area boundary, pre-select visible layers only | on |
| Export coded-value domain descriptions instead of codes | off |
| DXF text labels | on |
| Max features per layer | 50,000 |
| Max area (km², 0 = unlimited) | 0 |
| File name prefix | `area_export` |

Built-in `.prj` definitions (verified against the projection engine): WGS 84,
Web Mercator, GDA94/GDA2020 lat-long, MGA zones (GDA94 48–58, GDA2020 46–59),
Australian Albers (GDA94, GDA2020), WA GDA2020 project grids (PCG2020 EPSG:8031, ALB2020 EPSG:8013, ESP2020 EPSG:8021 — suggested automatically when the drawn area is inside the grid), WGS 84 UTM (all zones), NAD83 UTM 1–23N,
ETRS89 UTM 28–38N, British National Grid, NZTM2000. Any other EPSG code is
projected by the SDK and its `.prj` is fetched from the lookup URL; if that
fails the export still works and a README in the zip notes the missing `.prj`.

## Notes and limits

- **Security**: queries run as the signed-in user, so layer permissions and
  definition expressions are respected. Nothing leaves the browser except the
  normal layer queries (and the optional `.prj` lookup).
- **Large areas**: results are paged by the layer's max record count; each
  layer is capped at the configured maximum and the user is told when a layer
  was truncated. Very large exports are limited by browser memory.
- **Labels**: DXF labels and KML placemark names use the layer's display field
  (or its first text field).
- **Dates**: written as ISO 8601 in GeoJSON/KML/CSV and as `D` (date only) in
  shapefile DBFs. Shapefile field names are cut to 10 characters and made unique.
- **DWG / File Geodatabase / GeoPackage** can't be written in the browser. If
  you need them, the usual route is an ArcGIS Server "Extract Data"
  geoprocessing service, which this widget could call as an extra format.

## Structure

```
area-data-export/
  manifest.json  config.json  icon.svg
  src/config.ts
  src/runtime/widget.tsx        UI: drawing, layer list, options
  src/runtime/engine.ts         query, clip, project (SDK geometry operators)
  src/runtime/lib/              dependency-free writers: dxf, shapefile, geojson, kml, csv, zip, crs
  src/setting/setting.tsx       builder settings panel
```
