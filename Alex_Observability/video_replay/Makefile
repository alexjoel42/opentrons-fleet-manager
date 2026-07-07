# video_replay — run from this directory
# Usage: make setup, make lint, make format-fix

PYTHON   ?= python3
VENV     := .venv
VENV_BIN := $(VENV)/bin
PY_SRC   := monitor.py read_robot_logs.py

.PHONY: setup lint lint-py lint-fix format-fix format-fix-py help

# --- Setup ---
setup:
	@echo "Creating Python venv..."
	$(PYTHON) -m venv $(VENV)
	$(VENV_BIN)/pip install --upgrade pip
	@echo "Installing Python deps from requirements.txt..."
	$(VENV_BIN)/pip install -r requirements.txt
	@echo "Setup complete. Activate with: source $(VENV_BIN)/activate"

# --- Lint (Ruff default rules — same as Observability_V0 lint-py) ---
lint: lint-py
	@echo "Lint passed."

lint-py:
	@if [ -d $(VENV) ] && $(VENV_BIN)/python -c "import ruff" 2>/dev/null; then \
		echo "Lint (Python)..."; \
		$(VENV_BIN)/ruff check $(PY_SRC) 2>/dev/null || true; \
	else \
		echo "Skipping lint-py (venv or ruff not ready)."; \
	fi

lint-fix:
	@if [ -d $(VENV) ] && $(VENV_BIN)/python -c "import ruff" 2>/dev/null; then \
		echo "Lint fix (Python)..."; \
		$(VENV_BIN)/ruff check $(PY_SRC) --fix 2>/dev/null; \
	else \
		echo "Skipping lint-fix (venv or ruff not ready)."; \
	fi
	@echo "lint-fix done."

format-fix: lint-fix format-fix-py
	@echo "Format-fix complete."

format-fix-py:
	@if [ -d $(VENV) ] && $(VENV_BIN)/python -c "import ruff" 2>/dev/null; then \
		echo "Format fix (Python)..."; \
		$(VENV_BIN)/ruff check $(PY_SRC) --fix 2>/dev/null; \
		$(VENV_BIN)/ruff format $(PY_SRC) 2>/dev/null; \
		echo "format-fix-py done."; \
	else \
		echo "Skipping format-fix-py (venv or ruff not ready)."; \
	fi

# --- Help ---
help:
	@echo "video_replay Makefile (run from this directory)"
	@echo ""
	@echo "Setup:"
	@echo "  make setup       - Create .venv and install requirements.txt"
	@echo ""
	@echo "Quality:"
	@echo "  make lint        - Run Ruff (Python, default rules)"
	@echo "  make lint-fix    - Auto-fix lint where possible"
	@echo "  make format-fix  - Lint-fix + Ruff format"
