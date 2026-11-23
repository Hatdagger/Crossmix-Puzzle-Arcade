#!/bin/sh
# Crossmix LAN server: needs Node.js (https://nodejs.org). Keep this window open while playing.
cd "$(dirname "$0")"
node tools/lan-server.js 8080
