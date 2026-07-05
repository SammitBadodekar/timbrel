"""Frozen-binary entry point (PyInstaller analyzes this).

For development you can equivalently run ``python -m timbrel_sidecar``.
"""

import multiprocessing
import sys

from timbrel_sidecar.app import main

if __name__ == "__main__":
    # Required in the frozen binary: separation runs in a spawned worker
    # process, and without this the re-executed binary would rerun main().
    multiprocessing.freeze_support()
    sys.exit(main())
