import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Activity, BookOpen, CandlestickChart, Image as ImageIcon, ShoppingCart } from 'lucide-react';
import { xstreamApi } from './xstreamApi';
import { API_BASE_URL } from './apiConfig';

const StockMarket = () => {
  const [accessToken, setAccessToken] = useState(() => {
    const saved = localStorage.getItem('xstream_access_token');
    return saved || import.meta.env.VITE_XSTREAM_ACCESS_TOKEN || '';
  });
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_XSTREAM_API_KEY || '');
  const [clientCode, setClientCode] = useState(import.meta.env.VITE_XSTREAM_CLIENT_CODE || '');
  const [userId, setUserId] = useState(import.meta.env.VITE_XSTREAM_USER_ID || '');
  const [userPassword, setUserPassword] = useState(import.meta.env.VITE_XSTREAM_USER_PASSWORD || '');
  const [encryptionKey, setEncryptionKey] = useState(import.meta.env.VITE_XSTREAM_ENCRYPTION_KEY || '');
  const [appSource, setAppSource] = useState(import.meta.env.VITE_XSTREAM_APP_SOURCE || '');
  const [requestToken, setRequestToken] = useState('');
  const [oauthRedirectUrl, setOauthRedirectUrl] = useState(import.meta.env.VITE_XSTREAM_REDIRECT_URL || '');
  const [oauthCallbackUrl, setOauthCallbackUrl] = useState('');

  const [quoteParams, setQuoteParams] = useState({
    exchange: 'N',
    exchangeType: 'C',
    scripCode: '521064',
  });

  const [candleParams, setCandleParams] = useState({
    exchange: 'N',
    exchangeType: 'C',
    scripCode: '521064',
    interval: '1d',
    from: '',
    to: '',
  });

  const [orderPayload, setOrderPayload] = useState({
    exchange: 'N',
    exchangeType: 'C',
    scripCode: '521064',
    orderType: 'BUY',
    quantity: 1,
    price: '',
    product: 'CNC',
  });

  const [loadingKey, setLoadingKey] = useState('');
  const [error, setError] = useState('');
  const [responseData, setResponseData] = useState(null);
  const [stocks, setStocks] = useState([]);
  const [stocksLoading, setStocksLoading] = useState(false);
  const [livePrices, setLivePrices] = useState({});

  useEffect(() => {
    const loadStocks = async () => {
      setStocksLoading(true);
      try {
        const response = await axios.get(`${API_BASE_URL}/stocks/`);
        setStocks(response.data || []);
      } catch {
        setStocks([]);
      } finally {
        setStocksLoading(false);
      }
    };
    loadStocks();
  }, []);

  useEffect(() => {
    if (accessToken?.trim()) {
      localStorage.setItem('xstream_access_token', accessToken.trim());
    } else {
      localStorage.removeItem('xstream_access_token');
    }
  }, [accessToken]);

  const creds = useMemo(
    () => ({
      accessToken: accessToken.trim(),
      apiKey: apiKey.trim(),
      clientCode: clientCode.trim(),
      userId: userId.trim(),
      userPassword: userPassword.trim(),
      encryptionKey: encryptionKey.trim(),
      appSource: appSource.trim(),
    }),
    [accessToken, apiKey, clientCode, userId, userPassword, encryptionKey, appSource]
  );

  const oauthLoginUrl = useMemo(() => {
    if (!apiKey.trim() || !oauthRedirectUrl.trim()) return '';
    const vendorKey = encodeURIComponent(apiKey.trim());
    const responseUrl = encodeURIComponent(oauthRedirectUrl.trim());
    return `https://dev-openapi.5paisa.com/WebVendorLogin/VLogin/Index?VendorKey=${vendorKey}&ResponseURL=${responseUrl}`;
  }, [apiKey, oauthRedirectUrl]);

  const runCall = async (key, fn) => {
    setLoadingKey(key);
    setError('');
    try {
      const data = await fn();
      setResponseData(data);
    } catch (err) {
      setResponseData(null);
      setError(err.response?.data?.message || err.response?.data?.detail || err.message || 'Request failed');
    } finally {
      setLoadingKey('');
    }
  };

  const normalizeSymbolKey = (value) =>
    String(value || '')
      .toUpperCase()
      .replace('.NS', '')
      .replace('.BO', '')
      .replace(/[^A-Z0-9]/g, '');

  const derive5paisaParams = async (stock) => {
    const rawSymbol = (stock?.symbol || '').toUpperCase();
    const fallbackExchange = rawSymbol.includes('.BO') ? 'B' : 'N';
    const key = normalizeSymbolKey(rawSymbol);
    let mapped = null;
    try {
      const resolved = await xstreamApi.resolveScrip(key, fallbackExchange);
      if (resolved?.found) mapped = resolved.data;
    } catch {
      mapped = null;
    }
    const digitMatch = rawSymbol.match(/\d{4,}/);
    const scripCode = mapped?.scripCode || (digitMatch ? digitMatch[0] : '');
    const exchange = mapped?.exchange || fallbackExchange;
    return { exchange, exchangeType: 'C', scripCode };
  };

  const extractCurrentPrice = (payload) => {
    if (payload?.currentPrice !== undefined && payload?.currentPrice !== null) {
      const n = Number(payload.currentPrice);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const row = Array.isArray(payload) ? payload[0] : payload?.data?.[0] || payload?.Data?.[0] || payload;
    if (!row || typeof row !== 'object') return null;
    const candidates = [
      row.LastRate,
      row.lastRate,
      row.LastTradedPrice,
      row.lastTradedPrice,
      row.LTP,
      row.ltp,
      row.CurrentRate,
      row.currentRate,
      row.Close,
      row.close,
    ];
    for (const value of candidates) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  };

  const loadLivePrices = async () => {
    setLoadingKey('live-prices');
    setError('');
    const nextPrices = {};
    try {
      for (const stock of stocks) {
        const params = await derive5paisaParams(stock);
        if (!params.scripCode) {
          nextPrices[stock.id] = { value: null, note: 'missing scrip code' };
          continue;
        }
        try {
          let data = await xstreamApi.marketSnapshot(params, creds);
          let currentPrice = extractCurrentPrice(data);
          if (!currentPrice) {
            const altExchange = params.exchange === 'N' ? 'B' : 'N';
            data = await xstreamApi.marketSnapshot({ ...params, exchange: altExchange }, creds);
            currentPrice = extractCurrentPrice(data);
          }
          nextPrices[stock.id] = {
            value: currentPrice,
            note: currentPrice ? null : 'price unavailable',
          };
        } catch (err) {
          const msg = err.response?.data?.detail || err.response?.data?.message || 'fetch failed';
          nextPrices[stock.id] = { value: null, note: msg };
        }
      }
      setLivePrices(nextPrices);
      setResponseData(nextPrices);
    } finally {
      setLoadingKey('');
    }
  };

  const extractRequestTokenFromUrl = () => {
    try {
      const url = new URL(oauthCallbackUrl.trim());
      const token = url.searchParams.get('RequestToken') || url.searchParams.get('requestToken') || '';
      if (!token) {
        setError('RequestToken not found in callback URL.');
        return;
      }
      setRequestToken(token);
      setError('');
    } catch {
      setError('Invalid callback URL format.');
    }
  };

  return (
    <div className="container" style={{ paddingBottom: '4rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1>Stock Market (5paisa Xstream)</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Frontend integration page for market data and order APIs.
        </p>
      </header>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
          <h3 style={{ margin: 0 }}>Registered Stocks Data</h3>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={loadLivePrices}
              style={{ marginBottom: 0 }}
              disabled={loadingKey === 'live-prices' || stocks.length === 0}
            >
              {loadingKey === 'live-prices' ? 'Loading Prices...' : 'Load 5paisa Prices'}
            </button>
            <button
              type="button"
              onClick={async () => {
                setStocksLoading(true);
                try {
                  const response = await axios.get(`${API_BASE_URL}/stocks/`);
                  setStocks(response.data || []);
                } finally {
                  setStocksLoading(false);
                }
              }}
              style={{ marginBottom: 0 }}
            >
              {stocksLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
        {stocksLoading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading stocks...</p>
        ) : stocks.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No stocks found. Add stocks from Admin Panel first.</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.65rem' }}>
            {stocks.map((stock) => (
              <div key={stock.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.6rem 0.8rem' }}>
                <div style={{ width: '34px', height: '34px', borderRadius: '0.55rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {stock.logo_url ? (
                    <img src={stock.logo_url} alt={stock.symbol} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <ImageIcon size={16} color="var(--text-muted)" />
                  )}
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 700 }}>{stock.name}</p>
                  <p style={{ margin: 0, color: 'var(--primary)', fontSize: '0.82rem' }}>{stock.symbol}</p>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: livePrices[stock.id]?.value ? 'var(--success)' : 'var(--text-muted)' }}>
                    Current Price:{' '}
                    {livePrices[stock.id]?.value
                      ? `₹${Number(livePrices[stock.id].value).toFixed(2)}`
                      : livePrices[stock.id]?.note || '-'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '0.9rem' }}>API Credentials</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.8rem' }}>
          OAuth flow: login on 5paisa portal -> copy RequestToken -> exchange here to get Access Token.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.8rem' }}>
          <input
            placeholder="Access Token (Bearer)"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            style={{ marginBottom: 0 }}
          />
          <input
            placeholder="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={{ marginBottom: 0 }}
          />
          <input
            placeholder="Client Code"
            value={clientCode}
            onChange={(e) => setClientCode(e.target.value)}
            style={{ marginBottom: 0 }}
          />
          <input
            placeholder="User ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            style={{ marginBottom: 0 }}
          />
          <input
            placeholder="User Password"
            value={userPassword}
            onChange={(e) => setUserPassword(e.target.value)}
            style={{ marginBottom: 0 }}
          />
          <input
            placeholder="Encryption Key"
            value={encryptionKey}
            onChange={(e) => setEncryptionKey(e.target.value)}
            style={{ marginBottom: 0 }}
          />
          <input
            placeholder="App Source"
            value={appSource}
            onChange={(e) => setAppSource(e.target.value)}
            style={{ marginBottom: 0 }}
          />
          <input
            placeholder="Request Token (from OAuth redirect URL)"
            value={requestToken}
            onChange={(e) => setRequestToken(e.target.value)}
            style={{ marginBottom: 0 }}
          />
          <input
            placeholder="OAuth Redirect URL (e.g. https://yourapp.com/callback)"
            value={oauthRedirectUrl}
            onChange={(e) => setOauthRedirectUrl(e.target.value)}
            style={{ marginBottom: 0 }}
          />
          <input
            placeholder="Paste full callback URL to auto-extract RequestToken"
            value={oauthCallbackUrl}
            onChange={(e) => setOauthCallbackUrl(e.target.value)}
            style={{ marginBottom: 0 }}
          />
        </div>
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <a href={oauthLoginUrl || 'https://xstream.5paisa.com'} target="_blank" rel="noreferrer">
            <button type="button" style={{ marginBottom: 0, background: 'var(--border)' }}>
              Open OAuth Login
            </button>
          </a>
          <button
            type="button"
            onClick={extractRequestTokenFromUrl}
            style={{ marginBottom: 0, background: 'var(--border)' }}
            disabled={!oauthCallbackUrl.trim()}
          >
            Extract RequestToken
          </button>
          <button
            type="button"
            onClick={() =>
              runCall('token-exchange', async () => {
                const res = await xstreamApi.exchangeAccessToken(requestToken, creds);
                if (res?.accessToken) setAccessToken(res.accessToken);
                return res;
              })
            }
            style={{ marginBottom: 0 }}
            disabled={loadingKey === 'token-exchange' || !requestToken.trim()}
          >
            {loadingKey === 'token-exchange' ? 'Exchanging...' : 'Get Access Token'}
          </button>
          {accessToken && (
            <span style={{ color: 'var(--success)', fontSize: '0.8rem' }}>
              Access token is set. You can now load live prices.
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
        <div className="card">
          <h3 style={{ marginBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={18} color="var(--primary)" /> Market Snapshot (Quotes)
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.7rem' }}>
            <input
              placeholder="Exchange"
              value={quoteParams.exchange}
              onChange={(e) => setQuoteParams((p) => ({ ...p, exchange: e.target.value }))}
              style={{ marginBottom: 0 }}
            />
            <input
              placeholder="Exchange Type"
              value={quoteParams.exchangeType}
              onChange={(e) => setQuoteParams((p) => ({ ...p, exchangeType: e.target.value }))}
              style={{ marginBottom: 0 }}
            />
            <input
              placeholder="Scrip Code"
              value={quoteParams.scripCode}
              onChange={(e) => setQuoteParams((p) => ({ ...p, scripCode: e.target.value }))}
              style={{ marginBottom: 0 }}
            />
          </div>
          <button
            style={{ marginTop: '0.8rem' }}
            onClick={() => runCall('quote', () => xstreamApi.marketSnapshot(quoteParams, creds))}
            disabled={loadingKey === 'quote'}
          >
            {loadingKey === 'quote' ? 'Loading...' : 'Fetch Snapshot'}
          </button>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CandlestickChart size={18} color="var(--primary)" /> Historical Candles
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.7rem' }}>
            <input
              placeholder="Exchange"
              value={candleParams.exchange}
              onChange={(e) => setCandleParams((p) => ({ ...p, exchange: e.target.value }))}
              style={{ marginBottom: 0 }}
            />
            <input
              placeholder="Exchange Type"
              value={candleParams.exchangeType}
              onChange={(e) => setCandleParams((p) => ({ ...p, exchangeType: e.target.value }))}
              style={{ marginBottom: 0 }}
            />
            <input
              placeholder="Scrip Code"
              value={candleParams.scripCode}
              onChange={(e) => setCandleParams((p) => ({ ...p, scripCode: e.target.value }))}
              style={{ marginBottom: 0 }}
            />
            <input
              placeholder="Interval (e.g. 1d)"
              value={candleParams.interval}
              onChange={(e) => setCandleParams((p) => ({ ...p, interval: e.target.value }))}
              style={{ marginBottom: 0 }}
            />
            <input
              placeholder="From (YYYY-MM-DD)"
              value={candleParams.from}
              onChange={(e) => setCandleParams((p) => ({ ...p, from: e.target.value }))}
              style={{ marginBottom: 0 }}
            />
            <input
              placeholder="To (YYYY-MM-DD)"
              value={candleParams.to}
              onChange={(e) => setCandleParams((p) => ({ ...p, to: e.target.value }))}
              style={{ marginBottom: 0 }}
            />
          </div>
          <button
            style={{ marginTop: '0.8rem' }}
            onClick={() => runCall('candles', () => xstreamApi.historicalCandles(candleParams, creds))}
            disabled={loadingKey === 'candles'}
          >
            {loadingKey === 'candles' ? 'Loading...' : 'Fetch Candles'}
          </button>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <BookOpen size={18} color="var(--primary)" /> Order Book
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.8rem' }}>
            Read your current order book from Xstream.
          </p>
          <button
            onClick={() => runCall('order-book', () => xstreamApi.orderBook(creds))}
            disabled={loadingKey === 'order-book'}
          >
            {loadingKey === 'order-book' ? 'Loading...' : 'Fetch Order Book'}
          </button>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShoppingCart size={18} color="var(--primary)" /> Place Order
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.7rem' }}>
            <input
              placeholder="Exchange"
              value={orderPayload.exchange}
              onChange={(e) => setOrderPayload((p) => ({ ...p, exchange: e.target.value }))}
              style={{ marginBottom: 0 }}
            />
            <input
              placeholder="Exchange Type"
              value={orderPayload.exchangeType}
              onChange={(e) => setOrderPayload((p) => ({ ...p, exchangeType: e.target.value }))}
              style={{ marginBottom: 0 }}
            />
            <input
              placeholder="Scrip Code"
              value={orderPayload.scripCode}
              onChange={(e) => setOrderPayload((p) => ({ ...p, scripCode: e.target.value }))}
              style={{ marginBottom: 0 }}
            />
            <input
              placeholder="BUY / SELL"
              value={orderPayload.orderType}
              onChange={(e) => setOrderPayload((p) => ({ ...p, orderType: e.target.value }))}
              style={{ marginBottom: 0 }}
            />
            <input
              type="number"
              placeholder="Quantity"
              value={orderPayload.quantity}
              onChange={(e) => setOrderPayload((p) => ({ ...p, quantity: Number(e.target.value || 0) }))}
              style={{ marginBottom: 0 }}
            />
            <input
              placeholder="Price"
              value={orderPayload.price}
              onChange={(e) => setOrderPayload((p) => ({ ...p, price: e.target.value }))}
              style={{ marginBottom: 0 }}
            />
          </div>
          <button
            style={{ marginTop: '0.8rem' }}
            onClick={() => runCall('place-order', () => xstreamApi.placeOrder(orderPayload, creds))}
            disabled={loadingKey === 'place-order'}
          >
            {loadingKey === 'place-order' ? 'Placing...' : 'Place Order'}
          </button>
        </div>
      </div>

      {(error || responseData) && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ marginBottom: '0.8rem' }}>API Response</h3>
          {error ? (
            <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>
          ) : (
            <pre
              style={{
                margin: 0,
                textAlign: 'left',
                fontSize: '0.78rem',
                color: 'var(--text-muted)',
                background: 'rgba(2,6,23,0.55)',
                border: '1px solid var(--border)',
                borderRadius: '0.75rem',
                padding: '0.9rem',
                maxHeight: '400px',
                overflow: 'auto',
              }}
            >
              {JSON.stringify(responseData, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

export default StockMarket;

