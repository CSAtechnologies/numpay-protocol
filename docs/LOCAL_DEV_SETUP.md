# NUMPAY Local Dev Setup

Status: ACTIVE. Phase 1.
Last updated: 2026-05-22.

This is the only document that uses `.local` hostnames. Production hostnames live in `SECURITY_REQUIREMENTS.md` section 2.1.

## TLDR

1. Local-only repo. No remote push (ADR-015).
2. Docker Compose brings up Postgres 16 and Redis 7 on `127.0.0.1`.
3. Backend dev origin: `http://api.numpay.local:3000`. Web app dev origin: `http://app.numpay.local:5173`. Extension loaded unpacked from `extension/dist/`.
4. Tests live in `test-area/` and run with `pnpm tsx`.
5. No mainnet RPC keys in any `.env`. Testnet only.

## 1. Required tooling

| Tool | Version | Why |
|---|---|---|
| Node | 20.x LTS | Vite, NestJS, viem |
| pnpm | 9.x | Workspaces, deterministic installs |
| Docker | recent | Compose for Postgres + Redis |
| Docker Compose plugin | recent | Same |
| Chrome or Brave | recent | Extension dev |

The exact pinned versions go in `package.json#engines` and in `.tool-versions` at the repo root when the scaffold is created in Phase 1.

## 2. Repo layout (Phase 1 target)

```
.
|-- docs/                         # this doc set
|-- test-area/                    # Phase 0 scripts and Phase 1 additions
|-- extension/                    # MV3 extension (React + Vite)
|-- web/                          # web dashboard (Vite + React)
|-- backend/                      # NestJS API
|-- shared/                       # crypto core, types, JCS, schemas
|-- compose.yaml                  # Postgres + Redis for local dev
|-- package.json                  # pnpm workspace root
|-- pnpm-workspace.yaml
|-- pnpm-lock.yaml
|-- .env.example                  # names only; real .env stays out of git
|-- .editorconfig
|-- .gitignore
|-- README.md                     # short, points at docs/
```

Phase 0 has only `docs/` and `test-area/` plus this kickoff file set. The other directories appear after the M1 milestone.

## 3. Local hostnames

For local dev only.

| Hostname | Maps to | Service |
|---|---|---|
| `api.numpay.local` | `127.0.0.1` | Backend |
| `app.numpay.local` | `127.0.0.1` | Web app |
| `db.numpay.local` | `127.0.0.1` | Postgres |
| `redis.numpay.local` | `127.0.0.1` | Redis |

Hosts file additions (administrator privilege required to edit):
- Windows: `C:\Windows\System32\drivers\etc\hosts`
- macOS, Linux: `/etc/hosts`

```
127.0.0.1   api.numpay.local app.numpay.local db.numpay.local redis.numpay.local
```

These names appear in dev CSP only. They are never in the production CSP.

## 4. Docker Compose (target shape)

The actual file is committed in M1. Shape for reference:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    ports: ["127.0.0.1:5432:5432"]
    environment:
      POSTGRES_USER: numpay
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
      POSTGRES_DB: numpay_dev
    secrets: [postgres_password]
    volumes:
      - postgres_data:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
    ports: ["127.0.0.1:6379:6379"]
secrets:
  postgres_password:
    file: ./.secrets/postgres_password
volumes:
  postgres_data:
```

Notes.
- The Postgres port is bound to `127.0.0.1` only. No 0.0.0.0 binding ever.
- Secrets sit under `.secrets/` which is gitignored.

## 5. Environment file (.env shape)

Names only. Real values live in `.env` which is gitignored.

```
# Backend
NUMPAY_BACKEND_PORT=3000
NUMPAY_DATABASE_URL=postgres://numpay:***@db.numpay.local:5432/numpay_dev
NUMPAY_REDIS_URL=redis://redis.numpay.local:6379

# Backend signing key for payment intents (ed25519, hex private key, 32 bytes)
# Generated once at first run, never committed.
NUMPAY_INTENT_SIGNING_KEY_HEX=

# Web app
NUMPAY_API_BASE_URL=http://api.numpay.local:3000

