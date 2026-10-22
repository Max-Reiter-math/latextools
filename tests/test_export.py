"""Compare the Python export of every tests/cases/*.tex with its saved result.

    python tests/test_export.py           run the check
    python tests/test_export.py --update  save the current output as expected

tests/test_export.mjs checks the JavaScript twin against the same files.
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
from latextools.apps.export import convert  # noqa: E402

CASES = ROOT / "tests" / "cases"
EXTENSIONS = {"markdown": ".md", "html": ".html"}


def main():
    update = "--update" in sys.argv
    failures = 0
    for tex in sorted(CASES.glob("*.tex")):
        for fmt, ext in EXTENSIONS.items():
            expected_file = tex.with_suffix(ext)
            output, _log = convert(tex.read_text("utf-8"), fmt)
            if update:
                expected_file.write_text(output, "utf-8", newline="\n")
            elif output != expected_file.read_text("utf-8"):
                failures += 1
                print(f"FAIL {expected_file.name}")
    print("updated" if update else f"{failures} failure(s)")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
