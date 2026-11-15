"""Local presentation preview, with the existing app available at /explorar.

Aviso de SI: servidor de prévia criado com assistência de IA para Datanauts Brasil.
Usage from the repository root: python app/landing/serve.py [port]
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

APP = Path(__file__).resolve().parent.parent


class Preview(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP), **kwargs)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path in ('/', '/apresentacao', '/apresentacao/'):
            self.path = '/apresentacao.html'
        elif path in ('/explorar', '/explorar/'):
            self.path = '/plataforma.html'
        elif path == '/preview.html':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            data = (APP / 'apresentacao.html').read_bytes()
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    print(f'Rotare | apresentacao: http://127.0.0.1:{port}/', flush=True)
    print(f'Rotare | plataforma:   http://127.0.0.1:{port}/explorar', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Preview).serve_forever()
