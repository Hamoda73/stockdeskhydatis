# StockDesk

Hardened delivery chain for Corvane's StockDesk API (fictional). Port 3000 and env var names are unchanged.

## Run and test
- Test: `npm test` (Node 18+, no dependencies)
- Run locally: `cp .env.example .env`, edit the example values, then `docker compose up --build` (dev only, bound to 127.0.0.1)
- Check YAML: parse every `*.yml` / `*.yaml` (I used PyYAML)

## Where things are
- `.github/workflows/ci.yml`: pipeline (tests, gitleaks, Trivy, SBOM, push and deploy on main only)
- `Dockerfile`, `.dockerignore`: non-root, minimal image, no debugger
- `k8s/`: deployment, namespace, NetworkPolicy, `examples/secret.example.yaml` (never deployed)
- `RISKS.md` (prioritised risks and secret rotation steps), `THREAT-NOTE.md`, `DESIGN-NOTE.md`
- The secret values in the original repo come from the brief and are fictional; none remain in this tree.

## Checked
- `npm test`: 8/8 pass (Node <YOUR VERSION>)
- All YAML files parse (PyYAML)
- Live smoke test of the server
- No original secret value in the working tree

## Not checked
- No `docker build`, no pipeline run, no Trivy or gitleaks run, no cluster validation
- Tests not run on Node 24 (the version used by the Dockerfile and CI)
- Action SHAs, image digests and tool versions are marked `TODO verify`