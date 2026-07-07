# Backtest Accuracy Report — Smooth Full
**Forecast date:** 2026-03-30 (pipeline run on data capped 13 weeks before 2026-06-30)  
**Evaluation window:** 2026-04-06 → 2026-06-29 (13 weeks)  
**SKUs:** 55 (≥ 52 weeks of history at forecast time)  
**Baseline:** V1 (lag-based rolling average)

---

## Metric Definitions

| Metric | Formula |
|---|---|
| **WAPE** | Σ\|forecast − actual\| / Σ actual — demand-weighted; high-volume SKUs dominate |
| **Bias** | (Σ forecast − Σ actual) / Σ actual — positive = over-forecast |
| **MASE vs V1** | Σ\|model error\| / Σ\|V1 error\| — < 1.0 = model beats V1, > 1.0 = V1 wins |
| **Per-SKU win** | model wins if its individual WAPE < V1's WAPE for that SKU |

---

## Overall Result

| Metric | Model | V1 |
|---|---|---|
| **WAPE** | 14.4% | 11.3% |
| **Bias** | +10.5% | — |
| **MASE vs V1** | **1.279** | — |
| **Per-SKU wins** | 24 / 55 (44%) | 29 / 55 (53%) |
| **Ties** | 2 | — |

**V1 wins this backtest.** The models over-forecast by 10.5% on aggregate and generate 28% more absolute error than V1 on the same SKUs.

---

## Per-Model Breakdown

Sorted by MASE (best first). Models with MASE < 1.0 beat V1 on aggregate.

| Model | n | Model WAPE | V1 WAPE | MASE | Bias | Per-SKU wins |
|---|---|---|---|---|---|---|
| Ensemble: HistoricAverage + Naive | 1 | 8.1% | 22.8% | **0.353** | −8.1% | 1/1 |
| Ensemble: AutoARIMA + WindowAverage | 1 | 7.0% | 13.9% | **0.500** | −7.0% | 1/1 |
| Ensemble: AutoTheta + WindowAverage | 2 | 9.5% | 14.5% | **0.654** | +9.5% | 1/2 |
| Ensemble: AutoETS + HistoricAverage | 2 | 15.7% | 22.6% | **0.695** | +15.7% | 2/2 |
| HistoricAverage | 3 | 17.6% | 19.8% | **0.887** | +6.7% | 1/3 |
| Ensemble: Naive + SeasonalNaive | 1 | 22.2% | 23.8% | **0.933** | +22.2% | 1/1 |
| Ensemble: HistoricAverage + WindowAverage | 5 | 10.9% | 11.2% | 0.969 | +10.2% | 3/5 |
| Ensemble: AutoTheta + Naive | 2 | 21.9% | 21.5% | 1.019 | −0.5% | 1/2 |
| Ensemble: AutoETS + WindowAverage | 5 | 15.9% | 11.4% | 1.397 | +11.2% | 2/5 |
| AutoETS | 8 | 13.7% | 9.5% | 1.436 | +13.4% | 4/8 |
| WindowAverage | 18 | 12.0% | 8.8% | 1.367 | +8.8% | 7/18 |
| AutoTheta | 3 | 31.8% | 20.8% | 1.532 | +31.8% | 0/3 |
| Naive | 2 | 39.6% | 10.4% | 3.810 | +33.7% | 0/2 |
| SeasonalNaive | 1 | 42.9% | 8.2% | 5.250 | −42.9% | 0/1 |
| Ensemble: AutoARIMA + AutoTheta | 1 | 34.3% | 3.8% | 9.000 | +34.3% | 0/1 |

### What this shows

**Models that beat V1 (MASE < 1.0) — 7 SKUs total:**
Ensembles that include HistoricAverage consistently outperform V1. HistoricAverage acts as a damping component that prevents the model from chasing trend signals that don't hold over 13 weeks. The two best individual selections (HistoricAverage+Naive and AutoARIMA+WindowAverage) are single-SKU samples so read them with caution, but the pattern is consistent.

