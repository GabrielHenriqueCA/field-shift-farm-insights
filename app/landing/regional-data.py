"""Derive regional indicators from the repository's real, prepared rasters.

Aviso de SI: código criado com assistência de IA para Datanauts Brasil.
Run from the repository root: python app/landing/regional-data.py
"""
import base64
import json
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
source = (HERE.parent / 'data/regiao.js').read_text(encoding='utf-8')
region = json.loads(source[source.index('=') + 1:].strip().rstrip(';'))
ndvi = region['ndvi']
stack = np.frombuffer(base64.b64decode(ndvi['dados']), dtype=np.uint8).reshape(-1, ndvi['h'], ndvi['w'])
history = []
for year in range(2015, 2025):
    raw = stack[ndvi['meses'].index(f'{year}-02')]
    valid = raw != 255
    history.append({'year': year, 'mean': round(float((raw[valid] / 200 - .2).mean()), 4)})
clay = np.frombuffer(base64.b64decode(region['solo']['argila']), dtype=np.uint8)
slope = np.frombuffer(base64.b64decode(region['relevo']['declividade']), dtype=np.uint8)
summary = {
    'region': region['nome'], 'bbox': region['bbox'], 'ndvi': history,
    'clayMean': round(float(clay[clay != 255].mean()), 3),
    'slopeMean': round(float((slope[slope != 255] / 10).mean()), 3),
    'method': 'Média aritmética das células válidas da grade regional; NDVI: máximo mensal de fevereiro.',
}
(HERE / 'regional-data.js').write_text('// Indicadores derivados de app/data/regiao.js; nenhum valor sintético.\nwindow.ROTARE_LANDING_STATS=' + json.dumps(summary, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
print(json.dumps(summary, ensure_ascii=True))
