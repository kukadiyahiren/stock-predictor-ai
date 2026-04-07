import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { BarChart3, Bot, Image as ImageIcon, MonitorSmartphone, Wrench } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { API_BASE_URL } from './apiConfig';

const YahooStock = () => {
  const [query, setQuery] = useState('');
  const [stocks, setStocks] = useState([]);
  const [selectedStock, setSelectedStock] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [predictionData, setPredictionData] = useState(null);
  const [timelineData, setTimelineData] = useState([]);

  const getTodayChange = () => {
    if (!predictionData?.current_price || !Array.isArray(timelineData) || timelineData.length < 2) {
      return null;
    }
    const actualPoints = timelineData.filter((p) => p.actual !== null && p.actual !== undefined);
    if (actualPoints.length < 2) return null;
    const today = Number(actualPoints[actualPoints.length - 1].actual);
    const prev = Number(actualPoints[actualPoints.length - 2].actual);
    if (!Number.isFinite(today) || !Number.isFinite(prev) || prev === 0) return null;
    const change = today - prev;
    const changePct = (change / prev) * 100;
    return { change, changePct };
  };

  const loadStockData = async (symbolArg) => {
    const symbol = (symbolArg || query || selectedStock?.symbol || '').trim();
    if (!symbol) return;
    setLoading(true);
    setError('');
    try {
      const [predictionRes, timelineRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/predictions/${symbol}`),
        axios.get(`${API_BASE_URL}/timeline/${symbol}`, { params: { past_days: 7, future_days: 7 } }),
      ]);
      setPredictionData(predictionRes.data);
      setTimelineData(timelineRes.data || []);
    } catch (err) {
      setPredictionData(null);
      setTimelineData([]);
      setError(err.response?.data?.detail || 'Failed to load Yahoo-backed stock data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadStocks = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/stocks/`);
        const rows = response.data || [];
        setStocks(rows);
        if (rows.length > 0) {
          setSelectedStock(rows[0]);
          setQuery(rows[0].symbol);
        }
      } catch {
        setStocks([]);
      }
    };
    loadStocks();
  }, []);

  useEffect(() => {
    if (selectedStock?.symbol) {
      loadStockData(selectedStock.symbol);
    }
  }, [selectedStock]);

  return (
    <div className="container" style={{ paddingBottom: '4rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1>Yahoo Stock Workspace</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Browser tracking + API-powered modules for dashboards, trading tools, and AI prediction models.
        </p>
      </header>

      <div className="card" style={{ marginBottom: '1rem' }}>
        {stocks.length > 0 && (
          <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.8rem', overflowX: 'auto', paddingBottom: '0.4rem' }}>
            {stocks.map((stock) => (
              <button
                key={stock.id}
                type="button"
                onClick={() => {
                  setSelectedStock(stock);
                  setQuery(stock.symbol);
                }}
                style={{
                  marginBottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  background: selectedStock?.id === stock.id ? 'var(--primary)' : 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border)',
                }}
              >
                {stock.logo_url ? (
                  <img src={stock.logo_url} alt="" style={{ width: '16px', height: '16px', borderRadius: '2px', objectFit: 'contain' }} />
                ) : (
                  <ImageIcon size={14} />
                )}
                {stock.symbol}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr auto', gap: '0.75rem' }}>
          <input
            placeholder="Enter symbol (e.g. TRIDENT, SBIN, RELIANCE)"
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            style={{ marginBottom: 0 }}
          />
          <button type="button" onClick={loadStockData} disabled={loading}>
            {loading ? 'Loading...' : 'Track Stock'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <div className="card">
          <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
            <MonitorSmartphone size={16} color="var(--primary)" /> Quick Browser Tracking
          </p>
          <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
            Fast watchlist experience in browser/PWA for live checks.
          </p>
        </div>
        <div className="card">
          <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
            <Wrench size={16} color="var(--primary)" /> API for Trading Tools
          </p>
          <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
            Use API data stream for custom dashboards and execution utilities.
          </p>
        </div>
        <div className="card">
          <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
            <Bot size={16} color="var(--primary)" /> API for AI Models
          </p>
          <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
            Feed clean market data into AI prediction and decision systems.
          </p>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>
        </div>
      )}

      {predictionData && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{predictionData.name}</p>
          <p style={{ margin: '0.2rem 0 0', color: 'var(--primary)', fontWeight: 700 }}>{predictionData.symbol}</p>
          <p style={{ margin: '0.5rem 0 0', color: 'var(--text-muted)' }}>Current Price</p>
          <p style={{ margin: '0.1rem 0 0', fontSize: '2rem', fontWeight: 800 }}>
            {predictionData.currency}
            {predictionData.current_price}
          </p>
          {(() => {
            const delta = getTodayChange();
            if (!delta) return null;
            const isUp = delta.change >= 0;
            return (
              <p style={{ margin: '0.25rem 0 0', color: isUp ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
                Today&apos;s Change: {isUp ? '+' : ''}
                {delta.change.toFixed(2)} ({isUp ? '+' : ''}
                {delta.changePct.toFixed(2)}%)
              </p>
            );
          })()}
        </div>
      )}

      <div className="card">
        <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <BarChart3 size={18} color="var(--primary)" /> Last 7 + Next 7 (Yahoo Data)
        </h3>
        {timelineData.length > 1 ? (
          <div style={{ width: '100%', height: '320px' }}>
            <ResponsiveContainer>
              <LineChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="label" stroke="#94a3b8" fontSize={10} tickMargin={10} />
                <YAxis stroke="#94a3b8" fontSize={10} domain={['auto', 'auto']} />
                <Tooltip />
                <Line type="monotone" dataKey="actual" name="Actual" stroke="#10b981" strokeWidth={2.5} dot={{ r: 2 }} connectNulls={false} />
                <Line type="monotone" dataKey="predicted" name="Predicted" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 2 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>
            Search a stock to load the chart.
          </p>
        )}
      </div>
    </div>
  );
};

export default YahooStock;

