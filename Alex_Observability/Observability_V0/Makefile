# Observability_V0 — run from this directory
# Usage: make setup, make typecheck, make lint, make dev
#
# Dev API: use "make backend" or "make run-backend" (hyphen). Vite proxies /api → http://localhost:8000 by default
# (see vite.config.ts BACKEND_TARGET_URL). Do NOT use "make run backend" (space) — that only runs the frontend.

PYTHON        ?= python3
VENV          := .venv
VENV_BIN      := $(VENV)/bin
BACKEND       := backend
BACKEND_PORT  ?= 8000
RELEASE_VERSION ?= 0.0.0-dev
RELEASE_DIR   := release-artifacts

.PHONY: setup setup-js setup-py typecheck typecheck-js typecheck-py lint lint-js lint-py lint-fix format-fix format-fix-py dev run run-backend backend db-migrate seed-lab run-agent fetch-protocol copy-protocol-to-jupyter help build-release build-release-agent test-release test-release-agent

# --- Setup ---
setup: setup-js setup-py
	@echo "Setup complete. Activate Python venv with: source $(VENV_BIN)/activate"

setup-js:
	@echo "Installing JS deps..."
	npm ci 2>/dev/null || npm install
	@echo "setup-js done."

setup-py:
	@echo "Creating Python venv..."
	$(PYTHON) -m venv $(VENV)
	$(VENV_BIN)/pip install --upgrade pip
	@if [ -f $(BACKEND)/requirements.txt ]; then \
		echo "Installing Python deps from $(BACKEND)/requirements.txt..."; \
		$(VENV_BIN)/pip install -r $(BACKEND)/requirements.txt; \
	else \
		echo "No backend/requirements.txt found; venv ready."; \
	fi
	@echo "setup-py done. Use: source $(VENV_BIN)/activate"

# --- Typecheck ---
typecheck: typecheck-js typecheck-py
	@echo "Typecheck passed."

typecheck-js:
	@echo "Typecheck (JS/TS)..."
	npm run typecheck
	@echo "typecheck-js done."

typecheck-py:
	@if [ -d $(VENV) ] && $(VENV_BIN)/python -c "import mypy" 2>/dev/null; then \
		echo "Typecheck (Python backend)..."; \
		$(VENV_BIN)/mypy $(BACKEND) --ignore-missing-imports 2>/dev/null || true; \
	else \
		echo "Skipping typecheck-py (venv or mypy not ready)."; \
	fi

# --- Lint ---
lint: lint-js lint-py
	@echo "Lint passed."

lint-js:
	@echo "Lint (JS/TS)..."
	npm run lint
	@echo "lint-js done."

lint-fix:
	@echo "Lint fix (JS/TS)..."
	npm run lint:fix
	@echo "lint-fix done."

lint-py:
	@if [ -d $(VENV) ] && $(VENV_BIN)/python -c "import ruff" 2>/dev/null; then \
		echo "Lint (Python backend)..."; \
		$(VENV_BIN)/ruff check $(BACKEND) 2>/dev/null || true; \
	else \
		echo "Skipping lint-py (venv or ruff not ready)."; \
	fi

# --- Format fix (lint-fix + format + typecheck) ---
format-fix: lint-fix format-fix-py typecheck
	@echo "Format-fix complete. Lint and typecheck have been run."

format-fix-py:
	@if [ -d $(VENV) ] && $(VENV_BIN)/python -c "import ruff" 2>/dev/null; then \
		echo "Format fix (Python backend)..."; \
		$(VENV_BIN)/ruff check $(BACKEND) --fix 2>/dev/null; \
		$(VENV_BIN)/ruff format $(BACKEND) 2>/dev/null; \
		echo "format-fix-py done."; \
	else \
		echo "Skipping format-fix-py (venv or ruff not ready)."; \
	fi

# --- Run ---
dev run: run-dev

run-dev:
	@echo "Starting Vite dev server..."
	npm run dev

# Backend API — listens on http://localhost:$(BACKEND_PORT) (override: make backend BACKEND_PORT=8001).
# Run in a separate terminal from Vite so /api proxy (default target above) can connect.
run-backend:
	@echo "Starting FastAPI on http://localhost:$(BACKEND_PORT) (Vite proxies /api here unless BACKEND_TARGET_URL is set)"
	cd $(BACKEND) && ../$(VENV_BIN)/uvicorn demo_api:app --reload --port $(BACKEND_PORT)

