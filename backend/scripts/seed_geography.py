from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import seed_geography
from geography import build_region_name_map, load_seed_data

if __name__ == '__main__':
    result = seed_geography(seed_config_regions=True)
    seed = load_seed_data()
    print('Seeded geography data')
    print(f"Continents: {result['continents']}")
    print(f"Countries: {result['countries']}")
    print(f"Regions: {result['regions']}")
    print(f"Config region groups: {len(build_region_name_map(seed))}")
