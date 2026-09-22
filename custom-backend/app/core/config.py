from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    app_name: str = "SafeNestT Custom API"
    environment: str = "development"
    database_url: str = ""
    jwt_secret: str = ""
    jwt_issuer: str = "safenestt"
    access_token_minutes: int = 15
    refresh_token_days: int = 30

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

settings = Settings()
