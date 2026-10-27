"""Start PhotoCapture API for local/LAN development.

The application/business backend remains unchanged. This launcher only works
around a Windows Python 3.12 + SQLAlchemy import hang caused by platform.machine()
performing a WMI query during SQLAlchemy's optional C-extension detection.
"""
import os
import sys

backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

if os.name == "nt":
    import platform
    platform.machine = lambda: "AMD64"

import uvicorn


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8005, reload=True, app_dir=backend_dir)