# Alias: "make backend" — same as run-backend (avoids confusion with "make run backend", which is not this).
backend: run-backend

# --- Cloud (require DATABASE_URL) ---
db-migrate:
	@echo "Running Alembic migrations (set DATABASE_URL)..."
	cd $(BACKEND) && ../$(VENV_BIN)/alembic upgrade head

seed-lab:
	@echo "Seeding a lab and printing agent token (set DATABASE_URL, optional: make seed-lab LAB_NAME=\"My Lab\")..."
	cd $(BACKEND) && ../$(VENV_BIN)/python -m scripts.seed_lab "$(LAB_NAME)"

run-agent:
	@echo "Run the relay agent: export LAB_ID AGENT_TOKEN BACKEND_URL; optional: ROBOT_POLL_INTERVAL_SECONDS"
	@echo "  $(VENV_BIN)/python agent/run_agent.py"
	@echo "Or: AGENT_ARGS='--config=agent/agent_config.json' make run-agent"
	$(VENV_BIN)/python agent/run_agent.py $(AGENT_ARGS)

# Fetch protocol for a run (works without backend: talks to robot directly if backend unreachable)
fetch-protocol:
	@if [ -z "$(ROBOT_IP)" ]; then \
		echo "Usage: make fetch-protocol ROBOT_IP=198.51.100.73 RUN_ID=0a6af184-4cf1-4a16-aef2-fec1c2e299c0"; \
		echo "  Run from Observability_V0 dir. No backend required."; \
		exit 1; \
	fi
	cd $(BACKEND) && ../$(VENV_BIN)/python -m scripts.fetch_protocol_for_run "$(ROBOT_IP)" "$(RUN_ID)"

# List protocols or copy protocol to Jupyter (run on robot so /data and /var/data exist)
# Use RUN_ID to resolve protocol from run: make copy-protocol-to-jupyter ROBOT_IP=198.51.100.24 RUN_ID=0a6af184-...
# To only list protocol IDs: cd backend && ../.venv/bin/python -m scripts.copy_protocol_to_jupyter ROBOT_IP --list
copy-protocol-to-jupyter:
	@if [ -z "$(ROBOT_IP)" ]; then \
		echo "Usage: make copy-protocol-to-jupyter ROBOT_IP=198.51.100.24 [PROTOCOL_ID=uuid | RUN_ID=run_uuid]"; \
		exit 1; \
	fi
	@if [ -n "$(RUN_ID)" ]; then \
		cd $(BACKEND) && ../$(VENV_BIN)/python -m scripts.copy_protocol_to_jupyter "$(ROBOT_IP)" --run-id "$(RUN_ID)"; \
	else \
		cd $(BACKEND) && ../$(VENV_BIN)/python -m scripts.copy_protocol_to_jupyter "$(ROBOT_IP)" $(PROTOCOL_ID); \
	fi

