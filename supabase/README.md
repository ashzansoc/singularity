# Singularity beta quota + per-user OpenRouter keys (Supabase)

Project: `nuwsczuwyezpodtnouqf`

## User profiles & subscriptions

On every login/register (`POST /llm-proxy/v1/register`):

1. **`user_profiles`** — email, GitHub username/id, display name, avatar, auth provider
2. **`subscription_started_at`**, plan (`monthly_unlimited`), status (`active`)
3. **`user_openrouter_keys`** — encrypted per-user OpenRouter API key

Billing is enforced in Singularity (monthly unlimited plan), **not** via OpenRouter pay-per-use limits. Each OpenRouter key is created with **no spending limit** (`limit: null`).

OpenRouter dashboard shows keys named `github:<username>` (or `singularity:<email-local>` for email-only signups).

## Per-user OpenRouter keys

- Provisioned via [OpenRouter Management API](https://openrouter.ai/docs/guides/overview/auth/management-api-keys) on first login
- Stored encrypted in Postgres (`pgp_sym_encrypt`) — never exposed in Supabase client RLS
- Returned once to the IDE in the `/register` response → saved to `~/.singularity/beta-auth.json` as `openrouterApiKey` (hidden from UI)
- `llm-proxy` uses the user's key for upstream OpenRouter requests (fallback: shared `OPENROUTER_API_KEY`)

## Edge Function

`llm-proxy` — OpenAI-compatible proxy at:
`https://nuwsczuwyezpodtnouqf.supabase.co/functions/v1/llm-proxy/v1`

### Required secrets

```bash
supabase secrets set \
  OPENROUTER_MANAGEMENT_API_KEY=sk-or-v1-... \
  OPENROUTER_KEY_ENCRYPTION_SECRET='long-random-string' \
  OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

Optional fallback (shared workspace key during migration):

```bash
supabase secrets set OPENROUTER_API_KEY=sk-or-v1-...
```

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/register` | Sync profile, provision key, return gateway credentials |
| GET | `/v1/quota` | Usage stats (informational) |
| POST | `/v1/chat/completions` | Chat proxy (uses per-user OpenRouter key) |
| GET | `/v1/models` | Models list |

## Auth

Enable providers in **Authentication → Providers**:

- **Email** — magic link / OTP (current beta flow)
- **GitHub** — recommended; key name uses `github:<username>`

For GitHub OAuth, set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in Supabase Auth settings and add redirect URLs:

```
https://singularity-ide.web.app/auth/beta.html
singularity://beta-auth
```

## Deploy

```bash
supabase link --project-ref nuwsczuwyezpodtnouqf
supabase db push
supabase secrets set OPENROUTER_MANAGEMENT_API_KEY=... OPENROUTER_KEY_ENCRYPTION_SECRET=...
supabase functions deploy llm-proxy --use-api
```

## Tables

| Table | Purpose |
|-------|---------|
| `user_profiles` | User identity + subscription |
| `user_openrouter_keys` | Encrypted per-user OpenRouter keys |
| `beta_users` / `beta_devices` | Legacy usage tracking |
| `beta_usage_events` | Per-request audit log |

View users: **Table Editor → `user_profiles`**. OpenRouter keys visible by name in the [OpenRouter dashboard](https://openrouter.ai/settings/keys), not in Supabase plaintext.