**Models that lose badly to V1:**
- **Naive** (MASE 3.81) and **SeasonalNaive** (MASE 5.25) — extrapolate the most recent level or season blindly. Over a 13-week window with demand that softened after the cutoff, they over-shoot massively.
- **Ensemble: AutoARIMA + AutoTheta** (MASE 9.0) — one SKU, catastrophic. Both components are trend-following and compounded each other's error.
- **AutoTheta** (MASE 1.53, 0/3 wins) — systematically over-forecasts across all three SKUs it was selected for.

**WindowAverage (18 SKUs, MASE 1.367):**
The most-selected model. Its aggregate WAPE (12.0%) is actually close to V1's (8.8%) but it still loses. The key issue: WindowAverage is also essentially a rolling average but uses a fixed window tuned on training data, while V1 uses a lag-aligned window that implicitly accounts for where in the seasonal cycle the cutoff lands. On this particular window, V1's lag anchoring was better calibrated.

**AutoETS (8 SKUs, MASE 1.436):**
Loses on aggregate but wins per-SKU 4/8 — it's splitting the field. The issue is the 4 SKUs where it loses are high-volume, so they dominate the demand-weighted WAPE. The 4 it wins tend to be lower-volume.

---

## Root Cause Analysis: Why V1 Outperforms

### 1. V1 is heavily recency-weighted; the statistical models are not

V1's rate estimate is a weighted blend across six look-back windows:

| Window | Weight | What it sees |
|---|---|---|
| 7 days | 0.15 | Last week only |
| 15 days | 0.20 | Last two weeks |
| **30 days (sales)** | **0.30** | **Last month ← dominant** |
| 60 days | 0.15 | Last two months |
| 90 days | 0.10 | Last quarter |
| **30 days (preorder)** | **0.10** | **Pre-orders, same window** |

The 30-day window (sales + preorder combined) carries **40% of V1's total weight** — by far the single largest contribution. The effective weighted look-back across all windows is ≈ 34 calendar days. At cutoff 2026-03-30, V1 is anchored primarily to March velocity.

The statistical models (AutoETS, AutoARIMA, WindowAverage) minimize historical loss across the full training window. Even after the final refit at 2026-03-30, an AutoETS state-space model carries inertia from Q4 2025 levels. WindowAverage(8) does average the last 8 weeks but weights them equally, so older weeks (Feb) carry the same weight as March.

V1's heavy 30-day bias is exactly what worked for an Apr–Jun 2026 evaluation: it reflects March demand, which was a much better predictor of April demand than the Q4 peak was.

### 2. CV windows are 3–6 months before the actual forecast period

StatsForecast cross-validation ran `n_windows=3` inside the training period. With `step_size=13` weeks (the forecast horizon):

| CV Window | Trained on | Evaluated on |
|---|---|---|
| 1 | data up to 2025-04-21 | 2025-04-21 → 2025-07-21 |
| 2 | data up to 2025-07-21 | 2025-07-21 → 2025-10-20 |
| 3 | data up to 2025-10-20 | 2025-10-20 → 2026-01-19 |

**Actual forward evaluation period: 2026-04-06 → 2026-06-29**

Window 3 (the most recent) covers Nov 2025 – Jan 2026. The actual test period starts Apr 2026. That is a 3-month gap, during which:
- Q4 2025 holiday surge occurred and unwound
- Demand likely normalized to lower post-peak levels
- SKU-level trends may have changed direction

Models selected by CV for their performance in mid-2025 are not necessarily the best models for mid-2026. V1 bypasses CV entirely — it just reads March 2026 velocity and projects forward.

**This is the core structural disadvantage:** the CV framework evaluates model selection on old data, then the refit adapts to new data but the model *type* chosen may not be well-suited to the current regime. V1 always adapts automatically because it is nothing but a recent-velocity calculation.

### 3. Demand softened in Apr–Jun 2026 relative to the training average

The +10.5% over-forecast bias across all models (except HistoricAverage-containing ensembles) tells a clear story: the models collectively expected more units than actually sold. Possible causes:
- Q4 2025 peak inflated trailing averages; models trained on this over-estimated baseline demand
- Demand in certain categories genuinely softened in Q2 2026
- Deseasonalization removed the Q4 spike signal, but the post-Q4 mean reversion in Q1 2026 was sharper than the seasonal factor anticipated

