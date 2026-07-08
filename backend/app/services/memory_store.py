from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class MemoryStore:
    def __init__(self, database_path: str):
        path = Path(database_path)
        self.database_path = path if path.is_absolute() else Path(__file__).resolve().parents[2] / path
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.database_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    idea TEXT NOT NULL,
                    target_users TEXT,
                    platform TEXT,
                    created_at TEXT NOT NULL,
                    artifacts_json TEXT NOT NULL,
                    conversation_json TEXT NOT NULL,
                    score_json TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS memories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id TEXT NOT NULL,
                    keyword TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS staged_projects (
                    id TEXT PRIMARY KEY,
                    idea TEXT NOT NULL,
                    target_users TEXT,
                    platform TEXT,
                    current_stage TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    score_json TEXT NOT NULL,
                    state_json TEXT NOT NULL
                )
                """
            )
            self._ensure_columns(
                conn,
                "projects",
                {
                    "target_users": "TEXT",
                    "platform": "TEXT",
                    "artifacts_json": "TEXT NOT NULL DEFAULT '{}'",
                    "conversation_json": "TEXT NOT NULL DEFAULT '[]'",
                    "score_json": "TEXT NOT NULL DEFAULT '{}'",
                },
            )
            self._ensure_columns(
                conn,
                "staged_projects",
                {
                    "target_users": "TEXT",
                    "platform": "TEXT",
                    "current_stage": "TEXT NOT NULL DEFAULT 'decomposition'",
                    "created_at": "TEXT NOT NULL DEFAULT ''",
                    "updated_at": "TEXT NOT NULL DEFAULT ''",
                    "score_json": "TEXT NOT NULL DEFAULT '{}'",
                    "state_json": "TEXT NOT NULL DEFAULT '{}'",
                },
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_keyword ON memories(keyword)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_staged_projects_updated_at ON staged_projects(updated_at)")

    @staticmethod
    def _ensure_columns(conn: sqlite3.Connection, table: str, columns: dict[str, str]) -> None:
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        for name, definition in columns.items():
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")

    @staticmethod
    def _json_object(value: str | None) -> dict[str, Any]:
        if not value:
            return {}
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}

    @staticmethod
    def _json_list(value: str | None) -> list[dict[str, Any]]:
        if not value:
            return []
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []

    def save_project(
        self,
        project_id: str,
        idea: str,
        target_users: str | None,
        platform: str | None,
        artifacts: dict[str, Any],
        conversation: list[dict[str, Any]],
        score: dict[str, Any],
    ) -> None:
        created_at = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO projects
                (id, idea, target_users, platform, created_at, artifacts_json, conversation_json, score_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    project_id,
                    idea,
                    target_users,
                    platform,
                    created_at,
                    json.dumps(artifacts),
                    json.dumps(conversation),
                    json.dumps(score),
                ),
            )
            for keyword in self._keywords(idea):
                conn.execute(
                    """
                    INSERT INTO memories (project_id, keyword, summary, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (project_id, keyword, artifacts.get("prd", {}).get("summary", idea), created_at),
                )

    def list_projects(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, idea, created_at, score_json FROM projects ORDER BY created_at DESC LIMIT 50"
            ).fetchall()
        return [
            {
                "id": row["id"],
                "idea": row["idea"],
                "created_at": row["created_at"],
                "score": self._json_object(row["score_json"]),
            }
            for row in rows
        ]

    def get_project(self, project_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "idea": row["idea"],
            "target_users": row["target_users"],
            "platform": row["platform"],
            "created_at": row["created_at"],
            "artifacts": self._json_object(row["artifacts_json"]),
            "conversation": self._json_list(row["conversation_json"]),
            "score": self._json_object(row["score_json"]),
        }

    def save_staged_project(self, project: dict[str, Any]) -> None:
        score = project.get("score") or {}
        updated_at = project.get("updated_at") or datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO staged_projects
                (id, idea, target_users, platform, current_stage, created_at, updated_at, score_json, state_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    project["id"],
                    project["idea"],
                    project.get("target_users"),
                    project.get("platform"),
                    project.get("current_stage", "decomposition"),
                    project.get("created_at", updated_at),
                    updated_at,
                    json.dumps(score, default=str),
                    json.dumps(project, default=str),
                ),
            )
            conn.execute("DELETE FROM memories WHERE project_id = ?", (project["id"],))
            for keyword in self._keywords(project["idea"]):
                conn.execute(
                    """
                    INSERT INTO memories (project_id, keyword, summary, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (project["id"], keyword, project["idea"], project.get("created_at", updated_at)),
                )

    def list_staged_projects(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, idea, target_users, platform, current_stage, created_at, updated_at, score_json
                FROM staged_projects
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "idea": row["idea"],
                "target_users": row["target_users"],
                "platform": row["platform"],
                "current_stage": row["current_stage"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "score": self._json_object(row["score_json"]),
                "type": "staged",
            }
            for row in rows
        ]

    def get_staged_project(self, project_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT state_json FROM staged_projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            return None
        return self._json_object(row["state_json"]) or None

    def search_memory(self, idea: str, limit: int = 5) -> list[dict[str, Any]]:
        keywords = self._keywords(idea)
        if not keywords:
            return []
        clauses = " OR ".join(["keyword LIKE ?" for _ in keywords])
        params = [f"%{kw}%" for kw in keywords]
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT *
                FROM (
                    SELECT DISTINCT memories.project_id, projects.idea, memories.summary, projects.created_at
                    FROM memories
                    JOIN projects ON projects.id = memories.project_id
                    WHERE {clauses}
                    UNION
                    SELECT DISTINCT memories.project_id, staged_projects.idea, memories.summary, staged_projects.created_at
                    FROM memories
                    JOIN staged_projects ON staged_projects.id = memories.project_id
                    WHERE {clauses}
                )
                ORDER BY created_at DESC
                LIMIT ?
                """,
                [*params, *params, limit],
            ).fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    def _keywords(text: str) -> list[str]:
        stop_words = {
            "the", "and", "for", "with", "that", "this", "build", "system", "app", "application",
            "users", "user", "mobile", "web", "platform", "software", "create", "allows", "support",
        }
        words = []
        for raw in text.lower().replace(",", " ").replace(".", " ").split():
            word = "".join(ch for ch in raw if ch.isalnum() or ch == "-")
            if len(word) >= 4 and word not in stop_words:
                words.append(word)
        return sorted(set(words))[:12]
