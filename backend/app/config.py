from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    qwen_api_key: str = Field(default="", alias="QWEN_API_KEY")
    qwen_base_url: str = Field(
        default="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        alias="QWEN_BASE_URL",
    )
    qwen_model: str = Field(default="qwen-plus", alias="QWEN_MODEL")
    app_env: str = Field(default="local", alias="APP_ENV")
    database_path: str = Field(default="data/devteam.sqlite", alias="DATABASE_PATH")
    qwen_timeout_seconds: int = Field(default=90, alias="QWEN_TIMEOUT_SECONDS")

    model_config = SettingsConfigDict(env_file=".env", populate_by_name=True, extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