V1 anchored to March 2026 velocity (post-normalization), so its forecast was already at the lower post-Q4 level. The models anchored to mid-2025 training windows that embedded a higher baseline.

### 4. Scenarios where V1 wins vs. where models win

**V1 wins when:**
- Demand level has shifted in the last 30-60 days (V1 tracks it immediately; statistical models lag)
- Demand is flat or trending modestly in both training and forecast period
- Volume is moderate enough that V1's simple rate estimate is good enough
- Post-peak normalization: V1's window "forgets" the peak faster

**Models win when:**
- Demand has clear structure that looks different from V1's recency window (e.g., CC-SS-03-J-GR-1TO: AutoETS nailed it at 199 vs V1's 155 vs actual 199)
- Demand was recently depressed but will recover — V1 under-forecasts recovery because it weights the recent trough heavily (WindowAverage-selected SKUs like CC-CN-03-N-GR-1TO: model 738 vs V1 607 vs actual 731)
- The ensemble component includes HistoricAverage, which anchors the long-run mean and prevents over-shooting

### 5. Is 3-window CV causing the problem?

Partially, yes. The 3 windows cover only 39 weeks of evaluation history (May 2025 – Jan 2026). Using `N_CV_SPLITS=6` would extend back to ~Sep 2024 for smooth/medium SKUs — adding more pre-Q4 2025 data but still no post-Q4 data. The fundamental issue is that **no CV configuration can evaluate on data that doesn't exist yet** (Apr–Jun 2026), so the mismatch is structural, not a tuning problem.

The actionable fixes are: (a) remove bad-candidate models so CV can't select catastrophically wrong choices, (b) bias toward model types that are robust across regimes (ensembles with HistoricAverage), and (c) consider adding V1 as a selectable candidate in CV so the pipeline can explicitly prefer V1 when no model beats it.

---

## Bias Analysis

Almost every model over-forecasts (positive bias). The only exceptions are models that include HistoricAverage as a component — these either have near-zero bias or slightly under-forecast.

| Bias bucket | Models |
|---|---|
| Under-forecast (< −5%) | SeasonalNaive (−42.9%), HistoricAverage+Naive (−8.1%), AutoARIMA+WindowAverage (−7.0%) |
| Near-zero (±5%) | AutoTheta+Naive (−0.5%) |
| Over-forecast > 10% | AutoETS, AutoTheta, Naive, AutoARIMA+AutoTheta, AutoETS+WindowAverage, WindowAverage, AutoETS+HistoricAverage, AutoTheta+WindowAverage |

The positive bias across most models suggests demand in Apr–Jun 2026 ran below the pace embedded in training data. V1 partially avoids this because its lag window is aligned closer to the cutoff date, so it already reflects any recent softening.

---

## Outlier SKUs

### Worst model misses (model WAPE >> V1 WAPE)

| SKU | Model | Forecast | V1 | Actual | Model WAPE | V1 WAPE |
|---|---|---|---|---|---|---|
| CC-SN-03-D-GR-1TO | AutoTheta | 164 | 141 | 82 | **100%** | 72% |
| CA-SC-10-F-190-BK-1TO | Naive | 412 | 234 | 264 | **56%** | 11% |
| CC-CS-03-L-GR-1TO | Ensemble: AutoETS+WindowAverage | 250 | 187 | 166 | **51%** | 13% |
| CC-TS-03-V-GR-1TO | HistoricAverage | 73 | 55 | 48 | **52%** | 15% |
| CC-CC-03-CHCV15-GR-1TO | Ensemble: AutoTheta+Naive | 258 | 152 | 179 | **44%** | 15% |
| CC-CC-15-DGCH05-BKRD-STR | SeasonalNaive | 28 | 45 | 49 | **43%** | 8% |

All of these are severe over-forecasts. **CA-SC-10-F-190-BK-1TO** is particularly notable — Naive predicted 412 units, V1 predicted 234, actual was 264. Naive inherited recent high-demand weeks and extrapolated them forward.

### Best model wins (model WAPE << V1 WAPE)

