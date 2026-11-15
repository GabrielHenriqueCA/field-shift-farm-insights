"""Rebuild the landing's real regional snapshots and decorative vector globe.

Aviso de SI: script criado com assistência de IA para Datanauts Brasil.
Dependencies: Python, numpy, Pillow. Uses only the repository's prepared data.
Run from the repository root: python app/landing/prepare-assets.py
"""
import base64
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = HERE / 'assets'
OUT.mkdir(exist_ok=True)
text = (ROOT / 'app/data/regiao.js').read_text(encoding='utf-8')
region = json.loads(text[text.index('=') + 1:].strip().rstrip(';'))


def render(values, valid, stops, filename):
    palette = np.array([color for _, color in stops])
    limits = np.array([value for value, _ in stops])
    rgb = np.stack([np.interp(values, limits, palette[:, channel]) for channel in range(3)], axis=-1)
    rgb[~valid] = (52, 67, 75)
    image = Image.fromarray(np.uint8(np.clip(rgb, 0, 255)))
    image.resize((768, 768), Image.Resampling.NEAREST).save(OUT / filename, 'WEBP', quality=88, method=6)


ndvi = region['ndvi']
stack = np.frombuffer(base64.b64decode(ndvi['dados']), dtype=np.uint8).reshape(-1, ndvi['h'], ndvi['w'])
for year in range(2015, 2025):
    raster = stack[ndvi['meses'].index(f'{year}-02')]
    render(raster / 200 - .2, raster != 255, [(-.2,(184,132,69)),(.2,(215,192,107)),(.45,(140,173,98)),(.7,(54,125,85)),(1,(22,63,56))], f'ndvi-{year}.webp')
soil = region['solo']
clay = np.frombuffer(base64.b64decode(soil['argila']), dtype=np.uint8).reshape(soil['h'],soil['w'])
render(clay,clay!=255,[(0,(217,203,155)),(25,(174,142,87)),(45,(139,94,52)),(70,(88,58,45))],'solo.webp')
terrain = region['relevo']
slope = np.frombuffer(base64.b64decode(terrain['declividade']), dtype=np.uint8).reshape(terrain['h'],terrain['w'])
render(slope/10,slope!=255,[(0,(40,62,67)),(2,(115,134,118)),(5,(210,198,139)),(7.5,(233,196,106)),(10,(177,108,79))],'relevo.webp')

# Simplified, hand-authored geographic silhouettes, for decorative illustration only.
# Orthographic projection centered over the Atlantic, with South America in view.
continents = [
    [(-81,12),(-76,9),(-73,11),(-71,12),(-67,10),(-63,10),(-60,8),(-56,5),(-52,4),(-50,0),(-48,-1),(-45,-2),(-41,-3),(-38,-6),(-35,-7),(-35,-10),(-38,-13),(-39,-17),(-40,-22),(-44,-23),(-48,-28),(-50,-30),(-52,-33),(-54,-35),(-58,-38),(-60,-40),(-63,-41),(-65,-45),(-67,-48),(-68,-53),(-71,-55),(-74,-51),(-75,-46),(-74,-41),(-73,-37),(-72,-32),(-71,-28),(-70,-24),(-71,-20),(-74,-16),(-77,-12),(-80,-7),(-81,-3),(-79,1),(-77,5),(-78,8),(-81,9)],
    [(-168,65),(-154,70),(-140,69),(-128,70),(-122,75),(-111,74),(-100,75),(-90,73),(-83,69),(-76,68),(-70,62),(-65,60),(-60,54),(-56,52),(-60,47),(-65,44),(-69,45),(-73,42),(-75,36),(-80,32),(-81,26),(-80,25),(-83,25),(-85,30),(-89,29),(-91,29),(-94,25),(-97,22),(-96,18),(-91,18),(-87,16),(-84,13),(-83,9),(-79,9),(-77,8),(-78,7),(-82,8),(-85,10),(-87,13),(-90,15),(-94,16),(-100,17),(-105,20),(-108,24),(-111,26),(-114,28),(-117,32),(-120,36),(-124,40),(-125,47),(-130,51),(-139,59),(-148,60),(-156,58),(-165,60)],
    [(-17,15),(-16,20),(-13,24),(-10,29),(-6,33),(-2,35),(5,36),(10,37),(12,33),(18,31),(24,32),(30,31),(33,28),(35,23),(38,18),(43,12),(51,12),(49,6),(44,0),(42,-4),(39,-9),(41,-12),(39,-17),(35,-20),(33,-25),(29,-30),(25,-34),(19,-35),(17,-30),(15,-25),(13,-18),(11,-12),(13,-6),(10,0),(8,4),(2,6),(-4,5),(-8,5),(-13,9),(-17,15)],
    [(-10,36),(-9,43),(-2,44),(3,48),(-3,49),(-5,51),(0,54),(6,54),(10,57),(12,62),(18,67),(25,71),(33,69),(40,65),(50,64),(62,68),(75,70),(90,74),(110,73),(130,70),(150,62),(160,58),(155,50),(145,48),(140,40),(130,36),(122,28),(118,22),(110,20),(105,10),(98,7),(96,15),(90,22),(85,20),(80,7),(76,10),(72,20),(67,24),(60,25),(54,16),(50,13),(44,18),(40,25),(35,29),(33,34),(28,37),(23,39),(24,41),(18,43),(16,40),(13,42),(10,44),(8,44),(5,43),(1,40),(-3,36)],
    [(-52,59),(-45,61),(-40,65),(-30,68),(-22,72),(-20,77),(-30,82),(-45,83),(-55,80),(-62,75),(-58,68)],
    [(-8,50),(-5,51),(-5,55),(-3,59),(0,58),(0,54),(1,52)],
    [(47,-13),(50,-16),(49,-22),(45,-25),(44,-20)],
    [(-84,23),(-77,22),(-74,20),(-79,20)],
]
LON, LAT = map(math.radians, (-33, 7))


