from fastapi import APIRouter, Depends, Query

from app.dependencies import get_current_user
from app.models.user import User
from app.services import news

router = APIRouter(prefix="/feed", tags=["news"])


@router.get("/news")
async def get_news_feed(
    country: str = Query(default="ng"),
    current_user: User = Depends(get_current_user),
):
    articles = await news.fetch_general_news(country=country)
    return {"category": "News", "count": len(articles), "items": articles}


@router.get("/sports")
async def get_sports_feed(
    league_id: int | None = Query(default=None),
    current_user: User = Depends(get_current_user),
):
    fixtures = await news.fetch_football_fixtures(league_id=league_id)
    return {"category": "Sports", "count": len(fixtures), "items": fixtures}
