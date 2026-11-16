# RISKS.md: StockDesk delivery chain review

Scope: everything in this repository (code, Dockerfile, compose, CI pipeline, Kubernetes manifests).
Not in scope because not visible: the real cluster, the registry, GitHub settings, the database server.
Severity = how bad if exploited **and** how easy it is, considering that about 40 people (one external) can read the repository and that StockDesk opens to external suppliers next month.
Status: **Fixed** (removed in this repo), **Reduced** (partly handled), **Left** (not handled, reason given).

## 1. Prioritised list

| # | Risk | Where (in the original) | What could concretely happen | Severity | What I did |
|---|---|---|---|---|---|
| R1 | **CI takeover by anyone who can open a pull request** | `ci.yml`: `pull_request_target` + checkout of the PR head + `permissions: write-all` + secrets, and `deploy` runs for every push on every branch | A fork PR changes `package.json` ("test" script) or any file run by the build. It runs with a write token and the secrets, steals the registry token and kubeconfig, pushes an image and deploys it to the cluster | **Critical** | **Fixed for fork PRs, reduced for same-repo branches**: `pull_request` (no secrets for forks), `contents: read`, push and deploy on `main` only, deploy behind a protected Environment. **Left**: see R19 |
| R2 | **Credentials committed in the repository** | `.env` (DB password, API key; header says "production, copied from the ops wiki"), `docker-compose.yml` (same DB password), `k8s/secret.yaml` (same values in base64, which is not encryption), `ci.yml` (registry token) | Any of the ~40 readers, the contractor, or anyone who ever cloned/forked can log in to the database, call the write API, push images. History keeps them forever | **Critical** | **Reduced**: removed from the tree, ignored, replaced by examples. **Left**: they are still valid and still in Git history until rotated (section 3) |
| R3 | **Node debugger open to the network** | `Dockerfile` (`--inspect=0.0.0.0:9229`, `EXPOSE 9229`), `docker-compose.yml` (port published), `deployment.yaml` + Service `LoadBalancer` port 9229 | The inspector has no authentication: anyone who reaches the port runs arbitrary code in the process and reads its environment (DB password, API key) | **Critical** | **Fixed**: no `--inspect`, no port anywhere |
| R4 | **Public, unencrypted exposure** | `Service type: LoadBalancer`, port 80, no TLS, no NetworkPolicy | The API key travels in clear text; the service is reachable from anywhere; anyone on the path can read or replay it | **High** | **Reduced**: `ClusterIP`, default-deny ingress NetworkPolicy. **Left**: the Ingress with TLS suppliers will need (needs cluster details I do not have) |
| R5 | **Secrets copied into artifacts: image and logs** | `Dockerfile` `COPY . .` with no `.dockerignore` (copies `.env` into the image); `server.js` logs the whole config including password and API key at startup | Anyone able to pull the image (registry, any cluster node) gets the secrets; so does anyone who reads logs (and log tools often have wide access) | **High** | **Fixed**: `.dockerignore`, explicit `COPY`, redacted startup log (+ test) |
| R6 | **API not ready for external suppliers** | `server.js` | One shared API key for everyone (no per-supplier identity, revocation or audit); `GET /api/products` open to all; no rate limit | **High** (launch blocker) | **Reduced**: constant-time key check, body limit (10 KB), request timeouts. **Left**: per-supplier keys, rate limiting, read authentication (product decision) |
| R7 | **Mutable supply chain** | `node:latest`, `postgres:latest`, image tag `latest`, `corvane-labs/k8s-deploy-action@main` (receives the kubeconfig), action tags, `npm install` | A new upstream image or a change on the third-party action's `main` branch silently changes what we build and deploy, or steals the kubeconfig | **High** | **Reduced**: pinned major tags, per-commit image tag, third-party deploy action replaced by plain `kubectl`, Dependabot. **Left**: digests and action SHAs are `TODO verify` (I could not look them up) |
| R8 | **Pipeline does not protect anything** | `npm test \|\| true`; no scan of any kind | A broken or malicious change ships anyway; vulnerable base image or leaked secret goes unnoticed | **High** | **Fixed**: tests gate, gitleaks, Trivy (config + image), SBOM |
| R9 | **Script injection in the pipeline** | `echo "Building '${{ github.event.pull_request.title }}'..."` | A PR title containing shell syntax runs commands on the runner (with secrets, given R1) | **High** | **Fixed**: step removed; no untrusted `${{ }}` inside `run:` |
| R10 | **Container runs as root, no limits** | `Dockerfile` (no `USER`), `deployment.yaml` (no securityContext, resources, default namespace, token mounted) | A flaw in the app gives root in the container and an easier escape; a loop can starve the node | **Medium** | **Fixed**: non-root uid 10001, read-only filesystem, no capabilities, seccomp, limits, own namespace with `restricted` Pod Security, no service-account token |
| R11 | **Liveness probe depends on the database** | `deployment.yaml` probes `/health` (1 s timeout, 2 failures) | A short DB blip makes Kubernetes kill every pod: a small incident becomes an outage | **Medium** (availability) | **Fixed**: `/livez` for liveness (+ test), `/health` for readiness, saner timeouts |
| R12 | **Dev conveniences reachable on shared servers** | `docker-compose.yml`: 5432 and 9229 published, password inline, `restart: always`, `postgres:latest` | The compose file is labelled "test-server stack": the database and debugger could be open on a server | **Medium** | **Fixed**: dev-only, bound to 127.0.0.1, DB not published, password from ignored `.env`, pinned tag |
| R13 | **Egress and DB location unknown** | no DB manifest in `k8s/`; `DB_HOST=db` | A compromised pod can reach anything the cluster can reach | **Medium** | **Left**: no egress policy, because a wrong one breaks the app and I cannot test it |
| R14 | **No repository / GitHub controls visible** | not in files | Without branch protection and required reviews, one account (or the contractor) can push to `main`, which now deploys | **Medium** | **Left**: settings, not files; listed in section 5 |
| R15 | **Data lives in memory** | `server.js` `products` | Every restart loses stock adjustments; more than one replica would show different numbers. Integrity/availability, not security | **Medium** | **Left** on purpose: `replicas: 1` kept and commented. Needs the real PostgreSQL layer |
| R16 | **Denial of service by slow or large requests** | `server.js` unlimited body, default timeouts | One client can hold memory/sockets | **Medium** | **Fixed** (limit, timeouts) |
| R17 | **Unclean shutdown** | Node as PID 1 ignores SIGTERM | Slow rollouts (30 s kill), dropped requests | **Low** | **Fixed** (SIGTERM handler) |
| R18 | **Minor** | `/health` is public and reveals DB state; marker file in tmp; no audit trail of stock changes | Information leak / forensics gap | **Low** | marker file made best-effort; rest **Left** |
| R19 | **Registry token readable from a same-repo branch** | new `ci.yml`: `REGISTRY_TOKEN` is used in the `image` job, which also runs on pull requests and is not in a protected Environment | Someone with write access to the repository (for example the contractor, if they have it) edits the workflow on a branch and prints the token. The `if: push main` guard on the step does not help, because the edited workflow runs from their branch. Fork PRs are not affected (no secrets) | **Medium** | **Left**: the clean fix is a separate `publish` job in its own protected Environment (build, hand the image over as an artifact, push there). Not done for lack of time; branch protection and restricting contractor access (section 5) reduce it meanwhile |
| R20 | **NetworkPolicy may block health probes** | `k8s/networkpolicy.yaml` (default-deny ingress) | Depending on the network plugin, probe traffic from the node can be blocked and the pod never becomes ready | **Low** | **Left**: TODO verify on the test cluster (needs a cluster I do not have) |

