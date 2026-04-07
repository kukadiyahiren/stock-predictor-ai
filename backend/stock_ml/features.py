"""Feature engineering for technical indicators."""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

try:
    import pandas_ta as ta
except Exception:  # pragma: no cover - runtime dependency guard
    ta = None


class FeatureEngineer:
    """Builds model-ready features from OHLCV."""

    def __init__(self, logger: logging.Logger) -> None:
        self.logger = logger

    @staticmethod
    def _pick_column(frame: pd.DataFrame, prefix: str) -> str:
        for col in frame.columns:
            if str(col).upper().startswith(prefix.upper()):
                return col
        raise KeyError(prefix)

    def _add_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        required_cols = {"open", "high", "low", "close", "volume"}
        missing = required_cols.difference(out.columns)
        if missing:
            raise ValueError(f"Missing required OHLCV columns: {missing}")

        if ta is None:
            raise ImportError(
                "pandas_ta is not installed. Install with: pip install pandas_ta"
            )

        out["rsi"] = ta.rsi(out["close"], length=14)
        macd = ta.macd(out["close"], fast=12, slow=26, signal=9)
        out["macd"] = macd[self._pick_column(macd, "MACD_")]
        out["macd_signal"] = macd[self._pick_column(macd, "MACDS_")]
        out["macd_hist"] = macd[self._pick_column(macd, "MACDH_")]

        out["ma20"] = ta.sma(out["close"], length=20)
        out["ma50"] = ta.sma(out["close"], length=50)
        out["ma200"] = ta.sma(out["close"], length=200)

        bb = ta.bbands(out["close"], length=20, std=2.0)
        out["bb_lower"] = bb[self._pick_column(bb, "BBL_")]
        out["bb_mid"] = bb[self._pick_column(bb, "BBM_")]
        out["bb_upper"] = bb[self._pick_column(bb, "BBU_")]
        out["bb_width"] = (out["bb_upper"] - out["bb_lower"]) / out["bb_mid"]

        out["return_1d"] = out["close"].pct_change(1)
        out["return_5d"] = out["close"].pct_change(5)
        out["volatility_20d"] = out["return_1d"].rolling(20).std()
        return out

    def build_dataset(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create full feature set and target labels."""
        out = self._add_indicators(df)

        # Classification target: next-day direction
        out["target_up_down"] = (out["close"].shift(-1) > out["close"]).astype(int)

        # Next-day regression target for forecasting
        out["target_next_close"] = out["close"].shift(-1)

        # Fill + drop to handle missing values from indicators/shift
        out = out.replace([np.inf, -np.inf], np.nan)
        out = out.ffill().bfill()
        out = out.dropna().copy()

        self.logger.info("Feature dataset built with %d rows and %d columns", *out.shape)
        return out
