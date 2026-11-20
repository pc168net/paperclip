# Azure Image Build and Rebuild Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an operator-facing runbook for the first Docker image build and subsequent Paperclip upgrades on the Azure VM.

**Architecture:** Create a standalone Markdown document under `doc/` that uses the existing repository layout and Compose override. Separate first deployment from routine upgrades, and put verification and failure recovery after each workflow.

**Tech Stack:** Docker, Docker Compose, PostgreSQL 17, Caddy, Ubuntu 24.04, Markdown.

**Spec:** User-approved approach: create a separate deployment runbook rather than mixing deployment instructions into the Codex sandbox troubleshooting document.

## Global Constraints

- Never print or commit `.env`, passwords, SSH private keys, cookies, or tokens.
- Always run Compose with `--env-file .env`, `docker/docker-compose.yml`, and `docker-compose.override.yml`.
- Keep PostgreSQL and Paperclip port `3100` private; expose Paperclip through Caddy on ports `80/443`.
- Preserve the Codex runner requirements already documented: `NET_ADMIN`, `SYS_ADMIN`, unconfined AppArmor/seccomp, and the host sysctl when local Codex is enabled.
- Prefer fast-forward Git updates and back up the local Compose override before changing it.

## Review Focus

- A command must not accidentally expose PostgreSQL or port 3100; verify Compose port mappings.
- A rebuild must not delete the PostgreSQL named volume; avoid `down -v`.
- A failed image build due to OOM or disk exhaustion must have actionable recovery commands.
- A successful container start must be followed by HTTPS health and runner-log verification.
- Routine upgrades must preserve the local untracked override and `.env`.

---

### Task 1: Add the Azure deployment runbook

**Files:**
- Create: `doc/azure-deployment-build-rebuild.md`

**Interfaces:**
- Consumes: Existing `docker/docker-compose.yml`, root `docker-compose.override.yml`, `doc/azure-codex-native-session-troubleshooting.md`, and the documented Azure VM deployment decisions.
- Produces: A self-contained operator procedure for first build, normal upgrade, rollback/recovery, and verification.

- [ ] **Step 1: Document preflight checks**

Include VM resource checks, repository location, `.env` presence without displaying its contents, Docker/Compose versions, and a `tmux` recommendation for SSH sessions.

- [ ] **Step 2: Document the first image build and startup**

Use the exact Compose file ordering and `docker compose build` followed by `docker compose up -d`; explain that the first build can require at least 8 GB RAM, 4 GB swap, and approximately 64 GB disk.

- [ ] **Step 3: Document post-start verification**

Include `docker compose ps`, HTTPS `/api/health`, `docker inspect` security options/capabilities, private port inspection, and filtered server logs. Require `status: ok` and healthy PostgreSQL.

- [ ] **Step 4: Document routine upgrades**

Provide commands for `git pull --ff-only`, optional source inspection, rebuilding the image without removing volumes, recreating server services, and verifying Caddy/server/database status.

- [ ] **Step 5: Document failure recovery and safe rollback**

Cover OOM (`Exit status 137`), disk exhaustion (`no space left on device`), transient Caddy `502` during server recreation, and preserving database data. Include cache inspection/cleanup commands that do not remove volumes.

- [ ] **Step 6: Document security and maintenance rules**

State which files are local-only, prohibit secret output, explain why `down -v` is forbidden for normal upgrades, and link to the Codex sandbox troubleshooting document.

- [ ] **Step 7: Verify the document**

Run `git diff --check -- doc/azure-deployment-build-rebuild.md` and inspect the final Markdown for command consistency and absent secrets.
