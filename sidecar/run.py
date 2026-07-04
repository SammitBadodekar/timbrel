"""Frozen-binary entry point (PyInstaller analyzes this).

For development you can equivalently run ``python -m timbrel_sidecar``.
"""

import sys

from timbrel_sidecar.app import main

if __name__ == "__main__":
    sys.exit(main())
