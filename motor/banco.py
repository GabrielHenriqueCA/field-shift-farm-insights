# SI disclosure (NASA Space Apps 2026): this file was written with the help of an AI coding
# assistant (Claude, Anthropic) under the direction of the Datanauts Brasil team. It only reads the
# database; the decision engine (crop history, water balance, soil index, ranking) is the team's own code.
"""
Acesso ao banco do Rotare para o motor e o app. So leitura, sem regra de negocio.

    from motor.banco import consulta, raio_x, safras, clima_diario, janelas_zarc
    raio_x("sorriso")                       # 1 linha: clima medio, solo 0-30 cm, agua disponivel, relevo
    safras("sorriso")                       # 1 linha por ano-safra desde 1981
    clima_diario("sorriso", desde="2014-07-01")
    janelas_zarc("sorriso", "soja")
    consulta("SELECT * FROM fato_producao_municipal WHERE cultura_id = ?", ["soja"])
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import duckdb
import pandas as pd

BANCO = Path(__file__).resolve().parent.parent / "data" / "rotare.duckdb"


@lru_cache(maxsize=1)
def _con() -> duckdb.DuckDBPyConnection:
    if not BANCO.exists():
        raise FileNotFoundError(f"{BANCO} nao existe. Rode: python coleta/montar_banco.py")
    return duckdb.connect(str(BANCO), read_only=True)


def consulta(sql: str, params: list | None = None) -> pd.DataFrame:
    return _con().execute(sql, params or []).df()


def talhoes() -> pd.DataFrame:
    return consulta("SELECT * FROM dim_talhao ORDER BY talhao_id")


def raio_x(talhao: str) -> pd.Series:
    return consulta("SELECT * FROM vw_raio_x WHERE talhao_id = ?", [talhao]).iloc[0]


def safras(talhao: str, so_completas: bool = True) -> pd.DataFrame:
    filtro = "AND safra_completa" if so_completas else ""
    return consulta(f"SELECT * FROM vw_safra WHERE talhao_id = ? {filtro} ORDER BY ano_safra", [talhao])


def clima_diario(talhao: str, desde: str | None = None, ate: str | None = None) -> pd.DataFrame:
    return consulta("""SELECT * FROM fato_clima_diario WHERE talhao_id = ?
                       AND data >= coalesce(?::DATE, DATE '1900-01-01') AND data <= coalesce(?::DATE, DATE '2100-01-01')
                       ORDER BY data""", [talhao, desde, ate])


def solo(talhao: str) -> pd.DataFrame:
    return consulta("""SELECT c.*, a.agua_disponivel_mm FROM fato_solo_camada c
                       LEFT JOIN fato_solo_agua a USING (talhao_id, profundidade)
                       WHERE talhao_id = ? ORDER BY c.propriedade, c.topo_cm""", [talhao])


def janelas_zarc(talhao: str, cultura_id: str | None = None) -> pd.DataFrame:
    return consulta("""SELECT j.* FROM vw_zarc_janela_atual j JOIN dim_talhao t ON t.geocodigo = j.geocodigo
                       WHERE t.talhao_id = ? AND (?::VARCHAR IS NULL OR j.cultura_id = ?)""",
                    [talhao, cultura_id, cultura_id])


def culturas() -> pd.DataFrame:
    return consulta("SELECT * FROM dim_cultura ORDER BY cultura_id")
