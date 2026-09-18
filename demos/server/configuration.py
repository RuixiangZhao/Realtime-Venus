"""Browser access to local task settings; no credentials are returned to the UI."""

import hashlib
import secrets
import tempfile

from demos.settings import UserSetup, config_path, load_setup, save_setup


class WebConfiguration:
    def __init__(self, path):
        self.path = config_path(path)
        self.token = secrets.token_urlsafe(32)

    def revision(self):
        return (
            hashlib.sha256(self.path.read_bytes()).hexdigest()
            if self.path.exists()
            else "new"
        )

    def load(self):
        return load_setup(self.path)

    def status(self):
        try:
            return self.path.exists() and self.load().check()["ok"]
        except (OSError, ValueError, TypeError, KeyError):
            return False

    def public(self):
        setup = self.load()
        return {
            "data": setup.data,
            "revision": self.revision(),
            "token": self.token,
            "configured": self.status(),
            "check": setup.check(),
        }

    def save(self, body):
        if not isinstance(body, dict) or body.get("revision") != self.revision():
            raise RuntimeError(
                "Settings changed; reopen the panel / 配置已变化，请重新打开"
            )
        setup = UserSetup(body.get("data"), self.path)
        result = setup.check()
        if not result["ok"]:
            return result
        setup.workspace.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile(dir=setup.workspace):
            pass
        save_setup(setup.data, self.path)
        return result
