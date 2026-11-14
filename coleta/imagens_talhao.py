# Aviso de SI: script escrito com ajuda de IA (Claude), sob direcao do time Datanauts Brasil.
# Nenhuma imagem e gerada por IA: todas vem do NASA HLS (Landsat 30 + Sentinel 30) via Google Earth Engine.
"""
Gera a "tira do tempo" do talhao: uma imagem de satelite vista de cima por ano-safra,
no pico da soja (dez a fev) e no pico da safrinha (abr a jun).

Uso:
    python imagens_talhao.py --lat -12.6 --lon -55.95 --nome sorriso
    python imagens_talhao.py --lat -12.6 --lon -55.95 --nome sorriso --raio 2000 --de 2015 --ate 2025

Saida: data/<nome>/imagens/<safra>_<fase>.png e data/<nome>/imagens/imagens.json
Fonte: NASA HLS v2.0 (HLSL30 e HLSS30). Nuvem, sombra e cirro mascarados pelo Fmask.
"""
import argparse
import json
import os
import urllib.request
from pathlib import Path

import ee

RAIZ = Path(__file__).resolve().parent.parent

# Bandas com nomes comuns nas duas colecoes do HLS
BANDAS = {
    "NASA/HLS/HLSL30/v002": {"B4": "red", "B3": "green", "B2": "blue", "B5": "nir"},
    "NASA/HLS/HLSS30/v002": {"B4": "red", "B3": "green", "B2": "blue", "B8A": "nir"},
}

# Fases da safra no Centro-Oeste. O ano e o do inicio da safra (2023 = safra 2023/24).
FASES = {
    "soja": ((0, 12, 1), (1, 2, 28)),      # dez do ano Y ate fev do ano Y+1
    "safrinha": ((1, 4, 1), (1, 6, 30)),   # abr ate jun do ano Y+1
}


def ler_projeto():
    proj = os.environ.get("EE_PROJECT")
    env = Path(__file__).with_name(".env")
    if not proj and env.exists():
        for linha in env.read_text(encoding="utf-8").splitlines():
            if linha.startswith("EE_PROJECT="):
                proj = linha.split("=", 1)[1].strip().strip('"')
    return proj


def mascarar(img):
    # Fmask: bit 1 nuvem, bit 2 adjacente a nuvem, bit 3 sombra
    fm = img.select("Fmask")
    limpo = (fm.bitwiseAnd(1 << 1).eq(0)
             .And(fm.bitwiseAnd(1 << 2).eq(0))
             .And(fm.bitwiseAnd(1 << 3).eq(0)))
    return img.updateMask(limpo)


def colecao_hls(regiao, inicio, fim):
    partes = []
    for cid, mapa in BANDAS.items():
        ic = (ee.ImageCollection(cid).filterBounds(regiao).filterDate(inicio, fim)
              .map(mascarar).select(list(mapa.keys()), list(mapa.values())))
        partes.append(ic)
    return partes[0].merge(partes[1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--nome", required=True)
    ap.add_argument("--raio", type=int, default=2000, help="metros a partir do ponto (caixa de 2x raio)")
    ap.add_argument("--de", type=int, default=2015)
    ap.add_argument("--ate", type=int, default=2024)
    ap.add_argument("--px", type=int, default=512)
    a = ap.parse_args()

    ee.Initialize(project=ler_projeto())
    regiao = ee.Geometry.Point(a.lon, a.lat).buffer(a.raio).bounds()
    saida = RAIZ / "data" / a.nome / "imagens"
    saida.mkdir(parents=True, exist_ok=True)

    registros = []
    for ano in range(a.de, a.ate + 1):
        for fase, ((d0, m0, dia0), (d1, m1, dia1)) in FASES.items():
            inicio = f"{ano + d0}-{m0:02d}-{dia0:02d}"
            fim = f"{ano + d1}-{m1:02d}-{dia1:02d}"
            ic = colecao_hls(regiao, inicio, fim)
            n = ic.size().getInfo()
            reg = {"safra": f"{ano}/{str(ano + 1)[2:]}", "ano": ano, "fase": fase,
                   "inicio": inicio, "fim": fim, "cenas": n, "arquivo": None}
            if n == 0:
                print(f"{ano} {fase}: sem cena limpa")
                registros.append(reg)
                continue
            img = ic.median().clip(regiao)
            # NDVI medio da caixa, para conferir com a curva do MODIS
            ndvi = img.normalizedDifference(["nir", "red"]).reduceRegion(
                ee.Reducer.mean(), regiao, 30, bestEffort=True).get("nd").getInfo()
            url = img.getThumbURL({"region": regiao, "dimensions": a.px, "format": "png",
                                   "bands": ["red", "green", "blue"], "min": 0.0, "max": 0.25,
                                   "gamma": 1.3})
            nome = f"{ano}_{fase}.png"
            urllib.request.urlretrieve(url, saida / nome)
            reg.update(arquivo=nome, ndvi_medio=round(ndvi, 3) if ndvi is not None else None)
            registros.append(reg)
            print(f"{ano} {fase}: {n} cenas, NDVI {reg['ndvi_medio']} -> {nome}")

    meta = {"talhao": a.nome, "lat": a.lat, "lon": a.lon, "raio_m": a.raio,
            "fonte": "NASA HLS v2.0 (HLSL30 + HLSS30), mediana das cenas sem nuvem, via Google Earth Engine",
            "referencia": "Masek, J., et al. HLS Operational Land Surface Reflectance V2.0. NASA EOSDIS LP DAAC.",
            "imagens": registros}
    (saida / "imagens.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"ok: {saida}")


if __name__ == "__main__":
    main()
