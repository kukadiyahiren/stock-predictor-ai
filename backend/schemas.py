from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional

class StockBase(BaseModel):
    symbol: str
    name: str
    logo_url: Optional[str] = None

class StockCreate(StockBase):
    pass

class StockUpdate(StockBase):
    pass

class Stock(StockBase):
    id: int

    class Config:
        from_attributes = True

class Prediction(BaseModel):
    horizon: str
    predicted_price: float
    trend: str
    confidence: float

class PredictionHistory(BaseModel):
    id: int
    stock_id: int
    date: datetime
    horizon: str
    predicted_price: float
    trend: str
    confidence: float

    class Config:
        from_attributes = True

class StockResponse(BaseModel):
    stock_id: int
    symbol: str
    name: str
    logo_url: Optional[str] = None
    current_price: float
    currency: str
    predictions: List[Prediction]
    data_source: str

class StockSuggestion(BaseModel):
    symbol: str
    name: str
    exchange: Optional[str] = None

class TimelinePoint(BaseModel):
    label: str
    actual: Optional[float] = None
    predicted: Optional[float] = None
    predicted_lower: Optional[float] = None
    predicted_upper: Optional[float] = None