## 2. Why this order (top five)

1. **R1 first**: it is the only path where a stranger with no credentials gets code execution **and** every secret **and** deployment rights, in one step. It also makes every other secret worthless to protect. Cheapest to fix (a few lines).
2. **R2 second**: it needs no skill at all, only read access (about 40 people, incl. an external one, plus every past clone). Ranked below R1 only because R1 needs no access whatsoever. It is the one I **cannot** finish myself, hence the plan below. The CTO's "tests only" belief is contradicted by the file itself (production wording, ops wiki origin, same value in the cluster Secret), so I treat it as production.
3. **R3**: unauthenticated remote code execution if the port is reachable, and the original Service published it on a public load balancer. Severe but conditional on network reachability, so after the two "everyone can already read it" items.
4. **R4**: with suppliers coming, an HTTP-only public API carrying a key is the next realistic attack (sniffing, replay). Ranked after R3 because it needs a network position, not code execution.
5. **R5**: turns a harmless-looking asset (the image, the logs) into a secret store with a wide audience. Easy to fix, and fixing it also protects against the R2 secrets being baked into old images (old images in the registry must still be deleted or the secrets rotated).

R6 is intentionally just below the top five: it is the biggest **launch** risk, but it is a design decision for the product owner, not something to patch silently in a review.

## 3. What is exposed and what must be done (R2 in detail)

**Assume all four credentials are compromised, whatever the CTO believes.** Removing a file from the latest commit does not un-leak it: **rotation is what fixes it; rewriting history is only hygiene and comes last.**

