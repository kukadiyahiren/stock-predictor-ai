from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
from pathlib import Path
import json
import threading
import uuid
from datetime import datetime
import os
import time
import requests
import io
import csv
from py5paisa import FivePaisaClient

import models, schemas, database
from database import engine
from stock_ml.config import AppConfig
from stock_ml.data_loader import DataLoader
from stock_ml.features import FeatureEngineer
from stock_ml.model_xgboost import XGBoostPredictor
from stock_ml.model_lstm import LSTMPredictor
from stock_ml.backtest import Backtester
from stock_ml.main import setup_logger, get_feature_columns

models.Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import yfinance as yf
from datetime import timedelta
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
import numpy as np

ML_JOBS = {}
ML_ALERTS = []
SCHEDULER_STARTED = False
SCRIP_MASTER_CACHE = {}

def normalize_symbol(symbol: str) -> str:
    search_symbol = symbol.upper().replace("BOM:", "").replace("NSE:", "").strip()
    if search_symbol.isdigit() and len(search_symbol) >= 4:
        return f"{search_symbol}.BO"
    if "." not in search_symbol and len(search_symbol) <= 10:
        return f"{search_symbol}.NS"
    return search_symbol

def build_forecasts(current_price: float, closes):
    returns = closes.pct_change().dropna()
    short_momentum = closes.pct_change(5).iloc[-1] if len(closes) > 5 else 0
    medium_momentum = closes.pct_change(20).iloc[-1] if len(closes) > 20 else short_momentum
    drift = returns.tail(60).mean() if not returns.empty else 0
    volatility = returns.tail(60).std() if not returns.empty else 0
    volatility = 0 if volatility != volatility else float(volatility)  # NaN guard

    # Mean-reverting blended trend: short-term momentum + medium trend + drift
    daily_base_trend = (short_momentum * 0.35) + (medium_momentum * 0.25) + (drift * 0.40)
    daily_base_trend = max(min(daily_base_trend, 0.03), -0.03)  # cap extreme moves

    horizons = [
        ("Next 1 Hour", 1 / 24),
        ("Next 2 Hours", 2 / 24),
        ("Tomorrow", 1),
        ("1 Week", 7),
        ("1 Month", 30),
        ("6 Months", 180),
    ]
    confidence_by_horizon = {
        "Next 1 Hour": 0.93,
        "Next 2 Hours": 0.90,
        "Tomorrow": 0.87,
        "1 Week": 0.82,
        "1 Month": 0.74,
        "6 Months": 0.64,
    }

    forecasts = []
    for horizon, days in horizons:
        horizon_trend = daily_base_trend * days
        horizon_risk = volatility * (days ** 0.5) * 0.55
        expected_return = horizon_trend - (horizon_risk * 0.18)  # light risk penalty
        predicted_price = current_price * (1 + expected_return)
        trend_label = "up" if predicted_price >= current_price else "down"

        forecasts.append({
            "horizon": horizon,
            "predicted_price": round(max(predicted_price, 0.01), 2),
            "trend": trend_label,
            "confidence": confidence_by_horizon[horizon]
        })

    return forecasts

def fetch_stock_info(symbol: str):
    search_symbol = normalize_symbol(symbol)
    
    logo_url = None
    try:
        ticker = yf.Ticker(search_symbol)
        # Getting info can be slow, but it provides official name and logo
        info = ticker.info
        logo_url = info.get('logo_url')
    except:
        pass
    return search_symbol, logo_url

@app.post("/stocks/", response_model=schemas.Stock)
def create_stock(stock: schemas.StockCreate, db: Session = Depends(database.get_db)):
    db_stock = db.query(models.Stock).filter(models.Stock.symbol == stock.symbol).first()
    if db_stock:
        raise HTTPException(status_code=400, detail="Stock already registered")
    
    # Try to fetch logo
    _, logo_url = fetch_stock_info(stock.symbol)
    
    db_stock = models.Stock(symbol=stock.symbol, name=stock.name, logo_url=logo_url)
    db.add(db_stock)
    db.commit()
    db.refresh(db_stock)
    return db_stock

@app.put("/stocks/{stock_id}", response_model=schemas.Stock)
def update_stock(stock_id: int, stock: schemas.StockUpdate, db: Session = Depends(database.get_db)):
    db_stock = db.query(models.Stock).filter(models.Stock.id == stock_id).first()
    if not db_stock:
        raise HTTPException(status_code=404, detail="Stock not found")
    
    db_stock.symbol = stock.symbol
    db_stock.name = stock.name
    
    # Refresh logo if symbol changed
    _, logo_url = fetch_stock_info(stock.symbol)
    if logo_url:
        db_stock.logo_url = logo_url
    
    db.commit()
    db.refresh(db_stock)
    return db_stock

@app.get("/stocks/", response_model=List[schemas.Stock])
def read_stocks(skip: int = 0, limit: int = 100, db: Session = Depends(database.get_db)):
    stocks = db.query(models.Stock).offset(skip).limit(limit).all()
    return stocks

