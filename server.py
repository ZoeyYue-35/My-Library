#!/usr/bin/env python3
"""Compatibility launcher for local users.

The backend source now lives in ``backend/server.py``. Keeping this tiny
launcher means the documented local command still works:

    MY_LIBRARY_PORT=8011 python3 server.py
"""

from pathlib import Path
import runpy


runpy.run_path(str(Path(__file__).resolve().parent / "backend" / "server.py"), run_name="__main__")
