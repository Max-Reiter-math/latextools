"""Desktop front end: shows the docs/ folder in a native window and lets
its JavaScript call the Python backend through the Api class below.

Run with:  python -m latextools.desktop
"""
import pathlib
import sys

import webview

from latextools.apps import export

# Inside the .exe built by PyInstaller the files live in sys._MEIPASS.
ROOT = pathlib.Path(getattr(sys, "_MEIPASS", pathlib.Path(__file__).parent.parent))
WEB = ROOT / "docs"


class Api:
    """Every method here can be called from JavaScript as python("name", ...)."""

    def open_tex(self):
        paths = webview.windows[0].create_file_dialog(
            webview.FileDialog.OPEN, file_types=("LaTeX files (*.tex)", "All files (*.*)"))
        if not paths:
            return None
        path = pathlib.Path(paths[0])
        return {"path": str(path), "text": path.read_text("utf-8")}

    def export(self, text, fmt, path=None):
        """Convert text; \\input files are looked up next to the opened file."""
        folder = pathlib.Path(path).parent if path else None

        def read_file(name):
            if folder is None:
                return None
            for candidate in (folder / name, folder / f"{name}.tex"):
                if candidate.is_file():
                    return candidate.read_text("utf-8")
            return None

        return export.convert(text, fmt, read_file)


def main():
    webview.create_window("latextools", str(WEB / "index.html") + "?desktop",
                          js_api=Api(), width=1200, height=850)
    webview.start(http_server=True)


if __name__ == "__main__":
    main()
