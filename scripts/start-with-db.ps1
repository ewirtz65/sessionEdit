#Requires -Version 5.1
$ErrorActionPreference = "Stop"

# cd to repo root (this file lives in .\scripts\)
Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location ..

# 1) Start Postgres service (change "db" if your compose service name differs)
Write-Host "Starting Postgres (docker compose up -d db)..."
docker compose up -d db

# 2) Wait for Postgres to be ready (check exit code from pg_isready inside the container)
Write-Host "Waiting for Postgres to become ready..."
do {
  docker compose exec -T db pg_isready -U postgres -h 127.0.0.1 *> $null
  $code = $LASTEXITCODE
  if ($code -ne 0) { Start-Sleep -Seconds 1 }
} while ($code -ne 0)
Write-Host "Postgres is ready."

# 3) Start your Node server
node server\src\server.js