| SKU | Model | Forecast | V1 | Actual | Model WAPE | V1 WAPE |
|---|---|---|---|---|---|---|
| CC-SS-03-J-GR-1TO | AutoETS | 199 | 155 | 199 | **0%** | 22% |
| CC-CN-03-N-GR-1TO | WindowAverage | 738 | 607 | 731 | **1%** | 17% |
| CC-CN-03-M-GR-1TO | WindowAverage | 861 | 811 | 852 | **1%** | 5% |
| CC-CP-03-J-GR-1TO | WindowAverage | 804 | 705 | 784 | **3%** | 10% |
| CC-TS-03-T-GR-1TO | Ensemble: HistoricAverage+Naive | 137 | 183 | 149 | **8%** | 23% |
| CC-CN-03-K-GR-1TO | Ensemble: AutoTheta+WindowAverage | 953 | 752 | 878 | **9%** | 14% |

These are cases where the model correctly captured the demand level and V1's lag was dragging low.

---

## All 55 SKUs

Sorted by actual demand (descending).

| SKU | Model | Hist. Wks | Forecast | V1 | Actual | Model WAPE | V1 WAPE | Winner |
|---|---|---|---|---|---|---|---|---|
| CC-CN-03-P-GR-1TO | Ensemble: AutoETS+WindowAvg | 93 | 1,141 | 983 | 1,047 | 9.0% | 6.1% | V1 |
| CC-CP-03-K-GR-1TO | AutoETS | 63 | 1,109 | 968 | 1,042 | 6.4% | 7.1% | **Model** |
| CC-CN-03-D-GR-1TO | WindowAverage | 93 | 1,024 | 940 | 961 | 6.6% | 2.2% | V1 |
| CC-CP-03-G-GR-1TO | AutoETS | 63 | 1,171 | 1,048 | 957 | 22.4% | 9.5% | V1 |
| CC-CN-03-K-GR-1TO | Ensemble: AutoTheta+WindowAvg | 63 | 953 | 752 | 878 | 8.5% | 14.4% | **Model** |
| CC-CN-03-M-GR-1TO | WindowAverage | 93 | 861 | 811 | 852 | 1.1% | 4.8% | **Model** |
| CC-CN-03-X-GR-1TO | WindowAverage | 93 | 939 | 794 | 803 | 16.9% | 1.1% | V1 |
| CC-CP-03-J-GR-1TO | WindowAverage | 93 | 804 | 705 | 784 | 2.6% | 10.1% | **Model** |
| CC-CN-03-N-GR-1TO | WindowAverage | 93 | 738 | 607 | 731 | 1.0% | 17.0% | **Model** |
| CC-CN-03-J-GR-1TO | WindowAverage | 93 | 841 | 670 | 649 | 29.6% | 3.2% | V1 |
| CC-CN-03-L-GR-1TO | Ensemble: HistAvg+WindowAvg | 63 | 623 | 598 | 582 | 7.0% | 2.7% | V1 |
| CC-CN-03-R-GR-1TO | Ensemble: AutoTheta+Naive | 93 | 477 | 428 | 560 | 14.8% | 23.6% | **Model** |
| CC-CP-03-I-GR-1TO | WindowAverage | 93 | 450 | 450 | 498 | 9.6% | 9.6% | Tie |
| CC-CN-03-B-GR-1TO | WindowAverage | 93 | 466 | 420 | 408 | 14.2% | 2.9% | V1 |
| CC-CS-03-K-GR-1TO | WindowAverage | 93 | 500 | 455 | 360 | 38.9% | 26.4% | V1 |
| CC-TS-03-S-GR-1TO | Ensemble: AutoETS+HistAvg | 93 | 399 | 410 | 354 | 12.7% | 15.8% | **Model** |
| CC-SS-03-M-GR-1TO | WindowAverage | 93 | 313 | 336 | 299 | 4.7% | 12.4% | **Model** |
| CC-CN-03-F-GR-1TO | WindowAverage | 93 | 330 | 296 | 295 | 11.9% | 0.3% | V1 |
| CA-SC-10-F-190-BK-1TO | Naive | 55 | 412 | 234 | 264 | 56.1% | 11.4% | V1 |
| CC-SS-03-K-GR-1TO | AutoETS | 93 | 319 | 255 | 261 | 22.2% | 2.3% | V1 |
| CC-CS-03-I-GR-1TO | Ensemble: AutoETS+WindowAvg | 93 | 303 | 294 | 256 | 18.4% | 14.8% | V1 |
| CC-CN-03-T-GR-1TO | Ensemble: AutoARIMA+WindowAvg | 93 | 227 | 210 | 244 | 7.0% | 13.9% | **Model** |
| CC-CN-03-I-GR-1TO | WindowAverage | 93 | 179 | 165 | 216 | 17.1% | 23.6% | **Model** |
| CC-CP-03-H-GR-1TO | WindowAverage | 93 | 182 | 160 | 209 | 12.9% | 23.4% | **Model** |
| CC-SS-03-J-GR-1TO | AutoETS | 93 | 199 | 155 | 199 | 0.0% | 22.1% | **Model** |
| CC-CC-03-CHCV15-GR-1TO | Ensemble: AutoTheta+Naive | 81 | 258 | 152 | 179 | 44.1% | 15.1% | V1 |
| CC-CS-03-H-GR-1TO | WindowAverage | 93 | 211 | 190 | 171 | 23.4% | 11.1% | V1 |
| CC-CS-03-L-GR-1TO | Ensemble: AutoETS+WindowAvg | 93 | 250 | 187 | 166 | 50.6% | 12.7% | V1 |
| CC-CS-03-M-GR-1TO | HistoricAverage | 93 | 179 | 211 | 166 | 7.8% | 27.1% | **Model** |
| CC-CS-03-J-GR-1TO | AutoTheta | 93 | 191 | 150 | 164 | 16.5% | 8.5% | V1 |
| CC-SS-03-I-GR-1TO | AutoETS | 93 | 155 | 195 | 159 | 2.5% | 22.6% | **Model** |
| CC-CN-03-H-GR-1TO | AutoETS | 93 | 180 | 150 | 151 | 19.2% | 0.7% | V1 |
| CC-TS-03-T-GR-1TO | Ensemble: HistAvg+Naive | 93 | 137 | 183 | 149 | 8.1% | 22.8% | **Model** |
| CC-CN-03-G-GR-1TO | Naive | 93 | 128 | 128 | 140 | 8.6% | 8.6% | Tie |
| CC-CS-03-G-GR-1TO | AutoTheta | 93 | 134 | 121 | 125 | 7.2% | 3.2% | V1 |
| CC-CP-03-F-GR-1TO | Ensemble: AutoETS+WindowAvg | 93 | 97 | 77 | 125 | 22.4% | 38.4% | **Model** |
| CC-SS-03-N-GR-1TO | Ensemble: AutoARIMA+AutoTheta | 93 | 141 | 109 | 105 | 34.3% | 3.8% | V1 |
| CC-SS-03-G-GR-1TO | HistoricAverage | 93 | 82 | 89 | 99 | 17.2% | 10.1% | V1 |
| CC-CS-03-N-GR-1TO | Ensemble: HistAvg+WindowAvg | 93 | 93 | 85 | 96 | 3.1% | 11.5% | **Model** |
| CC-SN-03-B-GR-1TO | AutoETS | 93 | 91 | 92 | 90 | 1.1% | 2.2% | **Model** |
| CC-SN-03-D-GR-1TO | AutoTheta | 93 | 164 | 141 | 82 | 100.0% | 72.0% | V1 |
| CC-TC-03-P-GR-1TO | WindowAverage | 93 | 77 | 82 | 78 | 1.3% | 5.1% | **Model** *(low conf)* |
| CC-TT-03-U-GR-1TO | WindowAverage | 93 | 72 | 74 | 78 | 7.7% | 5.1% | V1 |
| CC-TS-03-R-GR-1TO | AutoETS | 93 | 102 | 99 | 73 | 39.7% | 35.6% | V1 |
| CC-SS-03-H-GR-1TO | Ensemble: HistAvg+WindowAvg | 93 | 95 | 113 | 72 | 31.9% | 56.9% | **Model** |
| CC-TC-03-N-GR-1TO | WindowAverage | 93 | 112 | 93 | 70 | 60.0% | 32.9% | V1 |
| CC-SS-03-R-GR-1TO | Ensemble: AutoETS+WindowAvg | 93 | 57 | 50 | 68 | 16.2% | 26.5% | **Model** |
| CC-CP-03-M-GR-1TO | Ensemble: AutoETS+HistAvg | 93 | 87 | 105 | 66 | 31.8% | 59.1% | **Model** |
| CC-CC-03-MZMX38-GR-1TO | Ensemble: HistAvg+WindowAvg | 93 | 76 | 49 | 64 | 18.8% | 23.4% | **Model** |
| CC-CP-03-L-GR-1TO | WindowAverage | 93 | 90 | 85 | 63 | 42.9% | 34.9% | V1 |
| CA-CL-AT-CBL | Ensemble: Naive+SeasonalNaive | 63 | 77 | 48 | 63 | 22.2% | 23.8% | **Model** |
| CC-CC-15-DGCH05-BKRD-STR | SeasonalNaive | 61 | 28 | 45 | 49 | 42.9% | 8.2% | V1 *(low conf)* |
| CC-TS-03-V-GR-1TO | HistoricAverage | 93 | 73 | 55 | 48 | 52.1% | 14.6% | V1 |
| CC-TT-03-S-GR-1TO | Ensemble: AutoTheta+WindowAvg | 93 | 54 | 49 | 42 | 28.6% | 16.7% | V1 |
| CC-TS-03-N-GR-1TO | Ensemble: HistAvg+WindowAvg | 93 | 56 | 55 | 42 | 33.3% | 31.0% | V1 |

