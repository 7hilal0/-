SHELL := /usr/bin/bash

.PHONY: setup run run-web docker-up docker-build

setup:
	python3 -m venv .venv
	. .venv/bin/activate && pip install --upgrade pip && pip install -r requirements.txt

run:
	. .venv/bin/activate && python bot/main.py

run-web:
	ENABLE_HEALTH_SERVER=true PORT=8080 . .venv/bin/activate && python bot/main.py

docker-build:
	docker compose build

docker-up:
	docker compose up -d --build