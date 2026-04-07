"""LSTM model for next close-price prediction."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, Tuple

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras.callbacks import EarlyStopping
from tensorflow.keras import Input
from tensorflow.keras.layers import LSTM, Dense, Dropout
from tensorflow.keras.models import Sequential, load_model
from tensorflow.keras.optimizers import Adam


class LSTMPredictor:
    """Build/train/evaluate LSTM and persist artifacts."""

    def __init__(
        self,
        logger: logging.Logger,
        model_path: Path,
        scaler_path: Path,
        plot_path: Path,
        sequence_length: int = 60,
        lstm_units: int = 64,
        dropout: float = 0.2,
        learning_rate: float = 0.001,
    ) -> None:
        self.logger = logger
        self.model_path = model_path
        self.scaler_path = scaler_path
        self.plot_path = plot_path
        self.sequence_length = sequence_length
        self.lstm_units = lstm_units
        self.dropout = dropout
        self.learning_rate = learning_rate
        self.scaler = MinMaxScaler(feature_range=(0, 1))
        self.model = None

    def _build_network(self, n_features: int) -> Sequential:
        model = Sequential(
            [
                Input(shape=(self.sequence_length, n_features)),
                LSTM(self.lstm_units, return_sequences=True),
                Dropout(self.dropout),
                LSTM(self.lstm_units // 2, return_sequences=False),
                Dropout(self.dropout),
                Dense(32, activation="relu"),
                Dense(1),
            ]
        )
        model.compile(optimizer=Adam(learning_rate=self.learning_rate), loss="mse")
        return model

    def _create_sequences(self, values: np.ndarray, y_values: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        X_seq, y_seq = [], []
        for i in range(self.sequence_length, len(values)):
            X_seq.append(values[i - self.sequence_length : i, :])
            y_seq.append(y_values[i])
        return np.array(X_seq), np.array(y_seq)

    def train(
        self,
        X_train: pd.DataFrame,
        y_train: pd.Series,
        X_test: pd.DataFrame,
        y_test: pd.Series,
        epochs: int = 20,
        batch_size: int = 32,
    ) -> Tuple[Dict[str, float], pd.Series]:
        """Train LSTM, evaluate and return metrics + predictions."""
        self.logger.info("Training LSTM model...")

        X_train_scaled = self.scaler.fit_transform(X_train.values)
        X_test_scaled = self.scaler.transform(X_test.values)

        # Fit a y-scaler based on train target only for stable inverse operations.
        y_min = float(y_train.min())
        y_max = float(y_train.max())
        y_den = (y_max - y_min) if (y_max - y_min) != 0 else 1.0
        y_train_scaled = ((y_train.values - y_min) / y_den).reshape(-1, 1)
        y_test_scaled = ((y_test.values - y_min) / y_den).reshape(-1, 1)

        X_train_seq, y_train_seq = self._create_sequences(X_train_scaled, y_train_scaled)
        X_test_seq, y_test_seq = self._create_sequences(X_test_scaled, y_test_scaled)

        if len(X_train_seq) == 0 or len(X_test_seq) == 0:
            raise ValueError(
                f"Not enough data for LSTM with sequence_length={self.sequence_length}. "
                "Use more data or reduce sequence length."
            )

        self.model = self._build_network(n_features=X_train_seq.shape[2])
        callbacks = [EarlyStopping(monitor="val_loss", patience=5, restore_best_weights=True)]
        self.model.fit(
            X_train_seq,
            y_train_seq,
            validation_data=(X_test_seq, y_test_seq),
            epochs=epochs,
            batch_size=batch_size,
            verbose=1,
            callbacks=callbacks,
        )

        pred_scaled = self.model.predict(X_test_seq, verbose=0).reshape(-1)
        pred_actual = (pred_scaled * y_den) + y_min
        y_actual = (y_test_seq.reshape(-1) * y_den) + y_min

        mae = float(mean_absolute_error(y_actual, pred_actual))
        rmse = float(np.sqrt(mean_squared_error(y_actual, pred_actual)))
        metrics = {"mae": mae, "rmse": rmse}
        self.logger.info("LSTM metrics: %s", metrics)

        pred_index = y_test.index[self.sequence_length :]
        preds_series = pd.Series(pred_actual, index=pred_index, name="lstm_pred_close")
        self._plot_predictions(y_actual, pred_actual)
        return metrics, preds_series

    def _plot_predictions(self, y_actual: np.ndarray, y_pred: np.ndarray) -> None:
        plt.figure(figsize=(12, 6))
        plt.plot(y_actual, label="Actual Close")
        plt.plot(y_pred, label="Predicted Close")
        plt.title("LSTM Predicted vs Actual Prices")
        plt.xlabel("Test Samples")
        plt.ylabel("Price")
        plt.legend()
        plt.tight_layout()
        plt.savefig(self.plot_path)
        plt.close()
        self.logger.info("Saved LSTM plot to %s", self.plot_path)

    def save(self) -> None:
        """Persist model and scaler metadata."""
        if self.model is None:
            raise RuntimeError("Model has not been trained yet.")
        self.model.save(self.model_path)

        # Persist scaler using numpy for zero extra dependency.
        np.savez(
            self.scaler_path,
            min_=self.scaler.min_,
            scale_=self.scaler.scale_,
            data_min_=self.scaler.data_min_,
            data_max_=self.scaler.data_max_,
            data_range_=self.scaler.data_range_,
            n_features_in_=self.scaler.n_features_in_,
        )
        self.logger.info("Saved LSTM model to %s", self.model_path)
        self.logger.info("Saved LSTM scaler to %s", self.scaler_path)

    def load(self) -> None:
        """Load a previously trained model."""
        self.model = load_model(self.model_path)
