# Penpot (Singularity)

Self-hosted [Penpot](https://github.com/penpot/penpot) — open-source Figma-like design tool — bundled for Singularity’s Design Preview flow.

## Requirements

- Docker / Podman with Compose
- Ports **9001** (Penpot UI) and **1080** (mailcatch, optional)

## Commands

```bash
./scripts/start.sh    # pull + start
./scripts/status.sh   # container + health
./scripts/stop.sh     # tear down
```

From the Singularity IDE: **Singularity AI: Start Penpot** / **Open Design Preview**.

## Flow

1. User asks Singularity to build a product UI
2. Design Director writes `.singularity/design-spec.json`
3. Singularity asks whether to open a Penpot-style preview
4. **Yes** → Design Preview panel (Spec board + Penpot iframe) → user clicks **Final Design** → coding
5. **No** → coding starts immediately from the Spec
