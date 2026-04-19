# IgnorAInt

The official website for **IgnorAInt**.

## Structure

- `index.html` — the site's landing page
- `styles.css` — site styles
- `colors_and_type.css` — design tokens (colors, typography)
- `assets/` — images, logos, illustrations, SVGs

## Local preview

Open `index.html` in any modern browser, or run a small static server:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying

**GitHub Pages:** Settings → Pages → Source: `main` branch, `/` (root).

**Render / Netlify / Vercel:** point the service at this repo; `index.html` is at the root, so no build command is needed.
