#!/usr/bin/env python3
# SI disclosure (NASA Space Apps 2026): this file was written with the help of an AI coding
# assistant (Claude, Anthropic) under the direction of the Datanauts Brasil team. It only reorganizes
# the collected data into a DuckDB database; no value is invented. Derived columns (crop-year keys,
# 0-30 cm soil averages, available water by Saxton & Rawls 2006) are documented below and in BANCO.md.
"""
Monta o banco analitico do Rotare (DuckDB) a partir dos Parquet de data/<talhao>/.

  python montar_banco.py                  # todos os talhoes de ../data -> ../data/rotare.duckdb
  python montar_banco.py --saida outro.duckdb

Camadas:
  dim_*   dimensoes (talhao, cultura, fonte)
  fato_*  dados limpos, uma linha por evento (dia, mes, camada de solo, decendio...)
  ref_*   tabelas de referencia externas (ECOCROP, calendario FAO)
  vw_*    visoes prontas para o motor e o app (safra, raio-x, solo, janelas do ZARC)

O banco e reconstruido do zero a cada execucao (idempotente): os Parquet continuam sendo a fonte.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import pyarrow as pa

from coleta_rotare import radiacao_extraterrestre_mm
from exportar_csv import achatar_calendario_fao

DATA = Path(__file__).resolve().parent.parent / "data"

# ---------------------------------------------------------------------------------------------
# Cultura: um id unico para cruzar ZARC, IBGE PAM, ECOCROP, MapBiomas e FAO.
# So nomes e familia botanica; os parametros agronomicos do catalogo (T3) sao do time.
# ---------------------------------------------------------------------------------------------
CULTURAS = [
    # id, nome_pt, nome_en, ecocrop, sidra, mapbiomas_classe, fao_calendario
    ("soja", "Soja", "Soybean", "soja", "soja", 39, "Soya"),
    ("milho", "Milho", "Maize", "milho", "milho", None, None),
    ("algodao", "Algodão", "Cotton", "algodao", "algodao_herbaceo", 62, None),
    ("sorgo", "Sorgo", "Sorghum", "sorgo", "sorgo", None, "Sorghum"),
    ("feijao", "Feijão", "Common bean", "feijao", "feijao", None, "Bean common, dry"),
    ("feijao_caupi", "Feijão-caupi", "Cowpea", "feijao_caupi", None, None, None),
    ("feijao_guandu", "Feijão-guandu", "Pigeon pea", "feijao_guandu", None, None, None),
    ("girassol", "Girassol", "Sunflower", "girassol", "girassol", None, "Sunflower"),
    ("arroz", "Arroz", "Rice", None, "arroz", 40, "Rice"),
    ("trigo", "Trigo", "Wheat", "trigo", None, None, "Wheat, bread"),
    ("amendoim", "Amendoim", "Groundnut", "amendoim", None, None, None),
    ("mamona", "Mamona", "Castor bean", None, None, None, None),
    ("gergelim", "Gergelim", "Sesame", "gergelim", None, None, None),
    ("milheto", "Milheto", "Pearl millet", "milheto", None, None, "Pearl millet"),
    ("aveia", "Aveia", "Oats", "aveia", None, None, "Oats"),
    ("braquiaria_brizantha", "Braquiária brizantha", "Palisade grass", "braquiaria_brizantha", None, None, None),
    ("braquiaria_ruziziensis", "Braquiária ruziziensis", "Ruzi grass", "braquiaria_ruziziensis", None, None, None),
    ("crotalaria_juncea", "Crotalária juncea", "Sunn hemp", "crotalaria_juncea", None, None, None),
    ("crotalaria_spectabilis", "Crotalária spectabilis", "Showy rattlebox", "crotalaria_spectabilis", None, None, None),
    ("nabo_forrageiro", "Nabo forrageiro", "Oilseed radish", "nabo_forrageiro", None, None, None),
]

# Nome da cultura no ZARC -> (cultura_id, epoca, consorcio_braquiaria, finalidade)
def zarc_cultura(nome: str) -> tuple[str | None, str | None, bool, str | None]:
    n = (nome or "").strip()
    epoca = "2a_safra" if "2ª Safra" in n else "1a_safra" if "1ª Safra" in n else None
    consorcio = "Braquiária" in n
    finalidade = "forrageiro" if "Forrageiro" in n else "granifero" if "Granífero" in n else None
    regras = [("Soja", "soja"), ("Milho", "milho"), ("Algodão", "algodao"), ("Sorgo", "sorgo"),
              ("Feijão Caupi", "feijao_caupi"), ("Feijão", "feijao"), ("Girassol", "girassol"),
              ("Arroz", "arroz"), ("Trigo", "trigo"), ("Amendoim", "amendoim"), ("Mamona", "mamona")]
    cid = next((c for prefixo, c in regras if n.startswith(prefixo)), None)
    return cid, epoca, consorcio, finalidade


# ---------------------------------------------------------------------------------------------
# Agua disponivel no solo: Saxton, K.E. & Rawls, W.J. (2006). Soil Sci. Soc. Am. J. 70:1569-1578.
# S e C em fracao (0-1), MO em % (MO = carbono organico x 1,724). Resultado em mm de agua por cm de solo.
# ---------------------------------------------------------------------------------------------
def saxton_rawls(areia_pct: float, argila_pct: float, carbono_g_kg: float) -> tuple[float, float]:
    s, c = areia_pct / 100, argila_pct / 100
    mo = min(carbono_g_kg / 10 * 1.724, 8.0)  # equacoes validas ate 8% de MO
    t1500 = -0.024 * s + 0.487 * c + 0.006 * mo + 0.005 * s * mo - 0.013 * c * mo + 0.068 * s * c + 0.031
    th1500 = t1500 + (0.14 * t1500 - 0.02)
    t33 = -0.251 * s + 0.195 * c + 0.011 * mo + 0.006 * s * mo - 0.027 * c * mo + 0.452 * s * c + 0.299
    th33 = t33 + (1.283 * t33 ** 2 - 0.374 * t33 - 0.015)
    return th33, th1500


def fontes_do_references() -> pd.DataFrame | None:
    """dim_fonte a partir do REFERENCES.md da raiz: a mesma lista que vai para a submissao."""
    arq = DATA.parent / "REFERENCES.md"
    if not arq.exists():
        return None
    grupos = {"NASA data": "nasa", "Space agency partner data": "parceiro_espacial", "Other data": "outros"}
    linhas, grupo = [], None
    for l in arq.read_text(encoding="utf-8").splitlines():
        if l.startswith("## "):
            grupo = grupos.get(l[3:].strip())
        elif grupo and l.startswith("|") and not l.startswith("| Source") and not l.startswith("| ---"):
            c = [x.strip() for x in l.strip().strip("|").split("|")]
            linhas.append({"grupo": grupo, "fonte": c[0], "url": c[1] if len(c) > 1 else None,
                           "licenca": c[2] if len(c) > 2 else None, "citacao": c[3] if len(c) > 3 else None})
    return pd.DataFrame(linhas) if linhas else None


def ler(pasta: Path, nome: str) -> pd.DataFrame | None:
    f = pasta / f"{nome}.parquet"
    return pd.read_parquet(f) if f.exists() else None


def juntar(pastas: list[Path], nome: str, prep=None) -> pd.DataFrame | None:
    partes = []
    for p in pastas:
        d = ler(p, nome)
        if d is None or d.empty:
            continue
        d = prep(d, p) if prep else d
        d.insert(0, "talhao_id", p.name)
        partes.append(d)
    return pd.concat(partes, ignore_index=True) if partes else None


def ano_safra(datas: pd.Series, mes_inicio: int = 7) -> pd.Series:
    """Ano agricola do lugar, rotulado pelo ano em que comeca. Com mes_inicio=7 (hemisferio sul),
    2023 = julho/2023 a junho/2024; com 1 (hemisferio norte), 2023 = o ano civil de 2023."""
    return (datas.dt.year - (datas.dt.month < mes_inicio).astype(int)).astype("int32")


def enso_do_talhao(oni: pd.DataFrame, mes_inicio: int) -> pd.DataFrame:
    """Fase ENSO de cada ano-safra do talhao: pico do ONI nos 6 meses centrais da safra (do 4o ao 9o mes).
    Com mes_inicio=7 sao out a mar; com 1, abr a set. Assim um El Nino que termina em fevereiro nao marca
    a safra seguinte do hemisferio norte. El Nino forte = ONI >= 1,5."""
    o = oni.copy()
    idx = o["ano"] * 12 + o["mes_central"] - 1
    linhas = []
    for a in range(int(o["ano"].min()), int(o["ano"].max()) + 1):
        ini = a * 12 + mes_inicio - 1
        v = o.loc[(idx >= ini + 3) & (idx <= ini + 8), "oni"]
        if len(v) < 6:
            continue
        mx, mn = float(v.max()), float(v.min())
        fase = ("el_nino_forte" if mx >= 1.5 else "el_nino_fraco_moderado" if mx >= 0.5
                else "la_nina" if mn <= -0.5 else "neutro")
        linhas.append({"ano_safra": a, "oni_max": mx, "oni_min": mn, "enso_safra": fase})
    return pd.DataFrame(linhas)


def profundidade_cm(txt: str) -> tuple[int, int]:
    a, b = re.findall(r"\d+", txt)[:2]
    return int(a), int(b)


def janelas_zarc(z: pd.DataFrame) -> pd.DataFrame:
    """Agrupa os decendios de cada combinacao em janelas continuas (circulares: dez -> jan)."""
    chaves = ["geocodigo", "safra", "ano_safra", "cultura_zarc", "cultura_id", "epoca", "consorcio_braquiaria",
              "ciclo", "solo", "manejo", "risco_pct"]
    linhas = []
    for k, g in z.groupby(chaves, dropna=False):
        decs = sorted(set(g["decendio"]))
        if len(decs) == 36:
            blocos = [decs]
        else:
            # comeca um bloco onde o decendio anterior (circular) nao esta no conjunto
            conj = set(decs)
            inicios = [d for d in decs if ((d - 2) % 36) + 1 not in conj]
            blocos = []
            for i in inicios:
                b, d = [], i
                while d in conj:
                    b.append(d)
                    d = d % 36 + 1
                    if d == i:
                        break
                blocos.append(b)
        for b in blocos:
            ini, fim = b[0], b[-1]
            linhas.append(dict(zip(chaves, k)) | {
                "decendio_inicio": ini, "decendio_fim": fim, "n_decendios": len(b),
                "inicio_dd_mm": f"{[1, 11, 21][(ini - 1) % 3]:02d}/{(ini - 1) // 3 + 1:02d}",
                "fim_dd_mm": f"{[10, 20, None][(fim - 1) % 3] or _ultimo_dia((fim - 1) // 3 + 1):02d}/{(fim - 1) // 3 + 1:02d}",
            })
    return pd.DataFrame(linhas)


def _ultimo_dia(mes: int) -> int:
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1]


# ---------------------------------------------------------------------------------------------
def montar(saida: Path) -> dict[str, int]:
    pastas = [p for p in sorted(DATA.iterdir()) if p.is_dir() and (p / "manifesto.json").exists()]
    if not pastas:
        raise SystemExit(f"nenhum talhao com manifesto.json em {DATA}")
    tabelas: dict[str, pd.DataFrame] = {}

    # ---- dim_talhao e meta -------------------------------------------------------------------
    talhoes, cargas, fontes = [], [], {}
    for p in pastas:
        m = json.loads((p / "manifesto.json").read_text(encoding="utf-8"))
        rel = ler(p, "relevo")
        sid = ler(p, "sidra_pam")
        z = ler(p, "zarc")
        geo = (sid["geocodigo"].iloc[0] if sid is not None and len(sid) else
               z["geocodigo"].iloc[0] if z is not None and len(z) else None)
        mun = sid["municipio"].iloc[0] if sid is not None and len(sid) else None
        pt = m["ponto"]
        talhoes.append({
            "talhao_id": p.name, "lat": pt["lat"], "lon": pt["lon"],
            "pais": pt.get("pais") or "BR", "pais_nome": pt.get("pais_nome") or "Brazil",
            "local": pt.get("local") or mun, "mes_inicio_safra": int(pt.get("mes_inicio_safra") or 7),
            "municipio": mun, "geocodigo": geo,
            "uf": z["uf"].iloc[0] if z is not None and len(z) else None,
            "altitude_m": rel["altitude_m"].iloc[0] if rel is not None else None,
            "declividade_pct": rel["declividade_pct"].iloc[0] if rel is not None else None,
            "risco_erosao_relevo": rel["risco_erosao_relevo"].iloc[0] if rel is not None else None,
            "periodo_inicio": pd.Timestamp(m["periodo"][0]), "periodo_fim": pd.Timestamp(m["periodo"][1]),
            "coletado_em": pd.Timestamp(m["gerado_em"]),
        })
        for fonte, status in m.get("resultado", {}).items():
            cargas.append({"talhao_id": p.name, "tabela": fonte, "status": status})
        for r in m.get("referencias", []):
            fontes.setdefault(r["fonte"], r)
    tabelas["dim_talhao"] = pd.DataFrame(talhoes)
    tabelas["meta_carga"] = pd.DataFrame(cargas)
    ref = fontes_do_references()
    tabelas["dim_fonte"] = ref if ref is not None else pd.DataFrame(
        [{"grupo": "manifesto", "fonte": f, "url": r.get("url"), "licenca": r.get("licenca"),
          "citacao": r.get("citacao")} for f, r in fontes.items()])

    # ---- dim_cultura -------------------------------------------------------------------------
    cult = pd.DataFrame(CULTURAS, columns=["cultura_id", "nome_pt", "nome_en", "ecocrop_nome", "sidra_produto",
                                           "mapbiomas_classe_id", "fao_calendario_nome"])
    cult["mapbiomas_classe_id"] = cult["mapbiomas_classe_id"].astype("Int64")
    eco = ler(pastas[0], "ecocrop_parametros")
    if eco is not None:
        fam = eco.set_index("cultura")
        cult["nome_cientifico"] = cult["ecocrop_nome"].map(fam["ScientificName"])
        cult["familia"] = cult["ecocrop_nome"].map(fam["FAMNAME"].str.split(":").str[-1])
    cult.loc[cult.cultura_id == "arroz", ["nome_cientifico", "familia"]] = ["Oryza sativa", "Gramineae"]
    cult.loc[cult.cultura_id == "mamona", ["nome_cientifico", "familia"]] = ["Ricinus communis", "Euphorbiaceae"]
    tabelas["dim_cultura"] = cult

    # ---- clima diario: CHIRPS + POWER (historico 1981-... + periodo da coleta) e ET0 ----------
    lat_de = {t["talhao_id"]: t["lat"] for t in talhoes}
    mes_de = {t["talhao_id"]: t["mes_inicio_safra"] for t in talhoes}

    def prep_clima(_d, p):
        chirps = ler(p, "chirps")
        power = pd.concat([x for x in (ler(p, "power_historico"), ler(p, "power")) if x is not None],
                          ignore_index=True) if (p / "power.parquet").exists() else None
        if power is not None:
            power = power.drop_duplicates("data").sort_values("data")
            # mesma conta da coleta (harmonizar): Hargreaves com Ra da FAO-56 e limiares de eventos
            ra = radiacao_extraterrestre_mm(lat_de[p.name], power["data"].dt.day_of_year.to_numpy())
            amp = (power["temp_max_c"] - power["temp_min_c"]).clip(lower=0)
            power["et0_hargreaves_mm"] = (0.0023 * (power["temp_media_c"] + 17.8) * np.sqrt(amp) * ra).round(2)
            power["geada"] = power["temp_min_c"] <= 2.0
            power["calor_extremo"] = power["temp_max_c"] >= 35.0
        if chirps is not None and power is not None:
            d = chirps.merge(power, on="data", how="outer")
        else:
            d = chirps if chirps is not None else power
        d = d.sort_values("data").reset_index(drop=True)
        d["chuva_extrema"] = d["chuva_chirps_mm"] >= 50.0 if "chuva_chirps_mm" in d else d["chuva_power_mm"] >= 50.0
        d["ano_safra"] = ano_safra(d["data"], mes_de[p.name])
        return d
    tabelas["fato_clima_diario"] = juntar(pastas, "chirps", prep_clima)

    def prep_imerg(d, p):
        d = d.rename(columns={"data": "mes", "chuva_imerg_mm": "chuva_mm"})
        d["ano_safra"] = ano_safra(d["mes"], mes_de[p.name])
        return d
    tabelas["fato_chuva_imerg_mensal"] = juntar(pastas, "imerg", prep_imerg)

    oni = ler(pastas[0], "oni")
    if oni is not None:
        tabelas["fato_enso_trimestral"] = oni
    if oni is not None:  # a fase do ENSO depende do calendario agricola de cada lugar
        tabelas["dim_enso_safra"] = pd.concat(
            [enso_do_talhao(oni, mes_de[t]).assign(talhao_id=t) for t in mes_de], ignore_index=True
        )[["talhao_id", "ano_safra", "oni_max", "oni_min", "enso_safra"]]

    # ---- solo por camada + agua disponivel ----------------------------------------------------
    def prep_solo(d, _p):
        d = d.copy()
        prof = d["profundidade"].map(profundidade_cm)
        d["topo_cm"] = prof.str[0]
        d["base_cm"] = prof.str[1]
        return d.drop(columns=["via"], errors="ignore")
    solo = juntar(pastas, "solo", prep_solo)
    tabelas["fato_solo_camada"] = solo
    if solo is not None:
        w = solo.pivot_table(index=["talhao_id", "profundidade", "topo_cm", "base_cm"], columns="propriedade",
                             values="valor").reset_index()
        cc, pmp = zip(*[saxton_rawls(r.sand, r.clay, r.soc) for r in w.itertuples()])
        w["umidade_cc_m3m3"] = np.round(cc, 3)       # capacidade de campo (-33 kPa)
        w["umidade_pmp_m3m3"] = np.round(pmp, 3)     # ponto de murcha (-1500 kPa)
        w["agua_disponivel_mm"] = np.round((w["umidade_cc_m3m3"] - w["umidade_pmp_m3m3"])
                                           * (w["base_cm"] - w["topo_cm"]) * 10, 1)
        tabelas["fato_solo_agua"] = w[["talhao_id", "profundidade", "topo_cm", "base_cm", "umidade_cc_m3m3",
                                       "umidade_pmp_m3m3", "agua_disponivel_mm"]].sort_values(["talhao_id", "topo_cm"])

    # ---- uso da terra, producao, ZARC ---------------------------------------------------------
    mb = juntar(pastas, "mapbiomas")
    if mb is not None:
        mb = mb.merge(cult[["cultura_id", "mapbiomas_classe_id"]].dropna(), left_on="classe_id",
                      right_on="mapbiomas_classe_id", how="left").drop(columns="mapbiomas_classe_id")
        tabelas["fato_uso_terra"] = mb.sort_values(["talhao_id", "ano"])

    um = juntar(pastas, "uso_terra_modis")
    if um is not None:
        tabelas["fato_uso_terra_modis"] = um.sort_values(["talhao_id", "ano"])

    sid = juntar(pastas, "sidra_pam")
    if sid is not None:
        sid = sid.merge(cult[["cultura_id", "sidra_produto"]].dropna(), left_on="produto",
                        right_on="sidra_produto", how="left").drop(columns="sidra_produto")
        tabelas["fato_producao_municipal"] = sid

    zs = [ler(p, "zarc") for p in pastas]
    zs = [z for z in zs if z is not None]
    if zs:
        z = pd.concat(zs, ignore_index=True).drop_duplicates()
        z = z.rename(columns={"cultura": "cultura_zarc"})
        info = z["cultura_zarc"].map(zarc_cultura)
        z["cultura_id"] = info.str[0]
        z["epoca"] = info.str[1]
        z["consorcio_braquiaria"] = info.str[2].astype(bool)
        z["finalidade"] = info.str[3]
        z["ano_safra"] = pd.to_numeric(z["safra"].str[:4], errors="coerce").astype("Int64")
        z["cultura_zarc"] = z["cultura_zarc"].str.strip()
        tabelas["fato_zarc_risco"] = z
        tabelas["fato_zarc_janela"] = janelas_zarc(z[z["safra"] != "sem_safra"])

    # ---- referencias ------------------------------------------------------------------------
    if eco is not None:
        manter = ["cultura", "ScientificName", "TOPMN", "TOPMX", "TMIN", "TMAX", "ROPMN", "ROPMX", "RMIN", "RMAX",
                  "PHOPMN", "PHOPMX", "PHMIN", "PHMAX", "KTMP", "GMIN", "GMAX", "LIFO", "PHOTO"]
        tabelas["ref_ecocrop"] = eco[[c for c in manter if c in eco]].rename(columns=str.lower)
    apt = juntar(pastas, "aptidao_ecocrop")
    if apt is not None:
        tabelas["fato_aptidao_ecocrop"] = apt
    pais_de = {t["talhao_id"]: t["pais"] for t in talhoes}
    cals = {}
    for pp in pastas:  # um calendario por pais (o da FAO nao cobre EUA nem India)
        cal = ler(pp, "calendario_fao")
        if cal is not None and pais_de[pp.name] not in cals:
            c = achatar_calendario_fao(cal) if "sessions" in cal else cal
            cals[pais_de[pp.name]] = c.assign(pais=pais_de[pp.name])
    if cals:
        tabelas["ref_calendario_fao"] = pd.concat(cals.values(), ignore_index=True)

    # ---- satelite (quando a fila do AppEEARS liberar) ----------------------------------------
    def prep_sat(d, p):
        d = d.copy()
        if "data" in d:
            d["ano_safra"] = ano_safra(pd.to_datetime(d["data"]), mes_de[p.name])
        return d
    for nome, alvo in [("ndvi_modis", "fato_ndvi_modis"), ("ndvi_hls", "fato_ndvi_hls"), ("smap_l4", "fato_smap")]:
        d = juntar(pastas, nome, prep_sat)
        if d is not None:
            tabelas[alvo] = d

    # ---- grava --------------------------------------------------------------------------------
    tmp = saida.with_suffix(".tmp.duckdb")
    tmp.unlink(missing_ok=True)
    con = duckdb.connect(str(tmp))
    for nome, df in tabelas.items():
        con.register("_df", pa.Table.from_pandas(df, preserve_index=False))  # Arrow: aceita o 'str' do pandas 3
        con.execute(f"CREATE TABLE {nome} AS SELECT * FROM _df")
        con.unregister("_df")
    criar_visoes(con, set(tabelas))
    comentar(con, set(tabelas))
    contagem = {n: con.execute(f"SELECT count(*) FROM {n}").fetchone()[0] for n in tabelas}
    for v in [r[0] for r in con.execute("SELECT view_name FROM duckdb_views() WHERE NOT internal").fetchall()]:
        contagem[v] = con.execute(f"SELECT count(*) FROM {v}").fetchone()[0]
    con.execute("CHECKPOINT")
    con.close()
    saida.unlink(missing_ok=True)
    tmp.rename(saida)
    return contagem


def criar_visoes(con, t: set[str]) -> None:
    if "fato_solo_camada" in t:
        # media ponderada pela espessura na camada arável (0 a 30 cm)
        con.execute("""
        CREATE VIEW vw_solo_0_30 AS
        SELECT talhao_id,
               round(sum(valor * (base_cm - topo_cm)) FILTER (WHERE propriedade = 'clay')   / 30, 1) AS argila_pct,
               round(sum(valor * (base_cm - topo_cm)) FILTER (WHERE propriedade = 'sand')   / 30, 1) AS areia_pct,
               round(sum(valor * (base_cm - topo_cm)) FILTER (WHERE propriedade = 'silt')   / 30, 1) AS silte_pct,
               round(sum(valor * (base_cm - topo_cm)) FILTER (WHERE propriedade = 'soc')    / 30, 1) AS carbono_org_g_kg,
               round(sum(valor * (base_cm - topo_cm)) FILTER (WHERE propriedade = 'phh2o')  / 30, 2) AS ph_agua,
               round(sum(valor * (base_cm - topo_cm)) FILTER (WHERE propriedade = 'cec')    / 30, 1) AS ctc_cmolc_kg,
               round(sum(valor * (base_cm - topo_cm)) FILTER (WHERE propriedade = 'nitrogen') / 30, 2) AS nitrogenio_g_kg,
               round(sum(valor * (base_cm - topo_cm)) FILTER (WHERE propriedade = 'bdod')   / 30, 2) AS densidade_kg_dm3
        FROM fato_solo_camada WHERE base_cm <= 30 GROUP BY talhao_id""")

    if "fato_clima_diario" in t:
        partes_safra = ["""
        WITH c AS (
          SELECT talhao_id, ano_safra, count(*) AS dias,
                 round(sum(chuva_chirps_mm), 1) AS chuva_chirps_mm,
                 round(sum(chuva_power_mm), 1) AS chuva_power_mm,
                 round(sum(et0_hargreaves_mm), 1) AS et0_mm,
                 count(et0_hargreaves_mm) AS dias_et0,
                 sum(CASE WHEN geada THEN 1 ELSE 0 END) AS dias_geada,
                 sum(CASE WHEN calor_extremo THEN 1 ELSE 0 END) AS dias_calor_extremo,
                 sum(CASE WHEN chuva_extrema THEN 1 ELSE 0 END) AS dias_chuva_extrema
          FROM fato_clima_diario GROUP BY ALL)"""]
        if "fato_ndvi_modis" in t:
            partes_safra.append(""",
        n AS (SELECT talhao_id, ano_safra, round(max(ndvi), 3) AS ndvi_max, round(min(ndvi), 3) AS ndvi_min,
                     count(ndvi) AS obs_ndvi FROM fato_ndvi_modis GROUP BY ALL)""")
        if "fato_smap" in t:
            partes_safra.append(""",
        m AS (SELECT talhao_id, ano_safra, round(avg(sm_raiz), 3) AS umidade_raiz_media, round(min(sm_raiz), 3) AS umidade_raiz_min
              FROM fato_smap GROUP BY ALL)""")
        imerg = "fato_chuva_imerg_mensal" in t
        if imerg:
            partes_safra.append(""",
        i AS (SELECT talhao_id, ano_safra, round(sum(chuva_mm), 1) AS chuva_imerg_mm, count(*) AS meses_imerg
              FROM fato_chuva_imerg_mensal GROUP BY ALL)""")
        con.execute("CREATE VIEW vw_safra AS " + "".join(partes_safra) + f"""
        SELECT c.talhao_id, c.ano_safra, c.dias, (c.dias >= 365) AS safra_completa,
               c.chuva_chirps_mm, {"i.chuva_imerg_mm, i.meses_imerg," if imerg else ""} c.chuva_power_mm,
               CASE WHEN c.dias_et0 >= 365 THEN c.et0_mm END AS et0_mm,
               CASE WHEN c.dias_et0 >= 365 THEN round(c.et0_mm - c.chuva_chirps_mm, 1) END AS deficit_chirps_mm,
               {"CASE WHEN c.dias_et0 >= 365 AND i.meses_imerg = 12 THEN round(c.et0_mm - i.chuva_imerg_mm, 1) END AS deficit_imerg_mm," if imerg else ""}
               c.dias_geada, c.dias_calor_extremo, c.dias_chuva_extrema,
               e.oni_max, e.oni_min, e.enso_safra
               {", n.ndvi_max, n.ndvi_min, n.obs_ndvi" if "fato_ndvi_modis" in t else ""}
               {", m.umidade_raiz_media, m.umidade_raiz_min" if "fato_smap" in t else ""}
               {", um.classe AS uso_terra_modis" if "fato_uso_terra_modis" in t else ""}
               {", u.classe AS mapbiomas_ano_colheita, u.cultura_id AS cultura_mapbiomas" if "fato_uso_terra" in t else ""}
               {", ps.rendimento_sc_ha AS soja_municipio_sc_ha, pm.rendimento_sc_ha AS milho_municipio_sc_ha" if "fato_producao_municipal" in t else ""}
        FROM c
        {"LEFT JOIN i USING (talhao_id, ano_safra)" if imerg else ""}
        {"LEFT JOIN n USING (talhao_id, ano_safra)" if "fato_ndvi_modis" in t else ""}
        {"LEFT JOIN m USING (talhao_id, ano_safra)" if "fato_smap" in t else ""}
        {"LEFT JOIN fato_uso_terra_modis um ON um.talhao_id = c.talhao_id AND um.ano = c.ano_safra" if "fato_uso_terra_modis" in t else ""}
        {"LEFT JOIN dim_enso_safra e USING (talhao_id, ano_safra)" if "dim_enso_safra" in t else "LEFT JOIN (SELECT NULL::VARCHAR talhao_id, NULL::INT ano_safra, NULL::DOUBLE oni_max, NULL::DOUBLE oni_min, NULL::VARCHAR enso_safra) e USING (talhao_id, ano_safra)"}
        {"LEFT JOIN fato_uso_terra u ON u.talhao_id = c.talhao_id AND u.ano = c.ano_safra + 1" if "fato_uso_terra" in t else ""}
        {"LEFT JOIN fato_producao_municipal ps ON ps.talhao_id = c.talhao_id AND ps.ano_safra = c.ano_safra AND ps.cultura_id = 'soja' LEFT JOIN fato_producao_municipal pm ON pm.talhao_id = c.talhao_id AND pm.ano_safra = c.ano_safra AND pm.cultura_id = 'milho'" if "fato_producao_municipal" in t else ""}
        ORDER BY c.talhao_id, c.ano_safra""")

        con.execute(f"""
        CREATE VIEW vw_raio_x AS
        SELECT t.*,
               (SELECT round(avg(chuva_chirps_mm)) FROM vw_safra s WHERE s.talhao_id = t.talhao_id AND s.safra_completa) AS chuva_media_anual_chirps_mm,
               (SELECT round(avg(et0_mm)) FROM vw_safra s WHERE s.talhao_id = t.talhao_id AND s.et0_mm IS NOT NULL) AS et0_media_anual_mm,
               (SELECT min(ano_safra) FROM vw_safra s WHERE s.talhao_id = t.talhao_id AND s.safra_completa) AS chuva_desde
               {", so.* EXCLUDE (talhao_id)" if "fato_solo_camada" in t else ""}
               {", (SELECT sum(agua_disponivel_mm) FROM fato_solo_agua a WHERE a.talhao_id = t.talhao_id AND a.base_cm <= 60) AS agua_disponivel_0_60_mm" if "fato_solo_agua" in t else ""}
               {", (SELECT sum(agua_disponivel_mm) FROM fato_solo_agua a WHERE a.talhao_id = t.talhao_id) AS agua_disponivel_0_100_mm" if "fato_solo_agua" in t else ""}
               {", (SELECT classe FROM fato_uso_terra_modis u WHERE u.talhao_id = t.talhao_id AND classe IS NOT NULL ORDER BY ano DESC LIMIT 1) AS uso_terra_modis_recente" if "fato_uso_terra_modis" in t else ""}
               {", (SELECT count(*) FILTER (WHERE classe_id IN (12, 14)) FROM fato_uso_terra_modis u WHERE u.talhao_id = t.talhao_id) AS anos_lavoura_modis" if "fato_uso_terra_modis" in t else ""}
               {", (SELECT classe FROM fato_uso_terra u WHERE u.talhao_id = t.talhao_id ORDER BY ano DESC LIMIT 1) AS uso_terra_mapbiomas_recente" if "fato_uso_terra" in t else ""}
        FROM dim_talhao t
        {"LEFT JOIN vw_solo_0_30 so USING (talhao_id)" if "fato_solo_camada" in t else ""}""")

    if "fato_zarc_janela" in t:
        # janela mais recente publicada para cada cultura/epoca/ciclo/solo, so sequeiro
        con.execute("""
        CREATE VIEW vw_zarc_janela_atual AS
        SELECT j.* FROM fato_zarc_janela j
        WHERE j.cultura_id IS NOT NULL AND coalesce(j.manejo, 'Sequeiro') = 'Sequeiro'
          AND j.ano_safra = (SELECT max(ano_safra) FROM fato_zarc_janela k
                             WHERE k.cultura_zarc = j.cultura_zarc AND k.geocodigo = j.geocodigo)
        ORDER BY cultura_id, epoca, ciclo, solo, risco_pct, decendio_inicio""")


COMENTARIOS = {
    "dim_talhao": ("Um talhao por ponto coletado (lat/lon) em qualquer pais, com local, mes de inicio do ano-safra, relevo SRTM e periodo da coleta", {
        "mes_inicio_safra": "Mes em que comeca o ano agricola do lugar (7 no hemisferio sul, 1 no norte, 5 no Punjab)",
        "municipio": "Municipio IBGE (so no Brasil)"}),
    "fato_uso_terra_modis": ("NASA MODIS MCD12Q1: classe IGBP de uso da terra no ponto, por ano, desde 2001 (12 = lavoura)", {}),
    "dim_cultura": ("Id unico de cultura para cruzar ZARC, IBGE PAM, ECOCROP, MapBiomas e calendario FAO. Sem parametros agronomicos (catalogo T3 e do time)", {}),
    "dim_fonte": ("Fontes de dados com URL, licenca e citacao (do manifesto.json)", {}),
    "dim_enso_safra": ("Fase ENSO de cada ano-safra de cada talhao pelo ONI da NOAA (6 meses centrais da safra); el_nino_forte = ONI >= 1,5", {}),
    "meta_carga": ("Status de cada fonte na ultima coleta de cada talhao", {}),
    "fato_clima_diario": ("Clima diario do talhao desde 1981: chuva CHIRPS, clima NASA POWER e ET0 Hargreaves (radiacao POWER so desde 1984)", {
        "chuva_extrema": "Chuva CHIRPS >= 50 mm no dia",
        "chuva_chirps_mm": "Chuva diaria CHIRPS v2.0 (mm). Use esta para o balanco hidrico diario",
        "chuva_power_mm": "Chuva do modelo NASA POWER (mm). Subestima nesta regiao",
        "et0_hargreaves_mm": "Evapotranspiracao de referencia, Hargreaves com Ra da FAO-56 (mm/dia)",
        "vento_2m_ms": "Vento POWER a 2 m. Valor nao confiavel na origem; nao usar",
        "ano_safra": "Ano agricola do talhao (ver dim_talhao.mes_inicio_safra). Sul: 2023 = jul/2023 a jun/2024"}),
    "fato_chuva_imerg_mensal": ("Chuva mensal NASA GPM IMERG Final V07 (mm/mes)", {}),
    "fato_enso_trimestral": ("Indice ONI trimestral da NOAA desde 1950", {}),
    "fato_solo_camada": ("SoilGrids 2.0 em formato longo: propriedade x camada (0 a 100 cm)", {}),
    "fato_solo_agua": ("Agua disponivel por camada estimada por Saxton & Rawls (2006) a partir de areia, argila e carbono do SoilGrids", {
        "agua_disponivel_mm": "Agua entre capacidade de campo e ponto de murcha na camada (mm)"}),
    "fato_uso_terra": ("MapBiomas Colecao 9: classe de uso da terra no ponto, por ano", {}),
    "fato_producao_municipal": ("IBGE PAM tabela 1612: area, producao e rendimento do municipio (nao do talhao)", {
        "ano_safra": "ano_colheita - 1", "rendimento_sc_ha": "Rendimento em sacas de 60 kg por hectare"}),
    "fato_zarc_risco": ("ZARC do MAPA: risco de plantio por decendio (20, 30 ou 40%). Decendio ausente = plantio nao indicado", {
        "decendio": "1 = 1 a 10/jan ... 36 = 21 a 31/dez", "epoca": "1a_safra, 2a_safra ou nulo (safra unica)"}),
    "fato_zarc_janela": ("Janelas continuas de plantio do ZARC (decendios agrupados, com virada de ano)", {}),
    "fato_aptidao_ecocrop": ("Aptidao climatica indicativa ECOCROP por cultura e mes de plantio (0 a 1)", {}),
    "ref_ecocrop": ("Parametros da FAO ECOCROP: temperatura, chuva, pH e ciclo por cultura", {}),
    "ref_calendario_fao": ("Calendario de plantio e colheita da FAO para o Brasil, uma linha por sessao", {}),
    "fato_ndvi_modis": ("NDVI/EVI NASA MODIS MOD13Q1 (16 dias, 250 m) desde 2000, via Earth Engine; nuvem e neve descartadas", {}),
    "fato_ndvi_hls": ("NDVI HLS (30 m) via AppEEARS", {}),
    "fato_smap": ("Umidade do solo NASA SMAP L4 v008 (media diaria, m3/m3) desde abr/2015, via Earth Engine", {}),
}
COMENTARIOS_VISOES = {
    "vw_safra": "Uma linha por talhao e ano-safra: chuva (CHIRPS, IMERG, POWER), ET0, deficit, eventos extremos, ENSO, MapBiomas e rendimento do municipio. Base do backtest",
    "vw_raio_x": "Uma linha por talhao: tudo o que a tela Raio-X mostra (clima medio, solo 0-30 cm, agua disponivel, relevo, uso recente)",
    "vw_solo_0_30": "Solo da camada aravel (0 a 30 cm), media ponderada pela espessura",
    "vw_zarc_janela_atual": "Janelas de plantio de sequeiro da safra ZARC mais recente de cada cultura",
}


def comentar(con, t: set[str]) -> None:
    q = lambda s: s.replace("'", "''")  # noqa: E731
    for tab, (desc, cols) in COMENTARIOS.items():
        if tab in t:
            con.execute(f"COMMENT ON TABLE {tab} IS '{q(desc)}'")
            existentes = {r[0] for r in con.execute(f"DESCRIBE {tab}").fetchall()}
            for c, d in cols.items():
                if c in existentes:
                    con.execute(f"COMMENT ON COLUMN {tab}.{c} IS '{q(d)}'")
    visoes = {r[0] for r in con.execute("SELECT view_name FROM duckdb_views() WHERE NOT internal").fetchall()}
    for v, d in COMENTARIOS_VISOES.items():
        if v in visoes:
            con.execute(f"COMMENT ON VIEW {v} IS '{q(d)}'")


def main():
    ap = argparse.ArgumentParser(description="Monta o banco DuckDB do Rotare a partir dos Parquet")
    ap.add_argument("--saida", default=str(DATA / "rotare.duckdb"))
    a = ap.parse_args()
    saida = Path(a.saida)
    contagem = montar(saida)
    print(f"Banco: {saida}  ({saida.stat().st_size / 1e6:.1f} MB)")
    for n, c in sorted(contagem.items()):
        print(f"  {n:28s} {c:>8} linhas")


if __name__ == "__main__":
    main()