@app.get("/stocks/search", response_model=List[schemas.StockSuggestion])
def search_stocks(q: str, limit: int = 8):
    query = q.strip()
    if len(query) < 3:
        return []

    try:
        search_result = yf.Search(query=query, max_results=limit, news_count=0)
        quotes = search_result.quotes or []
    except Exception:
        return []

    suggestions = []
    seen_symbols = set()
    allowed_types = {"EQUITY", "ETF", "MUTUALFUND"}

    for item in quotes:
        symbol = (item.get("symbol") or "").strip()
        name = (item.get("shortname") or item.get("longname") or item.get("symbol") or "").strip()
        exchange = (item.get("exchange") or item.get("exchDisp") or "").strip() or None
        quote_type = (item.get("quoteType") or "").upper().strip()

        if not symbol or not name:
            continue
        if quote_type and quote_type not in allowed_types:
            continue
        if symbol in seen_symbols:
            continue

        seen_symbols.add(symbol)
        suggestions.append({
            "symbol": symbol,
            "name": name,
            "exchange": exchange
        })

        if len(suggestions) >= limit:
            break

    return suggestions

@app.get("/predictions/{symbol}")
def get_predictions(symbol: str, db: Session = Depends(database.get_db)):
    db_stock = db.query(models.Stock).filter(models.Stock.symbol == symbol).first()
    if not db_stock:
        # Try finding by name or symbol again to be more flexible
        db_stock = db.query(models.Stock).filter(
            (models.Stock.symbol == symbol) | (models.Stock.name.contains(symbol))
        ).first()

    if not db_stock:
        raise HTTPException(status_code=404, detail="Stock not found in our database. Please add it first.")

    # Auto-append correct suffix for Indian stocks
    search_symbol = normalize_symbol(symbol)

    try:
        ticker = yf.Ticker(search_symbol)
        # Get history for the last 6 months to make a smart prediction
        # Use simple try-fetch to valid ticker existence
        hist = ticker.history(period="5d")
        
        if hist.empty:
            # Try once without suffix if not already tried
            if search_symbol != symbol.upper():
                search_symbol = symbol.upper()
                ticker = yf.Ticker(search_symbol)
                hist = ticker.history(period="5d")
            
        if hist.empty:
            raise Exception(f"No market data found for {search_symbol}")

        # If we reach here, we have data. Get longer history for predictions.
        hist = ticker.history(period="6mo")
        current_price = hist['Close'].iloc[-1]
        
        # Enhanced currency detection
        currency = "$"
        if any(suffix in search_symbol for suffix in [".NS", ".BO", "BOM:", "NSE:"]) or "TRIDENT" in db_stock.name.upper():
            currency = "₹"
        
        forecasts = build_forecasts(current_price, hist["Close"])

        # Create a combined result
        result = {
            "stock_id": db_stock.id,
            "symbol": search_symbol,
            "name": db_stock.name,
            "current_price": round(current_price, 2),
            "currency": currency,
            "predictions": forecasts,
            "data_source": "Live Market Data (Yahoo Finance)"
        }

        # PERSISTENCE: Save these predictions to the database for historical tracking
        for pred in forecasts:
            if pred["horizon"] in ("Tomorrow", "1 Week"):
                new_record = models.PredictionRecord(
                    stock_id=db_stock.id,
                    horizon=pred["horizon"],
                    predicted_price=pred["predicted_price"],
                    confidence=pred["confidence"],
                    trend=pred["trend"]
                )
                db.add(new_record)
        db.commit()
        
        return result

    except Exception as e:
        print(f"Error fetching data for {symbol}: {e}")

        is_indian = any(x in symbol.upper() for x in ["TRIDENT", "521064", ".NS", ".BO"])
        fallback_price = 24.14 if is_indian and "521064" in symbol else 24.13 if "TRIDENT" in symbol.upper() else 100.0
        
        result = {
            "stock_id": db_stock.id,
            "symbol": symbol,
            "name": db_stock.name,
            "current_price": round(fallback_price, 2),
            "currency": "₹" if is_indian else "$",
            "predictions": [
                {"horizon": "Next 1 Hour", "predicted_price": round(fallback_price * 1.001, 2), "trend": "up", "confidence": 0.93},
                {"horizon": "Next 2 Hours", "predicted_price": round(fallback_price * 1.002, 2), "trend": "up", "confidence": 0.90},
                {"horizon": "Tomorrow", "predicted_price": round(fallback_price * 1.005, 2), "trend": "up", "confidence": 0.87},
                {"horizon": "1 Week", "predicted_price": round(fallback_price * 1.01, 2), "trend": "up", "confidence": 0.82},
                {"horizon": "1 Month", "predicted_price": round(fallback_price * 1.03, 2), "trend": "up", "confidence": 0.74},
                {"horizon": "6 Months", "predicted_price": round(fallback_price * 1.08, 2), "trend": "up", "confidence": 0.64}
            ],
            "data_source": "Simulated Logic (API unavailable)"
        }
        
        new_record = models.PredictionRecord(
            stock_id=db_stock.id,
            horizon="1 Week",
            predicted_price=result["predictions"][0]["predicted_price"],
            confidence=0.8,
            trend="up"
        )
        db.add(new_record)
        db.commit()
        return result

