"""Configuration for the stock ML pipeline."""

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class AppConfig:
    """Runtime configuration used across modules."""

    lookback_years: int = 5
    train_split: float = 0.8
    sequence_length: int = 60
    random_state: int = 42

    # XGBoost params
    xgb_n_estimators: int = 300
    xgb_max_depth: int = 5
    xgb_learning_rate: float = 0.05
    xgb_subsample: float = 0.9
    xgb_colsample_bytree: float = 0.9

    # LSTM params
    lstm_epochs: int = 20
    lstm_batch_size: int = 32
    lstm_units: int = 64
    lstm_dropout: float = 0.2
    lstm_learning_rate: float = 0.001

    # Paths
    base_dir: Path = field(default_factory=lambda: Path(__file__).resolve().parent)
    artifacts_dir: Path = field(init=False)
    data_dir: Path = field(init=False)
    plots_dir: Path = field(init=False)
    predictions_dir: Path = field(init=False)
    logs_dir: Path = field(init=False)

    def __post_init__(self) -> None:
        self.artifacts_dir = self.base_dir / "artifacts"
        self.data_dir = self.base_dir / "data"
        self.plots_dir = self.artifacts_dir / "plots"
        self.predictions_dir = self.artifacts_dir / "predictions"
        self.logs_dir = self.artifacts_dir / "logs"

        for path in (
            self.artifacts_dir,
            self.data_dir,
            self.plots_dir,
            self.predictions_dir,
            self.logs_dir,
        ):
            path.mkdir(parents=True, exist_ok=True)
