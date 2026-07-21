import json
import sys

from .config import get_settings
from .local_auth import LocalAuthError, enroll_reviewer


def main() -> None:
    payload = json.loads(sys.stdin.read())
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))
    if not email or not password:
        raise LocalAuthError("reviewer_enrollment_input_invalid")
    uri, recovery_codes = enroll_reviewer(get_settings(), email, password)
    print("Reviewer MFA enrollment generated. Store these details offline; they are shown once.")
    print(f"otpauth_uri={uri}")
    print("recovery_codes=" + ",".join(recovery_codes))


if __name__ == "__main__":
    main()
