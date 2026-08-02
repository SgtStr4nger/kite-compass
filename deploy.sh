#!/bin/bash
set -e

cd /home/malte/kite-compass

echo "[deploy] Pulling latest main via SSH..."
git pull origin main

echo "[deploy] Installing dependencies..."
npm install --legacy-peer-deps

echo "[deploy] Building app..."
npm run build

echo "[deploy] Restarting PM2 app..."
pm2 restart kite-compass

echo "[deploy] Deployment complete."
