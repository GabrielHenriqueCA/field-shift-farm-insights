# Aviso de SI: modulo escrito com ajuda de IA (Claude), sob direcao do time Datanauts Brasil.
# Nenhum valor e inventado: tudo vem de NASA (MODIS, HLS, SRTM, POWER, IMERG, SMAP), CHIRPS, SoilGrids,
# ESA WorldCover e MapBiomas.
"""
Grades e series para QUALQUER area, usadas pelo app (servidor ao vivo) e pelo preparo da regiao de Sorriso.
Todas as grades saem em EPSG:4326 alinhadas a caixa [W, S, E, N], no formato que o navegador decodifica
(js/geo/zonal.js).
"""
import ast
import base64
import json
import math
import struct
import sys
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from array import array
from pathlib import Path

import calendar
from datetime import date, datetime, timedelta, timezone

# Sem pandas e sem numpy de proposito: este modulo roda na Serverless Function da Vercel (api/), cujo
# pacote tem limite de 225 MB, e os dois juntos ocupavam ~135 MB. Os pixels chegam do Earth Engine no
# formato NPY e sao lidos com a biblioteca padrao. As contas reproduzem o float32 do numpy (cada
# resultado volta a float32 com array('f')), entao as grades saem byte a byte iguais as de antes.

INICIO_CLIMA, FIM_CLIMA = "1981-01-01", "2025-06-30"
DX_250 = 0.0025
DX_90 = 1 / 1200

WORLDCOVER = {10: "Árvores", 20: "Arbustos", 30: "Campo / pastagem", 40: "Lavoura", 50: "Construções",
              60: "Solo exposto", 70: "Neve e gelo", 80: "Água", 90: "Área úmida", 95: "Mangue", 100: "Musgo e líquen"}


def _chave_service_account(bruto):
    """EE_SERVICE_ACCOUNT_KEY em Base64 (o normal na Vercel) ou o JSON cru, para facilitar testes."""
    bruto = bruto.strip()
    if not bruto.startswith("{"):
        bruto = base64.b64decode("".join(bruto.split())).decode("utf-8")
    info = json.loads(bruto)
    if not info.get("client_email") or not info.get("private_key"):
        raise ValueError("EE_SERVICE_ACCOUNT_KEY não parece uma chave de Service Account (faltam client_email/private_key).")
    return info, bruto


def ee_init():
    """Inicializa o Earth Engine e devolve o modulo `ee`.

    Nuvem (Vercel): com EE_SERVICE_ACCOUNT_KEY definida, autentica pela Service Account.
    Local: sem ela, usa as credenciais de `earthengine authenticate` (~/.config/earthengine) e o EE_PROJECT do .env.
    """
    import ee
    proj = os.environ.get("EE_PROJECT")
    chave = os.environ.get("EE_SERVICE_ACCOUNT_KEY")
    if chave:
        try:
            info, dados = _chave_service_account(chave)
        except Exception as e:
            raise RuntimeError(f"EE_SERVICE_ACCOUNT_KEY ilegível ({type(e).__name__}); confira o Base64 do JSON.") from None
        try:
            cred = ee.ServiceAccountCredentials(email=info["client_email"], key_data=dados)
            ee.Initialize(cred, project=proj or info.get("project_id"))
        except Exception as e:
            # Sem repassar a mensagem original: algumas trazem a chave privada inteira, e este erro
            # aparece em /api/status e nos logs. "from None" tambem corta o traceback encadeado.
            raise RuntimeError(f"Falha ao autenticar a Service Account {info['client_email']} "
                               f"no projeto {proj or info.get('project_id')}: {type(e).__name__}.") from None
        return ee
    env = Path(__file__).with_name(".env")
    if not proj and env.exists():
        for l in env.read_text(encoding="utf-8").splitlines():
            if l.startswith("EE_PROJECT="):
                proj = l.split("=", 1)[1].strip().strip('"')
    ee.Initialize(project=proj)
    return ee


