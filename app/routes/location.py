from fastapi import APIRouter, Query

router = APIRouter(prefix="/location", tags=["location"])

# Starter data set — extend as real coverage is needed. Structured so
# adding a country/region is just adding a dict entry, no code changes.
REGIONS: dict[str, list[str]] = {
    "NG": ["Lagos", "Rivers", "Kano", "Abuja", "Oyo", "Kaduna", "Enugu"],
    "GH": ["Greater Accra", "Ashanti", "Western", "Eastern"],
    "KE": ["Nairobi", "Mombasa", "Kisumu"],
    "US": ["California", "New York", "Texas", "Florida"],
    "UK": ["London", "Manchester", "Birmingham"],
}

LOCALITIES: dict[str, list[str]] = {
    "Lagos": ["Ikeja", "Lekki", "Yaba", "Surulere", "Apapa", "Victoria Island"],
    "Rivers": ["Port Harcourt", "Obio/Akpor", "Eleme"],
    "Greater Accra": ["Accra", "Tema", "Osu"],
}


@router.get("/regions")
async def get_regions(country: str = Query(...)):
    """GET /location/regions?country=NG"""
    regions = REGIONS.get(country.upper(), [])
    return {"country": country, "regions": regions}


@router.get("/localities")
async def get_localities(region: str = Query(...)):
    """GET /location/localities?region=Lagos"""
    localities = LOCALITIES.get(region, [])
    return {"region": region, "localities": localities}
