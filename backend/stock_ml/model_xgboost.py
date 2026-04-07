"""XGBoost classification model for up/down prediction."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, Tuple

import joblib
import pandas as pd
from sklearn.metrics import accuracy_score, precision_score, recall_score
from xgboost import XGBClassifier


class XGBoostPredictor:
    """Train/evaluate/save an XGBoost classifier."""

    def __init__(self, logger: logging.Logger, model_path: Path, params: Dict) -> None:
        self.logger = logger
        self.model_path = model_path
        self.params = params
        self.model = XGBClassifier(
            objective="binary:logistic",
            eval_metric="logloss",
            random_state=params.get("random_state", 42),
            n_estimators=params.get("n_estimators", 300),
            max_depth=params.get("max_depth", 5),
            learning_rate=params.get("learning_rate", 0.05),
            subsample=params.get("subsample", 0.9),
            colsample_bytree=params.get("colsample_bytree", 0.9),
        )

    def train(
        self, X_train: pd.DataFrame, y_train: pd.Series, X_test: pd.DataFrame, y_test: pd.Series
    ) -> Tuple[Dict[str, float], pd.Series]:
        """Train XGBoost and return metrics + predictions."""
        self.logger.info("Training XGBoost model...")
        self.model.fit(
            X_train,
            y_train,
            eval_set=[(X_test, y_test)],
            verbose=False,
        )

        preds = self.model.predict(X_test)
        metrics = {
            "accuracy": float(accuracy_score(y_test, preds)),
            "precision": float(precision_score(y_test, preds, zero_division=0)),
            "recall": float(recall_score(y_test, preds, zero_division=0)),
        }
        self.logger.info("XGBoost metrics: %s", metrics)
        return metrics, pd.Series(preds, index=y_test.index, name="pred_class")

    def save(self) -> None:
        """Persist model to disk."""
        joblib.dump(self.model, self.model_path)
        self.logger.info("Saved XGBoost model to %s", self.model_path)
