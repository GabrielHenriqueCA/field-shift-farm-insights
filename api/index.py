# Aviso de SI: modulo escrito com ajuda de IA (Claude), sob direcao do time Datanauts Brasil.
"""
Ponto de entrada WSGI / BaseHTTPRequestHandler da Vercel.
Roteia /api/status para a checagem do Earth Engine e /api/pacote para os dados climáticos/satélite.
"""
import json
import sys
import traceback
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rotare  # noqa: E402


def app(environ, start_response):
    """Entrypoint WSGI padrao da Vercel para frameworks Python."""
    try:
        path = environ.get("PATH_INFO", "") or ""
        query_string = environ.get("QUERY_STRING", "") or ""

        # Status do Earth Engine
        if path.rstrip("/").endswith("/status") or path in ("/api", "/api/"):
            try:
                _rotare.earth_engine()
                corpo = {"ok": True, "earth_engine": True}
            except Exception as e:
                corpo = {"ok": True, "earth_engine": False, "erro": str(e)}
            data = json.dumps(corpo, ensure_ascii=False).encode("utf-8")
            start_response("200 OK", [
                ("Content-Type", "application/json; charset=utf-8"),
                ("Content-Length", str(len(data))),
                ("Cache-Control", "no-store")
            ])
            return [data]

        # Pacote de dados da regiao / clima
        if path.rstrip("/").endswith("/pacote"):
            q = {k: v[0] for k, v in parse_qs(query_string).items()}
            try:
                if "bbox" in q:
                    bbox = _rotare.ler_caixa(q["bbox"])
                elif all(k in q for k in ("w", "s", "e", "n")):
                    bbox = _rotare.caixa_canonica(*(_rotare._num(q[k], k) for k in ("w", "s", "e", "n")))
                    destino = _rotare.url_canonica(bbox)
                    corpo = json.dumps({"bbox": bbox, "url": destino}, ensure_ascii=False).encode("utf-8")
                    start_response("308 Permanent Redirect", [
                        ("Location", destino),
                        ("Content-Type", "application/json; charset=utf-8"),
                        ("Content-Length", str(len(corpo))),
                        ("Cache-Control", _rotare.CACHE_OK)
                    ])
                    return [corpo]
                else:
                    corpo = json.dumps({"erro": "Informe w, s, e, n."}, ensure_ascii=False).encode("utf-8")
                    start_response("400 Bad Request", [
                        ("Content-Type", "application/json; charset=utf-8"),
                        ("Content-Length", str(len(corpo)))
                    ])
                    return [corpo]
            except ValueError as e:
                corpo = json.dumps({"erro": str(e)}, ensure_ascii=False).encode("utf-8")
                start_response("400 Bad Request", [
                    ("Content-Type", "application/json; charset=utf-8"),
                    ("Content-Length", str(len(corpo)))
                ])
                return [corpo]

            try:
                corpo = _rotare.montar_pacote(bbox)
                start_response("200 OK", [
                    ("Content-Type", "application/json; charset=utf-8"),
                    ("Content-Length", str(len(corpo))),
                    ("Cache-Control", _rotare.CACHE_OK)
                ])
                return [corpo]
            except Exception as e:
                traceback.print_exc()
                corpo = json.dumps({"erro": str(e)}, ensure_ascii=False).encode("utf-8")
                start_response("500 Internal Server Error", [
                    ("Content-Type", "application/json; charset=utf-8"),
                    ("Content-Length", str(len(corpo)))
                ])
                return [corpo]

        # Endpoint desconhecido
        corpo = json.dumps({"erro": "Endpoint nao encontrado. Use /api/status ou /api/pacote", "path": path}, ensure_ascii=False).encode("utf-8")
        start_response("404 Not Found", [
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Length", str(len(corpo)))
        ])
        return [corpo]

    except Exception as e:
        err = traceback.format_exc()
        print("FATAL ERROR IN API:", err)
        # o traceback fica so no log da Vercel; nao vai para o visitante (expoe caminhos internos)
        data = json.dumps({"ok": False, "erro": str(e)}, ensure_ascii=False).encode("utf-8")
        start_response("500 Internal Server Error", [
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Length", str(len(data)))
        ])
        return [data]


class handler(BaseHTTPRequestHandler):
    """Fallback caso a Vercel instancie como BaseHTTPRequestHandler."""
    def do_GET(self):
        try:
            path = self.path
            environ = {
                "PATH_INFO": path.split("?")[0],
                "QUERY_STRING": path.split("?")[1] if "?" in path else "",
                "REQUEST_METHOD": "GET"
            }
            res_headers = []
            res_status = ["200 OK"]

            def start_response(status, headers):
                res_status[0] = status
                res_headers.extend(headers)

            chunks = app(environ, start_response)
            status_code = int(res_status[0].split()[0])
            self.send_response(status_code)
            for k, v in res_headers:
                self.send_header(k, v)
            self.end_headers()
            for chunk in chunks:
                self.wfile.write(chunk)
        except Exception as e:
            traceback.print_exc()
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": False, "erro": str(e)}).encode("utf-8"))
