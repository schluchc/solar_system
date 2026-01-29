# Solar System WebGL

This is a browser-based version of the solar system demo using Three.js and WebGL.

## Run locally

Because the app uses ES modules, serve the repo from a local web server:

```bash
python -m http.server 8000
```

Then open:

```
http://localhost:8000/web/
```

## Notes

- Assets are loaded from `./assets` (copied into `web/assets` for deployment).
- Controls are listed in the in-page HUD.

## Cloudflare Pages checklist

1. Ensure `web/assets` exists with textures and sounds.
2. Deploy the `web/` directory (no build command).
3. If you update assets, re-copy them into `web/assets` before deploying.
