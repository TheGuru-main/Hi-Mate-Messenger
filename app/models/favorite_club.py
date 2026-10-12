from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String, UniqueConstraint

from app.database import Base


class FavoriteClub(Base):
    """A club a user follows. Shown on their profile as 'Favorite clubs'."""

    __tablename__ = "favorite_clubs"
    __table_args__ = (UniqueConstraint("user_uid", "sport", "team_key", name="uq_favorite_club"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_uid = Column(String, index=True, nullable=False)
    sport = Column(String, nullable=False, default="football")
    team_key = Column(String, index=True, nullable=False)
    team_name = Column(String, nullable=False)
    team_logo = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
