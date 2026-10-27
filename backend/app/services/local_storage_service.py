import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Use environment variable or default to backend/data/uploads
UPLOAD_DIR = Path(os.environ.get(
    "LOCAL_STORAGE_DIR",
    str(Path(__file__).parent.parent.parent / "data" / "uploads")
))


class LocalStorageService:
    """Saves files locally when Google Drive credentials are not configured."""

    def __init__(self):
        try:
            UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass  # May fail in tests — graceful fallback

    def save_file(self, file_content: bytes, file_name: str, folder: str = "") -> str:
        """Save a file locally. Returns the relative path (forward slashes) for serving."""
        try:
            folder_path = UPLOAD_DIR / folder
            folder_path.mkdir(parents=True, exist_ok=True)
            file_path = folder_path / file_name
            file_path.write_bytes(file_content)
        except OSError as e:
            logger.error(f"Could not save file locally: {e}")
            raise RuntimeError(f"Could not save file locally: {e}") from e
        # Always use forward slashes so the key works on any OS
        return (Path(folder) / file_name).as_posix() if folder else file_name

    def get_file_path(self, relative_path: str) -> str | None:
        """Get full path to a stored file. Returns None if not found or if path escapes UPLOAD_DIR."""
        try:
            resolved_upload_dir = UPLOAD_DIR.resolve()
            target_path = (UPLOAD_DIR / Path(relative_path)).resolve()
            # Prevent directory traversal attacks (e.g. ../../)
            if not target_path.is_relative_to(resolved_upload_dir):
                logger.warning(f"Path traversal attempt detected and blocked: {relative_path}")
                return None
            if target_path.is_file():
                return str(target_path)
        except Exception as e:
            logger.warning(f"Path resolution error: {e}")
            return None
        return None

    def get_thumbnail_path(self, relative_path: str) -> str | None:
        """Get path to a thumbnail file (e.g. uploads/thumb_abc.jpg). If thumbnail exists, returns full path."""
        try:
            p = Path(relative_path)
            thumb_name = f"thumb_{p.name}"
            thumb_rel = (p.parent / thumb_name).as_posix() if str(p.parent) != "." else thumb_name
            return self.get_file_path(thumb_rel)
        except Exception:
            return None

    def delete_file(self, relative_path: str) -> bool:
        """Delete a stored file safely inside UPLOAD_DIR (and its thumbnail if present)."""
        try:
            resolved_upload_dir = UPLOAD_DIR.resolve()
            target_path = (UPLOAD_DIR / Path(relative_path)).resolve()
            if not target_path.is_relative_to(resolved_upload_dir):
                logger.warning(f"Path traversal delete attempt blocked: {relative_path}")
                return False

            # Delete thumbnail if present
            thumb_path = self.get_thumbnail_path(relative_path)
            if thumb_path and Path(thumb_path).is_file():
                try:
                    Path(thumb_path).unlink()
                except Exception:
                    pass

            if target_path.is_file():
                target_path.unlink()
                return True
        except Exception:
            return False
        return False

