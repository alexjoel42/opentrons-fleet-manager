# video_replay — run from this directory
# Usage: make setup, make init-storage, make lint, make format-fix

PYTHON      ?= python3
VENV        := .venv
VENV_BIN    := $(VENV)/bin
PY_SRC      := monitor.py read_robot_logs.py
REPO_ROOT   := $(abspath $(CURDIR)/../..)
STORAGE_DIR := $(abspath $(REPO_ROOT)/../video_storage)

.PHONY: setup install-ffmpeg check-ffmpeg init-storage lint lint-py lint-fix format-fix format-fix-py help

# --- ffmpeg (system dependency for HLS recording) ---
check-ffmpeg:
	@if command -v ffmpeg >/dev/null 2>&1; then \
		echo "ffmpeg: $$(ffmpeg -version 2>/dev/null | head -1)"; \
	else \
		echo "ffmpeg not found on PATH. Run: make install-ffmpeg"; \
		exit 1; \
	fi

install-ffmpeg:
	@if command -v ffmpeg >/dev/null 2>&1; then \
		echo "ffmpeg already installed: $$(ffmpeg -version 2>/dev/null | head -1)"; \
	elif [ "$$(uname -s)" = "Darwin" ]; then \
		if ! command -v brew >/dev/null 2>&1; then \
			echo "Homebrew not found. Install from https://brew.sh then run: brew install ffmpeg"; \
			exit 1; \
		fi; \
		echo "Installing ffmpeg via Homebrew..."; \
		brew install ffmpeg; \
	elif command -v apt-get >/dev/null 2>&1; then \
		echo "Installing ffmpeg via apt..."; \
		sudo apt-get update && sudo apt-get install -y ffmpeg; \
	elif command -v dnf >/dev/null 2>&1; then \
		echo "Installing ffmpeg via dnf..."; \
		sudo dnf install -y ffmpeg; \
	elif command -v yum >/dev/null 2>&1; then \
		echo "Installing ffmpeg via yum..."; \
		sudo yum install -y ffmpeg; \
	else \
		echo "Could not detect a package manager. Install ffmpeg manually: https://ffmpeg.org/download.html"; \
		exit 1; \
	fi

# --- Setup ---
setup: install-ffmpeg
	@echo "Creating Python venv..."
	$(PYTHON) -m venv $(VENV)
	$(VENV_BIN)/pip install --upgrade pip
	@echo "Installing Python deps from requirements.txt..."
	$(VENV_BIN)/pip install -r requirements.txt
	@echo "Setup complete. Activate with: source $(VENV_BIN)/activate"

# --- Storage layout (sibling to opentrons-fleet-manager) ---
init-storage:
	@echo "Creating video storage at $(STORAGE_DIR)..."
	@mkdir -p "$(STORAGE_DIR)/clips" "$(STORAGE_DIR)/recordings"
	@if [ ! -f "$(STORAGE_DIR)/config.example.yaml" ]; then \
		cp config.example.yaml "$(STORAGE_DIR)/config.example.yaml"; \
		echo "Installed config.example.yaml"; \
	else \
		echo "config.example.yaml already present"; \
	fi
	@if [ ! -f "$(STORAGE_DIR)/config.example.ini" ]; then \
		cp config.example.ini "$(STORAGE_DIR)/config.example.ini"; \
		echo "Installed config.example.ini"; \
	else \
		echo "config.example.ini already present"; \
	fi
	@echo ""
	@echo "Storage ready: $(STORAGE_DIR)"
	@echo "  clips/       — incident clips and robot_key (optional)"
	@echo "  recordings/  — rolling ffmpeg buffer"
	@echo ""
	@echo "Next: cp $(STORAGE_DIR)/config.example.yaml $(STORAGE_DIR)/config.yaml"
	@echo "      cp $(STORAGE_DIR)/config.example.ini $(STORAGE_DIR)/config.ini"

# --- Lint (Ruff default rules — same as Observability_V0 lint-py) ---
lint:
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
	@echo "  make setup          - Install ffmpeg (if needed), create .venv, install requirements.txt"
	@echo "  make install-ffmpeg - Install ffmpeg via brew/apt/dnf (no-op if already on PATH)"
	@echo "  make check-ffmpeg   - Verify ffmpeg is on PATH"
	@echo "  make init-storage   - Create ../video_storage with clips/, recordings/, config examples"
	@echo ""
	@echo "Quality:"
	@echo "  make lint        - Run Ruff (Python, default rules)"
	@echo "  make lint-fix    - Auto-fix lint where possible"
	@echo "  make format-fix  - Lint-fix + Ruff format"
