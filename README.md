# Solar System (WebGL)

Real-time, interactive 3D solar system built with [Three.js](https://threejs.org/), running entirely in the browser — no build step required.

## Run locally

The app uses ES modules, so it must be served over HTTP (not opened as a file):

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/web/`.

## Controls

| Key / Input | Action |
|---|---|
| Click | Capture mouse look |
| Mouse move | Look around |
| Scroll | Zoom |
| `W` `A` `S` `D` | Move forward / left / back / right |
| `T` / `G` | Move up / down |
| `Q` / `E` | Slow down / speed up time |
| `Space` | Pause |
| `R` | Reset time scale |
| `1` – `9` | Focus camera on Sun → Neptune |
| `V` | Toggle real vs. visual planet sizes |
| `N` | Toggle planet/moon name labels |
| `Esc` | Release mouse |

## Notes

- Orbits use Keplerian elements (JPL J2000 epoch) and solve Kepler's equation each frame.
- The Moon is tidally locked; its near side always faces Earth.
- Rings are rendered for Jupiter, Saturn, Uranus, and Neptune.
- Major moons of all gas giants are included.

## Textures & assets

Planet textures and the Milky Way sky are from [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0).
Explosion sound: [OpenGameArt](https://opengameart.org/content/explosion-0) (CC0).

Assets live in `web/assets/`.

## Deployment (Cloudflare Pages)

1. Set the build root to `web/` (no build command needed).
2. Ensure `web/assets/textures/` and `web/assets/sounds/` are present.
3. Deploy — the app is fully static.
