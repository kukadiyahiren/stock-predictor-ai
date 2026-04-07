import React from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import Admin from './Admin';
import Predictions from './Predictions';
import Roadmap from './Roadmap';
import StockMarket from './StockMarket';
import YahooStock from './YahooStock';

function App() {
  return (
    <Router>
      <nav>
        <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>
          Admin Panel
        </NavLink>
        <NavLink to="/" className={({ isActive }) => (isActive ? 'active' : '')}>
          Stock Forecasts
        </NavLink>
        <NavLink to="/roadmap" className={({ isActive }) => (isActive ? 'active' : '')}>
          Roadmap
        </NavLink>
        <NavLink to="/stock-market" className={({ isActive }) => (isActive ? 'active' : '')}>
          Stock Market
        </NavLink>
        <NavLink to="/yahoo-stock" className={({ isActive }) => (isActive ? 'active' : '')}>
          Yahoo Stock
        </NavLink>
      </nav>

      <Routes>
        <Route path="/admin" element={<Admin />} />
        <Route path="/" element={<Predictions />} />
        <Route path="/roadmap" element={<Roadmap />} />
        <Route path="/stock-market" element={<StockMarket />} />
        <Route path="/yahoo-stock" element={<YahooStock />} />
      </Routes>
    </Router>
  );
}

export default App;
