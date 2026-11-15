# Aviso de SI: script escrito com ajuda de IA (Claude), sob direcao do time Datanauts Brasil.
# Nenhum valor e inventado: tudo vem de NASA (MODIS, HLS, SRTM, POWER, IMERG, SMAP), CHIRPS, SoilGrids e MapBiomas.
"""
Prepara os dados do app web do Rotare (rotare/app/data/*.js).

1. Grades regionais via Google Earth Engine, alinhadas em EPSG:4326, para estatistica zonal no navegador:
   - NDVI mensal (maximo do mes, MODIS Terra+Aqua 250 m, jul/2014 a jun/2025)
   - MapBiomas Colecao 9 (classe mais frequente por celula, 2014 a 2023)
   - SoilGrids 0-30 cm (areia, argila, carbono organico)
   - SRTM 30 m reamostrado para ~90 m (altitude e declividade)
2. Series do ponto regional (parquet ja coletado): chuva CHIRPS diaria 1981-2025, temperatura NASA POWER,
   ET0 Hargreaves, IMERG mensal, SMAP diario, ENSO por ano-safra.
3. Imagens HLS (pico da soja e da safrinha) dos talhoes de demonstracao.

Uso: python preparar_app.py            (tudo)
     python preparar_app.py --sem-ee   (so as series do parquet)
"""
import argparse
import base64
import json
import math
import os
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "data" / "sorriso"
SAIDA = RAIZ / "app" / "data"

# Caixa da regiao de demonstracao (cerca de 26 x 26 km em volta do ponto de Sorriso)
W, E, S, N = -56.07, -55.83, -12.72, -12.48
DX_250 = 0.0025        # ~270 m (MODIS, SoilGrids, MapBiomas agregado)
DX_90 = 1 / 1200       # ~90 m (SRTM)

TALHOES = [
    {"id": "sede", "nome": "Talhão Sede", "fazenda": "Fazenda demonstração A", "irrigado": False,
     "px": [(400, 436), (478, 436), (478, 490), (400, 490)]},
    {"id": "norte", "nome": "Talhão Norte", "fazenda": "Fazenda demonstração B", "irrigado": False,
     "px": [(205, 196), (300, 190), (305, 250), (215, 252), (200, 225)]},
    {"id": "pivo", "nome": "Pivô Central", "fazenda": "Fazenda demonstração C", "irrigado": True,
     "circulo": (457, 180, 28)},
]


def px_para_lonlat(x, y):
    return round(W + x / 960 * (E - W), 6), round(N - y / 960 * (N - S), 6)


def geometria_talhao(t):
    if "circulo" in t:
        cx, cy, r = t["circulo"]
        pts = [(cx + r * math.cos(a), cy + r * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 33)[:-1]]
    else:
        pts = t["px"]
    anel = [list(px_para_lonlat(x, y)) for x, y in pts]
    return anel + [anel[0]]


def b64(arr):
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode("ascii")


def escrever_js(nome, var, obj):
    SAIDA.mkdir(parents=True, exist_ok=True)
    txt = ("// Gerado por coleta/preparar_app.py. Nao editar a mao.\n"
           "// Aviso de SI: arquivo gerado por script escrito com ajuda de IA; os valores vem das fontes citadas.\n"
           f"window.{var} = " + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + ";\n")
    (SAIDA / nome).write_text(txt, encoding="utf-8")
    print(f"  {nome}: {len(txt) / 1024:.0f} KB")


# ------------------------------------------------------------------------------------------
# Earth Engine
# ------------------------------------------------------------------------------------------
def ee_init():
    """Mesma inicializacao do app (local ou Service Account): fica centralizada em grades.ee_init."""
    return __import__("grades").ee_init()


def grade(dx):
    w, h = round((E - W) / dx), round((N - S) / dx)
    return w, h, {"dimensions": {"width": w, "height": h},
                  "affineTransform": {"scaleX": dx, "shearX": 0, "translateX": W,
                                      "shearY": 0, "scaleY": -dx, "translateY": N},
                  "crsCode": "EPSG:4326"}


def baixar(ee, img, dx, bandas_por_lote=24):
    """Baixa uma imagem multibanda na grade fixa. Retorna array (bandas, h, w) float32."""
    w, h, g = grade(dx)
    nomes = img.bandNames().getInfo()
    camadas = []
    for i in range(0, len(nomes), bandas_por_lote):
        lote = nomes[i:i + bandas_por_lote]
        arr = ee.data.computePixels({"expression": img.select(lote), "fileFormat": "NUMPY_NDARRAY", "grid": g})
        camadas += [np.asarray(arr[b], dtype=np.float32) for b in lote]
    return np.stack(camadas), nomes, w, h


