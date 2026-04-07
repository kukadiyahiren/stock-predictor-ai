import axios from 'axios';
import { API_BASE_URL } from './apiConfig';

// These /xstream/* endpoints are served by our own FastAPI backend.
const XSTREAM_BASE_URL = API_BASE_URL;

const buildHeaders = ({ accessToken, apiKey, clientCode, userId, userPassword, encryptionKey, appSource }) => {
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (apiKey) headers['x-api-key'] = apiKey;
  if (clientCode) headers['x-client-code'] = clientCode;
  if (userId) headers['x-user-id'] = userId;
  if (userPassword) headers['x-user-password'] = userPassword;
  if (encryptionKey) headers['x-encryption-key'] = encryptionKey;
  if (appSource) headers['x-app-source'] = appSource;
  return headers;
};

const request = async ({ method = 'GET', path, params, data, creds }) => {
  const response = await axios({
    method,
    url: `${XSTREAM_BASE_URL}${path}`,
    params,
    data,
    headers: buildHeaders(creds || {}),
  });
  return response.data;
};

export const xstreamApi = {
  scripMaster: (segment = 'nse_eq') =>
    request({
      method: 'GET',
      path: '/xstream/scrip-master',
      params: { segment },
    }),

  resolveScrip: (symbol, exchange = 'N') =>
    request({
      method: 'GET',
      path: '/xstream/resolve-scrip',
      params: { symbol, exchange },
    }),

  exchangeAccessToken: (requestToken, creds) =>
    request({
      method: 'POST',
      path: '/xstream/oauth/access-token',
      data: { requestToken },
      creds,
    }),

  marketSnapshot: ({ exchange, exchangeType, scripCode }, creds) =>
    request({
      method: 'GET',
      path: '/xstream/live-price',
      params: { exchange, exchangeType, scripCode },
      creds,
    }),

  historicalCandles: ({ exchange, exchangeType, scripCode, interval, from, to }, creds) =>
    request({
      method: 'GET',
      path: '/xstream/historical-candles',
      params: { exchange, exchangeType, scripCode, interval, from_date: from, to_date: to },
      creds,
    }),

  orderBook: (creds) =>
    request({
      method: 'GET',
      path: '/xstream/order-book',
      creds,
    }),

  placeOrder: (payload, creds) =>
    request({
      method: 'POST',
      path: '/xstream/place-order',
      data: payload,
      creds,
    }),
};