@app.get("/timeline/{symbol}", response_model=List[schemas.TimelinePoint])
def get_prediction_timeline(symbol: str, past_days: int = 7, future_days: int = 7):
    past_days = min(max(past_days, 3), 30)
    future_days = min(max(future_days, 3), 30)

    search_symbol = normalize_symbol(symbol)
    ticker = yf.Ticker(search_symbol)
    hist = ticker.history(period="6mo")
    if hist.empty and search_symbol != symbol.upper():
        ticker = yf.Ticker(symbol.upper())
        hist = ticker.history(period="6mo")
    if hist.empty:
        raise HTTPException(status_code=404, detail="Unable to load market history for graph")

    closes = hist["Close"].dropna()
    if closes.empty:
        raise HTTPException(status_code=404, detail="No close price data for graph")

    actual_points = closes.tail(past_days)
    points = [
        {"label": dt.strftime("%d %b"), "actual": round(float(price), 2), "predicted": None}
        for dt, price in actual_points.items()
    ]

    current_price = float(closes.iloc[-1])
    returns = closes.pct_change().dropna()
    drift = returns.tail(60).mean() if not returns.empty else 0
    momentum = closes.pct_change(10).iloc[-1] if len(closes) > 10 else 0
    daily_trend = max(min((drift * 0.6) + (momentum * 0.4), 0.025), -0.025)
    volatility = returns.tail(60).std() if not returns.empty else 0
    volatility = 0 if volatility != volatility else float(volatility)

    future_price = current_price
    start_date = actual_points.index[-1]
    for day in range(1, future_days + 1):
        future_price = future_price * (1 + daily_trend)
        band = max(future_price * volatility * (day ** 0.5), future_price * 0.01)
        points.append({
            "label": (start_date + timedelta(days=day)).strftime("%d %b"),
            "actual": None,
            "predicted": round(float(future_price), 2),
            "predicted_lower": round(float(max(future_price - band, 0.01)), 2),
            "predicted_upper": round(float(future_price + band), 2),
        })

    return points

@app.get("/history/{stock_id}", response_model=List[schemas.PredictionHistory])
def get_prediction_history(stock_id: int, db: Session = Depends(database.get_db)):
    # Return last 50 records for this stock
    history = db.query(models.PredictionRecord).filter(
        models.PredictionRecord.stock_id == stock_id
    ).order_by(models.PredictionRecord.date.desc()).limit(50).all()
    return history[::-1] # Return in chronological order for the graph

def _ticker_key(ticker: str) -> str:
    return ticker.replace(".", "_").upper()

def _append_experiment_log(record: dict):
    cfg = AppConfig()
    experiments_path = cfg.artifacts_dir / "experiments.jsonl"
    with experiments_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")

def _add_alert(message: str, level: str = "error"):
    alert = {
        "timestamp": datetime.utcnow().isoformat(),
        "level": level,
        "message": message,
    }
    ML_ALERTS.append(alert)
    # Keep latest 200 alerts in memory.
    if len(ML_ALERTS) > 200:
        del ML_ALERTS[0 : len(ML_ALERTS) - 200]