| Secret | Where it was | Who |
|---|---|---|
| Database password | `.env`, `docker-compose.yml`, `k8s/secret.yaml` (same value everywhere), the ops wiki, possibly the real DB | Ops / DBA |
| API key | `.env`, `k8s/secret.yaml`, callers of the API | Dev lead + whoever owns the API consumers |
| Registry deploy token | `ci.yml` (and printed in the CI logs by the old `echo`) | Registry admin |
| Cluster credentials (`KUBECONFIG` secret) | GitHub secret; exposed to untrusted code by R1, not committed | Cluster admin |

Order (all on the same day, in this order, because the first two let an attacker ship code, the others only read or write data):

1. **CTO names one incident owner** and decides to treat this as a security incident (30 minutes). Freeze merges to `main` and disable the old workflow (or merge this one) so nothing new deploys with the old setup.
2. **Registry admin**: revoke the leaked deploy token, issue a new one, and store it as the repository secret `REGISTRY_TOKEN` (the `image` job reads it; moving it to an Environment needs the publish-job split described in R19). Check the registry push history for images you do not recognise; rebuild what you ship from a known commit; delete old images (they contain the old `.env`).
3. **Cluster admin**: replace the credentials behind the `KUBECONFIG` secret (new service account/token with rights on the `stockdesk` namespace only), revoke the old one, and keep the new one as a secret of the `test-cluster` Environment. Review cluster audit logs for unknown applies/exec.
4. **DBA/ops**: change the database password on the server first, then create the Kubernetes secret with the new value (see section 4), then restart the app. Check if the old password was reused anywhere else (other services, personal copies) and change those too. **Edit the ops wiki page and its history**, otherwise the old value stays there.
5. **Dev lead**: issue a new API key, tell the API consumers, switch over (the app accepts one key at a time, so agree a short window).
6. **Look for misuse** (security + ops): DB connection logs from unknown addresses, API requests with the old key from unknown addresses, stock adjustments nobody can explain, GitHub Actions run history and the organisation audit log (fork PRs, new deploy keys), whether ports 9229/5432 were reachable from outside, and a quick review of who still has repository access (the contractor who left; the external reader).
7. **Repo admin, last**: rewrite history to remove `.env`, `k8s/secret.yaml` and the old `ci.yml` values (git-filter-repo or BFG, on a fresh mirror clone), force-push once, ask all ~40 people to re-clone (not pull), close old PRs/forks that hold the values, and ask GitHub support to purge cached views if the host is GitHub. Do this only **after** steps 2 to 5: everyone has already had the old values for months.
8. **Prevent a repeat**: keep the `secret-scan` job (gitleaks); add a local pre-commit hook for it; turn on GitHub secret scanning and push protection if the plan includes it (TODO verify availability for private repositories on your plan).

## 4. Secrets going forward (Kubernetes, no vault)

Today (works now): an administrator creates the Secret directly in the cluster. Values never go on the command line (shell history, process list) and never into the repository:

```
# 1. umask 077, then create a temporary file OUTSIDE the repository, for example "$HOME/stockdesk.env",
#    with one KEY=value line per variable (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, API_KEY).
# 2. Create or update the secret from that file:
kubectl -n stockdesk create secret generic stockdesk-env \
  --from-env-file="$HOME/stockdesk.env" --dry-run=client -o yaml | kubectl apply -f -
# 3. Delete the temporary file right away.
# After a rotation, restart so pods read the new values:
kubectl -n stockdesk rollout restart deployment/stockdesk
```

The pipeline only checks that the secret exists. Weaknesses: nobody can review the change, and the cluster is the only copy.

Better, still free, when the team has time (not implemented here): **Sealed Secrets** (encrypted secret files can be committed; only the cluster can decrypt) or **SOPS with age** (encrypted file in Git, key held by two administrators). Also enable encryption at rest for Secrets in the cluster and limit who can `get secrets` (RBAC). A real vault is the next step, not a requirement for 30 people.

## 5. Settings outside the files (recommended, not done)

- Branch protection on `main`: pull request required, one reviewer, status checks (`test`, `secret-scan`, `image`) required, no force-push (except the one planned history rewrite).
- GitHub Environment `test-cluster`: required reviewers, deployment only from `main`; keep `KUBECONFIG` there, as an environment secret.
- Registry token (R19): until the publish job is split into its own Environment, limit who has write access to the repository and keep branch protection on.
- Repository access: external contractor read-only and only if still needed; Actions: "approve first-time contributors", default workflow token read-only.
- Registry: immutable tags if available.