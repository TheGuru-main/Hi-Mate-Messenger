from pydantic import BaseModel, ConfigDict


class NewsPreferenceUpdate(BaseModel):
    topics: list[str] | None = None
    followed_leagues: list[str] | None = None
    country: str | None = None


class NewsPreferenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    topics: list[str]
    followed_leagues: list[str]
    country: str


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


class MenuItem(BaseModel):
    key: str
    label: str
    status: str  # "available" | "coming_soon" | "external"
