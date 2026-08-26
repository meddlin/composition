import pytest

from composition.search import parse_search_query


def test_plain_text_has_no_filters_or_attribute_override():
    parsed = parse_search_query("hello world")

    assert parsed.text == "hello world"
    assert parsed.filters == []
    assert parsed.attributes_to_search_on is None


def test_tag_filter_extracted_as_equality_clause():
    parsed = parse_search_query("tag: software")

    assert parsed.text == ""
    assert parsed.filters == ['tags = "software"']


def test_multiple_tag_tokens_and_combined():
    parsed = parse_search_query("tag: software tag: rust")

    assert parsed.filters == ['tags = "software"', 'tags = "rust"']


def test_title_filter_restricts_attributes_to_search_on():
    parsed = parse_search_query("title: Next.js")

    assert parsed.attributes_to_search_on == ["title"]
    assert parsed.text == "Next.js"


def test_created_on_default_operator_is_equals():
    parsed = parse_search_query("createdOn: 2026-05-30")

    assert parsed.filters == [
        "created_at_ts >= 1780099200",
        "created_at_ts < 1780185600",
    ]


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("createdOn: >2026-05-30", ["created_at_ts >= 1780185600"]),
        ("createdOn: >=2026-05-30", ["created_at_ts >= 1780099200"]),
        ("createdOn: <2026-05-30", ["created_at_ts < 1780099200"]),
        ("createdOn: <=2026-05-30", ["created_at_ts < 1780185600"]),
        (
            "createdOn: =2026-05-30",
            ["created_at_ts >= 1780099200", "created_at_ts < 1780185600"],
        ),
    ],
)
def test_created_on_operators(query, expected):
    parsed = parse_search_query(query)

    assert parsed.filters == expected


def test_quoted_value_with_spaces_extracted():
    parsed = parse_search_query('tag: "deep work"')

    assert parsed.filters == ['tags = "deep work"']


def test_combines_free_text_with_filters():
    parsed = parse_search_query("roadmap tag: software")

    assert parsed.text == "roadmap"
    assert parsed.filters == ['tags = "software"']


def test_malformed_date_falls_back_to_literal_text():
    parsed = parse_search_query("createdOn: not-a-date")

    assert parsed.filters == []
    assert "createdOn: not-a-date" in parsed.text


def test_escapes_quotes_and_backslashes_in_filter_values():
    parsed = parse_search_query('tag: weird\\"value')

    assert parsed.filters == ['tags = "weird\\\\\\"value"']


def test_empty_value_after_colon_is_not_treated_as_token():
    parsed = parse_search_query("tag: roadmap")
    assert parsed.filters == ['tags = "roadmap"']

    parsed_empty = parse_search_query("tag:")
    assert parsed_empty.filters == []
    assert parsed_empty.text == "tag:"
