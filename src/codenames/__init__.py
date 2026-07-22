"""Hebrew Codenames co-pilot — engine package.

Path anchors live here so every module resolves data/assets against the project root,
regardless of the current working directory. The package sits at ``<root>/src/codenames``;
the runtime assets (``data/``, ``webapp/``, the served HTML) live at ``<root>``. In the deployed
container the same relation holds: code at ``/app/src/codenames``, assets at ``/app``.
"""

import os

# <root>/src/codenames/__init__.py  ->  <root>
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")

__all__ = ["PROJECT_ROOT", "DATA_DIR"]
