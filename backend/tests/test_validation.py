import pytest

from core.validation import (
    KENYA_COUNTIES, names_similar, normalize_county, normalize_kra_pin, normalize_national_id, normalize_phone,
)


def test_there_are_47_counties():
    assert len(KENYA_COUNTIES) == len(set(KENYA_COUNTIES)) == 47


@pytest.mark.parametrize("raw", ["0712345678", "712345678", "254712345678", "+254712345678", "+254 712 345 678", "(0712) 345-678"])
def test_safaricom_style_numbers(raw):
    assert normalize_phone(raw) == "+254712345678"


@pytest.mark.parametrize("raw", ["0110123456", "110123456", "+254110123456"])
def test_01_numbers(raw):
    assert normalize_phone(raw) == "+254110123456"


@pytest.mark.parametrize("raw", ["", "0212345678", "07123456789", "+255712345678", "phone", "0712 34567"])
def test_bad_phones(raw):
    with pytest.raises(ValueError):
        normalize_phone(raw)


def test_kra_pin():
    assert normalize_kra_pin(" a123456789b ") == "A123456789B"
    for bad in ("B123456789C", "A12345678C", "A1234567890", "A123456789"):
        with pytest.raises(ValueError):
            normalize_kra_pin(bad)


def test_national_id():
    assert normalize_national_id("1234567") == "1234567"
    assert normalize_national_id("12 345 678") == "12345678"
    for bad in ("123456", "123456789", "12a45678"):
        with pytest.raises(ValueError):
            normalize_national_id(bad)


@pytest.mark.parametrize("raw,canonical", [
    ("kiambu", "Kiambu"), ("KIAMBU COUNTY", "Kiambu"), ("Muranga", "Murang'a"),
    ("taita taveta", "Taita-Taveta"), ("Homa-Bay", "Homa Bay"), ("uasin gishu", "Uasin Gishu"),
])
def test_county(raw, canonical):
    assert normalize_county(raw) == canonical


def test_unknown_county():
    for bad in ("Kampala", "", "County"):
        with pytest.raises(ValueError):
            normalize_county(bad)


def test_name_similarity():
    assert names_similar("Limuru Dairy Co-op", "LIMURU DAIRY COOPERATIVE SOCIETY LTD")
    assert names_similar("Githunguri Dairy F.C.S.", "Githunguri Dairy")
    assert not names_similar("Limuru Dairy", "Nyeri Hills Dairy")
