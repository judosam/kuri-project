from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.captured_image import CapturedImage


class ImageRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(
        self,
        record_id: int,
        google_drive_file_id: str,
        file_name: str,
        photo_order: int,
        latitude: float,
        longitude: float,
        location_accuracy: float,
        captured_at,
        source="camera",
    ) -> CapturedImage:
        image = CapturedImage(
            record_id=record_id,
            google_drive_file_id=google_drive_file_id,
            file_name=file_name,
            photo_order=photo_order,
            latitude=latitude,
            longitude=longitude,
            location_accuracy=location_accuracy,
            captured_at=captured_at,
            source=source,
        )
        self.db.add(image)
        self.db.commit()
        self.db.refresh(image)
        return image

    def get_by_id(self, image_id: int) -> Optional[CapturedImage]:
        return self.db.query(CapturedImage).filter(CapturedImage.id == image_id).first()

    def get_by_record_id(self, record_id: int) -> List[CapturedImage]:
        return (
            self.db.query(CapturedImage)
            .filter(CapturedImage.record_id == record_id)
            .order_by(CapturedImage.photo_order)
            .all()
        )

    def get_by_record_and_image_id(
        self, record_id: int, image_id: int
    ) -> Optional[CapturedImage]:
        return (
            self.db.query(CapturedImage)
            .filter(
                CapturedImage.id == image_id,
                CapturedImage.record_id == record_id,
            )
            .first()
        )

    def delete_by_record_id(self, record_id: int) -> None:
        self.db.query(CapturedImage).filter(
            CapturedImage.record_id == record_id
        ).delete()
        self.db.commit()

    def get_pending_by_record_id(self, record_id: int) -> List[CapturedImage]:
        """Get images that have been created but not yet uploaded (pending: prefix)."""
        return (
            self.db.query(CapturedImage)
            .filter(
                CapturedImage.record_id == record_id,
                CapturedImage.google_drive_file_id.like("pending:%")
            )
            .order_by(CapturedImage.photo_order)
            .all()
        )

    def update_storage_key(self, image: CapturedImage, storage_key: str) -> CapturedImage:
        """Update an image's storage key from pending to real file ID/path."""
        image.google_drive_file_id = storage_key
        self.db.commit()
        self.db.refresh(image)
        return image

    def delete_pending_by_record_id(self, record_id: int) -> int:
        """Delete all pending (never-uploaded) image rows for a record. Returns count deleted."""
        count = (
            self.db.query(CapturedImage)
            .filter(
                CapturedImage.record_id == record_id,
                CapturedImage.google_drive_file_id.like("pending:%")
            )
            .delete()
        )
        self.db.commit()
        return count

    def get_drive_file_ids_by_record(self, record_id: int) -> List[str]:
        results = (
            self.db.query(CapturedImage.google_drive_file_id)
            .filter(CapturedImage.record_id == record_id)
            .all()
        )
        return [r[0] for r in results]
