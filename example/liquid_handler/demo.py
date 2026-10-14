"""A simulated Opentrons Flex on the IvoryOS edge, through PyLabRobot 1.0 (plr-ivoryos).

    uv run --project edge_server --with-editable ../IvoryOS-PyLabRobot-Integration \
        python example/liquid_handler/demo.py          (plr-ivoryos 1.0.0b1, not on PyPI yet)

PyLabRobot's own Flex, against a simulated robot (plr_ivoryos.opentrons.simulator): tips and volumes
are tracked and PyLabRobot's checks are real, nothing is connected. The Flex is the instrument
`flex`, and each thing mounted on it is one too: `flex_left` (an 8-channel 1000 µL pipette),
`flex_right` (a 1-channel), `flex_gripper`. A simulated plate reader reads what was pipetted. Open
the Labware panel to watch the deck, change what is mounted, or move labware.

What is mounted and what sits where is the worktable file, not this script: worktable.json in the
deck's data folder (copied from beside this script on the first start), edited in the Labware panel.

Runs beside the main demo deck (port 8080); its database, saved workflows and worktable file live
in example/liquid_handler/.edge/.
"""

import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# Before ivoryos_edge is imported: it reads the state folder at import time.
os.environ.setdefault("IVORYOS_EDGE_HOME", os.path.join(HERE, ".edge"))
sys.path.insert(0, os.path.join(HERE, "..", "..", "edge_server"))

import ivoryos_edge  # noqa: E402
from ivoryos_edge.paths import DATA_DIR, WORKFLOWS_DIR  # noqa: E402
from plr_ivoryos.labware_view import plugin as labware_view  # noqa: E402
from plr_ivoryos.opentrons import Flex  # noqa: E402
from plate_reader import SimulatedPlateReader  # noqa: E402

# The worktable this deck uses, kept in its data folder so the Labware view can change it. The
# first start copies the example's there.
WORKTABLE = os.path.join(DATA_DIR, "worktable.json")
if os.path.exists(WORKTABLE):
    import json
    with open(WORKTABLE, encoding="utf-8") as _f:
        if json.load(_f).get("deck_type") != "FlexDeck":  # this example's OT-2 worktable from before
            os.replace(WORKTABLE, os.path.join(DATA_DIR, "worktable.before-flex.json"))
if not os.path.exists(WORKTABLE):
    shutil.copy(os.path.join(HERE, "worktable.json"), WORKTABLE)

# The simulator answers at once; a short pause per step makes a run watchable.
flex = Flex(simulated=True, worktable=WORKTABLE, step_delay_s=0.35)
plate_reader = SimulatedPlateReader(flex)

# Ready-made workflows for this worktable, copied in once.
os.makedirs(WORKFLOWS_DIR, exist_ok=True)
for _file in os.listdir(os.path.join(HERE, "workflows")):
    if _file.endswith(".json") and not os.path.exists(os.path.join(WORKFLOWS_DIR, _file)):
        shutil.copy(os.path.join(HERE, "workflows", _file), os.path.join(WORKFLOWS_DIR, _file))

ivoryos_edge.run(__name__, port=int(os.environ.get("IVORYOS_PORT", 8083)), plugins=[labware_view])
