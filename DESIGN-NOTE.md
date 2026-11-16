# DESIGN-NOTE.md

## Approach
I read every file once, listed risks, then ranked them by two questions: *can someone with no access use it?* and *what do they get?* That put the pipeline first (a stranger with a pull request gets secrets and deployment rights), committed secrets second (anyone with read access, and I cannot rotate them), the open debugger third. I fixed the cheap, high-impact items in the three required files, then did the "if time allows" items that cost little (`.dockerignore`, dev-only compose, NetworkPolicy, Dependabot, SBOM, `/livez` with a test). Details and the full list are in `RISKS.md`.

## Main choices and trade-offs
- **Untrusted code never sees a secret.** `pull_request` instead of `pull_request_target`, read-only token, and registry push and deploy only on `main`; the cluster credentials are used only in a protected Environment (`test-cluster`). Cost: PRs from forks cannot push images. Limit: the registry token is still read in the `image` job, so someone with write access could edit the workflow on a branch to reach it (see "What I cut", item 7).
- **`ClusterIP` instead of `LoadBalancer`.** Safer by default, but the team loses direct access to the test cluster until an Ingress with TLS exists (use `kubectl port-forward` meanwhile).
- **Plain `kubectl` instead of the contractor's `@main` deploy action.** Less magic and one less party receiving the kubeconfig; I wrote about 10 lines more in the pipeline.
- **Liveness and readiness split.** A database outage now stops traffic but does not restart pods.
- **`replicas: 1` kept** and a PodDisruptionBudget **not** added: stock data is held in memory, so more replicas would disagree, and a PDB with one replica would block node drains.
- **I edited `src/`** only for security and probe reasons (no secrets in logs, constant-time key check, limits, `/livez`). Port and environment variable names are unchanged.

## What I cut (precise)
1. **Rotation of the exposed secrets and the history rewrite.** I cannot do them; `RISKS.md` section 3 gives the order and the owners. This is the biggest open item.
2. **TLS Ingress** for the supplier launch, and the NetworkPolicy `from` restriction that goes with it.
3. **Supplier access model**: per-supplier keys, rate limiting, authenticated reads (a product decision).
4. **Egress policy and database manifests**: the DB location is not in the repository.
5. **Pinned digests and action SHAs**: written as `TODO verify`, not looked up.
6. **A secrets tool** (Sealed Secrets or SOPS+age): described in `RISKS.md` section 4, not implemented.
7. **Registry token isolation and GitHub settings.** The registry push is not split into a separate job in its own protected Environment, so the token is readable by a workflow edited on a same-repo branch. Branch protection, Environment reviewers and branch rules, and contractor access are listed in `RISKS.md` section 5 but cannot be changed from files.
8. **Real persistence** (the in-memory data), and any monitoring or audit trail of stock changes.
9. **Verification gaps**: no `docker build`, no pipeline run, no Trivy/gitleaks run, no cluster validation, and tests were run on one local Node version only (stated in the README), not on the Node 24 used by the Dockerfile and CI.

## Declaration of AI use
I used **Claude (Anthropic)** as a support tool, not as the author of the work. It helped me in two ways: it explained security concepts and gave me background information (for example how `pull_request_target` works, or what Sealed Secrets and SOPS are), and it acted as a second pair of eyes, pointing out inconsistencies between my working copy and the original and suggesting wording. It did not do the work for me.

**What I did myself:** I read the repository and the original files, decided which risks to fix and which to cut, and ranked them. I made and applied the changes to the files, added 3 tests to the 5 provided, ran the tests and the checks, and wrote and reviewed the documents. I treated every AI suggestion as something to check, and I kept, changed or rejected it myself.

**How I verified:** I ran `npm test` (8/8 pass, Node version in the README), parsed all YAML files with PyYAML, and searched the working tree to confirm that none of the original secret values remain.

**What I did not verify:** see "Not checked" in the README. I can explain every choice and change any file live.