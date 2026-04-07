"""Data collection module using yfinance."""

from __future__ import annotations

from datetime import datetime, timedelta
import logging
from pathlib import Path

import pandas as pd
import yfinance as yf


class DataLoader:
    """Fetches and stores stock OHLCV data."""

    def __init__(self, data_dir: Path, logger: logging.Logger) -> None:
        self.data_dir = data_dir
        self.logger = logger

    @staticmethod
    def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
        """Flatten yfinance columns and standardize to lowercase OHLCV names."""
        out = df.copy()
        if isinstance(out.columns, pd.MultiIndex):
            # Prefer first level names if they look like OHLCV; otherwise fallback to last.
            first_level = [str(col[0]).lower() for col in out.columns]
            if {"open", "high", "low", "close", "volume"}.intersection(set(first_level)):
                out.columns = first_level
            else:
                out.columns = [str(col[-1]).lower() for col in out.columns]
        else:
            out.columns = [str(col).lower() for col in out.columns]
        return out

    def fetch_ohlcv(self, ticker: str, years: int = 5) -> pd.DataFrame:
        """Fetch daily OHLCV from Yahoo Finance for at least N years."""
        end_date = datetime.utcnow().date()
        start_date = end_date - timedelta(days=years * 365 + 10)
        self.logger.info("Fetching %s data from %s to %s", ticker, start_date, end_date)

        normalized = ticker.strip().upper().replace("BOM:", "").replace("NSE:", "")
        candidates = [ticker.strip().upper()]
        if normalized not in candidates:
            candidates.append(normalized)

        if normalized.isdigit():
            candidates.extend([f"{normalized}.BO", f"{normalized}.NS"])
        elif "." not in normalized and len(normalized) <= 10:
            candidates.extend([f"{normalized}.NS", f"{normalized}.BO"])

        # Preserve order and remove duplicates.
        seen = set()
        candidates = [c for c in candidates if not (c in seen or seen.add(c))]

        df = None
        used_ticker = None
        for symbol in candidates:
            attempt = yf.download(
                symbol,
                start=start_date.isoformat(),
                end=end_date.isoformat(),
                interval="1d",
                auto_adjust=False,
                progress=False,
            )
            if attempt is not None and not attempt.empty:
                df = attempt
                used_ticker = symbol
                break

        if df is None or df.empty:
            try:
                search_result = yf.Search(query=normalized, max_results=12, news_count=0)
                quotes = search_result.quotes or []
                quote_candidates = []
                for q in quotes:
                    q_symbol = (q.get("symbol") or "").strip().upper()
                    q_type = (q.get("quoteType") or "").upper().strip()
                    if not q_symbol:
                        continue
                    if q_type and q_type not in {"EQUITY", "ETF"}:
                        continue
                    quote_candidates.append(q_symbol)

                seen_q = set()
                quote_candidates = [q for q in quote_candidates if not (q in seen_q or seen_q.add(q))]
                self.logger.info(
                    "Primary symbol lookup failed for %s, trying search-based symbols: %s",
                    ticker,
                    quote_candidates[:6],
                )

                for symbol in quote_candidates:
                    attempt = yf.download(
                        symbol,
                        start=start_date.isoformat(),
                        end=end_date.isoformat(),
                        interval="1d",
                        auto_adjust=False,
                        progress=False,
                    )
                    if attempt is not None and not attempt.empty:
                        df = attempt
                        used_ticker = symbol
                        break
            except Exception:
                pass

        if df is None or df.empty:
            raise ValueError(
                f"No data found for ticker '{ticker}'. Tried: {', '.join(candidates)}"
            )

        if len(df) < 252 * years:
            self.logger.warning(
                "Downloaded %d rows, lower than expected for %d years.",
                len(df),
                years,
            )

        df = self._normalize_columns(df)
        df.index = pd.to_datetime(df.index)
        df = df.sort_index()

        if "close" not in df.columns:
            raise ValueError("Downloaded dataset does not include 'close' column.")

        csv_path = self.data_dir / f"{(used_ticker or ticker).replace('.', '_')}_ohlcv.csv"
        df.to_csv(csv_path)
        self.logger.info("Saved raw data for %s to %s", used_ticker or ticker, csv_path)
        return df
