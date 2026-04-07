import React from 'react';

const phases = [
  {
    title: 'Phase 1: Core Foundation',
    status: 'Completed',
    items: [
      'FastAPI backend with stock CRUD and prediction endpoints',
      'React frontend with Admin and Forecast screens',
      'SQLite + SQLAlchemy models for stocks and prediction history'
    ]
  },
  {
    title: 'Phase 2: Live Market + Smart Forecast',
    status: 'Completed',
    items: [
      'Yahoo Finance integration for live prices and timeline',
      'Short and medium horizon forecasts (1h, 2h, tomorrow, 1 week, 1 month, 6 months)',
      '7-day historical + 7-day projected graph view'
    ]
  },
  {
    title: 'Phase 3: ML Pipeline',
    status: 'Completed',
    items: [
      'Feature engineering with RSI, MACD, moving averages, Bollinger bands',
      'XGBoost classification for UP/DOWN signal',
      'LSTM model for next-close prediction with plot output',
      'Backtest vs buy-and-hold strategy and result reporting'
    ]
  },
  {
    title: 'Phase 4: Async Training Experience',
    status: 'Completed',
    items: [
      'Async ML training job APIs with job_id',
      'Frontend polling with stage/progress tracking',
      'On-complete model metrics, plot, and backtest cards'
    ]
  },
  {
    title: 'Phase 5: Next Up (Suggested)',
    status: 'Planned',
    items: [
      'Add model versioning and experiment tracking',
      'Introduce confidence bands on forecast charts',
      'Add scheduled daily retraining and alerting',
      'Export presentation-ready PDF report for selected stock'
    ]
  }
];

const stack = [
  { layer: 'Frontend', value: 'React + Recharts + Axios' },
  { layer: 'Backend API', value: 'FastAPI + async job workflow' },
  { layer: 'ML', value: 'XGBoost + TensorFlow LSTM + pandas_ta' },
  { layer: 'Data', value: 'Yahoo Finance (OHLCV, 5Y history)' },
  { layer: 'Storage', value: 'SQLite + artifact files (models, CSV, plots)' }
];

const Roadmap = () => {
  return (
    <div className="container" style={{ paddingBottom: '4rem' }}>
      <header style={{ marginBottom: '2rem', borderBottom: '1px solid var(--border)', paddingBottom: '1.5rem' }}>
        <h1 style={{ marginBottom: '0.5rem' }}>Project Roadmap</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          End-to-end plan and implementation status for the Stock Prediction platform.
        </p>
      </header>

      <div className="card" style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>Architecture Flow</h2>
        <p style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>
          Python ML Model (XGBoost + LSTM) -&gt; FastAPI Backend API -&gt; React Frontend Dashboard
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
          {stack.map((item) => (
            <div key={item.layer} style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.75rem' }}>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.layer}</p>
              <p style={{ margin: '0.35rem 0 0', fontWeight: 600 }}>{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gap: '1rem' }}>
        {phases.map((phase) => (
          <div key={phase.title} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{phase.title}</h3>
              <span style={{
                fontSize: '0.7rem',
                padding: '0.2rem 0.6rem',
                borderRadius: '999px',
                background: phase.status === 'Completed' ? 'rgba(34,197,94,0.12)' : 'rgba(99,102,241,0.12)',
                color: phase.status === 'Completed' ? 'var(--success)' : 'var(--primary)',
                border: '1px solid var(--border)'
              }}>
                {phase.status}
              </span>
            </div>
            <ul style={{ margin: 0, paddingLeft: '1rem', color: 'var(--text-muted)' }}>
              {phase.items.map((item) => (
                <li key={item} style={{ marginBottom: '0.4rem' }}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Roadmap;
