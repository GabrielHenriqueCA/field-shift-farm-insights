#!/usr/bin/env python3
# SI disclosure (NASA Space Apps 2026): this file was written with the help of an AI coding
# assistant (Claude, Anthropic) under the direction of the Datanauts Brasil team. It only converts
# the collected Parquet files to CSV; no value is created or changed.
"""
Exporta todos os Parquet de data/<talhao>/ para CSV completos em data/<talhao>/csv/, para o time
abrir em Excel, Sheets, Power BI ou pandas sem instalar pyarrow.

  python exportar_csv.py                 # todos os talhoes em ../data
  python exportar_csv.py --talhao sorriso

CSV: separador virgula, decimal ponto, UTF-8 com BOM (o Excel mostra os acentos).
No Excel em portugues: Dados > De Texto/CSV > Delimitador: Virgula.
O calendario da FAO vem aninhado (uma lista de sessoes por cultura) e e achatado em uma linha por sessao.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent / "data"


def achatar_calendario_fao(df: pd.DataFrame) -> pd.DataFrame:
    linhas = []
    for _, r in df.iterrows():
        sessoes = r.get("sessions")
        sessoes = list(sessoes) if sessoes is not None and len(sessoes) else [{}]
        for s in sessoes:
            s = s or {}

            def md(chave):
                d = s.get(chave) or {}
                return f"{int(d['day']):02d}/{int(d['month']):02d}" if d.get("day") and d.get("month") else ""

            linhas.append({
                "cultura": r.get("crop.name"), "regiao": r.get("aez.name"),
                "plantio_inicio": md("early_sowing"), "plantio_fim": md("later_sowing"),
                "colheita_inicio": md("early_harvest"), "colheita_fim": md("late_harvest"),
                "ano_todo": s.get("all_year", ""), "info": s.get("additional_information", ""),
                "comentario": s.get("comments", ""), "atualizado_em": r.get("lastUpdated"),
            })
    return pd.DataFrame(linhas)


def exportar(pasta: Path) -> list[tuple[str, int, int]]:
    saida = pasta / "csv"
    saida.mkdir(exist_ok=True)
    feitos = []
    for pq in sorted(pasta.glob("*.parquet")):
        df = pd.read_parquet(pq)
        if pq.stem == "calendario_fao" and "sessions" in df:
            df = achatar_calendario_fao(df)
        df.to_csv(saida / f"{pq.stem}.csv", index=False, encoding="utf-8-sig")
        feitos.append((pq.stem, len(df), df.shape[1]))
    return feitos


def main():
    ap = argparse.ArgumentParser(description="Exporta os Parquet do Rotare para CSV")
    ap.add_argument("--talhao", help="nome da pasta em data/ (padrao: todas)")
    a = ap.parse_args()
    pastas = [RAIZ / a.talhao] if a.talhao else [p for p in sorted(RAIZ.iterdir()) if p.is_dir()]
    for pasta in pastas:
        print(f"\n{pasta.name}:")
        for nome, n, c in exportar(pasta):
            print(f"  {nome:22s} {n:>7} linhas  {c:>3} colunas")
        print(f"  -> {pasta / 'csv'}")


if __name__ == "__main__":
    main()
