"""The build backend of ivoryos-edge: setuptools, refusing a wheel or sdist with no web UI in it.

A wheel or sdist is the edge as people install it (`pip install ivoryos-edge`, the desktop app's
bundled wheel), and it serves the pages it carries in `ivoryos_edge/ui/`, which are the same
version as its API. That folder is a build output, not source: scripts/build-edge.js at the
repository root builds the frontend, copies frontend/out into it and builds. Building without it
used to succeed and gave an edge that starts with an API and no pages, so it is refused here, and
the built file is checked to hold the pages too (a package-data rule that stops matching would
otherwise drop them silently).

An editable install (`pip install -e`, a source checkout in development) needs no copy: the edge
serves frontend/out from the checkout (`_frontend_dirs` in ivoryos_edge/server.py).
"""
import os
import shutil
import tarfile
import zipfile

from setuptools import build_meta as _setuptools
from setuptools.build_meta import *  # noqa: F401,F403  every other hook, editable installs included

_UI_INDEX = "ivoryos_edge/ui/index.html"


def _refuse(message):
    raise RuntimeError(
        f"{message}\nA wheel or sdist of ivoryos-edge must carry the web UI, or the edge it installs "
        "starts with no pages. Build it with `npm run build:edge` from the repository root, which "
        "builds frontend/ and copies frontend/out into ivoryos_edge/ui/ first. (In development, "
        "`pip install -e ./edge_server` needs no copy: it serves frontend/out from the checkout.)"
    )


def _require_ui():
    if not os.path.isfile(_UI_INDEX):
        _refuse(f"No web UI to package: {os.path.abspath(_UI_INDEX)} does not exist.")


def _check_built(path, names):
    if not any(name == _UI_INDEX or name.endswith("/" + _UI_INDEX) for name in names):
        os.remove(path)
        _refuse(f"{os.path.basename(path)} came out without {_UI_INDEX}, so it was removed. "
                "Check [tool.setuptools.package-data] in edge_server/pyproject.toml.")


def build_wheel(wheel_directory, config_settings=None, metadata_directory=None):
    _require_ui()
    # setuptools copies the package into build/lib and packs everything there, earlier builds'
    # files too: the UI's script names change with every frontend build, so old ones would pile up.
    shutil.rmtree(os.path.join("build", "lib", "ivoryos_edge", "ui"), ignore_errors=True)
    name = _setuptools.build_wheel(wheel_directory, config_settings, metadata_directory)
    path = os.path.join(wheel_directory, name)
    with zipfile.ZipFile(path) as wheel:
        names = wheel.namelist()
    _check_built(path, names)
    return name


def build_sdist(sdist_directory, config_settings=None):
    _require_ui()
    name = _setuptools.build_sdist(sdist_directory, config_settings)
    path = os.path.join(sdist_directory, name)
    with tarfile.open(path) as sdist:
        names = sdist.getnames()
    _check_built(path, names)
    return name
