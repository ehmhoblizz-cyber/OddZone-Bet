# Star Shooter 3D

A high-performance 3D arcade space shooter built with **Three.js**, **Vanilla JavaScript**, and **Web Audio API**. Fly a sleek spaceship through deep space, blast enemy interceptors, collect power-ups, and defeat massive bosses in endless waves.

## 🚀 Live Demo

Play the game here: [https://trinay-1.github.io/Star-Shooter-3d/]

## ✨ Features

- 🎮 Third-person 3D flight with mouse steering and smooth banking
- 💥 Four enemy types: Scout, Tank, Shooter, and Basic
- 👾 Boss battles every 5th wave with unique attack patterns
- ⚡ Four power-ups: Shield, Rapid Fire, Score Multiplier, Repair
- 🌌 Procedural synthwave background music (no audio files)
- 🎯 Floating score popups and dynamic visual effects
- 📱 Mobile touch controls (virtual joystick and fire zone)
- 💾 High score and lifetime stats saved to local storage
- 🔊 100% procedural audio via Web Audio API – zero external assets

## 🕹️ Controls

- **Mouse** – Steer the ship (yaw/pitch)
- **Left Click / Hold** – Fire lasers
- **ESC / P** – Pause
- **M** – Mute audio

### Mobile Touch Controls
- **Left half of screen** – Drag to steer
- **Right half of screen** – Touch and hold to fire

## 🛠️ Technologies Used

- HTML5 Canvas
- Three.js (loaded via CDN)
- CSS3 (custom styling, glassmorphism)
- Vanilla JavaScript (ES6)
- Web Audio API (procedural audio synthesis)
- localStorage (save system)

## 📂 Project Structure
star-shooter-3d/
├── index.html # Game layout, UI overlays, Three.js CDN loader
├── style.css # Cyberpunk/Sci-Fi UI styling
├── game.js # 3D engine, gameplay, audio, particles
└── README.md # This file


## 🚀 How to Run Locally

1. Clone or download this repository.
2. Open `index.html` in any modern browser.
3. No build step or server required. For best results, use a local server (e.g., `npx serve .` or VS Code Live Server).

## 📊 Scoring & Waves

- Basic Enemy: 100 pts
- Scout: 150 pts
- Shooter: 250 pts
- Tank: 300 pts
- Boss: 2000 pts
- Wave increases every 10 kills; boss appears every 5th wave.

## 💡 Power-Ups

| Power-Up | Effect | Duration |
|----------|--------|----------|
| Shield | Invulnerability | 5 sec |
| Rapid Fire | Faster shooting | 8 sec |
| Score Multiplier | 2x points | 10 sec |
| Repair | Restore 1 HP | Instant |

## 🧪 Development

This game was built as an experiment in procedural 3D rendering and audio. No external assets (models, textures, sounds) are used. Everything is generated at runtime.

Feel free to fork, modify, and improve!

## 📜 License

MIT License – free to use and modify.
