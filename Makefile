# Laundry Point POS (backend) — build & deploy helpers. `make help`

-include .env
export

# Path to the Vue frontend source (kept comment-free: Make keeps trailing spaces).
WEB_SRC ?= ../cashier
IMAGE ?= ghcr.io/OWNER/laundrypoint
TAG ?= latest
COMPOSE ?= docker compose
APP_PORT ?= 3000

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ───────────────────── Build the frontend into ./public ─────────────────
.PHONY: web
web: ## Build the Vue frontend and place it in ./public (commit this)
	cd "$(WEB_SRC)" && VITE_API_URL=/api npm install --no-audit --no-fund && npm run build-only
	rm -rf public
	cp -r "$(WEB_SRC)/dist" public
	@echo "✅ Frontend built into backend/public — commit it, then push a tag."

# ─────────────────────────── Build / publish ───────────────────────────
.PHONY: image
image: ## Build the Docker image locally (expects ./public present)
	docker build -t $(IMAGE):$(TAG) .

.PHONY: image-web
image-web: web image ## Build frontend + image in one go

.PHONY: push
push: ## Push the image to the registry
	docker push $(IMAGE):$(TAG)

.PHONY: release
release: ## Tag a version and push it (triggers the GitHub Action). Usage: make release V=v1.0.0
	@test -n "$(V)" || (echo "Usage: make release V=v1.2.3"; exit 1)
	git tag $(V) && git push origin $(V)

# ─────────────────────────── Run the stack ─────────────────────────────
.PHONY: up
up: ## Start the stack (db + app)
	$(COMPOSE) up -d

.PHONY: down
down: ## Stop the stack (keeps the db volume)
	$(COMPOSE) down

.PHONY: pull
pull: ## Pull the latest app image
	$(COMPOSE) pull app

.PHONY: logs
logs: ## Tail the app logs
	$(COMPOSE) logs -f app

.PHONY: ps
ps: ## Show stack status
	$(COMPOSE) ps

# ───────────────────────── Post-deploy steps ───────────────────────────
.PHONY: migrate
migrate: ## Sync the database schema (prisma db push)
	$(COMPOSE) exec app npx prisma db push --skip-generate

.PHONY: seed
seed: ## Seed reference data (outlet, employees, services, machines)
	$(COMPOSE) exec app npx prisma db seed

.PHONY: health
health: ## Curl the health endpoint
	curl -fsS http://localhost:$(APP_PORT)/api/health && echo

.PHONY: shell
shell: ## Shell into the running app container
	$(COMPOSE) exec app sh

# ─────────────────────────── One-shots ─────────────────────────────────
.PHONY: deploy
deploy: pull up migrate ## Pull image, start stack, sync schema
	@echo "✅ Deployed → http://localhost:$(APP_PORT)  (first run: add 'seed')"

.PHONY: first-deploy
first-deploy: pull up migrate seed health ## Full first-time deploy (schema + seed + health)

.PHONY: reset-db
reset-db: ## DANGER: drop the db volume and re-seed
	$(COMPOSE) down -v && $(COMPOSE) up -d && sleep 6 && $(MAKE) migrate seed
