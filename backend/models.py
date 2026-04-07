from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.sql import func
from database import Base

class Stock(Base):
    __tablename__ = "stocks"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(50), unique=True, index=True)
    name = Column(String(255), index=True)
    logo_url = Column(String(500), nullable=True)

class PredictionRecord(Base):
    __tablename__ = "prediction_records"

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"))
    date = Column(DateTime(timezone=True), server_default=func.now())
    horizon = Column(String(50)) # e.g. "1 Week"
    predicted_price = Column(Float)
    confidence = Column(Float)
    trend = Column(String(10)) # "up" or "down"