---

## What to Fix

### 1. ✅ Remove Naive and SeasonalNaive from the smooth model pool (done)
They have MASE of 3.8 and 5.25 respectively. Cross-validation selected them on their training window but they completely fell apart out-of-sample. Naive was removed from `_MODEL_SETS["smooth"]` in `models.py`; Naive and SeasonalNaive were removed from `_BASELINE_SETS["smooth"]` in `baselines.py`. The smooth candidate pool is now: AutoARIMA, AutoETS, AutoTheta, WindowAverage(8), HistoricAverage.

### 2. AutoTheta is over-forecasting (MASE 1.53, 0/3 wins)
All three AutoTheta-selected SKUs have the same pattern: strong upward trend in training data, Theta extrapolates it, demand flattens out-of-sample. Consider removing standalone AutoTheta and keeping it only in ensembles (where WindowAverage damps it — the Ensemble:AutoTheta+WindowAverage MASE is 0.654).

### 3. Ensembles with HistoricAverage are your best performers
The four model variants that beat V1 all include HistoricAverage: HistoricAverage+Naive (MASE 0.35), AutoARIMA+WindowAverage (0.50), AutoTheta+WindowAverage (0.65), AutoETS+HistoricAverage (0.70). HistoricAverage serves as a long-run mean anchor — it prevents models from chasing trends that don't hold. Consider weighting the selector to favour these ensembles.

### 4. WindowAverage is close but consistently lags V1 (MASE 1.37, 7/18 wins)
WindowAverage and V1 are conceptually similar (both are rolling averages), but V1's lag-aligned window is better calibrated to the cutoff date in this backtest. The gap is 12.0% vs 8.8% WAPE — meaningful but not catastrophic. Investigate whether adjusting WindowAverage's window parameter (or making it adaptive to the cutoff week) closes the gap.

### 5. The over-forecast bias (+10.5%) is the root issue
Most of the model underperformance versus V1 is not randomness — it is consistent directional error. The models are predicting more units than materialised. This could mean: demand in Apr–Jun was softer than the trailing training window, or the models are fitting to peaks in the training data. V1's lag anchoring implicitly smooths this. If the bias is consistent across multiple backtest cycles, adding a post-hoc bias correction (scale down all smooth-full forecasts by ~5–10%) could narrow the gap without changing the pipeline.

---

*Generated 2026-07-02 · Source: `shipcore.fc_forward_forecasts_test` (forecast_date = 2026-03-30)*
