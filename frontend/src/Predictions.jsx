import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { TrendingUp, TrendingDown, RefreshCcw, Info, History, Calendar, Image as ImageIcon } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { API_BASE_URL } from './apiConfig';

const Predictions = () => {
  const demoFlowData = [
    { label: 'D-6', actual: 98, predicted: null },
    { label: 'D-5', actual: 100, predicted: null },
    { label: 'D-4', actual: 102, predicted: null },
    { label: 'D-3', actual: 101, predicted: null },
    { label: 'D-2', actual: 104, predicted: null },
    { label: 'D-1', actual: 105, predicted: null },
    { label: 'Today', actual: 106, predicted: null },
    { label: 'F+1', actual: null, predicted: 107 },
    { label: 'F+2', actual: null, predicted: 108 },
    { label: 'F+3', actual: null, predicted: 109 },
    { label: 'F+4', actual: null, predicted: 108.5 },
    { label: 'F+5', actual: null, predicted: 110 },
    { label: 'F+6', actual: null, predicted: 111.2 },
    { label: 'F+7', actual: null, predicted: 112 },
  ];

  const processSteps = [
    { key: 'queued', label: 'Job created', threshold: 1 },
    { key: 'data', label: 'Fetch 5Y market data', threshold: 10 },
    { key: 'features', label: 'Build technical indicators', threshold: 25 },
    { key: 'xgb', label: 'Train XGBoost classifier', threshold: 40 },
    { key: 'lstm', label: 'Train LSTM sequence model', threshold: 65 },
    { key: 'backtest', label: 'Run strategy backtest', threshold: 85 },
    { key: 'done', label: 'Save results + plot', threshold: 100 },
  ];
  const DEMO_TICKER = import.meta.env.VITE_DEMO_TICKER || 'TRIDENT.BO';
  const BUY_THRESHOLD = Number(import.meta.env.VITE_BUY_THRESHOLD ?? 1.0);
  const SELL_THRESHOLD = Number(import.meta.env.VITE_SELL_THRESHOLD ?? -1.0);
  const [stocks, setStocks] = useState([]);
  const [selectedStock, setSelectedStock] = useState(null);
  const [predictionData, setPredictionData] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [timelineData, setTimelineData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mlLoading, setMlLoading] = useState(false);
  const [mlError, setMlError] = useState('');
  const [mlJob, setMlJob] = useState(null);
  const [mlJobId, setMlJobId] = useState('');
  const [mlPredict, setMlPredict] = useState(null);
  const [mlBacktest, setMlBacktest] = useState(null);
  const [mlPlotUrl, setMlPlotUrl] = useState('');
  const [mlFlowLogs, setMlFlowLogs] = useState([]);
  const [experiments, setExperiments] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [showLogic, setShowLogic] = useState(false);
  const [showProcessFlow, setShowProcessFlow] = useState(false);

  const getActionStrength = () => {
    const acc = mlPredict?.xgboost_metrics?.accuracy ?? 0;
    const precision = mlPredict?.xgboost_metrics?.precision ?? 0;
    const rmse = mlPredict?.lstm_metrics?.rmse ?? 999;
    const alpha = mlBacktest?.backtest?.alpha_pct ?? -999;

    if (acc >= 0.62 && precision >= 0.58 && alpha >= 5 && rmse <= 3) {
      return { label: 'Strong', color: 'var(--success)' };
    }
    if (acc >= 0.55 && precision >= 0.52 && alpha >= 0) {
      return { label: 'Moderate', color: 'var(--primary)' };
    }
    return { label: 'Weak', color: 'var(--danger)' };
  };

  const getHorizonPrediction = (horizonName) => {
    if (!predictionData?.predictions?.length) return null;
    return predictionData.predictions.find((p) => p.horizon === horizonName) || null;
  };

  const getNextDayAction = () => {
    const currentPrice = Number(predictionData?.current_price);
    const tomorrowPrice = Number(getHorizonPrediction('Tomorrow')?.predicted_price);
    if (!currentPrice || !tomorrowPrice) {
      return { action: 'HOLD', changePct: 0 };
    }
    const changePct = ((tomorrowPrice - currentPrice) / currentPrice) * 100;
    if (changePct >= BUY_THRESHOLD) return { action: 'BUY', changePct };
    if (changePct <= SELL_THRESHOLD) return { action: 'SELL', changePct };
    return { action: 'HOLD', changePct };
  };

  useEffect(() => {
    fetchStocks();
  }, []);

  const fetchStocks = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/stocks/`);
      setStocks(response.data);
      if (response.data.length > 0) {
        setSelectedStock(response.data[0]);
      }
    } catch (err) {
      console.error('Error fetching stocks:', err);
    }
  };

  useEffect(() => {
    if (selectedStock) {
      fetchPredictions(selectedStock.symbol);
      fetchHistory(selectedStock.id);
      fetchTimeline(selectedStock.symbol);
    }
  }, [selectedStock]);

  const runMlTrainingForSymbol = async (targetSymbol) => {
    if (!targetSymbol) return;
    setMlLoading(true);
    setMlError('');
    setMlJob(null);
    setMlJobId('');
    setMlFlowLogs([]);
    try {
      setMlFlowLogs((prev) => [...prev, `1) Start async training for ${targetSymbol}`]);
      const startRes = await axios.post(`${API_BASE_URL}/ml/train/async`, { ticker: targetSymbol });
      const jobId = startRes.data.job_id;
      const resolvedTicker = startRes.data.resolved_ticker || targetSymbol;
      if (!jobId) throw new Error('No job id returned');
      setMlJobId(jobId);
      setMlFlowLogs((prev) => [...prev, `2) job_id received: ${jobId}`]);
      if (resolvedTicker !== targetSymbol) {
        setMlFlowLogs((prev) => [...prev, `2.1) Resolved symbol for Yahoo: ${resolvedTicker}`]);
      }

      let attempts = 0;
      while (attempts < 240) {
        const statusRes = await axios.get(`${API_BASE_URL}/ml/train/status/${jobId}`);
        const job = statusRes.data;
        setMlJob(job);
        setMlFlowLogs((prev) => [
          ...prev.slice(-8),
          `3) Status: ${job.status} | Stage: ${job.stage} | Progress: ${job.progress}%`
        ]);

        if (job.status === 'completed') {
          setMlFlowLogs((prev) => [...prev, '4) Training completed, fetching prediction + backtest']);
          const [predictRes, backtestRes] = await Promise.all([
            axios.get(`${API_BASE_URL}/ml/predict/${resolvedTicker}`),
            axios.get(`${API_BASE_URL}/ml/backtest/${resolvedTicker}`)
          ]);
          setMlPredict(predictRes.data);
          setMlBacktest(backtestRes.data);
          setMlPlotUrl(`${API_BASE_URL}/ml/plot/${resolvedTicker}?t=${Date.now()}`);
          setMlFlowLogs((prev) => [...prev, '5) Results loaded in frontend']);
          return;
        }

        if (job.status === 'failed') {
          throw new Error(job.error || 'ML training failed');
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
        attempts += 1;
      }

      throw new Error('Training timed out. Please try again.');
    } catch (err) {
      setMlError(err.response?.data?.detail || err.message || 'Failed to train ML models');
    } finally {
      setMlLoading(false);
    }
  };
  const runMlTraining = async () => {
    if (!selectedStock?.symbol) return;
    await runMlTrainingForSymbol(selectedStock.symbol);
  };

  const fetchPredictions = async (symbol) => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/predictions/${symbol}`);
      setPredictionData(response.data);
    } catch (err) {
      console.error('Error fetching predictions:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async (stockId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/history/${stockId}`);
      const formattedData = response.data.map(item => ({
        ...item,
        displayDate: new Date(item.date).toLocaleDateString(),
        displayTime: new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }));
      setHistoryData(formattedData);
    } catch (err) {
      console.error('Error fetching history:', err);
    }
  };

  const fetchTimeline = async (symbol) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/timeline/${symbol}`, {
        params: { past_days: 7, future_days: 7 }
      });
      setTimelineData(response.data || []);
    } catch (err) {
      console.error('Error fetching timeline:', err);
      setTimelineData([]);
    }
  };

  const loadExperiments = async (ticker) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/ml/experiments`, { params: { ticker, limit: 5 } });
      setExperiments(response.data || []);
    } catch (err) {
      setExperiments([]);
    }
  };

  const loadAlerts = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/ml/alerts`, { params: { limit: 5 } });
      setAlerts(response.data || []);
    } catch (err) {
      setAlerts([]);
    }
  };

  const runFullDemo = async () => {
    const demoStock = stocks.find((s) => s.symbol?.toUpperCase() === DEMO_TICKER.toUpperCase()) || stocks[0];
    if (!demoStock) {
      setMlError('No stocks available. Add stock from Admin first.');
      return;
    }
    setSelectedStock(demoStock);
    setShowLogic(true);
    await runMlTrainingForSymbol(demoStock.symbol);
    await loadExperiments(demoStock.symbol);
    await loadAlerts();
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const firstValid = payload.find((entry) => typeof entry.value === 'number');
      const value = firstValid?.value;
      const seriesName = firstValid?.name || 'Value';
      return (
        <div style={{ background: '#1e293b', border: '1px solid #334155', padding: '0.75rem', borderRadius: '0.5rem' }}>
          <p style={{ color: '#94a3b8', fontSize: '0.75rem', marginBottom: '0.25rem' }}>{label}</p>
          {value !== undefined ? (
            <p style={{ color: '#6366f1', fontWeight: '700' }}>
              {seriesName}: {predictionData?.currency || ''}{value.toFixed(2)}
            </p>
          ) : (
            <p style={{ color: '#94a3b8', fontWeight: '700' }}>No value</p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="container" style={{ paddingBottom: '4rem' }}>
      <header style={{ marginBottom: '3rem', borderBottom: '1px solid var(--border)', paddingBottom: '2rem' }}>
        <h1 style={{ marginBottom: '0.5rem' }}>AI Forecast Engine</h1>
        <p style={{ color: 'var(--text-muted)' }}>Historical Performance Tracking & Future Insights</p>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button onClick={runMlTraining} disabled={mlLoading || !selectedStock} style={{ marginBottom: 0 }}>
            {mlLoading ? 'Running Async Training...' : 'Run Async Training Demo'}
          </button>
          <button onClick={runFullDemo} disabled={mlLoading || stocks.length === 0} style={{ marginBottom: 0 }}>
            {mlLoading ? 'Running...' : 'Run Full Demo'}
          </button>
          <button
            type="button"
            onClick={() => window.open(`${API_BASE_URL}/ml/report/${mlPredict?.ticker || selectedStock?.symbol}`, '_blank')}
            disabled={!selectedStock}
            style={{ marginBottom: 0 }}
          >
            Download PDF Report
          </button>
          <button
            type="button"
            onClick={() => loadExperiments(mlPredict?.ticker || selectedStock?.symbol)}
            disabled={!selectedStock}
            style={{ marginBottom: 0 }}
          >
            Load Recent Experiments
          </button>
          <button type="button" onClick={loadAlerts} style={{ marginBottom: 0 }}>
            Load Alerts
          </button>
          {mlJob && mlLoading && (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              {mlJob.stage} ({mlJob.progress}%)
            </span>
          )}
          {mlError && <span style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{mlError}</span>}
        </div>
        {(mlLoading || mlJob) && (
          <p style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Current async job:{' '}
            <strong>{mlJob?.ticker || selectedStock?.symbol || '-'}</strong>
            {mlJob?.resolved_ticker ? ` (resolved: ${mlJob.resolved_ticker})` : ''}
            {mlJobId ? ` | job_id: ${mlJobId}` : ''}
          </p>
        )}
      </header>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', overflowX: 'auto', paddingBottom: '1rem' }}>
        {stocks.map((stock) => (
          <button
            key={stock.id}
            onClick={() => setSelectedStock(stock)}
            style={{
              background: selectedStock?.id === stock.id ? 'var(--primary)' : 'var(--card-bg)',
              color: selectedStock?.id === stock.id ? 'white' : 'var(--text)',
              border: `1px solid ${selectedStock?.id === stock.id ? 'var(--primary)' : 'var(--border)'}`,
              whiteSpace: 'nowrap',
              padding: '0.5rem 1.5rem',
              borderRadius: '2rem',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            {stock.logo_url && (
              <img src={stock.logo_url} alt="" style={{ width: '16px', height: '16px', borderRadius: '2px', objectFit: 'contain' }} />
            )}
            {stock.symbol}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '6rem' }}>
          <RefreshCcw className="animate-spin" size={48} color="var(--primary)" />
          <p style={{ marginTop: '1.5rem', color: 'var(--text-muted)' }}>Processing market signals...</p>
        </div>
      )}

      {predictionData && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          <div className="card" style={{ background: 'linear-gradient(145deg, var(--card-bg), #1e293b)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
              <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                <div style={{ 
                  width: '64px', 
                  height: '64px', 
                  background: 'rgba(255,255,255,0.05)', 
                  borderRadius: '1rem', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  overflow: 'hidden',
                  border: '1px solid var(--border)'
                }}>
                  {selectedStock?.logo_url ? (
                    <img src={selectedStock.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <ImageIcon size={28} color="var(--text-muted)" />
                  )}
                </div>
                <div>
                  <h2 style={{ fontSize: '2rem' }}>{predictionData.name}</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <code style={{ fontSize: '1.25rem', color: 'var(--primary)', fontWeight: '700' }}>{predictionData.symbol}</code>
                    <span style={{ fontSize: '0.7rem', color: 'var(--success)', background: 'rgba(34,197,94,0.1)', padding: '0.2rem 0.6rem', borderRadius: '1rem' }}>
                      {predictionData.data_source}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase' }}>Market Price</p>
                <p style={{ fontSize: '2.5rem', fontWeight: '800' }}>{predictionData.currency}{predictionData.current_price}</p>
                {(() => {
                  const decision = getNextDayAction();
                  const actionColor = decision.action === 'BUY' ? 'var(--success)' : decision.action === 'SELL' ? 'var(--danger)' : 'var(--text-muted)';
                  const ActionIcon = decision.action === 'BUY' ? TrendingUp : decision.action === 'SELL' ? TrendingDown : Info;
                  return (
                    <div style={{ marginTop: '0.65rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: actionColor, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '999px', padding: '0.25rem 0.65rem' }}>
                      <ActionIcon size={14} />
                      <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>Suggested Action: {decision.action}</span>
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="prediction-grid">
              {predictionData.predictions.map((pred, i) => (
                <div key={i} className="prediction-card">
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: '700' }}>{pred.horizon}</p>
                  <p className="price" style={{ color: pred.trend === 'up' ? 'var(--success)' : 'var(--danger)' }}>
                    {predictionData.currency}{pred.predicted_price}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    {pred.trend === 'up' ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                    <span style={{ fontWeight: '600' }}>{pred.trend === 'up' ? 'Bullish' : 'Bearish'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
              <h3 style={{ margin: 0 }}>ML Process Flow (Demo Friendly)</h3>
              <button type="button" onClick={() => setShowProcessFlow((v) => !v)} style={{ marginBottom: 0 }}>
                {showProcessFlow ? 'Hide' : 'Show'}
              </button>
            </div>
            {showProcessFlow && (
              <>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.75rem', marginBottom: '1rem' }}>
                  Python ML Model (XGBoost + LSTM) &rarr; FastAPI endpoints &rarr; React dashboard output.
                </p>
                <div style={{ width: '100%', height: '8px', background: 'rgba(148,163,184,0.2)', borderRadius: '999px', marginBottom: '1rem' }}>
                  <div
                    style={{
                      width: `${Math.max(0, Math.min(100, mlJob?.progress || 0))}%`,
                      height: '8px',
                      borderRadius: '999px',
                      background: 'var(--primary)',
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.5rem 1rem' }}>
                  {processSteps.map((step) => {
                    const progress = mlJob?.progress || 0;
                    const done = progress >= step.threshold;
                    return (
                      <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '999px', background: done ? 'var(--success)' : 'var(--border)', display: 'inline-block' }} />
                        <span style={{ color: done ? 'var(--text)' : 'var(--text-muted)', fontSize: '0.82rem' }}>{step.label}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {mlJob?.stage && showProcessFlow && (
              <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Current stage: <strong>{mlJob.stage}</strong> ({mlJob.progress}%)
              </p>
            )}
            {mlJobId && showProcessFlow && (
              <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                job_id: <code>{mlJobId}</code>
              </p>
            )}
            {mlFlowLogs.length > 0 && showProcessFlow && (
              <div style={{ marginTop: '1rem', background: 'rgba(15,23,42,0.45)', border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.75rem', maxHeight: '180px', overflowY: 'auto' }}>
                {mlFlowLogs.map((log, idx) => (
                  <p key={idx} style={{ margin: '0 0 0.4rem 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {log}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
              <h3 style={{ margin: 0 }}>How Prediction Is Computed</h3>
              <button type="button" onClick={() => setShowLogic((v) => !v)} style={{ marginBottom: 0 }}>
                {showLogic ? 'Hide Details' : 'Show Details'}
              </button>
            </div>
            <p style={{ marginTop: '0.75rem', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
              Data source: Yahoo Finance (daily OHLCV/Close), then rule-based forecast + ML models.
            </p>
            {showLogic && (
              <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.75rem' }}>
                <div style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.75rem' }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: '0.86rem' }}>1) Live forecast card logic (non-ML)</p>
                  <p style={{ margin: '0.45rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Uses recent close-price returns to compute momentum (5d/20d), drift (mean return), and volatility.
                    A blended daily trend is projected across horizons (1h, 2h, tomorrow, 1w, 1m, 6m) with a risk penalty.
                  </p>
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.75rem' }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: '0.86rem' }}>2) ML features</p>
                  <p style={{ margin: '0.45rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    RSI, MACD, MA20/50/200, Bollinger Bands, returns, and rolling volatility are created from OHLCV.
                    Time split is 80/20 (train/test).
                  </p>
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.75rem' }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: '0.86rem' }}>3) ML models</p>
                  <p style={{ margin: '0.45rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    XGBoost predicts direction (UP/DOWN). LSTM predicts next close price.
                    Metrics shown: accuracy/precision/recall (XGBoost), MAE/RMSE (LSTM).
                  </p>
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.75rem' }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: '0.86rem' }}>4) Backtest + confidence bands</p>
                  <p style={{ margin: '0.45rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Strategy: buy when model says UP, else stay out. Compared against buy-and-hold.
                    Forecast chart also shows upper/lower confidence lines based on volatility.
                  </p>
                </div>
              </div>
            )}
          </div>

          {(mlLoading || mlPredict || mlBacktest) && (
            <div className="card">
              <h3 style={{ marginBottom: '1rem' }}>ML Model Results</h3>
              {!mlLoading && predictionData && (
                <div style={{ marginBottom: '1rem', border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.75rem' }}>
                  {(() => {
                    const decision = getNextDayAction();
                    const actionColor = decision.action === 'BUY' ? 'var(--success)' : decision.action === 'SELL' ? 'var(--danger)' : 'var(--text-muted)';
                    return (
                      <>
                        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>Quick Prediction Summary</p>
                        <p style={{ margin: '0.45rem 0 0', fontSize: '0.95rem' }}>
                          Current Market Price: <strong>{predictionData.currency}{predictionData.current_price}</strong>
                        </p>
                        <p style={{ margin: '0.3rem 0 0', fontSize: '0.95rem' }}>
                          Next 1 Hour Prediction Price:{' '}
                          <strong>
                            {predictionData.currency}
                            {getHorizonPrediction('Next 1 Hour')?.predicted_price ?? '-'}
                          </strong>
                        </p>
                        <p style={{ margin: '0.3rem 0 0', fontSize: '0.95rem' }}>
                          Next Day (Tomorrow) Prediction Price:{' '}
                          <strong>
                            {predictionData.currency}
                            {getHorizonPrediction('Tomorrow')?.predicted_price ?? '-'}
                          </strong>
                        </p>
                        <p style={{ margin: '0.45rem 0 0', fontSize: '0.98rem', fontWeight: 700, color: actionColor }}>
                          Suggested Action: {decision.action}
                        </p>
                        <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          Expected move (current → tomorrow): {decision.changePct.toFixed(2)}%
                        </p>
                        <p style={{ margin: '0.15rem 0 0', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          Rule: BUY if ≥ {BUY_THRESHOLD}% | SELL if ≤ {SELL_THRESHOLD}%
                        </p>
                      </>
                    );
                  })()}
                </div>
              )}
              {mlLoading && !mlPredict && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                  {[1, 2, 3].map((item) => (
                    <div key={item} style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.75rem' }}>
                      <div style={{ height: '10px', width: '50%', background: 'rgba(148,163,184,0.25)', borderRadius: '999px', marginBottom: '0.75rem' }} />
                      <div style={{ height: '20px', width: '35%', background: 'rgba(148,163,184,0.2)', borderRadius: '8px', marginBottom: '0.5rem' }} />
                      <div style={{ height: '8px', width: '70%', background: 'rgba(148,163,184,0.18)', borderRadius: '999px' }} />
                    </div>
                  ))}
                </div>
              )}
              {(() => {
                const strength = getActionStrength();
                return (
                  <div style={{ marginBottom: '1rem', border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.75rem', background: 'rgba(255,255,255,0.02)' }}>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Suggested action strength</p>
                    <p style={{ margin: '0.35rem 0 0', fontSize: '1rem', fontWeight: 700, color: strength.color }}>
                      {strength.label}
                    </p>
                    <p style={{ margin: '0.45rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Not investment advice. Use this output as support only, with risk controls and independent validation.
                    </p>
                  </div>
                );
              })()}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem' }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.75rem' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>XGBoost Accuracy</p>
                  <p style={{ fontSize: '1.3rem', fontWeight: 700 }}>{mlPredict?.xgboost_metrics?.accuracy?.toFixed?.(4) ?? '-'}</p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    P: {mlPredict?.xgboost_metrics?.precision?.toFixed?.(4) ?? '-'} | R: {mlPredict?.xgboost_metrics?.recall?.toFixed?.(4) ?? '-'}
                  </p>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.75rem' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>LSTM Next Price</p>
                  <p style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                    {predictionData?.currency || ''}{mlPredict?.latest_prediction?.lstm_pred_close ?? '-'}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Signal: <strong>{mlPredict?.latest_prediction?.signal ?? '-'}</strong>
                  </p>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.75rem' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Backtest (Strategy vs Hold)</p>
                  <p style={{ fontSize: '1.3rem', fontWeight: 700 }}>{mlBacktest?.backtest?.strategy_total_return_pct?.toFixed?.(2) ?? '-'}%</p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Hold: {mlBacktest?.backtest?.buy_hold_total_return_pct?.toFixed?.(2) ?? '-'}% | Alpha: {mlBacktest?.backtest?.alpha_pct?.toFixed?.(2) ?? '-'}%
                  </p>
                </div>
              </div>
              {mlPlotUrl && (
                <div style={{ marginTop: '1rem' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                    LSTM Predicted vs Actual Plot
                  </p>
                  <img
                    src={mlPlotUrl}
                    alt="LSTM predicted vs actual"
                    style={{ width: '100%', borderRadius: '0.75rem', border: '1px solid var(--border)' }}
                  />
                </div>
              )}
              {experiments.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Recent model versions / experiments</p>
                  <div style={{ display: 'grid', gap: '0.4rem' }}>
                    {experiments.map((exp) => (
                      <div key={exp.run_id} style={{ fontSize: '0.78rem', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.5rem' }}>
                        {exp.model_version} | {exp.ticker} | Acc {exp.xgboost_metrics?.accuracy?.toFixed?.(4) ?? '-'} | RMSE {exp.lstm_metrics?.rmse?.toFixed?.(4) ?? '-'}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {alerts.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Recent retraining alerts</p>
                  <div style={{ display: 'grid', gap: '0.4rem' }}>
                    {alerts.map((a, idx) => (
                      <div key={`${a.timestamp}-${idx}`} style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>
                        [{new Date(a.timestamp).toLocaleString()}] {a.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '2rem' }}>
            <div className="card">
              <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <History size={20} color="var(--primary)" /> Last 7 Days + Next 7 Days
              </h3>
              <div style={{ width: '100%', height: '300px' }}>
                {timelineData.length > 1 ? (
                  <ResponsiveContainer>
                    <LineChart data={timelineData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis dataKey="label" stroke="#94a3b8" fontSize={10} tickMargin={10} />
                      <YAxis stroke="#94a3b8" fontSize={10} domain={['auto', 'auto']} />
                      <Tooltip content={<CustomTooltip />} />
                      <Line type="monotone" dataKey="actual" name="Last 7 Days" stroke="#10b981" strokeWidth={2.5} dot={{ r: 2 }} connectNulls={false} />
                      <Line type="monotone" dataKey="predicted" name="Next 7 Days" stroke="#6366f1" strokeWidth={3} dot={{ r: 2 }} connectNulls={false} />
                      <Line type="monotone" dataKey="predicted_lower" name="Confidence Lower" stroke="#94a3b8" strokeWidth={1.2} dot={false} strokeDasharray="5 4" connectNulls={false} />
                      <Line type="monotone" dataKey="predicted_upper" name="Confidence Upper" stroke="#94a3b8" strokeWidth={1.2} dot={false} strokeDasharray="5 4" connectNulls={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer>
                    <LineChart data={demoFlowData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis dataKey="label" stroke="#94a3b8" fontSize={10} tickMargin={10} />
                      <YAxis stroke="#94a3b8" fontSize={10} domain={['auto', 'auto']} />
                      <Tooltip content={<CustomTooltip />} />
                      <Line type="monotone" dataKey="actual" name="Example Last 7 Days" stroke="#10b981" strokeWidth={2.5} dot={{ r: 2 }} connectNulls={false} />
                      <Line type="monotone" dataKey="predicted" name="Example Next 7 Days" stroke="#6366f1" strokeWidth={3} dot={{ r: 2 }} connectNulls={false} />
                      <Line type="monotone" dataKey="predicted_lower" name="Example Lower" stroke="#94a3b8" strokeWidth={1.2} dot={false} strokeDasharray="5 4" connectNulls={false} />
                      <Line type="monotone" dataKey="predicted_upper" name="Example Upper" stroke="#94a3b8" strokeWidth={1.2} dot={false} strokeDasharray="5 4" connectNulls={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
              {timelineData.length <= 1 && (
                <p style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  Showing sample graph for demo. Live graph appears after stock data is available.
                </p>
              )}
            </div>

            <div className="card">
              <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Calendar size={20} color="var(--primary)" /> Prediction Log
              </h3>
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      <th style={{ padding: '0.5rem 0' }}>Date</th>
                      <th>Output</th>
                      <th style={{ textAlign: 'right' }}>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyData.slice().reverse().map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(51, 65, 85, 0.5)', fontSize: '0.875rem' }}>
                        <td style={{ padding: '0.75rem 0' }}>
                          <span style={{ display: 'block' }}>{row.displayDate}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{row.displayTime}</span>
                        </td>
                        <td>
                          <span style={{ color: row.trend === 'up' ? 'var(--success)' : 'var(--danger)', fontSize: '0.75rem', fontWeight: '700' }}>
                            {row.trend.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: '700' }}>
                          {predictionData.currency}{row.predicted_price.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {historyData.length === 0 && (
                   <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No logs yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Predictions;
