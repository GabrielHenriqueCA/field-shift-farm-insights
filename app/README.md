# Rotare web app (MVP 1)

Static web app: no backend, no API key, no external call needed for the analysis. The decision engine runs in the
browser on pre-processed real data, so the demo is fast and stable.

**Journey:** coordinate → farm on satellite → draw the field → X-ray → priorities → 3-year rotations → climate simulator → smart map.

## Run

```powershell
cd rotare/app
python -m http.server 8765
# open http://127.0.0.1:8765
```

## Deploy to Vercel

The app is 100% static (HTML, CSS, JS, MapLibre GL, Turf.js) and ready for zero-config deployment on [Vercel](https://vercel.com):

1. **Option A (Default / Import repo):** Vercel will automatically read the root [`vercel.json`](../vercel.json) and serve the `app/` directory seamlessly.
2. **Option B (Root Directory = `app`):** In Vercel Project Settings, set **Root Directory** to `app`.

Tests (deterministic engine, 18 tests): `node --test app/tests/motor.test.cjs` from the `rotare` folder.

## Structure

| Layer | Files | Role |
| --- | --- | --- |
| Data preparation | `../coleta/preparar_app.py` → `data/*.js`, `data/img/` | Regional grids via Earth Engine (MODIS NDVI, MapBiomas, SoilGrids, SRTM), point series (CHIRPS, NASA POWER, IMERG, SMAP, ONI) and HLS images of the demo fields |
| Geoprocessing | `js/geo/editor.js`, `js/geo/zonal.js` | Polygon editor (rectangle, free polygon, vertex drag, midpoint insert, move, undo/redo), geodesic area with Turf, zonal statistics of every grid on the polygon |
| Engine | `js/motor/catalogo.js`, `balanco.js`, `rotacao.js`, `historico.js` | FAO-56 daily water balance, FAO-33 relative yield, indicators, 3-year rotation search, ranking, El Niño analog years, crop-history inference from NDVI |
| Explainability | `js/explica.js` | Why / Benefits / Risks / What we don't know, built only from engine numbers (rule-based; an LLM can be plugged in later receiving only the computed JSON) |
| Interface | `index.html`, `css/rotare.css`, `js/mapa.js`, `js/app.js`, `js/icones.js` | MapLibre globe, Esri imagery, NASA GIBS HLS layer, analysis layers, UI flow |

## Data coverage

Full analysis inside the demo region (≈26 × 26 km around Sorriso, MT, dashed blue box). Anywhere else the user
can view the satellite and draw a field; the app says clearly that there is no prepared data. To add a region:
run `coleta/coletar.ps1` for the point and adjust the box in `preparar_app.py`.

Three demo fields with real data: Talhão Sede, Talhão Norte (contains native vegetation, shown as attention area)
and Pivô Central (irrigated).

## Honesty rules built in

- Climate grids (CHIRPS ~5 km, POWER ~55 km) give one value per field: no invented zones inside the polygon.
- Income is a relative index (soy = 1), never money; no yield in bags.
- Scenarios are conditional ("what if"), never forecasts; El Niño mode shows each analog year, not an average.
- The crop catalogue (`catalogo.js`) is a literature draft (FAO-56, FAO-33, Embrapa) to be reviewed by the team.

<!-- SI disclosure: AI-assisted files in this folder carry a disclosure comment at the top. -->
