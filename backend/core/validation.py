"""
Normalisation and validation shared by every endpoint that accepts people or cooperatives.

Each `normalize_*` function returns the canonical stored form, or raises ValueError with a
message that is safe to show the user. `pydantic_field` adapts them for Pydantic validators
so FastAPI's 422 responses name the field and carry that message unchanged.
"""
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Callable

from pydantic_core import PydanticCustomError

KENYA_COUNTIES: tuple[str, ...] = (
    "Mombasa", "Kwale", "Kilifi", "Tana River", "Lamu", "Taita-Taveta", "Garissa", "Wajir",
    "Mandera", "Marsabit", "Isiolo", "Meru", "Tharaka-Nithi", "Embu", "Kitui", "Machakos",
    "Makueni", "Nyandarua", "Nyeri", "Kirinyaga", "Murang'a", "Kiambu", "Turkana", "West Pokot",
    "Samburu", "Trans-Nzoia", "Uasin Gishu", "Elgeyo-Marakwet", "Nandi", "Baringo", "Laikipia",
    "Nakuru", "Narok", "Kajiado", "Kericho", "Bomet", "Kakamega", "Vihiga", "Bungoma", "Busia",
    "Siaya", "Kisumu", "Homa Bay", "Migori", "Kisii", "Nyamira", "Nairobi",
)


def _letters(value: str) -> str:
    return re.sub(r"[^a-z]", "", value.lower())


# "taitataveta" -> "Taita-Taveta", so "Taita Taveta", "MURANGA" and "Kiambu County" all match.
_COUNTY_LOOKUP = {_letters(name): name for name in KENYA_COUNTIES}

_PHONE_PATTERNS = (
    re.compile(r"^\+254([17]\d{8})$"),
    re.compile(r"^254([17]\d{8})$"),
    re.compile(r"^0([17]\d{8})$"),
    re.compile(r"^([17]\d{8})$"),
)
_KRA_PIN = re.compile(r"^[AP]\d{9}[A-Z]$")
_NATIONAL_ID = re.compile(r"^\d{7,8}$")
_REGISTRATION_NUMBER = re.compile(r"^[A-Z0-9][A-Z0-9/.\-]{2,49}$")

# Words that don't distinguish one co-op from another when comparing names.
_GENERIC_NAME_WORDS = {
    "the", "cooperative", "cooperatives", "coop", "society", "societies", "ltd", "limited",
    "fcs", "sacco", "union", "and", "of",
}


def clean_text(value: str) -> str:
    """Trim and collapse internal whitespace."""
    return re.sub(r"\s+", " ", value).strip()


def normalize_email(value: str) -> str:
    return value.strip().lower()


def normalize_phone(value: str) -> str:
    """Kenyan mobile number -> E.164 (+2547XXXXXXXX / +2541XXXXXXXX)."""
    compact = re.sub(r"[\s\-().]", "", value or "")
    for pattern in _PHONE_PATTERNS:
        match = pattern.match(compact)
        if match:
            return "+254" + match.group(1)
    raise ValueError("Enter a Kenyan mobile number, e.g. 0712 345 678 or +254 712 345 678.")


def normalize_kra_pin(value: str) -> str:
    pin = re.sub(r"\s", "", value or "").upper()
    if not _KRA_PIN.match(pin):
        raise ValueError("KRA PIN must be A or P, then 9 digits, then a letter (e.g. P051234567Z).")
    return pin


def normalize_national_id(value: str) -> str:
    id_number = re.sub(r"\s", "", value or "")
    if not _NATIONAL_ID.match(id_number):
        raise ValueError("National ID number must be 7 or 8 digits.")
    return id_number


def normalize_county(value: str) -> str:
    key = _letters(value or "")
    if key.endswith("county") and key != "county":
        key = key[: -len("county")]
    county = _COUNTY_LOOKUP.get(key)
    if not county:
        raise ValueError("Choose one of Kenya's 47 counties.")
    return county


def normalize_registration_number(value: str) -> str:
    reg = re.sub(r"\s", "", value or "").upper()
    if not _REGISTRATION_NUMBER.match(reg):
        raise ValueError(
            "Registration number must be 3-50 characters: letters, digits, '/', '-' or '.' (e.g. CS/12345)."
        )
    return reg


def name_key(name: str) -> str:
    """Case-, accent- and punctuation-insensitive key for comparing organisation names."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    ascii_name = ascii_name.replace("co-operative", "cooperative").replace("co-op", "coop").replace(".", "")
    words = re.findall(r"[a-z0-9]+", ascii_name)
    meaningful = [w for w in words if w not in _GENERIC_NAME_WORDS]
    return " ".join(meaningful or words)


def names_similar(a: str, b: str, threshold: float = 0.88) -> bool:
    key_a, key_b = name_key(a), name_key(b)
    if not key_a or not key_b:
        return False
    return key_a == key_b or SequenceMatcher(None, key_a, key_b).ratio() >= threshold


def pydantic_field(normalizer: Callable[[str], str], error_type: str) -> Callable[[str], str]:
    """Wrap a normaliser so its message reaches the 422 response verbatim (no 'Value error,' prefix)."""

    def validate(value: str) -> str:
        try:
            return normalizer(value)
        except ValueError as exc:
            raise PydanticCustomError(error_type, str(exc)) from None

    return validate