def _meses(de, ate):
    """'2014-07'..'2025-06' -> [(ano, mes), ...] inclusivo."""
    a, m = map(int, de.split("-"))
    a2, m2 = map(int, ate.split("-"))
    out = []
    while (a, m) <= (a2, m2):
        out.append((a, m))
        a, m = (a + 1, 1) if m == 12 else (a, m + 1)
    return out


def _ultimo_dia(a, m):
    return date(a, m, calendar.monthrange(a, m)[1])


def _dia_utc(ms):
    """Milissegundos do Earth Engine (UTC) -> date."""
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).date()


def _dias(inicio, fim):
    d0, d1 = date.fromisoformat(inicio), date.fromisoformat(fim)
    return [d0 + timedelta(days=i) for i in range((d1 - d0).days + 1)]


def _interp(v):
    """Interpolacao linear por posicao, com as pontas repetindo o valor valido mais proximo."""
    v = [float(x) for x in v]
    xs = [i for i, x in enumerate(v) if not math.isnan(x)]
    if len(xs) == len(v) or not xs:
        return v
    out, j = [], 0
    for i in range(len(v)):          # mesma formula do numpy.interp: inclinacao * (x - xp[j]) + fp[j]
        if i <= xs[0]:
            out.append(v[xs[0]])
        elif i >= xs[-1]:
            out.append(v[xs[-1]])
        else:
            while xs[j + 1] <= i:
                j += 1
            a, b = xs[j], xs[j + 1]
            out.append(v[a] if i == a else (v[b] - v[a]) / (b - a) * (i - a) + v[a])
    return out


def f32(valores):
    """Arredonda cada valor para float32 (o mesmo que o numpy faz a cada operacao em float32)."""
    return array("f", valores)


def b64(valores, tipo="B"):
    """Bytes de inteiros (B = uint8, h = int16) em Base64, no formato que o navegador decodifica."""
    return base64.b64encode(array(tipo, valores).tobytes()).decode("ascii")


_TIPOS_NPY = {"f4": "f", "f8": "d", "i1": "b", "u1": "B", "i2": "h", "u2": "H", "i4": "i", "u4": "I", "i8": "q", "u8": "Q"}


def ler_npy(dados):
    """Le o NPY estruturado do Earth Engine (um campo por banda) -> {banda: [valores]} em ordem de linha."""
    if dados[:6] != bytes([0x93]) + b"NUMPY":
        raise ValueError("O Earth Engine não devolveu NPY.")
    if dados[6] == 1:
        n, ini = struct.unpack("<H", dados[8:10])[0], 10
    else:
        n, ini = struct.unpack("<I", dados[8:12])[0], 12
    cab = ast.literal_eval(dados[ini:ini + n].decode("latin1"))
    if cab.get("fortran_order"):
        raise ValueError("NPY em ordem Fortran não é suportado.")
    descr, corpo = cab["descr"], dados[ini + n:]
    if isinstance(descr, str):
        descr = [("b0", descr)]
    nomes, codigos = [], []
    for campo in descr:
        nome, tipo = campo[0], campo[1]
        if tipo[0] == ">" or tipo[1:] not in _TIPOS_NPY:
            raise ValueError(f"Tipo NPY não suportado: {tipo}")
        nomes.append(nome)
        codigos.append(_TIPOS_NPY[tipo[1:]])
    if len(set(codigos)) == 1:       # caso comum: todas as bandas do mesmo tipo
        tudo = array(codigos[0], corpo)
        if sys.byteorder == "big":
            tudo.byteswap()
        return {nome: tudo[k::len(nomes)] for k, nome in enumerate(nomes)}
    colunas = list(zip(*struct.iter_unpack("<" + "".join(codigos), corpo)))
    return {nome: list(col) for nome, col in zip(nomes, colunas)}


