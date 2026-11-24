#!/bin/sh
# Build the PC harness: all game code (strict C89) + test/hw_pc.c.
set -e
cd "$(dirname "$0")/.."
B=${1:-build-pc}
mkdir -p "$B"
CF="-std=c89 -pedantic -Wall -Wextra -Werror -O2 -g ${XM_CFLAGS:-}"
gcc $CF -Isrc -o "$B/xm" src/track.c src/draw.c src/game.c src/t_brick.c src/t_calm.c src/t_jewel.c src/t_swap.c src/t_pop.c src/t_grab.c src/t_nom.c test/hw_pc.c
echo "built $B/xm"
