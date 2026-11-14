# Dados do talhão de demo: Sorriso (MT)

Ponto: lat -12.60, lon -55.95 (lavoura de soja segundo o MapBiomas, 2012 a 2023). Período: 2014 a 2025.
Gerado por `coleta/coleta_rotare.py` e exportado por `coleta/exportar_csv.py`. Para atualizar:
`python coleta/exportar_csv.py`.

CSV com separador **vírgula**, decimal **ponto**, UTF-8. No Excel em português: *Dados > De Texto/CSV >
Delimitador: Vírgula*. No pandas: `pd.read_csv("arquivo.csv")`.

**Ainda faltam** (fila do AppEEARS): `ndvi_modis`, `smap_l4` e `ndvi_hls`. Quando chegarem, rode o exportador
de novo e as colunas `ndvi` e `solo_descoberto` aparecem na `base_diaria`.

## Tabelas principais (comecem por aqui)

### `base_diaria.csv`: uma linha por dia (4.383 dias)
| Coluna | O que é | Unidade / fonte |
| --- | --- | --- |
| data | dia | |
| temp_media_c, temp_max_c, temp_min_c | temperatura do ar a 2 m | °C, NASA POWER |
| chuva_power_mm | chuva diária do modelo | mm, NASA POWER. **Subestima** nesta região: para totais use o IMERG |
| umidade_rel_pct | umidade relativa | %, POWER |
| vento_2m_ms | vento a 2 m | m/s, POWER. **Valor quebrado na origem, não usar** |
| radiacao_mj_m2 | radiação solar | MJ/m²/dia, POWER |
| et0_hargreaves_mm | evapotranspiração de referência | mm/dia, Hargreaves (FAO-56) |
| geada / calor_extremo / chuva_extrema | Tmin ≤ 2 °C / Tmax ≥ 35 °C / chuva ≥ 50 mm | True/False |
| ano_safra | 2023 = julho/2023 a junho/2024 | |
| oni_max, oni_min | pico e vale do ONI entre ago e mar daquela safra | °C de anomalia, NOAA |
| enso_safra | el_nino_forte (ONI ≥ 1,5), el_nino_fraco_moderado, la_nina, neutro | |

### `resumo_safras.csv`: uma linha por ano-safra
| Coluna | O que é |
| --- | --- |
| chuva_power_mm, chuva_imerg_mm | chuva total da safra: modelo POWER e satélite IMERG (**use o IMERG**) |
| et0_hargreaves_mm | demanda de água da atmosfera na safra |
| deficit_hidrico_mm, deficit_hidrico_imerg_mm | ET0 menos chuva (positivo = faltou água). A versão IMERG fica vazia quando faltam meses |
| geada, calor_extremo, chuva_extrema | número de dias na safra |
| dias, safra_completa | **só compare safras com safra_completa = True** |
| meses_imerg | meses com IMERG (12 = completa) |

### `zarc.csv`: risco oficial de plantio do MAPA, por decêndio (19.767 linhas)
| Coluna | O que é |
| --- | --- |
| safra | 2016/2017 a 2026/2027; `sem_safra` = culturas perenes e olerícolas |
| cultura | Soja, Milho 2ª Safra, Algodão Herbáceo, Sorgo, Milho consorciado com Braquiária... |
| ciclo | grupo_I a grupo_VI (precoce a tardio), perene, semiperene |
| solo | arenoso / textura_media / argiloso (tabelas antigas) ou AD1 a AD6 (água disponível, 1 = menor) |
| manejo | Sequeiro, Irrigado... |
| decendio, mes, dia_inicio | decêndio 1 = 1 a 10/jan ... 36 = 21 a 31/dez |
| risco_pct | 20, 30 ou 40 (% de risco). Decêndio que não aparece = plantio não indicado |

### `chirps_safras.csv`: chuva por ano-safra desde 1981 (46 safras), com a fase do El Niño
| Coluna | O que é |
| --- | --- |
| chuva_chirps_mm | chuva total da safra (jul a jun), CHIRPS |
| dias, safra_completa | só compare safras completas |
| oni_max, oni_min, enso_safra | mesma classificação da base diária. **Inclui 1997/98**, o El Niño forte que o IMERG não cobre |

### `sidra_pam.csv`: produção oficial do município (IBGE PAM), 1987 a 2025
| Coluna | O que é |
| --- | --- |
| produto | soja, milho, algodao_herbaceo, sorgo, feijao, girassol, arroz |
| ano_colheita, ano_safra | colheita em 2016 = ano_safra 2015 (jul/2015 a jun/2016) |
| area_plantada_ha, area_colhida_ha, producao_t | do município inteiro |
| rendimento_kg_ha, rendimento_sc_ha | produtividade média (saca de 60 kg) |

Uso principal: **backtest**. Exemplo: a soja de Sorriso teve o pior rendimento de 2010 a 2024 na safra 2015
(El Niño forte, 48 sc/ha). O milho da PAM soma 1ª e 2ª safra. É dado do **município**, não do talhão.

## Tabelas por fonte

| Arquivo | Conteúdo |
| --- | --- |
| `power.csv` | clima diário bruto do NASA POWER |
| `imerg.csv` | chuva mensal do satélite GPM IMERG Final V07 (mm/mês), jan/2014 a set/2025 |
| `chirps.csv` | chuva **diária** CHIRPS (satélite + estações, ~5 km), 1981 a 2025. Melhor opção de chuva diária para o balanço hídrico |
| `oni.csv` | índice ONI trimestral desde 1950, com a fase (el_nino, la_nina, neutro) |
| `solo.csv` | SoilGrids: argila, areia, silte (%), carbono orgânico (g/kg), pH, densidade (kg/dm³), CTC, nitrogênio, em 5 profundidades até 1 m |
| `relevo.csv` | altitude (390 m), declividade (1,86 %) e risco de erosão pelo relevo (baixo) |
| `mapbiomas.csv` | uso da terra no ponto, por ano, de 1985 a 2023 (classe 39 = soja) |
| `ecocrop_parametros.csv` | exigências da FAO para 18 culturas: temperatura ótima e limite (TOPMN, TOPMX, TMIN, TMAX), chuva (ROPMN, ROPMX, RMIN, RMAX), pH, ciclo em dias (GMIN, GMAX), geada letal (KTMP) |
| `aptidao_ecocrop.csv` | nota de 0 a 1 por cultura e mês de plantio (temperatura, chuva, pH; a final é a menor). **Indicativa**: usa a chuva do POWER (baixa) e o pH natural do solo (sem calcário) |
| `calendario_fao.csv` | calendário de plantio e colheita da FAO para o Brasil, por região. **Não tem milho nem algodão**: para isso use o ZARC |

## Cuidados

- **El Niño forte:** com IMERG, só as safras 2015 e 2023; com CHIRPS, também 1997/98.
- **Os satélites discordam:** em 2023 o IMERG deu 1.336 mm e o CHIRPS 2.003 mm. Mostrem as duas como faixa
  de incerteza; não escolham uma sem avisar. As colunas de chuva e déficit existem em versão POWER, IMERG e
  CHIRPS no `resumo_safras.csv`.
- **SoilGrids e pH:** são estimativas do solo natural. Lavoura no Cerrado recebe calcário.
- **Fontes e licenças:** em `../manifesto.json` e no `REFERENCES.md` da raiz do repositório.