def _run_ml_pipeline(ticker: str, progress_cb=None):
    def report(stage: str, progress: int):
        if progress_cb:
            progress_cb(stage, progress)

    cfg = AppConfig()
    logger = setup_logger(cfg.logs_dir / "pipeline.log")
    ticker_key = _ticker_key(ticker)
    run_id = str(uuid.uuid4())
    model_version = datetime.utcnow().strftime("v%Y.%m.%d.%H%M%S")

    report("Fetching market data", 10)
    loader = DataLoader(cfg.data_dir, logger)
    engineer = FeatureEngineer(logger)

    raw_df = loader.fetch_ohlcv(ticker=ticker, years=cfg.lookback_years)
    report("Building features", 25)
    dataset = engineer.build_dataset(raw_df)

    feature_cols = get_feature_columns()
    split_idx = int(len(dataset) * cfg.train_split)
    train_df = dataset.iloc[:split_idx].copy()
    test_df = dataset.iloc[split_idx:].copy()
    if train_df.empty or test_df.empty:
        raise ValueError("Train/test split is empty. Need more historical rows.")

    X_train = train_df[feature_cols]
    X_test = test_df[feature_cols]
    y_train_cls = train_df["target_up_down"]
    y_test_cls = test_df["target_up_down"]
    y_train_reg = train_df["target_next_close"]
    y_test_reg = test_df["target_next_close"]

    report("Training XGBoost model", 40)
    xgb = XGBoostPredictor(
        logger=logger,
        model_path=cfg.artifacts_dir / f"xgb_{ticker_key}.joblib",
        params={
            "random_state": cfg.random_state,
            "n_estimators": cfg.xgb_n_estimators,
            "max_depth": cfg.xgb_max_depth,
            "learning_rate": cfg.xgb_learning_rate,
            "subsample": cfg.xgb_subsample,
            "colsample_bytree": cfg.xgb_colsample_bytree,
        },
    )
    xgb_metrics, xgb_preds = xgb.train(X_train, y_train_cls, X_test, y_test_cls)
    xgb.save()

    report("Training LSTM model", 65)
    lstm = LSTMPredictor(
        logger=logger,
        model_path=cfg.artifacts_dir / f"lstm_{ticker_key}.keras",
        scaler_path=cfg.artifacts_dir / f"lstm_scaler_{ticker_key}.npz",
        plot_path=cfg.plots_dir / f"lstm_pred_vs_actual_{ticker_key}.png",
        sequence_length=cfg.sequence_length,
        lstm_units=cfg.lstm_units,
        dropout=cfg.lstm_dropout,
        learning_rate=cfg.lstm_learning_rate,
    )
    lstm_metrics, lstm_preds = lstm.train(
        X_train,
        y_train_reg,
        X_test,
        y_test_reg,
        epochs=cfg.lstm_epochs,
        batch_size=cfg.lstm_batch_size,
    )
    lstm.save()

    report("Running backtest", 85)
    backtester = Backtester(logger)
    backtest = backtester.run(close_prices=test_df["close"], pred_up_down=xgb_preds)

    preds_df = pd.DataFrame(index=test_df.index)
    preds_df["close"] = test_df["close"]
    preds_df["xgb_signal"] = xgb_preds.reindex(test_df.index)
    preds_df["lstm_pred_close"] = lstm_preds.reindex(test_df.index)
    pred_csv_path = cfg.predictions_dir / f"predictions_{ticker_key}.csv"
    preds_df.to_csv(pred_csv_path)

    latest_idx = preds_df.dropna(subset=["close"]).index[-1]
    latest_close = float(preds_df.loc[latest_idx, "close"])
    latest_signal = int(preds_df.loc[latest_idx, "xgb_signal"]) if pd.notna(preds_df.loc[latest_idx, "xgb_signal"]) else 0
    latest_lstm = float(preds_df.loc[latest_idx, "lstm_pred_close"]) if pd.notna(preds_df.loc[latest_idx, "lstm_pred_close"]) else latest_close

    summary = {
        "run_id": run_id,
        "model_version": model_version,
        "trained_at": datetime.utcnow().isoformat(),
        "ticker": ticker.upper(),
        "xgboost_metrics": xgb_metrics,
        "lstm_metrics": lstm_metrics,
        "backtest": backtest,
        "latest_prediction": {
            "close": round(latest_close, 4),
            "signal": "UP" if latest_signal == 1 else "DOWN",
            "lstm_pred_close": round(latest_lstm, 4),
        },
        "artifacts": {
            "predictions_csv": str(pred_csv_path),
            "plot_file": str(cfg.plots_dir / f"lstm_pred_vs_actual_{ticker_key}.png"),
            "xgb_model": str(cfg.artifacts_dir / f"xgb_{ticker_key}.joblib"),
            "lstm_model": str(cfg.artifacts_dir / f"lstm_{ticker_key}.keras"),
        },
    }

    summary_path = cfg.predictions_dir / f"summary_{ticker_key}.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    _append_experiment_log({
        "run_id": run_id,
        "model_version": model_version,
        "ticker": ticker.upper(),
        "trained_at": summary["trained_at"],
        "xgboost_metrics": xgb_metrics,
        "lstm_metrics": lstm_metrics,
        "backtest": backtest,
        "artifacts": summary["artifacts"],
        "params": {
            "lookback_years": cfg.lookback_years,
            "train_split": cfg.train_split,
            "sequence_length": cfg.sequence_length,
            "xgb_n_estimators": cfg.xgb_n_estimators,
            "lstm_epochs": cfg.lstm_epochs,
            "lstm_batch_size": cfg.lstm_batch_size,
        },
    })

    report("Completed", 100)
    return summary

def _load_ml_summary(ticker: str):
    cfg = AppConfig()
    ticker_key = _ticker_key(ticker)
    summary_path = cfg.predictions_dir / f"summary_{ticker_key}.json"
    if not summary_path.exists():
        raise HTTPException(status_code=404, detail="No ML result found. Please train this ticker first.")
    return json.loads(summary_path.read_text(encoding="utf-8"))

def _resolve_ml_ticker(ticker: str, db: Session) -> str:
    normalized = ticker.strip().upper()
    if "." in normalized:
        return normalized

    end_date = datetime.utcnow().date()
    start_date = end_date - timedelta(days=365 * 5 + 10)

    def _has_usable_history(symbol: str) -> bool:
        try:
            probe = yf.download(
                symbol,
                start=start_date.isoformat(),
                end=end_date.isoformat(),
                interval="1d",
                progress=False,
                auto_adjust=False,
            )
            return probe is not None and not probe.empty and len(probe) > 200
        except Exception:
            return False

    candidates = [normalized]
    if normalized.isdigit():
        candidates.extend([f"{normalized}.BO", f"{normalized}.NS"])
    else:
        candidates.extend([f"{normalized}.NS", f"{normalized}.BO"])

    for c in candidates:
        if _has_usable_history(c):
            return c

    # If not resolvable directly, try using stock name from DB as Yahoo search query.
    stock_row = db.query(models.Stock).filter(models.Stock.symbol == normalized).first()
    if stock_row and stock_row.name:
        try:
            search_result = yf.Search(query=stock_row.name, max_results=10, news_count=0)
            quotes = search_result.quotes or []
            for q in quotes:
                symbol = (q.get("symbol") or "").strip().upper()
                qtype = (q.get("quoteType") or "").upper().strip()
                if not symbol:
                    continue
                if qtype and qtype not in {"EQUITY", "ETF"}:
                    continue
                if _has_usable_history(symbol):
                    return symbol
        except Exception:
            pass

    return normalized

