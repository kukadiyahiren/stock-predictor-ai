# 📈 Stock Predictor AI

**Stock Predictor AI** is a state-of-the-art, full-stack stock market prediction platform. It combines the power of Machine Learning (XGBoost & LSTM) with a modern React dashboard to provide intelligent trading insights, real-time price forecasting, and comprehensive backtesting reports.

---

## ✨ Key Features

- **🚀 Advanced ML Forecasting**: Utilizes XGBoost for trend classification and LSTM for time-series price prediction.
- **📊 Interactive Dashboard**: Visualize historical data and future trends with beautiful, interactive Recharts.
- **⏱️ Multiple Time Horizons**: Get predictions for Next 1 Hour, 2 Hours, Tomorrow, 1 Week, 1 Month, and 6 Months.
- **📈 Backtesting Engine**: Evaluate model performance against historical data with automated strategy returns vs. Buy & Hold comparisons.
- **📄 PDF Report Generation**: Generate professional-grade technical analysis reports including confidence bands and performance metrics.
- **🔌 Real-time Data**: Integrated with Yahoo Finance API for live market updates across global and Indian exchanges (NSE/BSE).
- **🛠️ Admin Management**: Add, update, and manage your watchlist of tracked stocks easily.

---

## 🛠️ Tech Stack

### Backend
- **Framework**: [FastAPI](https://fastapi.tiangolo.com/) (Python)
- **Database**: MySQL with [SQLAlchemy](https://www.sqlalchemy.org/) ORM
- **Migrations**: [Alembic](https://alembic.sqlalchemy.org/)
- **ML Libraries**: XGBoost, TensorFlow (LSTM), Scikit-learn, Pandas-TA
- **Data Source**: yfinance

### Frontend
- **Framework**: React.js (Vite)
- **Styling**: Modern Vanilla CSS with a focus on premium aesthetics
- **Visualization**: [Recharts](https://recharts.org/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **API Client**: Axios

---

## 📂 Project Structure

```text
.
├── backend/                # FastAPI Application
│   ├── stock_ml/           # ML Engine (Models, Features, Backtest)
│   ├── alembic/            # Database migrations
│   ├── main.py             # API Entry point
│   ├── models.py           # Database schemas
│   └── outputs/            # Generated PDF reports & ML artifacts
└── frontend/               # React Application
    ├── src/
    │   ├── Predictions.jsx # Main dashboard view
    │   ├── Admin.jsx       # Stock management
    │   ├── StockMarket.jsx # Market overview
    │   └── components/     # UI Components
    └── package.json
```

---

## 🚀 Getting Started

### Prerequisites
- Python 3.10+
- Node.js 18+
- MySQL Server

### 1. Backend Setup
1. Create a virtual environment:
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate  # Or `venv\Scripts\activate` on Windows
   ```
2. Install dependencies:
   ```bash
   pip install -r stock_ml/requirements.txt
   pip install fastapi uvicorn sqlalchemy mysql-connector-python alembic yfinance
   ```
3. Configure Database:
   Update `alembic.ini` and `database.py` with your MySQL credentials.
4. Run Migrations:
   ```bash
   alembic upgrade head
   ```
5. Start the server:
   ```bash
   uvicorn main:app --reload
   ```

### 2. Frontend Setup
1. Navigate to frontend:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start development server:
   ```bash
   npm run dev
   ```

---

## 🧪 Machine Learning Pipeline
The system automatically retrains models on a scheduled interval (default: 24h). You can also trigger manual training via the API:
- **XGBoost**: Focuses on "Up/Down" movement classification.
- **LSTM**: Captures long-term dependencies in price sequences.

---

## 📄 License
Distributed under the MIT License. See `LICENSE` for more information.

---
*Disclaimer: This tool is for educational and research purposes only. Stock market investments are subject to market risks. Always consult with a financial advisor before making investment decisions.*
