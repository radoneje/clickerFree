from clickerfree_worker import i18n


def test_ru_and_en_have_identical_keys():
    assert set(i18n.MESSAGES["ru"]) == set(i18n.MESSAGES["en"])


def test_formatting_params():
    assert "42" in i18n.t("ru", "pairing_code", code="42", url="http://x")
    assert "42" in i18n.t("en", "pairing_code", code="42", url="http://x")


def test_detect_lang_priority(monkeypatch):
    monkeypatch.setattr(i18n.locale, "getlocale", lambda: ("en_US", "UTF-8"))
    assert i18n.detect_lang("ru", "en") == "ru"
    assert i18n.detect_lang(None, "ru") == "ru"
    assert i18n.detect_lang(None, None) == "en"
    monkeypatch.setattr(i18n.locale, "getlocale", lambda: ("fr_FR", "UTF-8"))
    assert i18n.detect_lang(None, None) == "ru"
    monkeypatch.setattr(i18n.locale, "getlocale", lambda: (None, None))
    assert i18n.detect_lang(None, None) == "ru"
