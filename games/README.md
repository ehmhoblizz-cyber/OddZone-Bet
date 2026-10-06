# OddZone Game Modules

The game projects are isolated in their own same-origin iframe directories. OddZone's parent page owns the match timer and reads a numeric score from each game's `window.__oddzoneReadScore()` adapter. Timed views may also expose `window.__oddzoneStart()` and `window.__oddzoneEnd()`.

## Asynchronous (take turns) games

A game that supports turn-based play across sessions stores its whole board as JSON in Supabase and lets each player move from their own device whenever they like. The game's start screen offers **Create** (issues a short shareable code) and **Open code** (redeems one). After every shot the game writes the new snapshot and hands the turn over, so a player can close the tab and resume days later.

| Game | Table | Notes |
| --- | --- | --- |
| 8-Ball Pool | `pool_matches` | Turn snapshot per shot; Realtime broadcast plus a 4s poll fallback. |

Apply `supabase/pool_async.sql` once in the Supabase SQL editor before using the async mode. Without the table the game degrades cleanly: the async buttons report the error and the vs-computer mode still works.

The same caveat as below applies with more force here — the anon key is public, so the client-side writes in these tables are player-editable. Before real stakes, move the writes into a Postgres RPC or Edge Function that verifies the session user is one of the two participants.

## Upstream Sources

| Module | Source | License as declared upstream |
| --- | --- | --- |
| Hextris | https://github.com/Hextris/hextris | GPL-3.0-or-later; retain its license and source notices |
| 2048 | https://github.com/gabrielecirulli/2048 | MIT |
| Pac-Man | https://github.com/mumuy/pacman | MIT |
| Asteroids | https://github.com/dmcinnes/HTML5-Asteroids | MIT |
| Cave Runner | https://github.com/tope-olajide/cave-runner | MIT |
| Neon Serpent | https://github.com/einncodes/NeonSerpent-2D-Snake-Game | Apache-2.0, declared in upstream README |
| 8-Ball Pool | written for OddZone (canvas renderer, custom sub-stepped physics engine, Web Audio synth) | same project |

The upstream repositories for `oshimur/html5-breakout` and `marina-ferreira/js-memory-game` returned 404 when checked. `MDJAmin/classic-snake-game-html5-canvas-javascript` has no declared license, so its source is not redistributed. `nebez/floppybird` declares Apache-2.0 for code, but its README says the game artwork/audio were extracted from Flappy Bird without permission; those assets are not shipped. OddZone includes its own small pipe-hop, snake, breakout, and memory games instead.

## Wagering Note

Local scores and iframe messages are player-editable. They are suitable for local score history and UI tests, not for wallet settlement or determining a real-money winner. Cash matches stay disabled until a server verifies match identity, duration, and game results and performs the wallet transaction.
