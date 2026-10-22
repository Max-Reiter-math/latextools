"""Print the Python export of a test case: python tests/run_case.py basic markdown"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from latextools.apps.export import convert  # noqa: E402

name, fmt = sys.argv[1], sys.argv[2]
text, log = convert((pathlib.Path(__file__).parent / "cases" / f"{name}.tex").read_text("utf-8"), fmt)
print(text)
print("\n".join(log))
