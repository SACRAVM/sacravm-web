#!/bin/bash
# Doble clic en este archivo para abrir tu web SACRAVM.
cd "$(dirname "$0")"
echo "Arrancando SACRAVM..."
( sleep 1.5 && open "http://localhost:3000" ) &
node server.js
