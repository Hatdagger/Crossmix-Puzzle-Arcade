# Crossmix Puzzle Arcade — prototype v0.2

A versus puzzle game where **two different puzzle games fight each other**, Puyo Puyo Tetris style. Each puzzle game is a *track*. Every track turns its big moves into a shared attack (**units**) and takes incoming units as its own kind of junk. An entry for the *New Games Ideas* demo disc, made for the **Neo Geo CD** first.

All code and art are original. Only the rules are borrowed in spirit. The full design is in [`docs/concept.md`](docs/concept.md).

## Tracks

| Track | Plays like | Status |
|---|---|---|
| **Brick** | Modern falling blocks (SPACBRACK's brick race) | In v0.1 |
| **Calm** | Calm Combo's slide-a-line match-3 | In v0.1 |
| **Climb** | Tetris Plus: get the professor down to the floor | In v0.2 (CPU still weak, so it isn't dealt to CPUs at random) |
| **Jewel** | Columns: drop a column of 3 jewels, line up 3+ across, down or diagonally. A/B cycle the jewels, D or Up drops. Takes units as rock rows from below (one gap per batch); a rock breaks when a jewel next to it clears | Next release |
| **Swap** | Tetris Attack: a 2-wide cursor swaps panels (A or B) in a rising stack; hold C or D to raise it faster. Matches of 3+ across or down; panels that land in a new match make chains. Takes units as garbage slabs (each unit = 3 panels, 6 panels = a full row); a match next to a slab turns its bottom row back into panels | Next release |
| Pop, Grab, Nom Nom! Pets | Puzzle Bobble, Magical Drop, Baku Baku | Planned (greyed out on puzzle select) |
| Power Brick, Arsenal | Tetris Battle Gaiden, Battle Blocks X, on the Brick engine | Planned |

## Modes

- **Versus CPU:** best of 3 against the computer. Choose the CPU level (1-8) with left/right on the title menu, then pick your puzzle and the CPU's.
- **Versus 2P:** best of 3, each player picks their own puzzle.
- **Survival:** CPU after CPU, each on a random puzzle and one level tougher. Score = KOs. Between opponents there's about 3 s (KO, next challenger, 3-2-1) where the survivor keeps playing undisturbed, to clean up before the next CPU starts.
- **Side by Side:** no attacks, each player plays their own puzzle. A dead board restarts with A. Player 2 can join any time with Start. Either player can pause.
- **Puzzle select** has **Random**, which picks again on every retry.
- **Pause (Start):** Resume, Retry, Puzzle Select, Quit. The same menu (minus Resume) comes up when a match ends.

## Climb

- A 2x2 professor walks the stack. He turns at walls and at anything in his way, can step down but never up.
- Bricks fall straight through him. Once one settles inside his 2x2 square, he slowly climbs (about 1.3 s per row), so you have time to clear a line or two and bring him back down. If he touches the spiked ceiling, you lose.
- The field is 10 wide and 16 tall: 15 rows to play in, with the spikes starting in row 16. Bricks are 11 px (Brick uses 8).
- The ceiling drops a row after 12 bricks, then 10, 9, 8 ... down to every 3. Bricks that touch the spikes are destroyed (just that line), including a pile that reaches the top — only the professor touching the spikes ends the game.
- Get him to the floor to clear the stage: he drops out, does a little dance, walks off, and the next stage starts with the ceiling reset.
- Each stage is a scattered pile with a known solution: the first pieces dealt solve it (about 5-10, more on later stages). After that the pieces are random.
- Classic rules: no hold, no hard drop, no ghost, no wall kicks, one next piece, slow gravity and a slow soft drop.
- **Versus:** incoming units push garbage rows in from the bottom, lifting the stack and the professor toward the spikes. Clearing a stage sends 4 units.
- **Climb vs Climb (Versus CPU / 2P) is a race:** both get the same stage and the same pieces, no attacks; first to get the professor down wins the round.

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
- **Calm pressure** (so it can lose to a brick player): 12 s move timer that loses 0.5 s every minute (down to 6 s), each move costs one extra move every 2 minutes, and stones that don't fit on the board (cap 20) cost a move each.
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
2. A better Climb CPU, then Power Brick and Arsenal on the Brick engine.
3. Swap (reusing Calm's grid and stone code), Jewel, Pop, then Grab and Nom Nom! Pets.
