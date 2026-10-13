"""The deck the documentation screenshots are taken on.

The example lab (example/lab_drivers.py: three syringe pumps, a heater-stirrer, a balance, a UV-Vis
probe and an HPLC) with nothing else, in a data folder of its own (docs-site/.deck-data, ignored by
git), so the screenshots never show a developer's test drivers or their run history, and running
this never touches a real deck's database.

    uv run --project edge_server python docs-site/scripts/docs-deck.py      # http://localhost:8090

`npm run screenshots` in docs-site/ drives it (scripts/screenshots.mjs).
"""

import os
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA_DIR = os.path.join(ROOT, "docs-site", ".deck-data")
os.environ.setdefault("IVORYOS_DATA_DIR", DATA_DIR)
os.makedirs(os.path.join(DATA_DIR, "workflows"), exist_ok=True)

# The ready-made workflow the example ships with, copied once so the Library is not empty.
_shipped = os.path.join(ROOT, "edge_server", "ivoryos_edge", "workflows", "Suzuki coupling screen.json")
_seeded = os.path.join(DATA_DIR, "workflows", "Suzuki coupling screen.json")
if os.path.exists(_shipped) and not os.path.exists(_seeded):
    shutil.copyfile(_shipped, _seeded)

sys.path.insert(0, os.path.join(ROOT, "edge_server"))
sys.path.insert(0, os.path.join(ROOT, "example"))

import ivoryos_edge  # noqa: E402
from lab_drivers import HPLC, AnalyticalBalance, HeaterStirrer, SyringePump, UVVisSpectrometer  # noqa: E402

pump_1 = SyringePump(reagent="4-bromoanisole, 0.50 M in dioxane", role="substrate", concentration_m=0.50)
pump_2 = SyringePump(reagent="phenylboronic acid, 0.50 M in dioxane", role="boronic_acid", concentration_m=0.50)
pump_3 = SyringePump(reagent="Pd(dppf)Cl2, 10 mM in dioxane", role="catalyst", concentration_m=0.010)
reactor = HeaterStirrer(max_temperature_c=150.0)
balance = AnalyticalBalance()
uv_vis = UVVisSpectrometer(path_length_cm=1.0)
hplc = HPLC()

ivoryos_edge.run(__name__, port=int(os.environ.get("IVORYOS_PORT", 8090)))
