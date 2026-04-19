# IgnorAInt

The official website for **IgnorAInt**.

## Structure

- `project/index.html` — the site's landing page
- `project/styles.css` — site styles
- `project/colors_and_type.css` — design tokens (colors, typography)
- `project/assets/` — images, logos, illustrations, SVGs

## Local preview

Open `project/index.html` in any modern browser, or run a small static server from the `project/` folder:

```bash
cd project
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying on GitHub Pages

Go to the repo's **Settings → Pages** and set the source to the `main` branch, `/project` folder.
