# Aviso de SI: funcao escrita com ajuda de IA (Claude), sob direcao do time Datanauts Brasil.
"""
GET /api/pacote?w=&s=&e=&n=   -> 308 para a URL canonica (caixa com margem encaixada na grade de 0,01 grau)
GET /api/pacote?bbox=W,S,E,N  -> {"regiao": {...}, "clima": {...}, "imagens": {...}}

O redirecionamento faz talhoes proximos virarem a MESMA URL, entao o cache da CDN da Vercel
(s-maxage de 1 dia) e reaproveitado. O fetch do navegador segue o 308 sozinho; o app usa o bbox
devolvido em regiao.bbox, que sempre cobre o talhao desenhado.
"""
import sys
import traceback
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rotare  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
        try:
            if "bbox" in q:
                bbox = _rotare.ler_caixa(q["bbox"])
            elif all(k in q for k in ("w", "s", "e", "n")):
                bbox = _rotare.caixa_canonica(*(_rotare._num(q[k], k) for k in ("w", "s", "e", "n")))
                destino = _rotare.url_canonica(bbox)
                return _rotare.responder(self, 308, {"bbox": bbox, "url": destino}, cache=_rotare.CACHE_OK,
                                         extra={"Location": destino})
            else:
                return _rotare.responder(self, 400, {"erro": "Informe w, s, e, n."})
        except ValueError as e:
            return _rotare.responder(self, 400, {"erro": str(e)})
        try:
            corpo = _rotare.montar_pacote(bbox)
        except Exception as e:
            traceback.print_exc()   # vai para os logs da Vercel
            return _rotare.responder(self, 500, {"erro": str(e)})
        return _rotare.responder(self, 200, corpo, cache=_rotare.CACHE_OK)
