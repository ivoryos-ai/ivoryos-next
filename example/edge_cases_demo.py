"""A deck of nothing but the casting ground truth, for trying values by hand.

Starts an edge on port 8084 (or IVORYOS_PORT) with one instrument, `edge_cases`
(example/edge_case_sdl.py): one method per annotation shape, each keeping exactly what it received
and returning a one-line description of it (`int 3`, `Speed <Speed.FAST: 3>`). Type a value on the
Instruments page, in a Designer step, in an Iterate cell or an Optimize fixed value, run it, and
read back what the driver got. docs/argument_casting_ground_truth.md says what it should be;
tests/automated/test_casting_ground_truth.py checks the same rows automatically.

    uv run --project edge_server python example/edge_cases_demo.py

Its database and saved workflows live in example/.edge-cases, apart from the main demo's.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# Before ivoryos_edge is imported: it reads the data folder at import time.
os.environ.setdefault("IVORYOS_DATA_DIR", os.path.join(HERE, ".edge-cases"))
sys.path.insert(0, os.path.join(HERE, "..", "edge_server"))

import ivoryos_edge  # noqa: E402
from edge_case_sdl import EdgeCaseSDL  # noqa: E402

edge_cases = EdgeCaseSDL()

ivoryos_edge.run(__name__, port=int(os.environ.get("IVORYOS_PORT", 8084)))
