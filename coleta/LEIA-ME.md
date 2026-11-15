# Rotare | coleta de dados

Script que baixa, para um talhão, todos os dados do projeto e salva em Parquet.

## 0. Jeito rápido (Windows): um comando só

1. Copie `.env.exemplo` para `.env` e preencha usuário, senha e token do Earthdata (e `EE_PROJECT` para o MapBiomas).
2. Rode `.\coletar.ps1` (outro ponto: `.\coletar.ps1 -Lat -12.60 -Lon -55.95 -Nome sorriso`).

O script cria a `.venv` se faltar, roda as 11 fontes e **pula o que já foi baixado** para o mesmo ponto e período
(`cache.json`). Para forçar tudo de novo: `.\coletar.ps1 -Refazer`. Rodar de novo também retoma as tarefas do AppEEARS.

| Fonte | Login | Observação |
| --- | --- | --- |
| power, oni, solo, relevo, ecocrop, calendario_fao, zarc | nenhum | instantâneas (ZARC leva ~1 min: filtra ~2 GB em streaming) |
| imerg | token **ou** usuário/senha Earthdata | ~7 min (141 arquivos mensais) |
| appeears (NDVI MODIS + SMAP), hls | **usuário e senha** Earthdata (o token não serve) | fila da NASA: 10 a 60 min |
| mapbiomas | Google Earth Engine (`EE_PROJECT` + `earthengine authenticate` uma vez) | segundos |

**ZARC (MAPA)**: o município é descoberto pelo lat/lon (OpenStreetMap + IBGE); para forçar, use `--geocodigo 5107925`.
Sai `zarc.parquet` em formato longo: safra, cultura, ciclo (grupo I a VI), solo (arenoso/médio/argiloso ou AD1 a AD6),
manejo, decêndio (1 = 1 a 10/jan ... 36 = 21 a 31/dez), `mes`, `dia_inicio` e `risco_pct` (20, 30 ou 40).
Decêndios fora da janela indicada não aparecem. A chuva do `resumo_safras` também traz `chuva_imerg_mm` e
`deficit_hidrico_imerg_mm` (satélite), mais fiéis que o POWER no Cerrado.

## 1. Preparar (uma vez, uns 10 min)

1. Criar conta grátis no Earthdata: https://urs.earthdata.nasa.gov
2. Ainda no Earthdata, em *Applications > Authorized Apps*, autorizar
   **NASA GESDISC DATA ARCHIVE** (para o IMERG). O AppEEARS funciona só com o login.
3. Instalar:

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

4. Definir as credenciais (nunca no código nem no GitHub):

```bash
export EARTHDATA_USERNAME="seu_usuario"
export EARTHDATA_PASSWORD="sua_senha"
# Windows PowerShell:  $env:EARTHDATA_USERNAME="..."; $env:EARTHDATA_PASSWORD="..."
```

## 2. Escolher o ponto

Abram o Google Maps no modo satélite, cliquem **no meio de uma lavoura** e copiem lat/lon.
As coordenadas do exemplo abaixo são só um palpite na região de Sorriso (MT): confiram no mapa.
Se o ponto cair em mata, cidade ou água, o script avisa que o NDVI quase não varia.

## 3. Rodar

```bash
# tudo, menos MapBiomas (10 a 30 min, por causa do AppEEARS e do IMERG)
python coleta_rotare.py --lat -12.60 --lon -55.95 --nome sorriso --inicio 2014-01-01 --fim 2025-12-31

# só o que é instantâneo, para começar a desenvolver já
python coleta_rotare.py --lat -12.60 --lon -55.95 --nome sorriso --fontes power,oni,solo,relevo
```

Se o AppEEARS demorar, rode de novo depois: a tarefa é retomada, não reenviada.
Se uma fonte falhar, as outras continuam; o resumo final mostra o que faltou.

Opções úteis:

