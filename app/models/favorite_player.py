from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String, UniqueConstraint

from app.database import Base


class FavoritePlayer(Base):
    """A player a user follows. Shown on their profile as 'Favorite players'."""

    __tablename__ = "favorite_players"
    __table_args__ = (UniqueConstraint("user_uid", "sport", "player_key", name="uq_favorite_player"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_uid = Column(String, index=True, nullable=False)
    sport = Column(String, nullable=False, default="football")
    player_key = Column(String, nullable=False)
    player_id = Column(String, nullable=True)
    player_name = Column(String, nullable=False)
    team_name = Column(String, nullable=True)
    team_key = Column(String, nullable=True)
    number = Column(String, nullable=True)
    position = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
