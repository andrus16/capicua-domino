# CAPICÚA — Documento de sustentación

Juego de dominó doble-seis (2-4 jugadores): vs máquina con IA + multijugador
en línea en tiempo real, con cuentas, ranking e historial persistidos.

- **Producción:** https://capicua-z92d.onrender.com (frontend estático)
- **API:** https://capicua-api.onrender.com (`/health` → `{ok, db}`)
- **Repo:** https://github.com/andrus16/capicua-domino
- **BD prod:** PostgreSQL 16 en Neon. **BD local:** PostgreSQL 16 en Docker.

---

## 1. Arquitectura (monorepo npm workspaces)

```
capicua-domino/
├── packages/engine/   # motor de reglas PURO (sin red, BD ni timers)
├── server/            # Express + Socket.IO + auth + persistencia
├── client/            # React + Vite + Tailwind (SPA)
├── database/          # schema.sql, seed.sql, migrate.js, validate.mjs
├── render.yaml        # blueprint de despliegue
└── docs/              # este documento
```

Flujo en producción:

```
[Navegador] ──HTTPS──▶ [Render Static: React compilado]
     │  REST /api/*  y  WebSocket /socket.io  (misma API_URL)
     ▼
[Render Web: Express] ──▶ [Motor en memoria] (partidas solo + salas)
     │                       (salas/partidas en RAM con expiración;
     │                        un redeploy las vacía: decisión consciente v1)
     ▼
[Neon PostgreSQL] (cuentas, ranking, historial vía SQL parametrizado)
```

Decisión clave: el **motor es puro e inmutable** (cada jugada devuelve un
estado nuevo, nunca muta). Eso lo hace testeable, determinista (rng inyectable)
y reutilizable en servidor y futuros clientes.

---

## 2. Stack exacto y por qué

| Capa | Tecnología | Motivo |
|---|---|---|
| Runtime | Node 20 (prod, `.node-version`); dev en 24 | LTS, ESM nativo |
| Motor | JS puro ESM, **cero dependencias** | Portabilidad y tests sin mocks |
| API | Express 4 + `express.json({limit:"64kb"})` | Simple, maduro; límite anti-DoS |
| Tiempo real | Socket.IO 4 (WS + polling fallback) | Reconexión y rooms; atraviesa proxies/túneles |
| BD driver | `pg` 8, pool (máx 10), SSL fuera de local | Pool reutiliza conexiones |
| Passwords | bcryptjs (10 rondas) | Hash con sal; jamás se guarda el claro |
| Sesiones | JWT HS256, expira 7 días | Stateless; `Authorization: Bearer` |
| Seguridad HTTP | helmet, cors restrictivo, rate-limit, `trust proxy` | Cabeceras, orígenes y abuso |
| Frontend | React 18 + Vite 5 + Tailwind 3 + socket.io-client | SPA rápida; utilidades CSS |
| Sonido | WebAudio sintetizado (cero archivos) | Efectos + loop musical sin assets |
| BD prod | PostgreSQL 16 (Neon, gratis) | Relacional: ranking e historial con JOINs |
| BD local | PostgreSQL 16 en Docker | Paridad con prod |
| Validación local | pg-mem | Schema/seed sin servidor (con parches, §8) |
| Deploy | Render (API Node + Static) + Neon + GitHub | Gratis, links fijos, deploys por push |
| Túnel previo | Cloudflare quick tunnel (retirado) | Solo fase de pruebas locales |

---

## 3. Motor de reglas (`packages/engine`, 28 tests)

- **Fichas:** 28 del doble-seis, `{left,right}` 0-6, igualdad insensible al orden.
- **Reparto:** 7 por jugador. 2j → pozo de 14 (se roba); 3j → 7 fuera de juego;
  4j → 28 exactas.
- **Salida:** el doble más alto en mano; sin dobles, mayor suma.
- **Encaje:** `connects/getValidSides`; la ficha se **orienta** según el extremo
  (`orientTileForSide`) y el tablero guarda fichas ya orientadas + `leftEnd/rightEnd`.
- **Robar:** solo sin jugada válida y con pozo (no avanza turno).
- **Pasar:** solo sin jugada y pozo vacío; N pases seguidos = **tranque**,
  gana el de menos puntos (empate → asiento menor).
- **Dominó:** quedarse sin fichas; puntos = suma de manos rivales.
- **Match:** `createMatch/applyRoundResult` acumulan a `targetScore`.
- **Errores tipados** `EngineError{code}`: `BAD_TILE, NOT_IN_HAND, ILLEGAL_MOVE,
  NOT_YOUR_TURN, HAS_PLAY, MUST_DRAW, POZO_EMPTY, ROUND_OVER…` (mensajes guía al cliente).
- **`autoMove`**: timeout del servidor — juega la primera válida, roba o pasa.

## 4. IA de bots (`server/src/game/ai.js`)

- **easy:** jugada válida al azar.
- **medium:** ordena por valor (dobles primero, `isDouble→+50`).
- **hard:** evalúa las 3 mejores y resta `opciones_rivales × 4` contando fichas
  no vistas (`createTiles − mano − mesa`): bloquea extremos frecuentes. Sin
  `seenTiles` degrada a medium.

## 5. API REST

Solo (memoria, sin login): `POST /api/solo`, `GET /api/solo/:id`,
`POST /api/solo/:id/play|draw|pass`, `POST /api/solo/:id/next-round`.
El estado público da **tu mano + conteos rivales + `playable/canDraw/canPass/
lastMove`** — jamás manos ajenas (cubierto por tests).

