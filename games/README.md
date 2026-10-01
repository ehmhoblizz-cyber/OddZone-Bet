# OddZone Game Modules

The game projects are isolated in their own same-origin iframe directories. OddZone's parent page owns the match timer and reads a numeric score from each game's `window.__oddzoneReadScore()` adapter. Timed views may also expose `window.__oddzoneStart()` and `window.__oddzoneEnd()`.

## Upstream Sources

| Module | Source | License as declared upstream |
| --- | --- | --- |
| Hextris | https://github.com/Hextris/hextris | GPL-3.0-or-later; retain its license and source notices |
| 2048 | https://github.com/gabrielecirulli/2048 | MIT |
| Pac-Man | https://github.com/mumuy/pacman | MIT |
| Asteroids | https://github.com/dmcinnes/HTML5-Asteroids | MIT |
| Cave Runner | https://github.com/tope-olajide/cave-runner | MIT |
| Neon Serpent | https://github.com/einncodes/NeonSerpent-2D-Snake-Game | Apache-2.0, declared in upstream README |

The upstream repositories for `oshimur/html5-breakout` and `marina-ferreira/js-memory-game` returned 404 when checked. `MDJAmin/classic-snake-game-html5-canvas-javascript` has no declared license, so its source is not redistributed. `nebez/floppybird` declares Apache-2.0 for code, but its README says the game artwork/audio were extracted from Flappy Bird without permission; those assets are not shipped. OddZone includes its own small pipe-hop, snake, breakout, and memory games instead.

## Wagering Note

Local scores and iframe messages are player-editable. They are suitable for local score history and UI tests, not for wallet settlement or determining a real-money winner. Cash matches stay disabled until a server verifies match identity, duration, and game results and performs the wallet transaction.
