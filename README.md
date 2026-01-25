# Solar System (Approximate)

Real-time, interactive 3D solar system prototype built with Ursina.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python main.py
```

## Controls

- `+` / `-`: speed up / slow down time
- `space`: pause
- `r`: reset time scale
- `1-9`: focus camera on Sun through Neptune

## Notes

- Orbits are circular and approximate.
- The Moon is tidally locked (a marker dot always faces Earth).
- Closest-approach readout is approximate and based on current positions.

## Textures

Planet textures and the Milky Way sky are from Solar System Scope (https://www.solarsystemscope.com/textures/) and are provided under CC BY 4.0.
