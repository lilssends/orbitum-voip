// orbitum-voip-service — microservico Twilio para click-to-call (multi-atendente)
// Gera Access Tokens para o Twilio Voice SDK no browser e responde o TwiML de saida.

const express = require('express');
const cors = require('cors');
const twilio = require('twilio');

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;
const VoiceResponse = twilio.twiml.VoiceResponse;

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Credenciais (variaveis de ambiente no Railway)
const ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID;
const API_KEY       = process.env.TWILIO_API_KEY;
const API_SECRET    = process.env.TWILIO_API_SECRET;
const TWIML_APP_SID = process.env.TWILIO_TWIML_APP_SID;
const CALLER_ID     = process.env.TWILIO_CALLER_ID;

// Normaliza numero para E.164 (Brasil por padrao)
function toE164BR(raw) {
    if (!raw) return raw;
    let s = String(raw).trim();
    if (s.startsWith('client:')) return s; // destino interno (atendente)
  if (s.startsWith('+')) return s;       // ja em E.164
  let digits = s.replace(/\D/g, '');
    if (!digits) return s;
    if (digits.startsWith('00')) return '+' + digits.slice(2);
    if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return '+' + digits;
    if (digits.length === 10 || digits.length === 11) return '+55' + digits;
    return '+' + digits;
}

// Healthcheck
app.get('/', (req, res) => res.json({ service: 'orbitum-voip', provider: 'twilio', status: 'ok' }));

// 1) Token de acesso para o browser (Twilio Voice SDK)
app.get('/voip/token', (req, res) => {
    try {
          const identity = (req.query.user || 'atendente').toString().replace(/[^a-zA-Z0-9_]/g, '');
          const token = new AccessToken(ACCOUNT_SID, API_KEY, API_SECRET, {
                  identity: identity,
                  ttl: 3600,
          });
          const grant = new VoiceGrant({
                  outgoingApplicationSid: TWIML_APP_SID,
                  incomingAllow: true,
          });
          token.addGrant(grant);
          res.json({ token: token.toJwt(), identity });
    } catch (e) {
          console.error('token error', e);
          res.status(500).json({ error: e.message });
    }
});

// 2) TwiML de saida — Twilio chama este endpoint ao iniciar a chamada
app.all('/voip/outbound', (req, res) => {
    const raw = (req.body && req.body.To) || req.query.To || req.query.to;
    const destino = toE164BR(raw);
    const response = new VoiceResponse();
    const dial = response.dial({ callerId: CALLER_ID, answerOnBridge: true });
    if (destino && String(destino).startsWith('client:')) {
          dial.client(String(destino).replace('client:', ''));
    } else if (destino) {
          dial.number(destino);
    } else {
          response.say('Numero de destino invalido.');
    }
    res.set('Content-Type', 'text/xml');
    res.send(response.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('orbitum-voip ouvindo na porta ' + PORT));
