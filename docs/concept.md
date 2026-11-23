# Crossmix Puzzle Arcade — concept notes

The living design doc is in Claude Docs ("MIXTAPE — mixed-game versus puzzle (concept)"; MIXTAPE was the working title before the repo got its name). This file keeps the rules the code follows, so the repo stands on its own.

## Idea

Two players each pick a puzzle game (a *track*) and fight on a split screen. Every track turns its big moves into **units** (1 unit is about one row of brick garbage) and takes units as its own kind of junk. Your attacks cancel your own incoming units first.

## Tracks (10)

| Track | Plays like | Takes 1 unit as |
|---|---|---|
| Brick | Modern falling blocks (SPACBRACK) | 1 garbage row, one hole per batch |
| Calm | Calm Combo slide-match | 1 stone (cap 20; overflow costs moves) |
| Swap | Tetris Attack; reuses Calm's grid, match, cascade and stone code | Garbage slab (3 units = 3 wide, 6 = full row) |
| Jewel | Columns | 1 rock row rising from the bottom |
| Pop | Puzzle Bobble | 2 grey bubbles under the cluster; ceiling drops every 8 |
| Grab | Magical Drop | 1 row pushed in from the top |
| Nom Nom! Pets | Baku Baku | Half a row of food on top |
| Power Brick | Tetris Battle Gaiden, Brick engine | Garbage row, plus a power meter |
| Climb | Tetris Plus, Brick engine | 1 garbage row from below, lifting the stack and the professor (Climb vs Climb is a race instead: same stage, same pieces) |
| Arsenal | Battle Blocks X, Brick engine | Garbage row; weapons from letters |

Power Brick, Climb and Arsenal switch modern Brick features off per track (checklist in the design doc). Each feature is a switch in `G.BRICK_MODERN` in `js/track-brick.js`.

## Arsenal (Battle Blocks X style)

Single-line clears turn a random brick into a weapon letter. Clearing the letter's row collects it, one copy per line in that clear. Inventory has fixed slots, used in order; when full, new weapons are thrown out. C uses the front weapon on player 1, D on player 2 (same buttons for both players). Select throws away the front weapon (Start on MVS). Arsenal vs Arsenal has no garbage; in mixed matches it also trickles 2/3/4 lines = 0/1/2 units.

## Modes and menus

Versus CPU, Versus 2P (best of 3), Survival, Side by Side (no attacks, either player can pause). Puzzle select has Random, re-rolled on every retry. Pause menu: Resume, Retry, Puzzle Select, Quit; the same menu minus Resume after a match. MVS has no pause, so only the after-match menu.

## Neo Geo CD

320x224, two halves of 160 px. One C track interface (`init`, `update`, `receive`, `send`, `draw`, `isDead`) mirrors `js/track.js`. Both picked tracks load from disc before a match. Music as CD audio, one song per track.
