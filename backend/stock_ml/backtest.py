"""Simple backtesting logic for prediction-driven strategy."""

from __future__ import annotations

import logging
from typing import Dict

import numpy as np
import pandas as pd


class Backtester:
    """Compares prediction strategy against buy-and-hold."""

    def __init__(self, logger: logging.Logger) -> None:
        self.logger = logger

    def run(self, close_prices: pd.Series, pred_up_down: pd.Series) -> Dict[str, float]:
        """
        Buy if predicted UP, else hold cash.

        Strategy return is computed from daily returns where position is 1 when signal=UP else 0.
        """
        if len(close_prices) == 0 or len(pred_up_down) == 0:
            raise ValueError("Backtest inputs are empty.")

        df = pd.DataFrame({"close": close_prices, "signal": pred_up_down}).dropna().copy()
        if df.empty:
            raise ValueError("No overlapping rows between prices and predictions for backtest.")

        df["daily_return"] = df["close"].pct_change().fillna(0.0)
        df["position"] = np.where(df["signal"] == 1, 1.0, 0.0)
        df["strategy_return"] = df["position"].shift(1).fillna(0.0) * df["daily_return"]

        strategy_curve = (1.0 + df["strategy_return"]).cumprod()
        buy_hold_curve = (1.0 + df["daily_return"]).cumprod()

        strategy_total_return = float(strategy_curve.iloc[-1] - 1.0)
        buy_hold_total_return = float(buy_hold_curve.iloc[-1] - 1.0)

        result = {
            "strategy_total_return_pct": strategy_total_return * 100,
            "buy_hold_total_return_pct": buy_hold_total_return * 100,
            "alpha_pct": (strategy_total_return - buy_hold_total_return) * 100,
        }
        self.logger.info("Backtest result: %s", result)
        return result