| Opção | O que faz |
| --- | --- |
| `--fontes power,oni,solo,relevo,ecocrop,calendario_fao,appeears,hls,imerg,mapbiomas` | escolhe as fontes (padrão: todas menos mapbiomas) |
| `--ciclo-dias 120` | ciclo de referência para a aptidão ECOCROP (limitado à faixa de cada cultura) |
| `--imerg diario` | IMERG diário (pesado: use um período curto, ex. as safras de El Niño) |
| `--sem-smap` | pula a umidade do solo SMAP |
| `--mapbiomas-asset ...` | troca a coleção do MapBiomas (precisa de `pip install earthengine-api`, `earthengine authenticate` e `EE_PROJECT`) |

## 4. O que sai em `dados/<nome>/`

| Arquivo | Conteúdo |
| --- | --- |
| `base_diaria.parquet` | **tabela principal do app**: clima diário + ET0 (Hargreaves) + geada (Tmin ≤ 2 °C), calor (Tmax ≥ 35 °C), chuva extrema (≥ 50 mm) + NDVI + SMAP + ano-safra + fase do ENSO |
| `resumo_safras.parquet` | uma linha por ano-safra (jul a jun): chuva, ET0, déficit hídrico, dias de geada e calor, % de solo descoberto, El Niño ou não |
| `power`, `oni`, `ndvi_modis`, `smap_l4`, `imerg`, `solo`, `relevo`, `mapbiomas` | dados brutos já limpos, um arquivo por fonte |
| `ndvi_hls.parquet` | NDVI de 30 m (Landsat + Sentinel-2), com nuvem, sombra e água já mascaradas pelo Fmask |
| `ecocrop_parametros.parquet` | exigências de 18 culturas pela FAO: temperatura, chuva, pH, geada letal, ciclo, textura |
| `aptidao_ecocrop.parquet` | **nota de 0 a 1 de cada cultura em cada mês de plantio** no talhão (temperatura, chuva do ciclo e pH; a nota final é a menor das três) |
| `calendario_fao.parquet` | calendário de plantio e colheita da FAO (ver seção 7) |
| `manifesto.json` | o que deu certo e **a lista de referências** (fonte, link, licença, citação) para o campo References |

## 5. Regras do app

- O app lê **só os arquivos Parquet**. Nada de chamar API na demo ao vivo.
- Ano-safra 2023 = julho/2023 a junho/2024. A classificação do ENSO usa o pico do ONI
  entre ago e mar: **El Niño forte** quando ONI ≥ 1,5.
- Safras com `safra_completa = False` (pontas do período) não entram em comparação.
- Chuva: o POWER traz chuva diária pronta. O IMERG mensal serve para validar e
  para a comparação entre anos de El Niño.

## 6. Notas sobre as fontes novas

- **HLS**: roda numa tarefa separada do AppEEARS (pode levar mais que o MODIS). Tem menos anos
  e mais falhas por nuvem que o MODIS; use o MODIS para o histórico de 10 anos e o HLS para
  mostrar o talhão com detalhe de 30 m.
- **ECOCROP**: a base vem do repositório aberto `openclim/ecocrop` (cópia da base da FAO). Se o
  download falhar, o script usa `ecocrop_culturas.csv`, que já vem no pacote. A aptidão segue o
  modelo ECOCROP (Hijmans et al., 2001) com o clima do NASA POWER e o pH do SoilGrids. É uma nota
  **indicativa** de clima, não de produtividade.
- Culturas incluídas: soja, milho, sorgo, algodão, milheto, crotalária juncea e spectabilis,
  braquiária ruziziensis e brizantha, feijão, caupi, guandu, trigo, aveia, girassol, amendoim,
  nabo forrageiro e gergelim. Para mudar, edite `ECOCROP_NOMES` no script.

## 7. FAO Crop Calendar

A FAO não publica API documentada para o calendário. O script tenta o serviço que o site usa;
se não responder, lê `calendario_fao_manual.csv`. Para preencher: abram
https://cropcalendar.apps.fao.org/, escolham Brasil e copiem as culturas do projeto (uma linha por
cultura e região). Se o Brasil não tiver dados lá, usem o **ZARC** (tábua de risco aberta do
MAPA), que é mais detalhado para o país.

## 8. Referências obrigatórias

O `manifesto.json` já lista cada fonte usada com link e licença. Atenção a duas:
- **NASA POWER** pede a frase de agradecimento que está no manifesto.
- **SoilGrids** e **MapBiomas** são CC BY 4.0: citar na página do projeto.
