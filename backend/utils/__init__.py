"""Scrapers package — adds parent dir to sys.path for shared_excel imports."""
import sys
from pathlib import Path

# Allow scrapers to import shared_excel from the backend root
_backend_dir = str(Path(__file__).resolve().parent.parent)
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)
