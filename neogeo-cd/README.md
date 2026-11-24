# Crossmix Puzzle Arcade: Neo Geo CD

All ten puzzles from the web prototype, rewritten in C for the Neo Geo CD with [NeoCore](https://github.com/David-Vandensteen/neocore) (GCC 2.95 + DATlib, vendored in `neocore/`, MIT license). This is the same toolchain as SPACBRACK and Calm Combo.

## Playing it

Every push builds the disc on GitHub Actions. Each release (for example v0.9.0) has:

- `Crossmix-<version>-NeoGeoCD-BINCUE.zip`: a BIN/CUE for a real Neo Geo CD (burned disc or optical drive emulator), MiSTer, or any emulator that takes BIN/CUE.
- `Crossmix-<version>-NeoGeoCD.chd`: the same disc as a CHD for MAME.

### Modes

On the title screen: Versus CPU (left/right sets the CPU level, 1-8), Versus 2P, Survival and Side by Side. They work like the web version, best of 3 in the versus modes. Leave the title alone for 20 s and two CPUs play a demo round; any button ends it. Start pauses the game (Resume, Retry, Puzzle Select, Quit).

### Controls (Neo Geo pad)

| Puzzle | Stick | A | B | C | D |
|---|---|---|---|---|---|
| Brick | move, Down soft drop, Up hard drop | rotate left | rotate right | hold | hard drop |
| Calm | cursor / slide the line | grab, then drop | cancel | | |
| Climb | move, Down soft drop | rotate left | rotate right | | |
| Jewel | move, Down soft drop, Up drop | cycle | cycle back | | drop |
| Swap | cursor | swap | swap | hold: raise | hold: raise |
| Pop | aim, Up fire | fire | hold: fine aim | swap bubble | fire |
| Grab | move, Down grab, Up throw | grab | throw | grab | throw |
| Nom Nom! Pets | move, Down soft drop, Up drop | turn left | turn right | | drop |
| Arsenal | move, Down soft drop, Up hard drop | rotate left | rotate right | fire at 1P | fire at 2P |
| Power Brick | move, Down soft drop | rotate left | rotate right | cast power | |

Select throws away Arsenal's front weapon.

## How it is built

| File | What |
|---|---|
| `src/xm.h`, `src/xm_tracks.h` | The track interface (mirrors `js/track.js`) and every puzzle's state. |
| `src/track.c` | Shared parts: incoming units, cancelling, messages, Arsenal weapons, Power Brick powers (Fog, Swap Hands, Rush), Flip. |
| `src/t_brick.c` | The brick engine plus Brick, Arsenal, Power Brick and Climb, with their CPUs. |
| `src/t_calm.c` `t_jewel.c` `t_swap.c` `t_pop.c` `t_grab.c` `t_nom.c` | One file per puzzle, CPU included. |
| `src/game.c` | Title, puzzle select, matches, Survival, Side by Side, attract mode, menus. |
| `src/draw.c` | The screen as a 40x28 grid of fix-layer tiles. |
| `src/hw.c` | Neo Geo only: palettes, pads, sound, and sending the changed tiles to the fix layer. |
| `tools/make_tiles.py` | Paints both tile banks (`src/assets/gfx/fix/tiles_a.png`, `tiles_b.png`) and `src/art.h`. All art is original. |
| `test/hw_pc.c` | PC harness: `xm sim` plays CPU vs CPU on every pairing; `xm script` plays the real menus from a script and dumps screens. |
| `test/render.py` | Turns screen dumps into PNG screenshots. |
| `test/mame_smoke.lua` | CI: boots the CHD in MAME, lets attract mode run, takes snapshots and counts dropped frames. |

Everything is drawn on the fix layer: 8 px bricks for the brick family, and 16 px cells (2x2 tiles) for the rest. Tiles are painted in role colours and recoloured by palette, so one tile can show in any colour. Each half of the screen is redrawn every other frame (30 Hz). The game logic runs every frame and uses the real time that passed, so it keeps the right speed even if the 68000 drops a frame. CPU players spread their searches over several frames.

Changes from the web version, so it fits 224 lines and the 68000: Jewel's well is 12 rows (was 13), Grab's field is 11 rows (was 12), Pop has 11 rows to the line with 16 px bubbles, and the Jewel and Nom Nom! Pets CPUs don't look ahead at the next piece. There is no LAN play on the Neo Geo.

### PC checks

```
sh test/build_pc.sh
build-pc/xm sim 3 5 5          # 3 games per pairing, CPU level 5 vs 5
mkdir -p shots && build-pc/xm script test/tour.txt shots && python3 test/render.py shots --sheet shots/00_sheet.png
```

### Building on your own Windows PC

Same as SPACBRACK. Keep the path short: GCC 2.95 has a 100-character path limit.

```
git clone https://github.com/Hatdagger/Crossmix-Puzzle-Arcade C:\xm
cd C:\xm\neogeo-cd
python tools\make_tiles.py
python tools\make_audio.py
cd src
mak lib
mak sprite
mak
mak run:mame
```

For `mak dist:iso`, also copy `assets\cdda\*.wav` into `..\build\Crossmix\assets\cdda\`.

## Music

The CD audio tracks are placeholders, rendered from SPACBRACK's chiptunes: 2 title, 3 side by side, 4 spare, 5 versus, 6 survival. To use your own songs, put them in `music/` (see `music/README.md`) and push.