def grade(bbox, dx):
    W, S, E, N = bbox
    w, h = max(1, round((E - W) / dx)), max(1, round((N - S) / dx))
    return w, h, {"dimensions": {"width": w, "height": h},
                  "affineTransform": {"scaleX": dx, "shearX": 0, "translateX": W, "shearY": 0, "scaleY": -dx, "translateY": N},
                  "crsCode": "EPSG:4326"}


def baixar(ee, img, bbox, dx, bandas_por_lote=24):
    w, h, g = grade(bbox, dx)
    nomes = img.bandNames().getInfo()
    camadas = []
    for i in range(0, len(nomes), bandas_por_lote):
        lote = nomes[i:i + bandas_por_lote]
        bandas = ler_npy(ee.data.computePixels({"expression": img.select(lote), "fileFormat": "NPY", "grid": g}))
        camadas += [f32(bandas[b]) for b in lote]
    return camadas, nomes, w, h


# ------------------------------------------------------------------ grades
def grade_ndvi(ee, bbox, de="2014-07", ate="2025-06"):
    meses = _meses(de, ate)
    nomes = [f"{a}-{m:02d}" for a, m in meses]
    fim_total = _ultimo_dia(*meses[-1]) + timedelta(days=31)

    def prep(i):
        return i.select("NDVI").multiply(0.0001).updateMask(i.select("SummaryQA").lte(1)).copyProperties(i, ["system:time_start"])

    col = (ee.ImageCollection("MODIS/061/MOD13Q1").merge(ee.ImageCollection("MODIS/061/MYD13Q1"))
           .filterDate(f"{meses[0][0]}-{meses[0][1]:02d}-01", fim_total.isoformat()).map(prep))
    bandas = [col.filterDate(f"{a}-{m:02d}-01", (_ultimo_dia(a, m) + timedelta(days=1)).isoformat())
              .max().rename(n).unmask(-1) for (a, m), n in zip(meses, nomes)]
    img = ee.ImageCollection(bandas).toBands().rename(nomes)
    arr, _, w, h = baixar(ee, img, bbox, DX_250)
    c02 = f32([0.2])[0]
    cod = []
    for banda in arr:
        escala = f32([x * 200 for x in f32([x + c02 for x in banda])])
        cod += [255 if x < -0.5 else min(240, max(0, round(y))) for x, y in zip(banda, escala)]
    return {"meses": nomes, "w": w, "h": h, "dx": DX_250,
            "codificacao": "ndvi = byte/200 - 0.2 ; 255 = sem dado", "dados": b64(cod),
            "fonte": "NASA MODIS MOD13Q1 + MYD13Q1 v061 (250 m, 16 dias), maximo mensal, SummaryQA <= 1"}


def grade_mapbiomas(ee, bbox, anos=range(2014, 2024)):
    """So Brasil. Retorna None fora da cobertura."""
    anos = list(anos)
    asset = "projects/mapbiomas-public/assets/brazil/lulc/collection9/mapbiomas_collection90_integration_v1"
    W, S, E, N = bbox
    src = ee.Image(asset).select([f"classification_{a}" for a in anos])
    img = src.reduceResolution(ee.Reducer.mode(), maxPixels=1024).reproject(crs="EPSG:4326", crsTransform=[DX_250, 0, W, 0, -DX_250, N])
    arr, _, w, h = baixar(ee, img.unmask(0), bbox, DX_250)
    if not any(x for banda in arr for x in banda):
        return None
    return {"anos": anos, "w": w, "h": h, "dx": DX_250, "dados": b64([int(x) for banda in arr for x in banda]),
            "fonte": "MapBiomas Coleção 9 (30 m), classe mais frequente por célula de ~270 m"}


def dx_worldcover(bbox):
    W, S, E, N = bbox
    return max(0.0002, max(E - W, N - S) / 480)


