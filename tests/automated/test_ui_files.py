"""How the edge serves its built UI (server.py UIFiles).

Served with no caching header, a browser kept an edge's old page, and the old scripts it names,
after the edge was updated, until a hard reload.
"""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from ivoryos_edge.server import UIFiles


def _ui(tmp_path):
    (tmp_path / "designer").mkdir()
    (tmp_path / "designer" / "index.html").write_text("<html>designer</html>")
    (tmp_path / "index.html").write_text("<html>home</html>")
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


def test_an_unchanged_page_comes_back_as_a_304(tmp_path):
    client = _ui(tmp_path)
    etag = client.get("/designer/").headers["etag"]
    again = client.get("/designer/", headers={"If-None-Match": etag})
    assert again.status_code == 304
