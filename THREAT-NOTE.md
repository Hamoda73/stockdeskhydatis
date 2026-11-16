# THREAT-NOTE.md: StockDesk delivery chain (one page)

**What is protected.** (1) Stock data and the right to change it (the `adjust` endpoint). (2) Credentials: DB password, API key, registry token, cluster access. (3) The ability to ship code into the cluster. (4) Corvane's relationship with the suppliers who will use the API next month.

**Who could attack.** An outsider who can open a pull request or find the public IP; a supplier (hostile, or with a stolen key); an insider or the external contractor with read access to the repository (about 40 people); an upstream component (base image, third-party action).

## Four realistic attack paths

| # | Path | What cuts it (this delivery) | What remains |
|---|---|---|---|
| A | **Pull request to cluster.** Outsider opens a PR; the old `pull_request_target` workflow runs their code with a write token and secrets; they deploy their own image. | `pull_request` trigger (fork PRs get no secrets), read-only token, registry push and deploy only on `main`, cluster deploy in the `test-cluster` Environment, no `${{ }}` of untrusted text in `run:` | Someone with **write access** can edit the workflow on a branch and read the registry token, which the `image` job uses outside an Environment (RISKS.md R19). A malicious change **merged** by a reviewer, or a stolen maintainer account. Branch protection and Environment reviewers are settings, not done. Old logs/runs may hold the old token |
| B | **Read the repo, use the secrets.** Anyone with read access takes the DB password, API key and registry token from `.env`, compose, `secret.yaml`, `ci.yml`, or Git history. | Removed from the tree, `.gitignore`, `.dockerignore`, gitleaks in CI, no secrets in logs or image | **The secrets are still valid and still in history until rotated** (RISKS.md section 3). This is the biggest open item |
| C | **Internet to debugger.** Scan finds the LoadBalancer, connects to port 9229, runs code in the process, reads its environment. | No `--inspect`, no 9229 anywhere, `ClusterIP` Service, default-deny NetworkPolicy, non-root, read-only filesystem, no capabilities | Public access will return when an Ingress is added: it must be TLS-only and expose port 3000 only. Pod egress is not restricted |
| D | **Poisoned upstream.** `node:latest` or `k8s-deploy-action@main` changes under us (or is compromised) and ships or steals credentials. | Third-party deploy action removed, pinned major tags, per-commit image tag, Trivy scan, SBOM, Dependabot | Digests and action SHAs are `TODO verify` (not looked up), so tags are still mutable. The SBOM is produced but nobody watches it yet |

**Also worth a line.** A supplier with a valid key can change any stock level (one shared key, no per-supplier identity, no rate limit, open reads). I made the endpoint harder to abuse (constant-time check, body limit, timeouts) but did not change the access model: it is a product decision to take before launch.

**Honest summary.** The paths an unknown outsider could use today (A from a fork, C) are closed in the files. Path A is only reduced for people with write access to the repository (R19), and path B, the one an insider can use today, is only closed once the four credentials are rotated, which only Corvane's administrators can do.