@app.post("/ml/train")
def train_ml(payload: dict, db: Session = Depends(database.get_db)):
    ticker = (payload.get("ticker") or "").strip().upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker is required")
    try:
        resolved_ticker = _resolve_ml_ticker(ticker, db)
        return _run_ml_pipeline(resolved_ticker)
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"Missing ML dependency: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ML training failed: {e}")

@app.post("/ml/train/async")
def train_ml_async(payload: dict, db: Session = Depends(database.get_db)):
    ticker = (payload.get("ticker") or "").strip().upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker is required")
    resolved_ticker = _resolve_ml_ticker(ticker, db)

    job_id = str(uuid.uuid4())
    ML_JOBS[job_id] = {
        "job_id": job_id,
        "ticker": ticker,
        "resolved_ticker": resolved_ticker,
        "status": "running",
        "progress": 0,
        "stage": "Queued",
        "error": None,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }

    def _runner():
        try:
            def _progress(stage: str, progress: int):
                ML_JOBS[job_id]["stage"] = stage
                ML_JOBS[job_id]["progress"] = progress
                ML_JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()

            _run_ml_pipeline(resolved_ticker, progress_cb=_progress)
            ML_JOBS[job_id]["status"] = "completed"
            ML_JOBS[job_id]["progress"] = 100
            ML_JOBS[job_id]["stage"] = "Completed"
            ML_JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()
        except Exception as e:
            ML_JOBS[job_id]["status"] = "failed"
            ML_JOBS[job_id]["error"] = str(e)
            ML_JOBS[job_id]["updated_at"] = datetime.utcnow().isoformat()
            _add_alert(f"Async training failed for {resolved_ticker}: {e}")

    thread = threading.Thread(target=_runner, daemon=True)
    thread.start()
    return {"job_id": job_id, "status": "running", "ticker": ticker, "resolved_ticker": resolved_ticker}

@app.get("/ml/train/status/{job_id}")
def train_ml_status(job_id: str):
    job = ML_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@app.get("/ml/predict/{ticker}")
def ml_predict(ticker: str):
    summary = _load_ml_summary(ticker)
    return {
        "ticker": summary["ticker"],
        "run_id": summary.get("run_id"),
        "model_version": summary.get("model_version"),
        "trained_at": summary.get("trained_at"),
        "latest_prediction": summary["latest_prediction"],
        "xgboost_metrics": summary["xgboost_metrics"],
        "lstm_metrics": summary["lstm_metrics"],
        "artifacts": summary["artifacts"],
    }

@app.get("/ml/backtest/{ticker}")
def ml_backtest(ticker: str):
    summary = _load_ml_summary(ticker)
    return {
        "ticker": summary["ticker"],
        "backtest": summary["backtest"],
    }

@app.get("/ml/plot/{ticker}")
def ml_plot(ticker: str):
    cfg = AppConfig()
    ticker_key = _ticker_key(ticker)
    plot_path = cfg.plots_dir / f"lstm_pred_vs_actual_{ticker_key}.png"
    if not plot_path.exists():
        raise HTTPException(status_code=404, detail="Plot not found. Train this ticker first.")
    return FileResponse(path=plot_path, media_type="image/png", filename=plot_path.name)

@app.get("/ml/experiments")
def ml_experiments(ticker: str = "", limit: int = 20):
    cfg = AppConfig()
    experiments_path = cfg.artifacts_dir / "experiments.jsonl"
    if not experiments_path.exists():
        return []
    rows = []
    with experiments_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
                if ticker and row.get("ticker", "").upper() != ticker.upper():
                    continue
                rows.append(row)
            except Exception:
                continue
    return rows[-max(1, min(limit, 200)) :][::-1]

def _build_timeline_points_for_report(symbol: str, past_days: int = 7, future_days: int = 7):
    search_symbol = normalize_symbol(symbol)
    ticker = yf.Ticker(search_symbol)
    hist = ticker.history(period="6mo")
    if hist.empty and search_symbol != symbol.upper():
        ticker = yf.Ticker(symbol.upper())
        hist = ticker.history(period="6mo")
    if hist.empty:
        raise ValueError("Unable to load market history")

    closes = hist["Close"].dropna()
    actual_points = closes.tail(past_days)
    returns = closes.pct_change().dropna()
    drift = returns.tail(60).mean() if not returns.empty else 0
    momentum = closes.pct_change(10).iloc[-1] if len(closes) > 10 else 0
    volatility = returns.tail(60).std() if not returns.empty else 0
    volatility = 0 if volatility != volatility else float(volatility)
    daily_trend = max(min((drift * 0.6) + (momentum * 0.4), 0.025), -0.025)

    points = [{"label": dt.strftime("%d %b"), "actual": float(v), "predicted": None} for dt, v in actual_points.items()]
    future_price = float(closes.iloc[-1])
    start_date = actual_points.index[-1]
    for day in range(1, future_days + 1):
        future_price = future_price * (1 + daily_trend)
        band = max(future_price * volatility * (day ** 0.5), future_price * 0.01)
        points.append({
            "label": (start_date + timedelta(days=day)).strftime("%d %b"),
            "actual": None,
            "predicted": float(future_price),
            "predicted_lower": float(max(future_price - band, 0.01)),
            "predicted_upper": float(future_price + band),
        })
    return points

