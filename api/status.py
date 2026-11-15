# Aviso de SI: funcao escrita com ajuda de IA (Claude), sob direcao do time Datanauts Brasil.
"""GET /api/status -> {"ok": true, "earth_engine": true|false} (mesmo contrato do servidor local)."""
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rotare  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            _rotare.earth_engine()
            corpo = {"ok": True, "earth_engine": True}
        except Exception as e:
            corpo = {"ok": True, "earth_engine": False, "erro": str(e)}
        _rotare.responder(self, 200, corpo)