# --- Release (local build/test; mirrors .github/workflows/release.yml) ---
# Build only the agent (use when frontend has issues or to quick-validate agent packaging).
build-release-agent:
	@echo "Building Python agent only (VERSION=$(RELEASE_VERSION))..."
	@sed -i.bak "s/^version = .*/version = \"$(RELEASE_VERSION)\"/" agent/pyproject.toml && rm -f agent/pyproject.toml.bak
	@if command -v uv >/dev/null 2>&1; then \
		uv build agent/; \
	else \
		$(VENV_BIN)/pip install build -q && cd agent && $(VENV_BIN)/python -m build && cd ..; \
	fi
	@mkdir -p $(RELEASE_DIR)
	@rm -f $(RELEASE_DIR)/observability_agent-*.whl $(RELEASE_DIR)/observability_agent-*.tar.gz
	@cp agent/dist/*.whl agent/dist/*.tar.gz $(RELEASE_DIR)/ 2>/dev/null || true
	@echo "Agent artifacts in $(RELEASE_DIR)/:"
	@ls -la $(RELEASE_DIR)/

build-release:
	@echo "Building release artifacts (VERSION=$(RELEASE_VERSION))..."
	@sed -i.bak "s/^version = .*/version = \"$(RELEASE_VERSION)\"/" agent/pyproject.toml && rm -f agent/pyproject.toml.bak
	@echo "Building frontend..."
	npm run build
	@echo "Building Python agent..."
	@if command -v uv >/dev/null 2>&1; then \
		uv build agent/; \
	else \
		$(VENV_BIN)/pip install build -q && cd agent && $(VENV_BIN)/python -m build && cd ..; \
	fi
	@mkdir -p $(RELEASE_DIR)
	@echo "Zipping frontend dist..."
	@cd dist && zip -rq ../$(RELEASE_DIR)/observability-v0-frontend-$(RELEASE_VERSION).zip . && cd ..
	@rm -f $(RELEASE_DIR)/observability_agent-*.whl $(RELEASE_DIR)/observability_agent-*.tar.gz
	@cp agent/dist/*.whl agent/dist/*.tar.gz $(RELEASE_DIR)/ 2>/dev/null || true
	@echo "Release artifacts in $(RELEASE_DIR)/:"
	@ls -la $(RELEASE_DIR)/

test-release: build-release
	@echo "Installing wheel and testing CLI..."
	$(VENV_BIN)/pip install --force-reinstall $$(ls -t $(RELEASE_DIR)/observability_agent-*.whl 2>/dev/null | head -1) -q
	$(VENV_BIN)/observability-agent --help
	@echo "test-release OK."

test-release-agent: build-release-agent
	@echo "Installing wheel and testing CLI..."
	$(VENV_BIN)/pip install --force-reinstall $$(ls -t $(RELEASE_DIR)/observability_agent-*.whl 2>/dev/null | head -1) -q
	$(VENV_BIN)/observability-agent --help
	@echo "test-release-agent OK."

# --- Help ---
help:
	@echo "Observability_V0 Makefile (run from this directory)"
	@echo ""
	@echo "Setup:"
	@echo "  make setup       - Install JS and Python deps (recommended first)"
	@echo "  make setup-js    - Install npm deps"
	@echo "  make setup-py    - Create .venv and install backend requirements"
	@echo ""
	@echo "Quality:"
	@echo "  make typecheck   - Run TypeScript and Python type checks"
	@echo "  make lint       - Run ESLint and Ruff (Python)"
	@echo "  make lint-fix   - Auto-fix lint where possible"
	@echo "  make format-fix - Lint-fix + Python format + typecheck (fix all, then verify)"
	@echo ""
	@echo "Run:"
	@echo "  make dev         - Start Vite dev server (same as make run)"
	@echo "  make backend     - Start FastAPI on http://localhost:8000 (same as make run-backend; use another terminal)"
	@echo "  make run-backend - Same as make backend (BACKEND_PORT=8000 by default; override if needed)"
	@echo "  make fetch-protocol ROBOT_IP=198.51.100.73 RUN_ID=<run_id> - Fetch run + protocol from robot (no backend needed)"
	@echo "  make copy-protocol-to-jupyter ROBOT_IP=... [PROTOCOL_ID=uuid | RUN_ID=run_uuid] - Resolve from run, find protocol dir, copy .py to Jupyter (run on robot)"
	@echo ""
	@echo "Cloud (DATABASE_URL required for db-migrate / seed-lab):"
	@echo "  make db-migrate  - Run Alembic migrations (cd backend, alembic upgrade head)"
	@echo "  make seed-lab    - Create a lab and print agent token (optional: LAB_NAME=\"My Lab\")"
	@echo "  make run-agent   - Start relay agent (set LAB_ID, AGENT_TOKEN, BACKEND_URL or AGENT_ARGS)"
	@echo ""
	@echo "Release (validate automation locally):"
	@echo "  make build-release       - Build frontend + agent, zip dist, output to $(RELEASE_DIR)/ (RELEASE_VERSION?=0.0.0-dev)"
	@echo "  make test-release        - build-release then install wheel and run observability-agent --help"
	@echo "  make build-release-agent  - Build agent only (skips frontend); use to validate agent packaging"
	@echo "  make test-release-agent   - build-release-agent then install wheel and run observability-agent --help"
