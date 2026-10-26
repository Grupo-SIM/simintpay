const axios = require('axios');

const token = '4a29df01-a980-45e3-b3c7-1a8b8eb7850f';
const base = 'https://apiv3.dompagamentos.com.br/checkout/production';

const endpoints = [
  '/summary',
  '/balance',
  '/wallet',
  '/dashboard',
  '/me',
  '/auth/me',
  '/user',
  '/statistics'
];

async function test() {
  for (const ep of endpoints) {
    try {
      console.log(`Testing ${base}${ep}...`);
      const res = await axios.get(`${base}${ep}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'x-access-token': token,
          'Accept': 'application/json'
        }
      });
      console.log(`SUCCESS ${ep}:`, JSON.stringify(res.data).substring(0, 100));
    } catch (err) {
      console.log(`FAILED ${ep}: ${err.response?.status || err.message}`);
    }
  }
}

test();
