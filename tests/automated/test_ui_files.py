"""How the edge finds and serves its built UI (server.py _frontend_dirs, UIFiles).

Served with no caching header, a browser kept an edge's old page, and the old scripts it names,
after the edge was updated, until a hard reload. A 404 left the same way: starlette serves the
build's 404.html outside file_response, so the answer to an old page asking for a chunk the new
build no longer has could be kept too.

An edge installed from a wheel looked only for frontend/out three folders above server.py, which
exists in a source checkout and nowhere else, so `pip install` gave an API with no pages. It now
serves the copy its wheel carries (ivoryos_edge/ui/) first.
"""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from ivoryos_edge import server
from ivoryos_edge.server import UIFiles


def _ui(tmp_path, not_found_page=True):
    (tmp_path / "designer").mkdir()
    (tmp_path / "designer" / "index.html").write_text("<html>designer</html>")
    (tmp_path / "index.html").write_text("<html>home</html>")
    if not_found_page:  # a Next export always writes one
        (tmp_path / "404.html").write_text("<html>not found</html>")
    chunks = tmp_path / "_next" / "static" / "chunks"
    chunks.mkdir(parents=True)
    (chunks / "1abc.js").write_text("console.log(1)")
    app = FastAPI()
    app.mount("/", UIFiles(directory=str(tmp_path), html=True), name="static")
    return TestClient(app)


def test_pages_are_rechecked_and_named_scripts_are_kept(tmp_path):
    client = _ui(tmp_path)
    page = client.get("/designer/")
    assert page.status_code == 200 and page.headers["cache-control"] == "no-cache"
    assert client.get("/").headers["cache-control"] == "no-cache"
    script = client.get("/_next/static/chunks/1abc.js")
    assert script.status_code == 200
    assert script.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_a_missing_script_is_a_404_that_is_rechecked(tmp_path):
    """An old page kept by a browser names scripts by content hash, and the new build has other
    names: the 404 it gets must not be kept as that script, nor as missing once the page is new."""
    client = _ui(tmp_path)
    gone = client.get("/_next/static/chunks/does-not-exist.js")
    assert gone.status_code == 404 and gone.headers["cache-control"] == "no-cache"
    assert "not found" in gone.text, "the build's own 404 page, as before"
    assert client.get("/no/such/page/").status_code == 404
    assert client.get("/no/such/page/").headers["cache-control"] == "no-cache"
    # The two answers that existed are unchanged.
    script = client.get("/_next/static/chunks/1abc.js")
    assert script.status_code == 200 and script.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert client.get("/designer/").headers["cache-control"] == "no-cache"


def test_a_404_is_rechecked_without_a_404_page_too(tmp_path):
    """A build with no 404.html: starlette raises, the app answers, and the header still goes."""
    client = _ui(tmp_path, not_found_page=False)
    gone = client.get("/_next/static/chunks/does-not-exist.js")
    assert gone.status_code == 404 and gone.headers["cache-control"] == "no-cache"


def test_an_unchanged_page_comes_back_as_a_304(tmp_path):
    client = _ui(tmp_path)
    etag = client.get("/designer/").headers["etag"]
    again = client.get("/designer/", headers={"If-None-Match": etag})
    assert again.status_code == 304


def _layout(tmp_path, monkeypatch, package):
    """server.py placed at `package`/server.py, as installed or in a checkout."""
    monkeypatch.delenv("IVORYOS_FRONTEND_DIR", raising=False)
    package.mkdir(parents=True)
    monkeypatch.setattr(server, "__file__", str(package / "server.py"))


def _build(folder):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "index.html").write_text("<html>built</html>")
    return str(folder)


def test_the_ui_inside_the_package_comes_before_the_checkout(tmp_path, monkeypatch):
    package = tmp_path / "edge_server" / "ivoryos_edge"
    _layout(tmp_path, monkeypatch, package)
    checkout = _build(tmp_path / "frontend" / "out")
    assert server._default_frontend_dir() == checkout, "a checkout: development is unchanged"
    (package / "ui").mkdir()
    assert server._default_frontend_dir() == checkout, "an empty ui/ is not a build"
    packaged = _build(package / "ui")
    assert server._default_frontend_dir() == packaged
    assert server._frontend_dirs() == [packaged, checkout]


def test_an_installed_edge_serves_the_ui_it_carries(tmp_path, monkeypatch):
    package = tmp_path / "venv" / "lib" / "python3.11" / "site-packages" / "ivoryos_edge"
    _layout(tmp_path, monkeypatch, package)
    assert server._default_frontend_dir() is None
    # What the warning names: where it looked.
    assert server._frontend_dirs() == [str(package / "ui"), str(package.parent.parent / "frontend" / "out")]
    packaged = _build(package / "ui")
    assert server._default_frontend_dir() == packaged


def test_ivoryos_frontend_dir_is_the_only_place_when_set(tmp_path, monkeypatch):
    package = tmp_path / "edge_server" / "ivoryos_edge"
    _layout(tmp_path, monkeypatch, package)
    _build(package / "ui")
    chosen = tmp_path / "elsewhere"
    monkeypatch.setenv("IVORYOS_FRONTEND_DIR", str(chosen))
    assert server._frontend_dirs() == [str(chosen)]
    assert server._default_frontend_dir() is None, "not built there: say so, do not serve another"
    built = _build(chosen)
    assert server._default_frontend_dir() == built
