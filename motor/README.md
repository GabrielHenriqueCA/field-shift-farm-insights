# Decision engine (in progress)

Planned steps, all deterministic (no AI generates numbers):

1. **Crop history**: smooth the NDVI series (Savitzky-Golay), detect peaks (`scipy.signal.find_peaks`),
   label each crop year as single crop or soybean + second crop; low NDVI days count as bare soil.
   Validated against MapBiomas.
2. **Water risk per planting date**: daily bucket water balance (Hargreaves ET0 x FAO-56 Kc), rainfall
   bias-corrected with IMERG, bucket size from SoilGrids texture. Risk = share of years with a critical
   deficit. Compared with the official ZARC windows.
3. **Soil index**: relative index with the structure of the USDA-NRCS Soil Conditioning Index.
4. **Ranking**: enumerate valid three-year sequences, keep the Pareto front, rank by the farmer's weights.

Input: Parquet files in `../data/<field>/`.

<!-- SI disclosure: AI-assisted files in this folder carry a disclosure comment at the top. -->