@app.get("/ml/report/{ticker}")
def ml_report(ticker: str):
    summary = _load_ml_summary(ticker)
    cfg = AppConfig()
    ticker_key = _ticker_key(ticker)
    report_path = cfg.artifacts_dir / f"report_{ticker_key}.pdf"

    points = _build_timeline_points_for_report(ticker, 7, 7)
    labels = [p["label"] for p in points]
    actual = np.array([p.get("actual", np.nan) for p in points], dtype=float)
    predicted = np.array([p.get("predicted", np.nan) for p in points], dtype=float)
    lower = np.array([p.get("predicted_lower", np.nan) for p in points], dtype=float)
    upper = np.array([p.get("predicted_upper", np.nan) for p in points], dtype=float)

    with PdfPages(report_path) as pdf:
        fig1 = plt.figure(figsize=(11.69, 8.27))
        plt.axis("off")
        plt.text(0.05, 0.92, f"Stock Prediction Report: {summary.get('ticker', ticker)}", fontsize=18, fontweight="bold")
        plt.text(0.05, 0.87, f"Model version: {summary.get('model_version', '-')}", fontsize=11)
        plt.text(0.05, 0.84, f"Run ID: {summary.get('run_id', '-')}", fontsize=10)
        plt.text(0.05, 0.81, f"Trained at: {summary.get('trained_at', '-')}", fontsize=10)
        plt.text(0.05, 0.74, "XGBoost Metrics", fontsize=12, fontweight="bold")
        xgb = summary.get("xgboost_metrics", {})
        plt.text(0.05, 0.70, f"Accuracy: {xgb.get('accuracy', 0):.4f}")
        plt.text(0.05, 0.67, f"Precision: {xgb.get('precision', 0):.4f}")
        plt.text(0.05, 0.64, f"Recall: {xgb.get('recall', 0):.4f}")
        plt.text(0.45, 0.74, "LSTM Metrics", fontsize=12, fontweight="bold")
        lstm = summary.get("lstm_metrics", {})
        plt.text(0.45, 0.70, f"MAE: {lstm.get('mae', 0):.4f}")
        plt.text(0.45, 0.67, f"RMSE: {lstm.get('rmse', 0):.4f}")
        bt = summary.get("backtest", {})
        plt.text(0.05, 0.56, "Backtest", fontsize=12, fontweight="bold")
        plt.text(0.05, 0.52, f"Strategy return: {bt.get('strategy_total_return_pct', 0):.2f}%")
        plt.text(0.05, 0.49, f"Buy & hold: {bt.get('buy_hold_total_return_pct', 0):.2f}%")
        plt.text(0.05, 0.46, f"Alpha: {bt.get('alpha_pct', 0):.2f}%")
        pdf.savefig(fig1)
        plt.close(fig1)

        fig2 = plt.figure(figsize=(11.69, 8.27))
        ax = fig2.add_subplot(111)
        x = np.arange(len(labels))
        ax.plot(x, actual, label="Actual (Last 7 Days)", color="#10b981", linewidth=2)
        ax.plot(x, predicted, label="Predicted (Next 7 Days)", color="#6366f1", linewidth=2)
        ax.plot(x, lower, color="#94a3b8", linestyle="--", linewidth=1, label="Confidence Lower")
        ax.plot(x, upper, color="#94a3b8", linestyle="--", linewidth=1, label="Confidence Upper")
        valid_band = np.isfinite(lower) & np.isfinite(upper)
        ax.fill_between(x, lower, upper, where=valid_band, color="#94a3b8", alpha=0.12)
        ax.set_xticks(x)
        ax.set_xticklabels(labels, rotation=35, ha="right")
        ax.set_title("Forecast Timeline with Confidence Band")
        ax.set_ylabel("Price")
        ax.set_xlabel("Date")
        ax.grid(alpha=0.2)
        ax.legend()
        pdf.savefig(fig2)
        plt.close(fig2)

    return FileResponse(path=report_path, media_type="application/pdf", filename=report_path.name)

def _daily_retrain_worker():
    interval_seconds = int(os.getenv("ML_RETRAIN_INTERVAL_SECONDS", "86400"))
    while True:
        db = database.SessionLocal()
        try:
            stocks = db.query(models.Stock).all()
            for stock in stocks:
                try:
                    resolved = _resolve_ml_ticker(stock.symbol, db)
                    _run_ml_pipeline(resolved)
                except Exception as e:
                    _add_alert(f"Scheduled retrain failed for {stock.symbol}: {e}")
        except Exception as e:
            _add_alert(f"Scheduled retrain worker failed: {e}")
        finally:
            db.close()
        time.sleep(max(300, interval_seconds))

@app.on_event("startup")
def start_retrain_scheduler():
    global SCHEDULER_STARTED
    if SCHEDULER_STARTED:
        return
    SCHEDULER_STARTED = True
    thread = threading.Thread(target=_daily_retrain_worker, daemon=True)
    thread.start()

@app.post("/ml/retrain/trigger")
def trigger_retrain_now(db: Session = Depends(database.get_db)):
    stocks = db.query(models.Stock).all()
    results = []
    for stock in stocks:
        try:
            resolved = _resolve_ml_ticker(stock.symbol, db)
            _run_ml_pipeline(resolved)
            results.append({"symbol": stock.symbol, "status": "ok", "resolved_ticker": resolved})
        except Exception as e:
            msg = f"Manual retrain failed for {stock.symbol}: {e}"
            _add_alert(msg)
            results.append({"symbol": stock.symbol, "status": "failed", "error": str(e)})
    return {"count": len(results), "results": results}

