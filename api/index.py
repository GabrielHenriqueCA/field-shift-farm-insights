# Aviso de SI: modulo escrito com ajuda de IA (Claude), sob direcao do time Datanauts Brasil.
"""
Ponto de entrada padrao (entrypoint) da Vercel.
Roteia requisicoes de /api/status e /api/pacote para os respectivos handlers.
"""
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import status  # noqa: E402
import pacote  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        caminho = urlparse(self.path).path.rstrip("/")
        if caminho.endswith("/status"):
            return status.handler.do_GET(self)
        if caminho.endswith("/pacote"):
            return pacote.handler.do_GET(self)
        if caminho in ("/api", ""):
            return status.handler.do_GET(self)

        self.send_response(404)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(b'{"erro": "Endpoint nao encontrado. Use /api/status ou /api/pacote"}')


# Compatibilidade caso o runtime busque por app
app = handler