def grade_worldcover(ee, bbox):
    W, S, E, N = bbox
    dx = dx_worldcover(bbox)
    wc = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map")
    img = wc.reduceResolution(ee.Reducer.mode(), maxPixels=4096).reproject(crs="EPSG:4326", crsTransform=[dx, 0, W, 0, -dx, N]) \
        if dx > 0.00015 else wc
    arr, _, w, h = baixar(ee, img.unmask(0).rename("Map"), bbox, dx)
    return {"w": w, "h": h, "dx": dx, "dados": b64([int(x) for x in arr[0]]), "classes": {str(k): v for k, v in WORLDCOVER.items()},
            "fonte": f"ESA WorldCover 2021 v200 (10 m), classe mais frequente por célula de ~{dx * 111000:.0f} m"}


def grade_solo(ee, bbox):
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
    arr, _, w, h = baixar(ee, img, bbox, DX_250)
    def pct(banda):
        return [255 if x < 0 else round(y) for x, y in zip(banda, f32([x / 10 for x in banda]))]

    areia, argila = pct(arr[0]), pct(arr[1])
    carb = [255 if x < 0 else min(254, max(0, round(y)))
            for x, y in zip(arr[2], f32([x * 4 for x in f32([x / 10 for x in arr[2]])]))]
    return {"w": w, "h": h, "dx": DX_250, "areia": b64(areia), "argila": b64(argila), "carbono": b64(carb),
            "codificacao": "areia e argila em % (255 = sem dado); carbono g/kg = byte/4",
            "fonte": "ISRIC SoilGrids 2.0 (250 m), média ponderada 0-30 cm"}


def grade_relevo(ee, bbox):
    W, S, E, N = bbox
    dem = ee.Image("USGS/SRTMGL1_003")
    dec = ee.Terrain.slope(dem).multiply(math.pi / 180).tan().multiply(100)
    img = ee.Image.cat([dem.rename("alt"), dec.rename("dec")]).reduceResolution(ee.Reducer.mean(), maxPixels=256) \
        .reproject(crs="EPSG:4326", crsTransform=[DX_90, 0, W, 0, -DX_90, N])
    arr, _, w, h = baixar(ee, img.unmask(-9999), bbox, DX_90)
    alt = [round(x) for x in arr[0]]
    dec = [min(255, max(0, round(y))) for y in f32([(0 if x < 0 else x) * 10 for x in arr[1]])]
    return {"w": w, "h": h, "dx": DX_90, "altitude": b64(alt, "h"), "declividade": b64(dec),
            "codificacao": "altitude int16 em m; declividade % = byte/10",
            "fonte": "NASA SRTM GL1 v003 (30 m), média para ~90 m; declividade por ee.Terrain.slope"}


# ------------------------------------------------------------------ series do ponto
def ra_fao56(lat, doys):
    """Radiacao extraterrestre (MJ/m2/dia) da FAO-56 para cada dia do ano; mesma ordem das contas de antes."""
    phi = math.radians(lat)
    k, c = 2 * math.pi / 365, 24 * 60 / math.pi * 0.0820
    out = []
    for doy in doys:
        dr = 1 + 0.033 * math.cos(k * doy)
        d = 0.409 * math.sin(k * doy - 1.39)
        ws = math.acos(min(1.0, max(-1.0, -math.tan(phi) * math.tan(d))))
        out.append(c * dr * (ws * math.sin(phi) * math.sin(d) + math.cos(phi) * math.cos(d) * math.sin(ws)))
    return out


def et0_hargreaves(lat, datas, tmax, tmin):
    """datas: lista de date (ou qualquer objeto com timetuple()); tmax e tmin: listas do mesmo tamanho."""
    ras = ra_fao56(lat, [float(d.timetuple().tm_yday) for d in datas])
    return [0.0023 * (ra / 2.45) * ((a + b) / 2 + 17.8) * math.sqrt(max(a - b, 0.0)) for ra, a, b in zip(ras, tmax, tmin)]