def project(lon,lat):
    lon,lat=math.radians(lon),math.radians(lat)
    z=math.sin(LAT)*math.sin(lat)+math.cos(LAT)*math.cos(lat)*math.cos(lon-LON)
    return (450+420*math.cos(lat)*math.sin(lon-LON),450-420*(math.cos(LAT)*math.sin(lat)-math.sin(LAT)*math.cos(lat)*math.cos(lon-LON)),z)


def segment(points):
    output=[]
    for (a,b),(c,d) in zip(points,points[1:]+points[:1]):
        count=max(1,round(max(abs(c-a),abs(d-b))/1.8))
        output.extend((a+(c-a)*i/count,b+(d-b)*i/count) for i in range(count))
    return output


parts=['''<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900"><defs>
<radialGradient id="ocean" cx="32%" cy="25%" r="77%"><stop stop-color="#304e57"/><stop offset=".38" stop-color="#1a3540"/><stop offset=".75" stop-color="#12242d"/><stop offset="1" stop-color="#080f19"/></radialGradient>
<radialGradient id="land" cx="30%" cy="20%" r="88%"><stop stop-color="#9a9c78"/><stop offset=".43" stop-color="#71886a"/><stop offset=".75" stop-color="#3c6054"/><stop offset="1" stop-color="#1d3a36"/></radialGradient>
<radialGradient id="shade" cx="24%" cy="25%" r="78%"><stop offset=".35" stop-color="#080e1b" stop-opacity="0"/><stop offset=".7" stop-color="#050911" stop-opacity=".2"/><stop offset="1" stop-color="#050911" stop-opacity=".93"/></radialGradient>
<radialGradient id="rim"><stop offset=".91" stop-color="#5da2d2" stop-opacity="0"/><stop offset=".98" stop-color="#7ca7bf" stop-opacity=".1"/><stop offset="1" stop-color="#83c1e3" stop-opacity=".65"/></radialGradient>
<clipPath id="sphere"><circle cx="450" cy="450" r="420"/></clipPath><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".065" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".13"/></feComponentTransfer><feBlend in="SourceGraphic" mode="soft-light"/></filter></defs>
<circle cx="450" cy="450" r="423" fill="#578dac" opacity=".07"/><circle cx="450" cy="450" r="420" fill="url(#ocean)"/>
<g clip-path="url(#sphere)">''']
land_paths=[]
for polygon in continents:
    points=[project(*point) for point in segment(polygon)]
    if not any(p[2]>.02 for p in points): continue
    # Visible portions of this decorative globe, clamped at the horizon.
    visible=[p for p in points if p[2]>=0]
    if len(visible)<3: continue
    path='M'+' '.join(f'{p[0]:.1f},{p[1]:.1f}' for p in visible)+'Z'
    land_paths.append(path)
    parts.append(f'<path d="{path}" fill="url(#land)" stroke="#c2c4a8" stroke-opacity=".3" stroke-width=".8"/>')
parts.append('<clipPath id="land-clip">'+''.join(f'<path d="{p}"/>' for p in land_paths)+'</clipPath>')
parts.append('<g clip-path="url(#land-clip)" opacity=".17" fill="none" stroke="#d1c69a" stroke-width=".6">')
for i in range(32):
    x=180+i*13
    parts.append(f'<path d="M{x},160 C{x+180},300 {x-190},550 {x+70},800"/>')
parts.append('</g><g fill="#e9dcb7" opacity=".18" clip-path="url(#land-clip)">')
for row in range(21,147):
    for col in range(15,147):
        if (row*13+col*7)%9<3:
            parts.append(f'<circle cx="{col*6}" cy="{row*6}" r=".7"/>')
parts.append('</g><g fill="none" stroke="#91afb5" stroke-width=".65" opacity=".17">')
for direction in ('lat','lon'):
    for fixed in range(-150 if direction=='lon' else -60,181 if direction=='lon' else 61,30):
        segments=[]; current=[]
        for varying in range(-90 if direction=='lon' else -180,91 if direction=='lon' else 181,2):
            p=project(fixed,varying) if direction=='lon' else project(varying,fixed)
            if p[2]>=0: current.append(p)
            elif current: segments.append(current);current=[]
        if current:segments.append(current)
        for pts in segments:
            if len(pts)>1:parts.append('<path d="M'+' '.join(f'{p[0]:.1f},{p[1]:.1f}' for p in pts)+'"/>')
parts.append('</g><circle cx="450" cy="450" r="420" fill="url(#shade)"/><circle cx="450" cy="450" r="420" fill="url(#rim)"/></g><circle cx="450" cy="450" r="420" fill="none" stroke="#9cc8d6" stroke-opacity=".23" stroke-width="1"/></svg>')
(OUT/'earth.svg').write_text(''.join(parts),encoding='utf-8')
print('Created 12 real-data map snapshots and the decorative vector globe.')
