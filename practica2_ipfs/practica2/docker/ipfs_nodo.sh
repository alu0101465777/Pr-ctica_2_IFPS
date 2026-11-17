#!/usr/bin/env bash
# Lanza el nodo IPFS (Kubo) en Docker y configura CORS para la DApp (localhost:3000).
# Uso: bash ipfs_nodo.sh      (ejecutar desde la carpeta donde quieras guardar los datos)
set -e
mkdir -p ipfs_data ipfs_export

docker rm -f ipfs_host 2>/dev/null || true
docker run -d --name ipfs_host \
  -v "$PWD/ipfs_export:/export" -v "$PWD/ipfs_data:/data/ipfs" \
  -p 4001:4001 -p 4001:4001/udp \
  -p 127.0.0.1:8080:8080 -p 127.0.0.1:5001:5001 \
  ipfs/kubo

echo "Esperando a que arranque el nodo..."
sleep 8

docker exec ipfs_host ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin \
  '["http://0.0.0.0:5001", "http://localhost:3000", "http://127.0.0.1:3000", "http://127.0.0.1:5001", "http://localhost:5001", "https://webui.ipfs.io"]'
docker exec ipfs_host ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT", "POST", "GET"]'

docker restart ipfs_host
sleep 5
docker exec ipfs_host ipfs id | head -n 3
echo "Nodo listo. WebUI: http://127.0.0.1:5001/webui"