def chuva_chirps(ee, lat, lon):
    if abs(lat) > 50:
        raise ValueError("CHIRPS cobre só de 50°S a 50°N")
    col = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY").filterDate(INICIO_CLIMA, "2025-07-01").select("precipitation")
    rows = col.getRegion(ee.Geometry.Point(lon, lat), 5566).getInfo()
    it, ip = rows[0].index("time"), rows[0].index("precipitation")
    chuva = {}
    for r in rows[1:]:   # primeiro valor nao nulo de cada dia
        d = _dia_utc(r[it])
        if r[ip] is not None and d not in chuva:
            chuva[d] = float(r[ip])
    return chuva


def temperatura_power(lat, lon):
    u = ("https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M_MAX,T2M_MIN&community=AG"
         f"&longitude={lon:.4f}&latitude={lat:.4f}&start={INICIO_CLIMA.replace('-', '')}&end={FIM_CLIMA.replace('-', '')}&format=JSON")
    p = json.load(urllib.request.urlopen(u, timeout=120))["properties"]["parameter"]
    dias = list(p["T2M_MAX"])
    datas = [datetime.strptime(d, "%Y%m%d").date() for d in dias]
    lim = lambda xs: _interp([math.nan if x is None or x == -999 else x for x in xs])
    tmax, tmin = lim([p["T2M_MAX"][d] for d in dias]), lim([p["T2M_MIN"].get(d) for d in dias])
    return {d: (float(a), float(b)) for d, a, b in zip(datas, tmax, tmin)}


def imerg_mensal(ee, lat, lon):
    col = ee.ImageCollection("NASA/GPM_L3/IMERG_MONTHLY_V07").filterDate("2014-01-01", "2025-07-01").select("precipitation")
    rows = col.getRegion(ee.Geometry.Point(lon, lat), 11132).getInfo()
    out = {}
    for r in rows[1:]:
        d = _dia_utc(r[3])
        if r[4] is not None:
            dias_mes = calendar.monthrange(d.year, d.month)[1]
            out[f"{d.year}-{d.month:02d}"] = round(float(r[4]) * 24 * dias_mes, 1)   # mm/h -> mm/mes
    return out


def smap_mensal(ee, lat, lon):
    """Uma consulta por ano (a serie inteira de uma vez estoura a memoria do Earth Engine)."""
    pt = ee.Geometry.Point(lon, lat)

    def ano(a):
        col = (ee.ImageCollection("NASA/SMAP/SPL4SMGP/008").filterDate(f"{a}-01-01", f"{a + 1}-01-01")
               .filter(ee.Filter.calendarRange(12, 13, "hour")).select(["sm_surface", "sm_rootzone"]))
        try:
            rows = col.getRegion(pt, 11000).getInfo()
        except Exception:
            return None
        return rows

    with ThreadPoolExecutor(6) as ex:
        partes = [r for r in ex.map(ano, range(2015, 2026)) if r and len(r) > 1]
    por_mes = {}
    for rows in partes:
        it, isu, iro = rows[0].index("time"), rows[0].index("sm_surface"), rows[0].index("sm_rootzone")
        for r in rows[1:]:
            if any(v is None for v in r):   # mesma regra do dropna: linha com qualquer vazio sai
                continue
            d = _dia_utc(r[it])
            por_mes.setdefault(f"{d.year}-{d.month:02d}", []).append((float(r[isu]), float(r[iro])))
    def media4(vals):   # soma em sequencia e arredonda como numpy.round(x, 4): rint(x * 1e4) / 1e4
        s = 0.0
        for v in vals:
            s += v
        return round(s / len(vals) * 10000) / 10000

    return {m: [media4([a for a, _ in por_mes[m]]), media4([b for _, b in por_mes[m]])] for m in sorted(por_mes)}


