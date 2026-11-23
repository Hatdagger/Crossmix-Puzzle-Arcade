# Crossmix Puzzle Arcade — prototype v0.1

A versus puzzle game where **two different puzzle games fight each other**, Puyo Puyo Tetris style. Each puzzle game is a *track*. Every track turns its big moves into a shared attack (**units**) and takes incoming units as its own kind of junk. An entry for the *New Games Ideas* demo disc, made for the **Neo Geo CD** first.

All code and art are original. Only the rules are borrowed in spirit. The full design is in [`docs/concept.md`](docs/concept.md).

## Tracks

| Track | Plays like | Status |
|---|---|---|
| **Brick** | Modern falling blocks (SPACBRACK's brick race) | In v0.1 |
| **Calm** | Calm Combo's slide-a-line match-3 | In v0.1 |
| Swap, Jewel, Pop, Grab, Nom Nom! Pets | Tetris Attack, Columns, Puzzle Bobble, Magical Drop, Baku Baku | Planned (greyed out on puzzle select) |
| Power Brick, Climb, Arsenal | Tetris Battle Gaiden, Tetris Plus, Battle Blocks X, on the Brick engine | Planned |

## Modes

- **Versus CPU:** best of 3 against the computer. Choose the CPU level (1-8) with left/right on the title menu, then pick your puzzle and the CPU's.
- **Versus 2P:** best of 3, each player picks their own puzzle.
- **Survival:** CPU after CPU, each on a random puzzle and one level tougher. Score = KOs.
- **Side by Side:** no attacks, each player plays their own puzzle. A dead board restarts with A. Player 2 can join any time with Start. Either player can pause.
- **Puzzle select** has **Random**, which picks again on every retry.
- **Pause (Start):** Resume, Retry, Puzzle Select, Quit. The same menu (minus Resume) comes up when a match ends.

## Run it

No build step and nothing to install. Open `index.html` in Chrome, Edge or Firefox (Windows, Linux, Android). Plug in or pair a controller and press a button on it so the browser sees it. Double-click for fullscreen.

- **Play in the browser (GitHub Pages):** one-time setup: in the repo go to **Settings → Pages** and set **Source** to **GitHub Actions**. After that every push to `main` updates https://hatdagger.github.io/Crossmix-Puzzle-Arcade/
- **New release:** change the number in `VERSION` and push; a release with a zip is made automatically.

## Controls (Neo Geo pad layout)

| | Brick | Calm | Keyboard 1P | Keyboard 2P (number pad) |
|---|---|---|---|---|
| Stick | Move, Down soft drop, Up hard drop | Move cursor / slide the line | Arrows | 8 4 5 6 |
| A | Rotate left | Grab / drop a tile | Z | 1 |
| B | Rotate right | Cancel | X | 3 |
| C | Hold | | C | 7 |
| D | Hard drop | | V or Space | 9 or 0 |
| Start | Pause / join | Pause / join | Enter | Enter |
| Select | Back on menus | Back on menus | Backspace | + |

Gamepads: first pad is 1P, second is 2P. A B X Y = Neo Geo A B C D, Back = Select.

## How the attack works

- **Brick sends:** 2/3/4 lines = 1/2/4 units, T-spins 2 per line, +1 back-to-back, combo bonus, all clear +10. Incoming garbage waits 1 s (amber bar), then lands (flashing red) the next time you lock a brick without clearing.
- **Calm sends:** its stone formula (chain step after the first 1, 4-match 1, 5+-match 2, lever 1) × 0.2. Incoming units become stones; they land after your next move or after 3 s.
- **Calm pressure** (so it can lose to a brick player): 7 s move timer that loses 0.5 s every minute (down to 3 s), each move costs one extra move every 2 minutes, and stones that don't fit on the board (cap 20) cost a move each.
- Your attacks always cancel your own incoming units first.

## Balance runs

`node tools/sim.js [games] [cpuLevelA] [cpuLevelB]` plays every pairing of tracks CPU vs CPU and prints win rates and units sent per minute. v0.1 at levels 3, 6 and 8 (8 games each): Brick vs Calm lands between 3-5 and 5-3 both ways.

## Repo layout

```
index.html        the browser prototype (320x224, Neo Geo resolution)
js/track.js       the track interface + shared attack bar
js/track-*.js     one file per puzzle game
js/main.js        title, puzzle select, matches, menus
js/gfx.js         pixel renderer kit from SPACBRACK
tools/sim.js      headless CPU-vs-CPU balance runs
docs/             design notes
```

## Next

1. Neo Geo CD build (NeoCore, from SPACBRACK's `tetris` branch and the Calm Combo port), built by GitHub Actions into BIN/CUE and CHD.
2. Power Brick, Climb and Arsenal on the Brick engine (waiting on the modern feature checklist).
3. Swap (reusing Calm's grid and stone code), Jewel, Pop, then Grab and Nom Nom! Pets.
