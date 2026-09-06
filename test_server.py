import time
import json
import urllib.request
import urllib.error
import threading
from server import run_server

# ponytail: assert-based self test using stdlib urllib; upgrade to pytest when adding complex mock bridges

def test_suite():
    port = 4045
    t = threading.Thread(target=run_server, args=(port,), daemon=True)
    t.start()
    time.sleep(0.5)

    base_url = f"http://127.0.0.1:{port}"

    # 1. Status test
    req = urllib.request.Request(f"{base_url}/api/status")
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200
        data = json.loads(resp.read().decode("utf-8"))
        assert data.get("status") == "online"

    # 2. Auth fail test
    req_bad_auth = urllib.request.Request(
        f"{base_url}/api/auth",
        data=json.dumps({"token": "wrong-token"}).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        urllib.request.urlopen(req_bad_auth)
        assert False, "Should fail with 403"
    except urllib.error.HTTPError as e:
        assert e.code == 403

    # 3. Auth success test
    req_good_auth = urllib.request.Request(
        f"{base_url}/api/auth",
        data=json.dumps({"token": "cursor-remote-2026"}).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req_good_auth) as resp:
        assert resp.status == 200
        auth_data = json.loads(resp.read().decode("utf-8"))
        assert auth_data.get("ok") is True
        session_token = auth_data.get("token")
        assert len(session_token) > 0

    # 4. Protected /api/agents test
    req_agents = urllib.request.Request(
        f"{base_url}/api/agents",
        headers={"Authorization": f"Bearer {session_token}"}
    )
    with urllib.request.urlopen(req_agents) as resp:
        assert resp.status == 200
        agents_data = json.loads(resp.read().decode("utf-8"))
        assert "agents" in agents_data
        assert len(agents_data["agents"]) > 0

    # 5. Static file serving
    for asset in ["/", "/manifest.json", "/sw.js", "/style.css", "/app.js", "/icon.svg"]:
        req_asset = urllib.request.Request(f"{base_url}{asset}")
        with urllib.request.urlopen(req_asset) as resp:
            assert resp.status == 200

    print("ALL TESTS PASSED: Cursor Remote PWA verified.")

if __name__ == "__main__":
    test_suite()
