// orbitum-voip-service — microservico Plivo para click-to-call
// Gera tokens de acesso para o SDK Plivo no browser e responde o XML de saida.

const express = require('express');
const plivo = require('plivo');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const AUTH_ID    = process.env.PLIVO_AUTH_ID;
const AUTH_TOKEN = process.env.PLIVO_AUTH_TOKEN;
const APP_ID     = process.env.PLIVO_APP_ID;
const CALLER_ID  = process.env.PLIVO_CALLER_ID;

// Healthcheck
app.get('/', (req, res) => res.json({ service: 'orbitum-voip', status: 'ok' }));

// 1) Token de acesso para o browser (SDK Plivo)
app.get('/voip/token', (req, res) => {
  try {
    const username = (req.query.user || 'atendente').toString().replace(/[^a-zA-Z0-9_]/g, '');
    const endpoint = new plivo.AccessToken(AUTH_ID, AUTH_TOKEN, username, {
      validTill: Math.floor(Date.now() / 1000) + 3600,
    });
    endpoint.addVoiceGrants(APP_ID, true, true);
    res.json({ token: endpoint.toJwt(), username });
  } catch (e) {
    console.error('token error', e);
    res.status(500).json({ error: e.message });
  }
});

// 2) XML de saida — Plivo chama este endpoint ao iniciar a chamada
app.all('/voip/outbound', (req, res) => {
  const destino = (req.body && req.body.To) || req.query.To || req.query.to;
  const response = plivo.Response();
  const dial = response.addDial({ callerId: CALLER_ID });
  dial.addNumber(destino);
  res.set('Content-Type', 'text/xml');
  res.send(response.toXML());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('orbitum-voip rodando na porta ' + PORT));
