"""CLI entrypoint for end-to-end stock prediction system."""

from __future__ import annotations

import argparse
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

import pandas as pd

from .backtest import Backtester
from .config import AppConfig
from .data_loader import DataLoader
from .features import FeatureEngineer
from .model_lstm import LSTMPredictor
from .model_xgboost import XGBoostPredictor


def setup_logger(log_file: Path) -> logging.Logger:
    """Configure application logger."""
    logger = logging.getLogger("stock_ml")
    logger.setLevel(logging.INFO)
    if logger.handlers:
        return logger

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)

    file_handler = RotatingFileHandler(log_file, maxBytes=2_000_000, backupCount=3)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    return logger


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stock Prediction CLI")
    parser.add_argument("--ticker", type=str, help="Ticker symbol, e.g. AAPL or RELIANCE.NS")
    parser.add_argument("--years", type=int, default=5, help="Number of years of daily data")
    parser.add_argument("--epochs", type=int, default=20, help="LSTM epochs")
    parser.add_argument("--batch-size", type=int, default=32, help="LSTM batch size")
    return parser.parse_args()


def get_feature_columns() -> list[str]:
    return [
        "open",
        "high",
        "low",
        "close",
        "volume",
        "rsi",
        "macd",
        "macd_signal",
        "macd_hist",
        "ma20",
        "ma50",
        "ma200",
        "bb_lower",
        "bb_mid",
        "bb_upper",
        "bb_width",
        "return_1d",
        "return_5d",
        "volatility_20d",
    ]


def main() -> None:
    args = parse_args()
    config = AppConfig(lookback_years=args.years, lstm_epochs=args.epochs, lstm_batch_size=args.batch_size)
    logger = setup_logger(config.logs_dir / "pipeline.log")

    ticker = (args.ticker or input("Enter stock ticker (e.g., AAPL, TSLA, RELIANCE.NS): ").strip()).upper()
    if not ticker:
        raise ValueError("Ticker is required.")

    logger.info("Starting pipeline for ticker: %s", ticker)

    # 1) Data collection
    loader = DataLoader(config.data_dir, logger)
    raw_df = loader.fetch_ohlcv(ticker=ticker, years=config.lookback_years)

    # 2) Feature engineering
    engineer = FeatureEngineer(logger)
    dataset = engineer.build_dataset(raw_df)

    feature_cols = get_feature_columns()
    missing_features = [c for c in feature_cols if c not in dataset.columns]
    if missing_features:
        raise ValueError(f"Missing feature columns: {missing_features}")

    # Time-based split (no shuffle)
    split_idx = int(len(dataset) * config.train_split)
    train_df = dataset.iloc[:split_idx].copy()
    test_df = dataset.iloc[split_idx:].copy()
    if train_df.empty or test_df.empty:
        raise ValueError("Train/test split is empty. Need more data.")

    X_train = train_df[feature_cols]
    X_test = test_df[feature_cols]
    y_train_cls = train_df["target_up_down"]
    y_test_cls = test_df["target_up_down"]
    y_train_reg = train_df["target_next_close"]
    y_test_reg = test_df["target_next_close"]

    # 3A/4A/5A) XGBoost classification
    xgb = XGBoostPredictor(
        logger=logger,
        model_path=config.artifacts_dir / f"xgb_{ticker.replace('.', '_')}.joblib",
        params={
            "random_state": config.random_state,
            "n_estimators": config.xgb_n_estimators,
            "max_depth": config.xgb_max_depth,
            "learning_rate": config.xgb_learning_rate,
            "subsample": config.xgb_subsample,
            "colsample_bytree": config.xgb_colsample_bytree,
        },
    )
    xgb_metrics, xgb_preds = xgb.train(X_train, y_train_cls, X_test, y_test_cls)
    xgb.save()

    # 3B/4B/5B) LSTM regression
    lstm = LSTMPredictor(
        logger=logger,
        model_path=config.artifacts_dir / f"lstm_{ticker.replace('.', '_')}.keras",
        scaler_path=config.artifacts_dir / f"lstm_scaler_{ticker.replace('.', '_')}.npz",
        plot_path=config.plots_dir / f"lstm_pred_vs_actual_{ticker.replace('.', '_')}.png",
        sequence_length=config.sequence_length,
        lstm_units=config.lstm_units,
        dropout=config.lstm_dropout,
        learning_rate=config.lstm_learning_rate,
    )
    lstm_metrics, lstm_preds = lstm.train(
        X_train, y_train_reg, X_test, y_test_reg, epochs=config.lstm_epochs, batch_size=config.lstm_batch_size
    )
    lstm.save()

    # 6) Backtesting using XGBoost buy/sell signal
    backtester = Backtester(logger)
    bt_result = backtester.run(close_prices=test_df["close"], pred_up_down=xgb_preds)

    # 10) Save predictions to CSV
    out = pd.DataFrame(index=test_df.index)
    out["close"] = test_df["close"]
    out["xgb_signal"] = xgb_preds.reindex(test_df.index)
    out["lstm_pred_close"] = lstm_preds.reindex(test_df.index)
    out_path = config.predictions_dir / f"predictions_{ticker.replace('.', '_')}.csv"
    out.to_csv(out_path)
    logger.info("Saved predictions CSV to %s", out_path)

    # 5/9) Console summary
    print("\n=== XGBoost Classification Metrics ===")
    print(f"Accuracy : {xgb_metrics['accuracy']:.4f}")
    print(f"Precision: {xgb_metrics['precision']:.4f}")
    print(f"Recall   : {xgb_metrics['recall']:.4f}")

    print("\n=== LSTM Regression Metrics ===")
    print(f"MAE : {lstm_metrics['mae']:.4f}")
    print(f"RMSE: {lstm_metrics['rmse']:.4f}")

    print("\n=== Backtest Result ===")
    print(f"Strategy Return : {bt_result['strategy_total_return_pct']:.2f}%")
    print(f"Buy & Hold      : {bt_result['buy_hold_total_return_pct']:.2f}%")
    print(f"Alpha           : {bt_result['alpha_pct']:.2f}%")

    print("\nArtifacts")
    print(f"- LSTM plot: {config.plots_dir}")
    print(f"- Saved models: {config.artifacts_dir}")
    print(f"- Predictions CSV: {out_path}")
    print(f"- Logs: {config.logs_dir / 'pipeline.log'}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nExecution interrupted by user.")
    except Exception as exc:
        print(f"\nPipeline failed: {exc}")
        raise
