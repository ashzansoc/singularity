# Project Intelligence daemon

Standalone HTTP process for the Context Intelligence Layer.

```bash
npm run build -w @singularity/intelligence
SINGULARITY_WORKSPACE=/path/to/repo SINGULARITY_INTELLIGENCE_PORT=4781 \
  npx tsx services/project-intelligence/src/main.ts
```

The Singularity IDE also hosts the same Hono app in-process so Docker is not required.

## API

- `GET /context?q=`
- `POST /search`
- `POST /symbols`
- `POST /impact`
- `GET /dependencies?symbol=`
- `GET /architecture`
- `GET /project-status`
- `POST /events`
- `POST /lsp`