@app.get("/ml/alerts")
def ml_alerts(limit: int = 50):
    limit = max(1, min(limit, 200))
    return ML_ALERTS[-limit:][::-1]

XSTREAM_BASE_URL = os.getenv("XSTREAM_BASE_URL", "https://xstream.5paisa.com")
SCRIP_MASTER_BASE_URL = os.getenv("SCRIP_MASTER_BASE_URL", "https://Openapi.5paisa.com")

def _extract_xstream_headers(request: Request):
    upstream_headers = {"Content-Type": "application/json"}
    whitelist = [
        "authorization",
        "x-api-key",
        "x-client-code",
        "x-user-id",
        "x-user-password",
        "x-encryption-key",
        "x-app-source",
    ]
    for key in whitelist:
        value = request.headers.get(key)
        if value:
            upstream_headers[key] = value
    return upstream_headers

def _proxy_xstream_get(request: Request, path: str, params: dict):
    try:
        response = requests.get(
            f"{XSTREAM_BASE_URL}{path}",
            params=params,
            headers=_extract_xstream_headers(request),
            timeout=20,
        )
        return response.json()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Xstream upstream error: {exc}")
    except ValueError:
        raise HTTPException(status_code=502, detail="Xstream returned non-JSON response")

def _proxy_xstream_post(request: Request, path: str, payload: dict):
    try:
        response = requests.post(
            f"{XSTREAM_BASE_URL}{path}",
            json=payload,
            headers=_extract_xstream_headers(request),
            timeout=20,
        )
        return response.json()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Xstream upstream error: {exc}")
    except ValueError:
        raise HTTPException(status_code=502, detail="Xstream returned non-JSON response")

@app.get("/xstream/market-snapshot")
def xstream_market_snapshot(
    request: Request,
    exchange: str,
    exchangeType: str,
    scripCode: str,
):
    return _proxy_xstream_get(
        request,
        "/market-data/market-snapshot",
        {"exchange": exchange, "exchangeType": exchangeType, "scripCode": scripCode},
    )

@app.get("/xstream/historical-candles")
def xstream_historical_candles(
    request: Request,
    exchange: str,
    exchangeType: str,
    scripCode: str,
    interval: str,
    from_date: str = "",
    to_date: str = "",
):
    params = {
        "exchange": exchange,
        "exchangeType": exchangeType,
        "scripCode": scripCode,
        "interval": interval,
    }
    if from_date:
        params["from"] = from_date
    if to_date:
        params["to"] = to_date
    return _proxy_xstream_get(request, "/market-data/historical-candles", params)

@app.get("/xstream/order-book")
def xstream_order_book(request: Request):
    return _proxy_xstream_get(request, "/order-management/order-book", {})

@app.post("/xstream/place-order")
def xstream_place_order(request: Request, payload: dict):
    return _proxy_xstream_post(request, "/order-management/place-order", payload)

@app.get("/xstream/scrip-master")
def xstream_scrip_master(segment: str = "nse_eq"):
    cache_key = segment.lower().strip()
    now = time.time()
    cached = SCRIP_MASTER_CACHE.get(cache_key)
    # Keep a 6-hour in-memory cache to avoid repeated large downloads.
    if cached and (now - cached["fetched_at"]) < 21600:
        return {
            "segment": cache_key,
            "count": len(cached["rows"]),
            "cached": True,
            "data": cached["rows"],
        }

    try:
        response = requests.get(
            f"{SCRIP_MASTER_BASE_URL}/VendorsAPI/Service1.svc/ScripMaster/segment/{cache_key}",
            timeout=30,
            headers={"Content-Type": "application/json"},
        )
        response.raise_for_status()
        text = response.text
        reader = csv.DictReader(io.StringIO(text))
        rows = []
        for row in reader:
            # Keep response compact for frontend mapping use.
            rows.append(
                {
                    "scripCode": (row.get("Scripcode") or row.get("ScripCode") or "").strip(),
                    "symbol": (row.get("Name") or row.get("Symbol") or "").strip(),
                    "exchange": (row.get("Exch") or row.get("Exchange") or "").strip(),
                }
            )
        symbol_map = {}
        for row in rows:
            key = (row.get("symbol") or "").upper().replace(".NS", "").replace(".BO", "").strip()
            if key and row.get("scripCode") and key not in symbol_map:
                symbol_map[key] = row

        SCRIP_MASTER_CACHE[cache_key] = {
            "fetched_at": now,
            "rows": rows,
            "symbol_map": symbol_map,
        }
        return {"segment": cache_key, "count": len(rows), "cached": False, "data": rows}
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"ScripMaster upstream error: {exc}")

@app.get("/xstream/resolve-scrip")
def xstream_resolve_scrip(symbol: str, exchange: str = "N"):
    normalized = symbol.upper().replace(".NS", "").replace(".BO", "").strip()
    segments = ["nse_eq", "bse_eq"] if exchange.upper() not in {"N", "B"} else (["nse_eq"] if exchange.upper() == "N" else ["bse_eq"])

    for segment in segments:
        # Ensure segment is in cache (loads on miss).
        if segment not in SCRIP_MASTER_CACHE:
            xstream_scrip_master(segment=segment)
        cached = SCRIP_MASTER_CACHE.get(segment, {})
        symbol_map = cached.get("symbol_map", {})
        matched = symbol_map.get(normalized)
        if matched:
            return {"found": True, "segment": segment, "data": matched}

    return {"found": False, "symbol": symbol, "exchange": exchange.upper()}

