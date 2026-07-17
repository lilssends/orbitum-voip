// orbitum-voip-service — microservico Twilio para click-to-call (multi-atendente)
// Gera Access Tokens para o Twilio Voice SDK no browser, responde o TwiML de saida
// e entrega a gravacao da chamada para o Orbitum Hub guardar.
//
// As credenciais do Twilio vivem SO aqui (mesma regra do certificado A1 no proxy SEFAZ):
// o Hub nunca fala com o Twilio direto.

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

// --- Configuracao da gravacao -------------------------------------------------
// VOIP_SECRET             : se definido, /voip/token e /voip/recording passam a exigir
//                           o header X-Voip-Secret. Enquanto vazio, nada muda (o
//                           sistema antigo continua funcionando).
// VOIP_RECORD             : 'off' desliga a gravacao. Padrao: ligada.
// VOIP_AVISO_GRAVACAO     : 'off' desliga o aviso falado. Padrao: ligado (LGPD).
// VOIP_RECORDING_CALLBACK : URL que recebe o aviso do Twilio quando o audio fica pronto.
const VOIP_SECRET = (process.env.VOIP_SECRET || '').trim();
const RECORD_ON = (process.env.VOIP_RECORD || 'on').toLowerCase() !== 'off';
const AVISO_ON = (process.env.VOIP_AVISO_GRAVACAO || 'on').toLowerCase() !== 'off';
const RECORDING_CALLBACK = (process.env.VOIP_RECORDING_CALLBACK ||
  'https://api.orbitum.com.br/api/atendimento/voip/gravacao').trim();
const AVISO_TEXTO = process.env.VOIP_AVISO_TEXTO ||
  'Esta ligação poderá ser gravada para fins de qualidade e segurança.';

/**
 * Exige o segredo compartilhado — mas SO se VOIP_SECRET estiver definido.
 * Assim o servico pode subir esta versao sem derrubar quem ja usa; quando o
 * segredo for definido no Railway, o endpoint fecha.
 *
 * Nao vale para /voip/outbound: quem chama aquele endpoint e o proprio Twilio,
 * que nao tem como mandar o nosso header.
 */
function exigirSegredo(req, res, next) {
    if (!VOIP_SECRET) return next(); // ainda aberto (compatibilidade)
    const enviado = req.get('X-Voip-Secret') || '';
    if (enviado !== VOIP_SECRET) {
        console.warn('[voip] acesso negado em ' + req.path);
        return res.status(401).json({ error: 'nao autorizado' });
    }
    return next();
}

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
app.get('/', (req, res) => res.json({
    service: 'orbitum-voip',
    provider: 'twilio',
    status: 'ok',
    gravacao: RECORD_ON,
    aviso: AVISO_ON,
    protegido: Boolean(VOIP_SECRET),
}));

// 1) Token de acesso para o browser (Twilio Voice SDK)
//    ATENCAO: este endpoint emite uma credencial do Twilio. Com VOIP_SECRET definido,
//    so o Hub (server-to-server) consegue chama-lo — e la a identidade vem do usuario
//    logado, nao de quem pede.
app.get('/voip/token', exigirSegredo, (req, res) => {
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

// 2) TwiML de saida — o Twilio chama este endpoint ao iniciar a chamada.
//    Fica aberto de proposito: quem chama e o Twilio (nao manda header nosso), e a
//    resposta e apenas XML — sem um token valido ninguem completa chamada por aqui.
app.all('/voip/outbound', (req, res) => {
    const raw = (req.body && req.body.To) || req.query.To || req.query.to;
    const destino = toE164BR(raw);
    const response = new VoiceResponse();

    // Aviso de gravacao (LGPD) antes de discar.
    if (RECORD_ON && AVISO_ON) {
        response.say({ language: 'pt-BR' }, AVISO_TEXTO);
    }

    const opcoes = { callerId: CALLER_ID, answerOnBridge: true };
    if (RECORD_ON) {
        // Grava os dois lados, so depois que atendem (nao grava chamada nao atendida).
        opcoes.record = 'record-from-answer-dual';
        opcoes.recordingStatusCallback = RECORDING_CALLBACK;
        opcoes.recordingStatusCallbackEvent = 'completed';
        opcoes.recordingStatusCallbackMethod = 'POST';
    }

    const dial = response.dial(opcoes);
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

// 3) Entrega o audio da gravacao para o Hub guardar (Supabase Storage).
//    O Hub nao tem credencial do Twilio — por isso o download passa por aqui.
app.get('/voip/recording/:sid', exigirSegredo, async (req, res) => {
    const sid = String(req.params.sid || '').trim();
    if (!/^RE[a-zA-Z0-9]+$/.test(sid)) {
        return res.status(400).json({ error: 'sid invalido' });
    }
    try {
        const url = 'https://api.twilio.com/2010-04-01/Accounts/' + ACCOUNT_SID + '/Recordings/' + sid + '.mp3';
        // API Key + Secret valem como basic auth na API REST do Twilio.
        const auth = Buffer.from(API_KEY + ':' + API_SECRET).toString('base64');
        const r = await fetch(url, { headers: { Authorization: 'Basic ' + auth } });
        if (!r.ok) {
            console.error('[voip] download da gravacao falhou: ' + r.status);
            return res.status(r.status).json({ error: 'gravacao indisponivel (' + r.status + ')' });
        }
        const buf = Buffer.from(await r.arrayBuffer());
        res.set('Content-Type', 'audio/mpeg');
        res.set('Content-Length', String(buf.length));
        return res.send(buf);
    } catch (e) {
        console.error('[voip] erro ao baixar gravacao', e);
        return res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('orbitum-voip ouvindo na porta ' + PORT));
