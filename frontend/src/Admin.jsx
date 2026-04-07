import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Edit2, Save, X, Plus, Image as ImageIcon } from 'lucide-react';
import { API_BASE_URL } from './apiConfig';

const Admin = () => {
  const [stocks, setStocks] = useState([]);
  const [formData, setFormData] = useState({ symbol: '', name: '' });
  const [stockQuery, setStockQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editFormData, setEditFormData] = useState({ symbol: '', name: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchStocks();
  }, []);

  useEffect(() => {
    const query = stockQuery.trim();

    if (query.length < 3) {
      setSuggestions([]);
      return undefined;
    }

    const timeout = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await axios.get(`${API_BASE_URL}/stocks/search`, {
          params: { q: query, limit: 8 }
        });
        setSuggestions(response.data || []);
      } catch (err) {
        setSuggestions([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [stockQuery]);

  const fetchStocks = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/stocks/`);
      setStocks(response.data);
    } catch (err) {
      console.error('Error fetching stocks:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.symbol || !formData.name) return;
    
    setLoading(true);
    setError('');
    try {
      await axios.post(`${API_BASE_URL}/stocks/`, formData);
      setFormData({ symbol: '', name: '' });
      setStockQuery('');
      setSuggestions([]);
      fetchStocks();
    } catch (err) {
      setError(err.response?.data?.detail || 'Error adding stock');
    } finally {
      setLoading(false);
    }
  };

  const handleStockQueryChange = (value) => {
    setStockQuery(value);
    setFormData({ ...formData, name: value });
    setShowSuggestions(true);
  };

  const selectSuggestion = (suggestion) => {
    setFormData({
      symbol: suggestion.symbol.toUpperCase(),
      name: suggestion.name
    });
    setStockQuery(suggestion.name);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const startEditing = (stock) => {
    setEditingId(stock.id);
    setEditFormData({ symbol: stock.symbol, name: stock.name });
  };

  const cancelEditing = () => {
    setEditingId(null);
  };

  const handleUpdate = async (id) => {
    try {
      await axios.put(`${API_BASE_URL}/stocks/${id}`, editFormData);
      setEditingId(null);
      fetchStocks();
    } catch (err) {
      alert('Error updating stock');
    }
  };

  return (
    <div className="container">
      <header style={{ marginBottom: '3rem' }}>
        <h1>Admin Dashboard</h1>
        <p style={{ color: 'var(--text-muted)' }}>Manage stock inventory and track official branding</p>
      </header>

      <div className="card" style={{ maxWidth: '500px', margin: '0 auto 3rem' }}>
        <h2 style={{ marginBottom: '1.5rem', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Plus size={20} color="var(--primary)" /> Add New Stock
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
          Tip: For Indian stocks, use the symbol (e.g., <strong>TRIDENT</strong>) or BSE code (e.g., <strong>521064</strong>).
        </p>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', gap: '1rem' }}>
             <input
              placeholder="Symbol"
              style={{ flex: '0 0 120px' }}
              value={formData.symbol}
              onChange={(e) => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
              required
            />
            <input
              placeholder="Full Stock Name"
              value={stockQuery}
              onChange={(e) => handleStockQueryChange(e.target.value)}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              required
            />
          </div>
          {showSuggestions && stockQuery.trim().length >= 3 && (
            <div style={{ marginTop: '0.5rem', border: '1px solid var(--border)', borderRadius: '0.75rem', maxHeight: '220px', overflowY: 'auto', background: 'var(--card-bg)' }}>
              {isSearching ? (
                <p style={{ margin: 0, padding: '0.75rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Searching stocks...</p>
              ) : suggestions.length === 0 ? (
                <p style={{ margin: 0, padding: '0.75rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No matching stocks found</p>
              ) : (
                suggestions.map((suggestion) => (
                  <button
                    key={`${suggestion.symbol}-${suggestion.exchange || 'EX'}`}
                    type="button"
                    onMouseDown={() => selectSuggestion(suggestion)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--border)',
                      padding: '0.75rem 1rem',
                      cursor: 'pointer'
                    }}
                  >
                    <strong>{suggestion.symbol}</strong> - {suggestion.name}
                    {suggestion.exchange ? ` (${suggestion.exchange})` : ''}
                  </button>
                ))
              )}
            </div>
          )}
          {error && <p style={{ color: 'var(--danger)', marginBottom: '1rem', fontSize: '0.8rem' }}>{error}</p>}
          <button type="submit" style={{ width: '100%', marginTop: '0.5rem' }} disabled={loading}>
            {loading ? 'Processing...' : 'Register Stock'}
          </button>
        </form>
      </div>

      <div className="stock-list" style={{ gridTemplateColumns: '1fr' }}>
        <h2 style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>Registered Portfolio</h2>
        <div style={{ display: 'grid', gap: '1rem' }}>
          {stocks.map((stock) => (
            <div key={stock.id} className="card" style={{ padding: '1rem 1.5rem' }}>
              {editingId === stock.id ? (
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <input
                    style={{ flex: '0 0 120px', marginBottom: 0 }}
                    value={editFormData.symbol}
                    onChange={(e) => setEditFormData({ ...editFormData, symbol: e.target.value.toUpperCase() })}
                  />
                  <input
                    style={{ marginBottom: 0 }}
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  />
                  <button onClick={() => handleUpdate(stock.id)} style={{ padding: '0.5rem', background: 'var(--success)' }}>
                    <Save size={18} />
                  </button>
                  <button onClick={cancelEditing} style={{ padding: '0.5rem', background: 'var(--border)' }}>
                    <X size={18} />
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                    <div style={{ 
                      width: '48px', 
                      height: '48px', 
                      background: 'rgba(255,255,255,0.05)', 
                      borderRadius: '0.75rem', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      overflow: 'hidden',
                      border: '1px solid var(--border)'
                    }}>
                      {stock.logo_url ? (
                        <img src={stock.logo_url} alt={stock.symbol} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      ) : (
                        <ImageIcon size={20} color="var(--text-muted)" />
                      )}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontWeight: '700', fontSize: '1.1rem' }}>{stock.symbol}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{stock.name}</span>
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => startEditing(stock)}
                    style={{ padding: '0.5rem 1rem', background: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary)', border: '1px solid rgba(99, 102, 241, 0.2)' }}
                  >
                    <Edit2 size={16} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Admin;
