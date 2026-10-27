from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import os
import secrets
import string
from typing import Optional

import bcrypt
from jose import JWTError, jwt

from app.core.config import get_settings

settings = get_settings()

PBKDF2_ROUNDS = 200_000
PBKDF2_ALGORITHM = "sha256"
PBKDF2_SCHEME = "pbkdf2_sha256"
SYMBOL_POOL = "!@#$%^&*()-_=+"

# Pre-computed dummy salt for timing attack mitigation
_DUMMY_SALT = b"timing_defense16"
_DUMMY_HASH = hashlib.pbkdf2_hmac(
    PBKDF2_ALGORITHM,
    b"dummy_password_timing_defense",
    _DUMMY_SALT,
    PBKDF2_ROUNDS,
)


def generate_strong_password(length: int = 16) -> str:
    """Generate a high-entropy CSPRNG temporary password satisfying strict diversity:
    - Minimum 2 uppercase
    - Minimum 2 lowercase
    - Minimum 2 digits
    - Minimum 2 symbols (!@#$%^&*()-_=+)
    - Cryptographically shuffled via Fisher-Yates using secrets.randbelow
    """
    if length < 10:
        length = 16

    upper = string.ascii_uppercase
    lower = string.ascii_lowercase
    digits = string.digits
    symbols = SYMBOL_POOL

    chars = [
        secrets.choice(upper),
        secrets.choice(upper),
        secrets.choice(lower),
        secrets.choice(lower),
        secrets.choice(digits),
        secrets.choice(digits),
        secrets.choice(symbols),
        secrets.choice(symbols),
    ]

    all_chars = upper + lower + digits + symbols
    for _ in range(length - len(chars)):
        chars.append(secrets.choice(all_chars))

    # Fisher-Yates CSPRNG shuffle
    for i in range(len(chars) - 1, 0, -1):
        j = secrets.randbelow(i + 1)
        chars[i], chars[j] = chars[j], chars[i]

    return "".join(chars)


def hash_password(password: str) -> str:
    """Hash password using PBKDF2-HMAC-SHA256 with 200,000 rounds and 16 bytes CSPRNG salt.
    Format: pbkdf2_sha256$200000$<salt_hex>$<digest_hex>
    """
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        PBKDF2_ALGORITHM,
        password.encode("utf-8"),
        salt,
        PBKDF2_ROUNDS,
    )
    return f"{PBKDF2_SCHEME}${PBKDF2_ROUNDS}${salt.hex()}${digest.hex()}"


def verify_password(plain_password: str, stored_hash: str) -> bool:
    """Verify password in constant-time using hmac.compare_digest.
    Supports PBKDF2-HMAC-SHA256 and provides backward-compatible fallback for bcrypt hashes.
    """
    if not stored_hash or not plain_password:
        return False

    try:
        if stored_hash.startswith(f"{PBKDF2_SCHEME}$"):
            parts = stored_hash.split("$")
            if len(parts) != 4:
                return False
            _, rounds_str, salt_hex, digest_hex = parts
            iterations = int(rounds_str)
            salt = bytes.fromhex(salt_hex)
            stored_digest = bytes.fromhex(digest_hex)

            incoming_digest = hashlib.pbkdf2_hmac(
                PBKDF2_ALGORITHM,
                plain_password.encode("utf-8"),
                salt,
                iterations,
            )
            return hmac.compare_digest(incoming_digest, stored_digest)

        # Backward compatibility for legacy bcrypt hashes ($2b$, $2a$, $2y$)
        if stored_hash.startswith(("$2b$", "$2a$", "$2y$")):
            return bcrypt.checkpw(
                plain_password.encode("utf-8"), stored_hash.encode("utf-8")
            )
    except Exception:
        return False

    return False


def dummy_verify_password(plain_password: str) -> None:
    """Executes a full PBKDF2 calculation against dummy salt in constant time.
    Defeats timing attacks and user enumeration when user account does not exist.
    """
    try:
        incoming_digest = hashlib.pbkdf2_hmac(
            PBKDF2_ALGORITHM,
            plain_password.encode("utf-8"),
            _DUMMY_SALT,
            PBKDF2_ROUNDS,
        )
        hmac.compare_digest(incoming_digest, _DUMMY_HASH)
    except Exception:
        pass


def is_legacy_hash(stored_hash: str) -> bool:
    """Returns True if the stored hash is in an older format and needs transparent re-hashing."""
    return stored_hash.startswith(("$2b$", "$2a$", "$2y$"))


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        return payload
    except JWTError:
        return None
