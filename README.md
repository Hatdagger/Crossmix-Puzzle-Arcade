# Crossmix Puzzle Arcade — prototype v0.9.0

**Neo Geo CD version:** every release has a Neo Geo CD disc (`-NeoGeoCD-BINCUE.zip` for a real console, MiSTer or optical drive emulator; `.chd` for MAME). All ten puzzles, Versus CPU, Versus 2P, Survival and Side by Side. See [`neogeo-cd/README.md`](neogeo-cd/README.md).

A versus puzzle game where **two different puzzle games fight each other**, Puyo Puyo Tetris style. Each puzzle game is a *track*. Every track turns its big moves into a shared attack (**units**) and takes incoming units as its own kind of junk. An entry for the *New Games Ideas* demo disc, made for the **Neo Geo CD** first.

All code and art are original. Only the rules are borrowed in spirit. The full design is in [`docs/concept.md`](docs/concept.md).

## Tracks

| Track | Plays like | Status |
|---|---|---|
| **Brick** | Modern falling blocks (SPACBRACK's brick race) | In v0.1 |
| **Calm** | Calm Combo's slide-a-line match-3 | In v0.1 |
| **Climb** | Tetris Plus: get the professor down to the floor | In v0.2 (CPU still weak, so it isn't dealt to CPUs at random) |
| **Jewel** | Columns: drop a column of 3 jewels, line up 3+ across, down or diagonally. A/B cycle the jewels, D or Up drops. Takes units as rock rows from below (one gap per batch); a rock breaks when a jewel next to it clears | In v0.3 |
| **Swap** | Tetris Attack: a 2-wide cursor swaps panels (A or B) in a rising stack; hold C or D to raise it faster. Matches of 3+ across or down; panels that land in a new match make chains. Takes units as garbage slabs (each unit = 3 panels, 6 panels = a full row); a match next to a slab turns its bottom row back into panels | In v0.3 |
| **Pop** | Puzzle Bobble: aim with left/right (hold B for fine aim; a dotted line shows the whole path, bounces included), fire with A, D or Up, C swaps with the next bubble. 3+ of a colour pop; bubbles left hanging drop. Only drops attack: every 2 dropped = 1 unit (x0.85), all clear +3. The ceiling comes down every 12 shots (one fewer every 30 s, down to 7); if you don't fire for 8 s it fires for you. Takes units as grey bubbles (2 per unit) stuck under the cluster; a grey breaks when a bubble next to it pops, and every 8 units taken also bring the ceiling down a row | In v0.4 |
| **Grab** | Magical Drop: balls hang from the ceiling and a new row pushes down every few seconds (faster over time; the PUSH bar shows when). Move the grabber left/right; A, C or Down grabs the lowest run of one colour from the column above (keep grabbing more of the same colour), B, D or Up throws them back up under any column. 3+ of a colour in a column clears, plus every ball of that colour touching them; balls below move up and can chain. Clearing again within 1.5 s of the last clear is a combo. Takes units as extra rows pushed in from the top (1.75 rows per unit) | In v0.6 |
| **Nom Nom! Pets** | Baku Baku: pairs of blocks fall (A/B turn the pair, D or Up drops). Each block is a pet's head or a food: dog + bone, cat + fish, bunny + carrot, mouse + cheese. A head touching its own food eats that food and all matching food connected to it. A rare coin clears every block of the kind it lands on. Blocks that fall afterwards can chain. Heads get a little rarer every 30 s. Takes units as wrapped food dropped on top (5 per unit); a wrapped block can't be eaten until something next to it is eaten | In v0.7 |
| **Arsenal** | Battle Blocks X, on the Brick engine (no hold, 1 next piece, short lock, no T-spin/combo/all-clear bonuses, no cancelling). Every single-line clear turns a random brick into a weapon letter; clearing its row collects it (one copy per line in that clear) into 8 slots, used front first. **C** fires the front weapon at player 1, **D** at player 2 (on the left side C is you), **Select** throws it away, **Up** hard drops. A weapon that can't work on the opponent's puzzle has a red X: hold it or throw it. Arsenal vs Arsenal sends no garbage; in mixed matches 2/3/4 lines send 0/1/2 | In v0.8 |
| **Power Brick** | Tetris Battle Gaiden, on the Brick engine (no hold, ghost, hard drop, wall kicks or 7-bag; 5 previews, T-spins, cancelling kept). About 1 piece in 4 carries a pink crystal. Clearing lines fills the power meter: 1 point per line, 3 more per crystal cleared; 4 points = 1 star, up to 5. **C** casts the power for your stars and spends them all: 1 SHAKE (clear your bottom 3 rows), 2 SHIELD (blocks the next attack), 3 FOG (hides the top half of their field for 5 s), 4 HANDS (their left/right swapped for 5 s), 5 RUSH (their game at double speed for 6 s). Sends 2/3/4 lines = 1/2/4, T-spins 2 per line | In v0.9 |

## Modes

- **Versus CPU:** best of 3 against the computer. Choose the CPU level (1-8) with left/right on the title menu, then pick your puzzle and the CPU's.
- **Versus 2P:** best of 3, each player picks their own puzzle.
- **Survival:** CPU after CPU, each on a random puzzle and one level tougher. Score = KOs. Between opponents there's about 3 s (KO, next challenger, 3-2-1) where the survivor keeps playing undisturbed, to clean up before the next CPU starts.
- **Side by Side:** no attacks, each player plays their own puzzle. A dead board restarts with A. Player 2 can join any time with Start. Either player can pause.
- **Puzzle select** has **Random**, which picks again on every retry.
- **Pause (Start):** Resume, Retry, Puzzle Select, Quit. The same menu (minus Resume) comes up when a match ends.

## LAN challenges (PC netplay)

Survival can be played over your home network, with other players dropping in to challenge you. The only settings are on the title screen (and the pause menu): **CHALLENGES ON/OFF** and **MY SIDE LEFT/RIGHT** (which half of the screen is yours). Everything else happens in the background.

**Set up: the Crossmix app (easiest).** Download `Crossmix-<version>.exe` (Windows) or `Crossmix-<version>.AppImage` (Linux) from the release and double-click it on every PC. That's all:
- Each copy looks for a Crossmix game on your network. If there isn't one, it becomes the host; everyone else joins it automatically. Only copies of the same version play together.
- If the host quits, another PC takes over within a few seconds and play carries on.
- Challenges are ON by default in the app. The title screen shows the LAN status (bottom left).
- Phones and tablets on the same network can join too: the host's title screen shows an address (like `192.168.1.20:8080`); open it in the phone's browser.
- The first time, Windows asks whether to allow Crossmix on private networks: click **Allow**.
- The Windows app uses the Edge browser engine that's already part of Windows 10 and 11.

**Without the app:** install [Node.js](https://nodejs.org) on one PC, unzip the release there and double-click `start-lan-server.bat` (Windows) or run `start-lan-server.sh` (Linux). Keep the window open, open the address it shows on every PC, set **CHALLENGES ON** and play **SURVIVAL**.

**How challenges work:**
- You play Survival against CPUs. Whenever two players with challenges on are free, the server matches them. If more people are waiting, the one waiting longest gets the next open spot; the winner of the last challenge goes first.
- The host keeps their board and carries on. The challenger's board clears and counts in.
- The challenger takes **half garbage** until they make a big move or have played 14 pieces. Big moves: Brick, Power Brick and Climb: all clear, any T-spin or a 4-line clear. Jewel and Calm: a chain or a 5+ match. Swap: a chain or a 4+ combo. Pop: dropping 4+ bubbles at once or an all clear. Grab: a chain, 6+ balls at once or a 3x combo. Nom Nom! Pets: a chain, 7+ eaten at once or a coin clearing 6+. (Calm counts moves, Swap counts swaps, Pop counts shots and Grab counts throws instead of pieces.)
- A challenge is one round. The loser can press A to **run it back**; if the winner accepts, round 2 is played (the loser's board resets). If that makes it 1-1, round 3 starts with both boards cleared.
- **Winner stays on** and goes back to fighting CPUs until the next challenger. The loser starts a fresh Survival.
- No pausing during a challenge. Leaving (closing the page) forfeits. If the server goes away, you're back to CPUs and the game reconnects by itself.

Only button presses cross the network: each PC runs its own board and sends its inputs; the other PC replays them on an exact copy of your board. The GitHub Pages version can't reach a LAN server, so there CHALLENGES ON just plays solo.

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

**The app:** download the `.exe` (Windows) or `.AppImage` (Linux) from the latest release and double-click it. It's the same game, plus automatic LAN play (see above). The app is built by GitHub Actions from `app/` (Tauri; the LAN side is `app/src-tauri/src/lan.rs`, a port of `tools/lan-server.js` with automatic host finding).

**The browser version:** 
no build step and nothing to install. Open `index.html` in Chrome, Edge or Firefox (Windows, Linux, Android). Plug in or pair a controller and press a button on it so the browser sees it. Double-click for fullscreen.

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

## Arsenal weapons

Weapons work on every puzzle, not just brick fields:

| Weapon | Effect |
|---|---|
| Clear Field (C) | The board goes back to how it looked at the start of the match (Climb: the stage starts over) |
| Empty Inventory (E) | Empties an Arsenal player's weapons (Power Brick's powers later) |
| Add Line (A) | 1 unit of attack |
| Remove Line (R) | Undoes 1 unit of incoming garbage; if none is coming, removes the line furthest from where that player's pieces come in |
| Speed Up (U) / Slow Down (D) | x1.25 faster / slower, permanent for that board and stacking (x0.5 to x3); a fresh board starts at normal speed |
| Gravity (G) | Brick fields: every brick falls straight down |
| Flip Field (F) | The target's play field is shown upside down for 8 s (text and panels stay upright) |
| Swap (S) | The two players trade games, boards and all (local play only) |

Power Brick's Fog, Hands and Rush work on every puzzle too (they act on the screen or the controls). Empty Inventory empties a Power Brick player's meter and shield.

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
js/net.js         Survival with LAN challenges (netplay)
js/gfx.js         pixel renderer kit from SPACBRACK
tools/sim.js      headless CPU-vs-CPU balance runs
tools/lan-server.js  LAN server for challenges (plain Node)
docs/             design notes
neogeo-cd/        the Neo Geo CD version in C (NeoCore), see its README
```

## Next

1. Play the Neo Geo CD disc on real hardware / MiSTer and tune from there (speed, CPU strength, balance).
2. A better Climb CPU.
3. Your own music for the disc (`neogeo-cd/music/`).