def grade_ndvi(ee):
    meses = pd.period_range("2014-07", "2025-06", freq="M")

    def prep(i):
        q = i.select("SummaryQA")
        return i.select("NDVI").multiply(0.0001).updateMask(q.lte(1)).copyProperties(i, ["system:time_start"])

    col = (ee.ImageCollection("MODIS/061/MOD13Q1").merge(ee.ImageCollection("MODIS/061/MYD13Q1"))
           .filterDate("2014-06-01", "2025-07-31").map(prep))
    bandas = []
    for m in meses:
        ini = m.start_time.strftime("%Y-%m-%d")
        fim = (m.end_time + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        # composicoes de 16 dias que comecam no mes: o maximo do mes reduz o efeito residual de nuvem
        bandas.append(col.filterDate(ini, fim).max().rename(str(m)).unmask(-1))
    img = ee.ImageCollection(bandas).toBands()
    img = img.rename([str(m) for m in meses])
    arr, nomes, w, h = baixar(ee, img, DX_250)
    cod = np.where(arr < -0.5, 255, np.clip(np.round((arr + 0.2) * 200), 0, 240)).astype(np.uint8)
    print(f"  NDVI: {arr.shape}, sem dado {np.mean(cod == 255):.1%}")
    return {"meses": [str(m) for m in meses], "w": w, "h": h, "dx": DX_250,
            "codificacao": "ndvi = byte/200 - 0.2 ; 255 = sem dado", "dados": b64(cod),
            "fonte": "NASA MODIS MOD13Q1 + MYD13Q1 v061 (250 m, 16 dias), maximo mensal, SummaryQA <= 1"}


def grade_mapbiomas(ee):
    anos = list(range(2014, 2024))
    asset = "projects/mapbiomas-public/assets/brazil/lulc/collection9/mapbiomas_collection90_integration_v1"
    src = ee.Image(asset).select([f"classification_{a}" for a in anos])
    w, h, g = grade(DX_250)
    img = src.reduceResolution(ee.Reducer.mode(), maxPixels=1024).reproject(crs="EPSG:4326", crsTransform=[DX_250, 0, W, 0, -DX_250, N])
    arr, _, _, _ = baixar(ee, img.unmask(0), DX_250)
    return {"anos": anos, "w": w, "h": h, "dx": DX_250, "dados": b64(arr.astype(np.uint8)),
            "fonte": "MapBiomas Coleção 9 (30 m), classe mais frequente por célula de ~270 m"}


def grade_solo(ee):
    camadas = {"0-5cm": 5, "5-15cm": 10, "15-30cm": 15}
    out = {}
    for prop in ("sand", "clay", "soc"):
        im = ee.Image(f"projects/soilgrids-isric/{prop}_mean")
        soma = None
        for c, peso in camadas.items():
            b = im.select(f"{prop}_{c}_mean").multiply(peso / 30)
            soma = b if soma is None else soma.add(b)
        out[prop] = soma.rename(prop)
    img = ee.Image.cat([out["sand"], out["clay"], out["soc"]]).unmask(-1)
    arr, _, w, h = baixar(ee, img, DX_250)
    # SoilGrids: areia e argila em g/kg, carbono em dg/kg -> %, %, g/kg
    areia = np.where(arr[0] < 0, 255, np.round(arr[0] / 10)).astype(np.uint8)
    argila = np.where(arr[1] < 0, 255, np.round(arr[1] / 10)).astype(np.uint8)
    carb = np.where(arr[2] < 0, 255, np.clip(np.round(arr[2] / 10 * 4), 0, 254)).astype(np.uint8)
    print(f"  solo: areia {np.median(areia)}%, argila {np.median(argila)}%, C {np.median(carb) / 4} g/kg")
    return {"w": w, "h": h, "dx": DX_250, "areia": b64(areia), "argila": b64(argila), "carbono": b64(carb),
            "codificacao": "areia e argila em % (255 = sem dado); carbono g/kg = byte/4",
            "fonte": "ISRIC SoilGrids 2.0 (250 m), média ponderada 0-30 cm"}


def grade_relevo(ee):
    dem = ee.Image("USGS/SRTMGL1_003")
    dec = ee.Terrain.slope(dem).multiply(math.pi / 180).tan().multiply(100)   # graus -> %
    img = ee.Image.cat([dem.rename("alt"), dec.rename("dec")]).reduceResolution(ee.Reducer.mean(), maxPixels=256) \
        .reproject(crs="EPSG:4326", crsTransform=[DX_90, 0, W, 0, -DX_90, N])
    arr, _, w, h = baixar(ee, img, DX_90)
    alt = np.round(arr[0]).astype(np.int16)
    dec = np.clip(np.round(arr[1] * 10), 0, 255).astype(np.uint8)
    print(f"  relevo: alt {alt.min()}-{alt.max()} m, declividade mediana {np.median(dec) / 10}%")
    return {"w": w, "h": h, "dx": DX_90, "altitude": b64(alt), "declividade": b64(dec),
            "codificacao": "altitude int16 em m; declividade % = byte/10",
            "fonte": "NASA SRTM GL1 v003 (30 m), média para ~90 m; declividade por ee.Terrain.slope"}


def baixar_arquivo(url, destino, tentativas=4):
    for k in range(tentativas):
        try:
            urllib.request.urlretrieve(url, destino)
            return
        except Exception:
            if k == tentativas - 1:
                raise


def imagens_hls(ee, talhoes):
    def mascarar(i):
        return i.updateMask(i.select("Fmask").bitwiseAnd(14).eq(0))

    bandas = {"NASA/HLS/HLSL30/v002": ["B4", "B3", "B2"], "NASA/HLS/HLSS30/v002": ["B4", "B3", "B2"]}
    for t in talhoes:
        anel = t["geometria"]
        lons, lats = [p[0] for p in anel], [p[1] for p in anel]
        m = 0.004
        reg = ee.Geometry.Rectangle([min(lons) - m, min(lats) - m, max(lons) + m, max(lats) + m], "EPSG:4326", False)
        pasta = SAIDA / "img" / t["id"]
        pasta.mkdir(parents=True, exist_ok=True)
        t["imagens"] = {"caixa": [min(lons) - m, min(lats) - m, max(lons) + m, max(lats) + m], "itens": []}
        for ano in range(2015, 2025):
            for fase, ini, fim in (("soja", f"{ano}-12-01", f"{ano + 1}-02-28"), ("safrinha", f"{ano + 1}-04-01", f"{ano + 1}-06-30")):
                partes = [ee.ImageCollection(c).filterBounds(reg).filterDate(ini, fim).map(mascarar).select(b, ["r", "g", "b"])
                          for c, b in bandas.items()]
                ic = partes[0].merge(partes[1])
                n = ic.size().getInfo()
                arq = None
                if n:
                    url = ic.median().getThumbURL({"region": reg, "dimensions": 320, "format": "png", "bands": ["r", "g", "b"],
                                                   "min": 0, "max": 0.22, "gamma": 1.3, "crs": "EPSG:4326"})
                    arq = f"img/{t['id']}/{ano}_{fase}.png"
                    baixar_arquivo(url, SAIDA / arq)
                t["imagens"]["itens"].append({"ano": ano, "fase": fase, "cenas": n, "arquivo": arq})
        print(f"  HLS {t['id']}: ok")


# ------------------------------------------------------------------------------------------
# Series do ponto (parquet)
# ------------------------------------------------------------------------------------------
def ra_fao56(lat, doy):
    """Radiacao extraterrestre (MJ/m2/dia), FAO-56 eq. 21."""
    phi = math.radians(lat)
    dr = 1 + 0.033 * np.cos(2 * np.pi / 365 * doy)
    d = 0.409 * np.sin(2 * np.pi / 365 * doy - 1.39)
    ws = np.arccos(-np.tan(phi) * np.tan(d))
    return 24 * 60 / np.pi * 0.0820 * dr * (ws * np.sin(phi) * np.sin(d) + np.cos(phi) * np.cos(d) * np.sin(ws))


def series_ponto():
    man = json.loads((DADOS / "manifesto.json").read_text(encoding="utf-8"))
    lat, lon = man["ponto"]["lat"], man["ponto"]["lon"]
    chirps = pd.read_parquet(DADOS / "chirps.parquet")
    hist = pd.read_parquet(DADOS / "power_historico.parquet")
    rec = pd.read_parquet(DADOS / "base_diaria.parquet")
    temp = pd.concat([hist[["data", "temp_max_c", "temp_min_c"]], rec[["data", "temp_max_c", "temp_min_c"]]]) \
        .drop_duplicates("data").set_index("data")
    df = chirps.set_index("data").join(temp, how="inner").sort_index()
    df = df[df.index <= "2025-06-30"]
    tmed = (df.temp_max_c + df.temp_min_c) / 2
    ra = ra_fao56(lat, df.index.day_of_year.values) / 2.45      # em mm/dia equivalentes
    et0 = 0.0023 * ra * (tmed + 17.8) * np.sqrt((df.temp_max_c - df.temp_min_c).clip(lower=0))
    print(f"  clima diario: {df.index.min().date()} a {df.index.max().date()}, {len(df)} dias")

    safras = pd.read_parquet(DADOS / "chirps_safras.parquet")
    enso = {int(r.ano_safra): {"fase": r.enso_safra, "oni_max": float(r.oni_max)} for r in safras.itertuples()}
    imerg = pd.read_parquet(DADOS / "imerg.parquet")
    smap = pd.read_parquet(DADOS / "smap_l4.parquet")
    smap["mes"] = smap.data.dt.to_period("M").astype(str)
    smap_m = smap.groupby("mes")[["sm_superficie", "sm_raiz"]].mean().round(4)
    relevo = pd.read_parquet(DADOS / "relevo.parquet").iloc[0].to_dict()
    mb = pd.read_parquet(DADOS / "mapbiomas.parquet")

    return {
        "ponto": {"lat": lat, "lon": lon, "local": man["ponto"]["local"]},
        "inicio": str(df.index.min().date()),
        "chuva": [round(float(v), 1) for v in df.chuva_chirps_mm],
        "et0": [round(float(v), 2) for v in et0],
        "tmax": [round(float(v), 1) for v in df.temp_max_c],
        "tmin": [round(float(v), 1) for v in df.temp_min_c],
        "enso_safra": enso,
        "imerg_mensal": {str(d.date())[:7]: round(float(v), 1) for d, v in zip(imerg.data, imerg.chuva_imerg_mm)},
        "smap_mensal": {m: [float(r.sm_superficie), float(r.sm_raiz)] for m, r in smap_m.iterrows()},
        "relevo_ponto": {k: (v if isinstance(v, str) else float(v)) for k, v in relevo.items()},
        "mapbiomas_ponto": {int(r.ano): r.classe for r in mb.itertuples()},
        "fontes": {
            "chuva": "CHIRPS v2.0 diário (~5,5 km), UCSB Climate Hazards Center",
            "temperatura": "NASA POWER diário (0,5° x 0,625°, ~55 km)",
            "et0": "Hargreaves & Samani (1985) com Ra da FAO-56, a partir das temperaturas do NASA POWER",
            "imerg": "NASA GPM IMERG Final V07 mensal (0,1°, ~11 km)",
            "smap": "NASA SMAP L4 v008 (9 km), média mensal",
            "enso": "NOAA CPC ONI; fase pelo ONI máximo nos meses centrais do ano-safra",
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sem-ee", action="store_true")
    ap.add_argument("--so-imagens", action="store_true", help="refaz so as imagens HLS e o talhoes.js")
    a = ap.parse_args()
    print("Series do ponto")
    escrever_js("clima.js", "ROTARE_CLIMA", series_ponto())

    talhoes = [{k: v for k, v in t.items() if k not in ("px", "circulo")} | {"geometria": geometria_talhao(t)} for t in TALHOES]
    if a.sem_ee:
        escrever_js("talhoes.js", "ROTARE_TALHOES", talhoes)
        return
    ee = ee_init()
    if a.so_imagens:
        imagens_hls(ee, talhoes)
        escrever_js("talhoes.js", "ROTARE_TALHOES", talhoes)
        return
    print("Grades regionais (Earth Engine)")
    regiao = {"nome": "Sorriso, Mato Grosso", "bbox": [W, S, E, N],
              "ndvi": grade_ndvi(ee), "mapbiomas": grade_mapbiomas(ee), "solo": grade_solo(ee), "relevo": grade_relevo(ee),
              "worldcover": __import__("grades").grade_worldcover(ee, [W, S, E, N])}
    escrever_js("regiao.js", "ROTARE_REGIAO", regiao)
    print("Imagens HLS dos talhoes")
    imagens_hls(ee, talhoes)
    escrever_js("talhoes.js", "ROTARE_TALHOES", talhoes)


if __name__ == "__main__":
    main()