# Extension build-time pins
NUMPAY_PIN_BACKEND_PUBKEY_HEX=
NUMPAY_PIN_API_ORIGIN=https://api.numpay.local
# In dev with self-signed certs this becomes http://; production uses https://

# Sepolia (testnet) RPC
SEPOLIA_RPC_INFURA=https://sepolia.infura.io/v3/
SEPOLIA_RPC_INFURA_KEY=
SEPOLIA_RPC_ALCHEMY=https://eth-sepolia.g.alchemy.com/v2/
SEPOLIA_RPC_ALCHEMY_KEY=
SEPOLIA_RPC_FALLBACK=https://ethereum-sepolia.publicnode.com

# Solana devnet RPC
SOLANA_DEVNET_RPC_PRIMARY=https://api.devnet.solana.com
SOLANA_DEVNET_RPC_SECONDARY=
```

No mainnet RPC keys. Ever. Until Phase 4 explicitly approves a pilot.

## 6. First-run sequence (Phase 1, once the scaffold exists)

1. `pnpm install --frozen-lockfile`
2. `cp .env.example .env` and fill values.
3. `mkdir -p .secrets && head -c 32 /dev/urandom | base64 > .secrets/postgres_password`
4. `docker compose up -d`
5. `pnpm --filter backend exec drizzle-kit migrate`
6. `pnpm --filter backend run dev`
7. `pnpm --filter web run dev`
8. `pnpm --filter extension run build && pnpm --filter extension run watch`
9. Load `extension/dist/` as an unpacked extension in Chrome or Brave.

In Phase 0, only steps 1, 2 in `test-area/`, plus running the scripts there.

## 7. Backend signing key (dev only)

For dev:

```
node -e "const {randomBytes}=require('node:crypto'); console.log(randomBytes(32).toString('hex'))"
```

Put the hex in `.env` as `NUMPAY_INTENT_SIGNING_KEY_HEX`. Derive the public key with the project's ed25519 helper and write it to `NUMPAY_PIN_BACKEND_PUBKEY_HEX` so the extension build can pin it.

Rotation in dev. Same procedure. Restart backend. Rebuild the extension. The audit log entries continue under the new key. Phase 3 will support overlapping signing keys for graceful prod rotation.

## 8. Testnet faucets

- Sepolia ETH: any reputable Sepolia faucet (search at implementation time; the right one rotates). Use the Alchemy or Infura faucet linked from their dashboards.
- Solana devnet SOL: `solana airdrop` CLI or the Phantom devnet faucet.

Do not use a single faucet address for all dev wallets. Generate per-dev addresses.

## 9. Running tests

```
pnpm run test         # vitest in all workspaces
pnpm run test:scripts # all test-area scripts
pnpm run audit        # pnpm audit --prod, fails on high or critical
pnpm run check        # the chain of the three above
```

In Phase 0, only `pnpm run test:scripts` is meaningful.

## 10. Browser extension dev

- Open `chrome://extensions`, enable Developer mode, click "Load unpacked", point at `extension/dist/`.
- The extension reloads on rebuild via `pnpm --filter extension run watch`.
- The popup is opened from the toolbar icon. The options page lives at `chrome-extension://<id>/options.html`.
- Service worker logs live in the extension's "service worker" link on the chrome://extensions page.

## 11. Common dev pitfalls

- Mixed lockfiles. Do not run `npm install` in a workspace; only `pnpm`.
- `Math.random` in any path. The lint rule will fail the build. Use `crypto.getRandomValues`.
- Logging an object that contains the mnemonic or a derived key. `test-area/verify_no_secret_logging.ts` catches this. Use the structured logger only.
- Hard-coded RPC URLs. Use the env-fed config.
- Bumping a crypto library without an ADR update. Don't.

## 12. Cleanup

```
docker compose down -v   # stop and wipe Postgres volume
rm -rf .secrets          # only after you accept losing the local password
```

## 13. References

- Docker Compose. https://docs.docker.com/compose/
- pnpm workspaces. https://pnpm.io/workspaces
- Drizzle ORM. https://orm.drizzle.team/
- Sepolia testnet. https://ethereum.org/developers/docs/networks#sepolia
- Solana devnet. https://docs.solana.com/clusters