@app.get("/xstream/live-price")
def xstream_live_price(
    request: Request,
    exchange: str,
    exchangeType: str,
    scripCode: str,
):
    auth = request.headers.get("authorization", "")
    access_token = auth.replace("Bearer ", "").strip() if auth.startswith("Bearer ") else ""
    if not access_token:
        raise HTTPException(status_code=400, detail="Missing access token. Provide Authorization: Bearer <token>.")

    user_id = request.headers.get("x-user-id", "")
    client_code = request.headers.get("x-client-code", "") or user_id
    app_source = request.headers.get("x-app-source", "")
    user_password = request.headers.get("x-user-password", "")
    encryption_key = request.headers.get("x-encryption-key", "")
    api_key = request.headers.get("x-api-key", "")
    app_name = os.getenv("XSTREAM_APP_NAME", "HIRENTEST")

    if not all([client_code, user_id, app_source, user_password, encryption_key, api_key]):
        raise HTTPException(status_code=400, detail="Missing required xstream headers (client/user/app/password/key/api-key).")

    cred = {
        "APP_NAME": app_name,
        "APP_SOURCE": app_source,
        "USER_ID": user_id,
        "PASSWORD": user_password,
        "USER_KEY": api_key,
        "ENCRYPTION_KEY": encryption_key,
    }

    def _extract_price(candidate):
        if candidate is None:
            return None
        if isinstance(candidate, list):
            for item in candidate:
                price = _extract_price(item)
                if price is not None:
                    return price
            return None
        if isinstance(candidate, dict):
            # Traverse common containers first.
            for key in ("Data", "data", "MarketDepthData", "Values"):
                if key in candidate:
                    price = _extract_price(candidate.get(key))
                    if price is not None:
                        return price
            # Then check common numeric keys.
            for key in ("LastRate", "LastTradedPrice", "LTP", "CurrentRate", "Close", "Price"):
                value = candidate.get(key)
                try:
                    number = float(value)
                    if number > 0:
                        return number
                except Exception:
                    pass
        return None

    try:
        client = FivePaisaClient(cred=cred)
        client.set_access_token(access_token, client_code)
        result = client.fetch_market_depth_by_scrip(
            Exchange=exchange,
            ExchangeType=exchangeType,
            ScripCode=str(scripCode),
        )
        current_price = _extract_price(result)

        # Fallback: market snapshot API sometimes returns data when depth is empty.
        if current_price is None:
            snapshot_req = [{"Exchange": exchange, "ExchangeType": exchangeType, "ScripCode": str(scripCode)}]
            snapshot = client.fetch_market_snapshot(snapshot_req)
            snap_price = _extract_price(snapshot)
            if snap_price is not None:
                return {
                    "exchange": exchange,
                    "exchangeType": exchangeType,
                    "scripCode": str(scripCode),
                    "currentPrice": snap_price,
                    "source": "market_snapshot",
                    "data": snapshot,
                }

        if current_price is None:
            raise HTTPException(
                status_code=502,
                detail="No live price returned by 5paisa. Most common causes: expired/invalid access token, IP whitelist restriction, or unavailable scrip quote.",
            )

        return {
            "exchange": exchange,
            "exchangeType": exchangeType,
            "scripCode": str(scripCode),
            "currentPrice": current_price,
            "source": "market_depth",
            "data": result,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"5paisa live-price error: {exc}")

@app.post("/xstream/oauth/access-token")
def xstream_oauth_access_token(request: Request, payload: dict):
    request_token = (payload.get("requestToken") or payload.get("request_token") or "").strip()
    if not request_token:
        raise HTTPException(status_code=400, detail="requestToken is required.")

    user_id = request.headers.get("x-user-id", "")
    client_code = request.headers.get("x-client-code", "") or user_id
    app_source = request.headers.get("x-app-source", "")
    user_password = request.headers.get("x-user-password", "")
    encryption_key = request.headers.get("x-encryption-key", "")
    api_key = request.headers.get("x-api-key", "")
    app_name = os.getenv("XSTREAM_APP_NAME", "HIRENTEST")

    if not all([client_code, user_id, app_source, user_password, encryption_key, api_key]):
        raise HTTPException(status_code=400, detail="Missing required xstream headers (client/user/app/password/key/api-key).")

    cred = {
        "APP_NAME": app_name,
        "APP_SOURCE": app_source,
        "USER_ID": user_id,
        "PASSWORD": user_password,
        "USER_KEY": api_key,
        "ENCRYPTION_KEY": encryption_key,
    }

    try:
        client = FivePaisaClient(cred=cred)
        client.get_oauth_session(request_token)
        access_token = client.get_access_token()
        if not access_token:
            raise HTTPException(status_code=502, detail="Unable to fetch access token from 5paisa.")
        return {"accessToken": access_token, "clientCode": client_code}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OAuth token exchange failed: {exc}")
