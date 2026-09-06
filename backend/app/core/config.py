from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Concept Foundry API"
    environment: str = "development"
    secret_key: str = "change-me-to-a-long-random-string"
    access_token_expire_minutes: int = 60 * 24 * 7
    database_url: str = "postgresql+psycopg://concept:concept@localhost:5432/concept_foundry"
    cors_origins: str = "http://localhost:8080,http://127.0.0.1:8080"
    seed_admin_email: str = "admin@example.com"
    seed_admin_password: str = "ChangeMe123!"
    seed_admin_name: str = "Admin"
    resend_api_key: str = ""
    email_from: str = "Sales <sales@mrfogsales.com>"
    mapbox_access_token: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
