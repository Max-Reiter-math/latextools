# latextools

Small tools that help when working on LaTeX documents and projects.

latextools comes in two versions with the same look and the same tools:

- **Desktop app** for Windows: a single `latextools.exe`, no installation needed.
- **Web app**: runs in your browser at `https://<username>.github.io/latextools/`.
  The browser cannot read files from your disk on its own, so a few features
  are desktop-only (they are marked in the app's console).

## Tools

| Tool   | What it does |
|--------|--------------|
| Export | Converts LaTeX to Markdown or HTML. Your own `\newcommand` and `\newenvironment` definitions are expanded, math is rewritten to work in Markdown and HTML (MathJax/KaTeX), and messages appear in a console. The desktop app also pulls in files from `\input`, `\include` and `\subfile`. |

More tools will follow.

## Download

Get `latextools.exe` from the [Releases](../../releases) page and double-click it.

## Run from source

Requires [conda](https://docs.conda.io/).

```bash
conda env create -f environment.yml
conda activate latextools
python -m latextools.desktop          # desktop app
python -m http.server 8765 -d web     # web app at http://localhost:8765
build_exe.bat                         # builds dist\latextools.exe
```

## How it is built

The backend is written in Python (`latextools/`). Every Python module has a
JavaScript twin with the same functions (`web/backend/`), so the web app can
work without Python. Both versions share one HTML/CSS frontend (`web/`); the
desktop app shows it in a native window using [pywebview](https://pywebview.flowrl.com/).

The tests run the same example files through Python and JavaScript and check
that both give the same result:

```bash
python tests/test_export.py
node tests/test_export.mjs
```

## License

[MIT](LICENSE) © 2026 Max