def serie_clima(ee, lat, lon):
    with ThreadPoolExecutor(4) as ex:
        f_ch, f_t = ex.submit(chuva_chirps, ee, lat, lon), ex.submit(temperatura_power, lat, lon)
        f_im, f_sm = ex.submit(imerg_mensal, ee, lat, lon), ex.submit(smap_mensal, ee, lat, lon)
        chuva, temp = f_ch.result(), f_t.result()
        imerg, smap = f_im.result(), f_sm.result()
    datas = _dias(INICIO_CLIMA, FIM_CLIMA)
    chuva = [chuva.get(d, 0.0) for d in datas]
    nan = (math.nan, math.nan)
    tmax = _interp([temp.get(d, nan)[0] for d in datas])
    tmin = _interp([temp.get(d, nan)[1] for d in datas])
    et0 = et0_hargreaves(lat, datas, tmax, tmin)
    return {
        "ponto": {"lat": lat, "lon": lon, "local": f"{lat:.4f}, {lon:.4f}"},
        "inicio": INICIO_CLIMA,
        "chuva": [round(float(v), 1) for v in chuva],
        "et0": [round(float(v), 2) for v in et0],
        "tmax": [round(float(v), 1) for v in tmax],
        "tmin": [round(float(v), 1) for v in tmin],
        "imerg_mensal": imerg, "smap_mensal": smap,
        "fontes": {"chuva": "CHIRPS v2.0 diário (~5,5 km)", "temperatura": "NASA POWER diário (~55 km)",
                   "et0": "Hargreaves & Samani (1985) com Ra da FAO-56", "imerg": "NASA GPM IMERG Final V07 mensal (~11 km)",
                   "smap": "NASA SMAP L4 v008 (9 km), média mensal das 12h"},
    }


# ------------------------------------------------------------------ imagens HLS (URLs de miniatura)
def miniaturas_hls(ee, bbox, anos=range(2015, 2025)):
    W, S, E, N = bbox
    reg = ee.Geometry.Rectangle([W, S, E, N], "EPSG:4326", False)

    def mascarar(i):
        return i.updateMask(i.select("Fmask").bitwiseAnd(14).eq(0))

    def uma(ano, fase, ini, fim):
        partes = [ee.ImageCollection(c).filterBounds(reg).filterDate(ini, fim).map(mascarar).select(["B4", "B3", "B2"], ["r", "g", "b"])
                  for c in ("NASA/HLS/HLSL30/v002", "NASA/HLS/HLSS30/v002")]
        ic = partes[0].merge(partes[1])
        try:
            url = ic.median().getThumbURL({"region": reg, "dimensions": 320, "format": "png", "bands": ["r", "g", "b"],
                                           "min": 0, "max": 0.22, "gamma": 1.3, "crs": "EPSG:4326"})
        except Exception:
            url = None
        return {"ano": ano, "fase": fase, "url": url}

    tarefas = []
    for a in anos:
        tarefas.append((a, "soja", f"{a}-12-01", f"{a + 1}-02-28"))
        tarefas.append((a, "safrinha", f"{a + 1}-04-01", f"{a + 1}-06-30"))
    with ThreadPoolExecutor(8) as ex:
        itens = list(ex.map(lambda t: uma(*t), tarefas))
    return {"caixa": [W, S, E, N], "itens": [i for i in itens if i["url"]]}


def pacote_regiao(ee, bbox, nome, com_imagens=True):
    """Tudo que o navegador precisa para analisar qualquer polígono dentro de bbox."""
    with ThreadPoolExecutor(6) as ex:
        fut = {k: ex.submit(f, ee, bbox) for k, f in {"ndvi": grade_ndvi, "solo": grade_solo, "relevo": grade_relevo,
                                                       "worldcover": grade_worldcover, "mapbiomas": grade_mapbiomas}.items()}
        if com_imagens:
            fut["imagens"] = ex.submit(miniaturas_hls, ee, bbox)
        res = {}
        for k, f in fut.items():
            try:
                res[k] = f.result()
            except Exception as e:  # MapBiomas fora do Brasil, por exemplo
                if k in ("mapbiomas", "imagens"):
                    res[k] = None
                else:
                    raise RuntimeError(f"{k}: {e}") from e
    regiao = {"nome": nome, "bbox": list(bbox), **{k: res[k] for k in ("ndvi", "solo", "relevo", "worldcover", "mapbiomas")}}
    return regiao, res.get("imagens")
