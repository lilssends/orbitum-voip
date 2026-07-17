# orbitum-voip

Microserviço Twilio do Orbitum Hub: emite Access Token para o Twilio Voice SDK (softphone
no navegador), responde o TwiML de saída e entrega a gravação da chamada ao Hub.

**As credenciais do Twilio vivem só aqui** — o Hub nunca fala com o Twilio direto (mesma
regra do certificado A1, que só existe no proxy SEFAZ).

## Endpoints

| Rota | Protegida? | O quê |
|---|---|---|
| `GET /` | não | health + estado (gravação, aviso, protegido) |
| `GET /voip/token?user=<identity>` | **sim** (se `VOIP_SECRET`) | Access Token do Voice SDK |
| `ALL /voip/outbound` | não — **quem chama é o Twilio** | TwiML `<Dial>` (com gravação) |
| `GET /voip/recording/:sid` | **sim** (se `VOIP_SECRET`) | baixa o mp3 da gravação |

## Variáveis

| Variável | Padrão | Para quê |
|---|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_API_KEY` / `TWILIO_API_SECRET` | — | credenciais |
| `TWILIO_TWIML_APP_SID` / `TWILIO_CALLER_ID` | — | app de voz e número de origem |
| `VOIP_SECRET` | *(vazio)* | **quando definido**, `/voip/token` e `/voip/recording` passam a exigir o header `X-Voip-Secret`. Vazio = aberto (compatibilidade com o sistema antigo) |
| `VOIP_RECORD` | `on` | `off` desliga a gravação |
| `VOIP_AVISO_GRAVACAO` | `on` | `off` desliga o aviso falado (LGPD) |
| `VOIP_AVISO_TEXTO` | *"Esta ligação poderá ser gravada para fins de qualidade e segurança."* | texto do aviso |
| `VOIP_RECORDING_CALLBACK` | `https://api.orbitum.com.br/api/atendimento/voip/gravacao` | para onde o Twilio avisa que o áudio ficou pronto |

## ⚠️ Segurança — leia antes de mexer

`/voip/token` **emite uma credencial do Twilio**. Sem `VOIP_SECRET`, qualquer um com a URL
emite um token com a identidade que quiser e **origina chamadas na conta** (e na fatura).
O `VOIP_SECRET` começa vazio só para não derrubar o sistema antigo durante a migração —
**defina-o assim que o Hub assumir o VoIP**.

`/voip/outbound` fica aberto de propósito: quem o chama é o próprio Twilio, que não tem como
mandar o nosso header — e a resposta é apenas XML, sem credencial.
