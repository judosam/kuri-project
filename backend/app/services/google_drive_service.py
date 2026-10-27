import io
import logging
import os
from typing import Optional

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Drive service will be initialized lazily
_drive_service = None
_folder_cache: dict[str, str] = {}


def get_drive_service():
    """Initialize Google Drive service from service account credentials."""
    global _drive_service
    if _drive_service is not None:
        return _drive_service

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        creds_path = settings.GOOGLE_DRIVE_CREDENTIALS_PATH
        if not os.path.exists(creds_path):
            logger.warning(
                f"Google Drive credentials not found at {creds_path}. "
                "Drive uploads will be simulated."
            )
            return None

        creds = service_account.Credentials.from_service_account_file(
            creds_path,
            scopes=["https://www.googleapis.com/auth/drive.file"],
        )
        _drive_service = build("drive", "v3", credentials=creds)
        return _drive_service
    except Exception as e:
        logger.error(f"Failed to initialize Google Drive service: {e}")
        return None


class GoogleDriveService:
    """Service for uploading files to Google Drive."""

    def __init__(self):
        self.service = get_drive_service()
        self.root_folder_id = settings.GOOGLE_DRIVE_ROOT_FOLDER_ID

    def upload_image(
        self,
        file_content: bytes,
        file_name: str,
        folder_path: str = "captures",
        content_type: str = "image/jpeg",
    ) -> Optional[str]:
        """
        Upload an image to Google Drive.
        Returns the file ID on success, None on failure.

        Uses predictable folder/file naming for deduplication.
        """
        if not self.service:
            logger.warning("Google Drive service not available. Simulating upload.")
            return f"simulated-{file_name}"

        try:
            # Ensure folder exists (simplified — in production, cache folder IDs)
            folder_id = self._ensure_folder(folder_path)

            file_metadata = {
                "name": file_name,
                "parents": [folder_id],
            }

            media = io.BytesIO(file_content)
            from googleapiclient.http import MediaIoBaseUpload

            media_upload = MediaIoBaseUpload(
                media, mimetype=content_type, resumable=True
            )

            file = (
                self.service.files()
                .create(
                    body=file_metadata,
                    media_body=media_upload,
                    fields="id",
                )
                .execute()
            )

            file_id = file.get("id")
            logger.info(f"Uploaded file {file_name} with Drive ID: {file_id}")
            return file_id

        except Exception as e:
            logger.error(f"Failed to upload {file_name} to Google Drive: {e}")
            return None

    def _ensure_folder(self, folder_path: str) -> str:
        """Ensure a folder structure exists in Drive, return the leaf folder ID."""
        if not self.root_folder_id:
            raise ValueError("GOOGLE_DRIVE_ROOT_FOLDER_ID not configured")

        normalized = folder_path.strip("/")
        if normalized in _folder_cache:
            return _folder_cache[normalized]

        parts = normalized.split("/")
        current_parent = self.root_folder_id
        path_acc = ""

        for part in parts:
            path_acc = f"{path_acc}/{part}" if path_acc else part
            if path_acc in _folder_cache:
                current_parent = _folder_cache[path_acc]
                continue

            # Search for existing folder
            query = (
                f"'{current_parent}' in parents "
                f"and name='{part}' "
                f"and mimeType='application/vnd.google-apps.folder' "
                f"and trashed=false"
            )
            results = (
                self.service.files().list(q=query, fields="files(id)").execute()
            )
            files = results.get("files", [])

            if files:
                current_parent = files[0]["id"]
            else:
                # Create folder
                folder_metadata = {
                    "name": part,
                    "mimeType": "application/vnd.google-apps.folder",
                    "parents": [current_parent],
                }
                folder = (
                    self.service.files()
                    .create(body=folder_metadata, fields="id")
                    .execute()
                )
                current_parent = folder["id"]

            _folder_cache[path_acc] = current_parent

        _folder_cache[normalized] = current_parent
        return current_parent

    def delete_file(self, file_id: str) -> bool:
        """Delete a file from Google Drive."""
        if not self.service:
            return True

        try:
            self.service.files().delete(fileId=file_id).execute()
            return True
        except Exception as e:
            logger.error(f"Failed to delete file {file_id}: {e}")
            return False
