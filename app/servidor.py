# Aviso de SI: servidor escrito com ajuda de IA (Claude), sob direcao do time Datanauts Brasil.
"""
Servidor local do Rotare: entrega o app e a API que busca, ao vivo, os dados de qualquer area via
Google Earth Engine e NASA POWER (mesmas fontes e metodos da regiao de demonstracao).

Uso (na pasta rotare/app, com o venv que tem earthengine-api):
    ..\\..\\codigo\\rotare-coletav2\\coleta\\.venv\\Scripts\\python servidor.py
    abrir http://127.0.0.1:8765

API:
    GET /api/status                       -> {"ok": true, "earth_engine": true}
    GET /api/pacote?w=&s=&e=&n=           -> {"regiao": {...}, "clima": {...}, "imagens": {...}}
    A caixa recebe uma margem de ~1 km. Respostas ficam em data/cache/ (a segunda consulta e instantanea).
"""
import hashlib
import json
import sys
import threading
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI.parent / "coleta"))
import grades  # noqa: E402

CACHE = AQUI / "data" / "cache"
MARGEM = 0.01          # graus (~1 km)
MAX_LADO = 0.25        # graus (~27 km): limite para manter a consulta em segundos
_ee = None
_ee_erro = None
_trava = threading.Lock()


def earth_engine():
    global _ee, _ee_erro
    with _trava:
        if _ee is None and _ee_erro is None:
            try:
                _ee = grades.ee_init()
            except Exception as e:  # sem credencial, sem internet
                _ee_erro = str(e)
    if _ee is None:
        raise RuntimeError(f"Earth Engine indisponível: {_ee_erro}")
    return _ee


def montar_pacote(w, s, e, n):
    bbox = [round(w - MARGEM, 4), round(s - MARGEM, 4), round(e + MARGEM, 4), round(n + MARGEM, 4)]
    if bbox[2] - bbox[0] > MAX_LADO or bbox[3] - bbox[1] > MAX_LADO:
        raise ValueError("Área grande demais para a análise ao vivo (lado máximo ~25 km).")
    chave = hashlib.sha1(json.dumps(bbox).encode()).hexdigest()[:16]
    arq = CACHE / f"{chave}.json"
    if arq.exists():
        return arq.read_bytes()
    ee = earth_engine()
    t0 = time.time()
    lat, lon = (bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(2) as ex:
        f_reg = ex.submit(grades.pacote_regiao, ee, bbox, f"Área em {lat:.3f}, {lon:.3f}")
        f_cli = ex.submit(grades.serie_clima, ee, lat, lon)
        regiao, imagens = f_reg.result()
        clima = f_cli.result()
    corpo = json.dumps({"regiao": regiao, "clima": clima, "imagens": imagens, "segundos": round(time.time() - t0, 1)},
                       ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    CACHE.mkdir(parents=True, exist_ok=True)
    arq.write_bytes(corpo)
    print(f"pacote {chave} montado em {time.time() - t0:.1f} s ({len(corpo) / 1024:.0f} KB)")
    return corpo


class Rotare(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(AQUI), **k)

    def _json(self, codigo, corpo):
        if isinstance(corpo, (dict, list)):
            corpo = json.dumps(corpo, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/status":
            try:
                earth_engine()
                return self._json(200, {"ok": True, "earth_engine": True})
            except Exception as e:
                return self._json(200, {"ok": True, "earth_engine": False, "erro": str(e)})
        if u.path == "/api/pacote":
            q = {k: float(v[0]) for k, v in parse_qs(u.query).items() if k in ("w", "s", "e", "n")}
            try:
                return self._json(200, montar_pacote(q["w"], q["s"], q["e"], q["n"]))
            except KeyError:
                return self._json(400, {"erro": "Informe w, s, e, n."})
            except ValueError as e:
                return self._json(400, {"erro": str(e)})
            except Exception as e:
                traceback.print_exc()
                return self._json(500, {"erro": str(e)})
        return super().do_GET()

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"Rotare em http://127.0.0.1:{porta}  (Ctrl+C para parar)")
    ThreadingHTTPServer(("127.0.0.1", porta), Rotare).serve_forever()