Cuentas (requiere BD): `POST /api/auth/register|login|guest`,
`GET /api/auth/me` (Bearer). Ranking/perfil/historial: `GET /api/ranking`,
`GET /api/users/:id`, `GET /api/users/:id/games`. Sin `DATABASE_URL` responden
503 con mensaje claro; el modo vs máquina sigue funcionando (diseño degradable).

## 6. Multijugador (`server/src/game/rooms.js` + sockets, 10 tests + E2E real)

- **Lobby:** `lobby:update` → salas abiertas + conectados (libre/en sala).
- **Salas:** código de 6 letras (sin 0/O/1/I), 2-4 jugadores, meta configurable.
  Crear/unirse/salir; el host (👑) inicia; si sale, el host rota.
- **Invitaciones:** `invite:send {to, code}` → `invite:received`; aceptar = unirse.
- **Partida:** el servidor guarda `match+round`; cada socket recibe
  `room:state` **personal** (su mano, nunca las ajenas).
- **Desconexión:** el asiento se conserva (reconexión por `userId`); a los 30 s
  en su turno el servidor juega por él (`autoPlay`); sala vacía = disuelta.
- **Anti-memoria:** `cleanupRooms/cleanupSoloGames` cada 15 min (lobbies y solos
  de +2 h) + tope de 500 salas.
- **Persistencia:** al cerrar el match se guarda con `saveGameResult`
  (transacción games+players+rounds+moves+stats; fire-and-forget sin romper el juego).
- Verificado con **2 clientes reales** (ronda completa por socket: crear →
  unirse → jugar → cerrar → siguiente).

## 7. Base de datos

Tablas: `users` (registrados con email+hash; invitados sin ambos, CHECK),
`rooms` (código, host, 2-4 jugadores), `games` (`room_id` NULL = vs máquina;
`winner_id` NULL = ganó un bot), `game_players` (`user_id` NULL = bot),
`rounds`, `moves` (`draw/pass` con fichas NULL), `user_stats` (una fila por
usuario, upsert en la misma transacción del resultado) y vista `v_ranking`
(`RANK() OVER (ORDER BY victorias, puntos)`).
Seed demo: alba/bruno/carla (`demo1234`) + sala ABIERT con partida e historial.

## 8. Correcciones durante el desarrollo (defiende esto)

1. **pg-mem no soporta `RANK() OVER` ni subselects en `INSERT…SELECT`.**
   `validate.mjs` usa vista/seed compatibles **solo localmente**; en Postgres
   real corre el SQL tal cual. Lección: validar igual, adaptar el arnés, no el producto.
2. **Bug crítico: jugador trabado sin jugada.** El motor sabía robar/pasar pero
   la API/UI no lo exponían. Se agregaron `draw/pass` (solo y online),
   `canDraw/canPass`, botones 🎣/⏭ y auto-robo/pase por timeout. Probado en vivo.
3. **Página en blanco:** `useMemo` usado sin importar → ReferenceError total.
   Lección: el build (esbuild) no detecta identificadores indefinidos; el error
   solo aparece en runtime.
4. **Túnel bloqueado por Vite** (`Blocked request`): faltaba `allowedHosts`
   para `*.trycloudflare.com` + `host:true`.
5. **`npm install socket.io-client` podó `react`** de `client/node_modules`
   (hoisting a root + caché `.vite` con rutas viejas) → reinstalación y borrado
   de caché. Lección: tras instalar, compilar y probar.
6. **CORS en producción:** `CLIENT_URL` provisional vs URL real con sufijo
   (`capicua-z92d…`, el nombre limpio estaba ocupado) → se actualizó la variable.
7. **Credencial de Neon expuesta en el chat** → rotación (`ALTER USER…`) y
   actualización en Render; verificado `db: ok`.

## 9. Seguridad (estado real)

Bien: sin puertos abiertos en casa (túnel saliente, ya retirado); SQL 100 %
parametrizado; bcrypt+JWT con secreto generado; validación de username anti-XSS
(`^[A-Za-z0-9_-]{3,32}$`); errores sin stack; helmet + rate-limit + JSON 64kb;
`.env` en `.gitignore`; JWT expira; login no enumera usuarios.
Riesgos asumidos/límites gratis: plan free duerme el backend (~50 s al despertar);
salas en RAM (un redeploy las vacía; escalar horizontal pediría Redis);
invitaciones por código compartido fuera de la app; link público = cualquiera entra.

## 10. Testing y verificación

- Motor: **28/28**. Servidor: **33 pass / 0 fail** (2 de integración con BD
  real se omiten sin `DATABASE_URL`).
- `node database/validate.mjs`: schema + seed + ranking + CHECKs en memoria.
- E2E sockets con 2 clientes reales: OK. Producción verificada:
  `health db:ok`, ranking, registro, login y partida solo por URL pública.

## 11. Posibles preguntas del profesor (respuestas de 1 línea)

- *¿Por qué motor separado?* → Puro, testeable y reutilizable; el servidor solo orquesta.
- *¿Por qué inmutabilidad?* → Sin efectos laterales: tests deterministas y sin corrupción de estado entre jugadores.
- *¿Cómo evitan ver manos ajenas?* → Vistas públicas por asiento en el servidor; el cliente nunca recibe el resto.
- *¿Por qué Socket.IO y no WS puro?* → Fallback a polling, reconexión y rooms; atraviesa proxies.
- *¿Y si se cae un jugador?* → Asiento reservado + auto-jugada a los 30 s; disolución si queda vacía.
- *¿Por qué Neon y no Render Postgres?* → El gratis de Render expira a los 90 días; Neon no.
- *¿Qué pasa si Render duerme?* → Cold start ~50 s una vez; luego normal.
- *¿Dónde está el riesgo mayor hoy?* → Estado en memoria (se pierde al redesplegar) y link público sin control de acceso: aceptados para el alcance v1.
