# Aviso de SI: modulo escrito com ajuda de IA (Claude), sob direcao do time Datanauts Brasil.
"""
Logica comum das Serverless Functions da Vercel (api/status.py e api/pacote.py).

Mesmas regras do servidor local (app/servidor.py), com duas diferencas por ser serverless:
- nao ha disco persistente: o reaproveitamento vem do cache da CDN (Cache-Control s-maxage);
- a caixa e encaixada numa grade fixa de 0,01 grau, para que talhoes vizinhos caiam na mesma URL.
Arquivos com "_" no inicio dentro de api/ nao viram endpoints na Vercel.
"""
import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coleta"))
import grades  # noqa: E402

MARGEM = 0.01      # graus (~1 km), igual ao servidor local
MAX_LADO = 0.25    # graus (~27 km), igual ao servidor local
GRADE = 0.01       # graus (~1,1 km): passo da grade fixa usada como chave de cache
CACHE_OK = "public, s-maxage=86400, stale-while-revalidate=3600"

_ee = None
_ee_erro = None


def earth_engine():
    """Inicializa uma vez por instancia (o modulo sobrevive entre invocacoes quentes)."""
    global _ee, _ee_erro
    if _ee is None:
        try:
            _ee = grades.ee_init()
            _ee_erro = None
        except Exception as e:  # sem credencial, chave invalida, sem rede
            _ee_erro = str(e)
    if _ee is None:
        raise RuntimeError(f"Earth Engine indisponível: {_ee_erro}")
    return _ee


def _num(v, nome):
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"Parâmetro {nome} inválido.") from None
    if not math.isfinite(x):
        raise ValueError(f"Parâmetro {nome} inválido.")
    return x


def _validar(w, s, e, n):
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        raise ValueError("Caixa inválida: use w < e e s < n em graus.")


def caixa_canonica(w, s, e, n):
    """Caixa do talhao -> caixa com margem, encaixada para fora na grade fixa (sempre cobre o talhao)."""
    _validar(w, s, e, n)
    W, S, E, N = w - MARGEM, s - MARGEM, e + MARGEM, n + MARGEM
    if E - W > MAX_LADO or N - S > MAX_LADO:   # mesmo criterio do servidor local, antes do encaixe
        raise ValueError("Área grande demais para a análise ao vivo (lado máximo ~25 km).")
    eps = 1e-9
    W = math.floor(W / GRADE + eps) * GRADE
    S = math.floor(S / GRADE + eps) * GRADE
    E = math.ceil(E / GRADE - eps) * GRADE
    N = math.ceil(N / GRADE - eps) * GRADE
    return [round(max(W, -180), 2), round(max(S, -90), 2), round(min(E, 180), 2), round(min(N, 90), 2)]


def ler_caixa(texto):
    """Le ?bbox=W,S,E,N ja canonica e confere se esta na grade (evita chaves de cache arbitrarias)."""
    partes = texto.split(",")
    if len(partes) != 4:
        raise ValueError("bbox deve ter 4 números: W,S,E,N.")
    bbox = [_num(v, "bbox") for v in partes]
    _validar(*bbox)
    if any(abs(v / GRADE - round(v / GRADE)) > 1e-6 for v in bbox):
        raise ValueError("bbox fora da grade de 0,01°; use w, s, e, n.")
    if bbox[2] - bbox[0] > MAX_LADO + 2 * GRADE + 1e-9 or bbox[3] - bbox[1] > MAX_LADO + 2 * GRADE + 1e-9:
        raise ValueError("Área grande demais para a análise ao vivo (lado máximo ~25 km).")
    return [round(v, 2) for v in bbox]


def url_canonica(bbox):
    return "/api/pacote?bbox=" + ",".join(f"{v:.2f}" for v in bbox)


def montar_pacote(bbox):
    """Mesmo conteudo do servidor local: regiao (grades), clima (series) e imagens HLS."""
    ee = earth_engine()
    t0 = time.time()
    lat, lon = (bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2
    with ThreadPoolExecutor(2) as ex:
        f_reg = ex.submit(grades.pacote_regiao, ee, bbox, f"Área em {lat:.3f}, {lon:.3f}")
        f_cli = ex.submit(grades.serie_clima, ee, lat, lon)
        regiao, imagens = f_reg.result()
        clima = f_cli.result()
    return json.dumps({"regiao": regiao, "clima": clima, "imagens": imagens, "segundos": round(time.time() - t0, 1)},
                      ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def responder(h, codigo, corpo, cache="no-store", extra=None):
    """Envia JSON por um BaseHTTPRequestHandler."""
    if isinstance(corpo, (dict, list)):
        corpo = json.dumps(corpo, ensure_ascii=False).encode("utf-8")
    h.send_response(codigo)
    h.send_header("Content-Type", "application/json; charset=utf-8")
    h.send_header("Content-Length", str(len(corpo)))
    h.send_header("Cache-Control", cache)
    for k, v in (extra or {}).items():
        h.send_header(k, v)
    h.end_headers()
    h.wfile.write(corpo)
