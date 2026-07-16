from io import BytesIO

from PIL import Image


def _decimal(values: tuple[float, float, float], reference: str) -> float:
    degrees, minutes, seconds = values
    result = float(degrees) + float(minutes) / 60 + float(seconds) / 3600
    return -result if reference in {"S", "W"} else result


def extract_gps(image_bytes: bytes) -> tuple[float | None, float | None]:
    with Image.open(BytesIO(image_bytes)) as image:
        gps = image.getexif().get_ifd(0x8825)
    latitude = gps.get(2) if gps else None
    longitude = gps.get(4) if gps else None
    if not latitude or not longitude:
        return None, None
    return _decimal(latitude, str(gps.get(1, "N"))), _decimal(longitude, str(gps.get(3, "E")))
