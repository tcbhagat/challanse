import hashlib
import io
from PIL import Image, UnidentifiedImageError

FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
MAX_PIXELS = 25_000_000

def validate_and_sanitize(data: bytes, declared_mime: str, expected_sha256: str) -> tuple[bytes, str]:
    if len(data) > 5_000_000 or hashlib.sha256(data).hexdigest() != expected_sha256:
        raise ValueError("Image checksum or size is invalid.")
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            actual_mime = FORMATS.get(image.format or "")
            if actual_mime != declared_mime or image.width < 64 or image.height < 64 or image.width * image.height > MAX_PIXELS:
                raise ValueError("Image type or dimensions are invalid.")
            output = io.BytesIO()
            image = image.convert("RGB")
            image.save(output, format="WEBP", quality=88, method=6, exif=b"")
            return output.getvalue(), "image/webp"
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError("Image could not be decoded.") from error
