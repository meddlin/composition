from composition import frontmatter

CREATED = "2026-08-26T12:00:00+00:00"
UPDATED = "2026-08-26T12:00:00+00:00"


def test_generate_produces_block_with_expected_key_order():
    block = frontmatter.generate(
        "My Note", created_at=CREATED, updated_at=UPDATED, description="desc", tags=["a"]
    )

    assert block.index("title") < block.index("description")
    assert block.index("description") < block.index("tags")
    assert block.index("tags") < block.index("createdAt")
    assert block.index("createdAt") < block.index("updatedAt")


def test_parse_round_trips_generate_output():
    block = frontmatter.generate(
        "My Note", created_at=CREATED, updated_at=UPDATED, description="desc", tags=["a", "b"]
    )

    parsed, body = frontmatter.parse(block)

    assert parsed is not None
    assert parsed.title == "My Note"
    assert parsed.description == "desc"
    assert parsed.tags == ["a", "b"]
    assert parsed.created_at == CREATED
    assert parsed.updated_at == UPDATED
    assert body == ""


def test_render_reassembles_edited_content_stably():
    block = frontmatter.generate("My Note", created_at=CREATED, updated_at=UPDATED)
    body = "# Heading\n\nSome text.\n"
    content = block + body

    parsed, parsed_body = frontmatter.parse(content)
    assert parsed_body == body

    parsed.description = "new description"
    rendered = frontmatter.render(parsed, parsed_body)

    reparsed, reparsed_body = frontmatter.parse(rendered)
    assert reparsed.description == "new description"
    assert reparsed_body == body


def test_parse_returns_none_for_content_with_no_frontmatter():
    parsed, body = frontmatter.parse("# Just a note\n\nNo frontmatter here.")

    assert parsed is None
    assert body == "# Just a note\n\nNo frontmatter here."


def test_parse_returns_none_for_malformed_yaml():
    content = "---\ntitle: [unbalanced\n---\nbody"

    parsed, body = frontmatter.parse(content)

    assert parsed is None
    assert body == content


def test_parse_returns_none_when_block_is_not_a_mapping():
    content = "---\n- one\n- two\n---\nbody"

    parsed, body = frontmatter.parse(content)

    assert parsed is None
    assert body == content


def test_parse_coerces_unquoted_datetime_scalar_to_iso_string():
    content = "---\ntitle: Note\ncreatedAt: 2026-08-26T12:00:00+00:00\n---\n"

    parsed, _ = frontmatter.parse(content)

    assert parsed is not None
    assert isinstance(parsed.created_at, str)
    assert parsed.created_at == "2026-08-26T12:00:00+00:00"


def test_parse_accepts_tags_as_scalar_string_fallback():
    content = "---\ntitle: Note\ntags: work, ideas\n---\n"

    parsed, _ = frontmatter.parse(content)

    assert parsed is not None
    assert parsed.tags == ["work", "ideas"]


def test_strip_removes_block_leaving_body():
    block = frontmatter.generate("My Note", created_at=CREATED, updated_at=UPDATED)
    content = block + "body text"

    assert frontmatter.strip(content) == "body text"


def test_strip_returns_content_unchanged_when_no_frontmatter():
    assert frontmatter.strip("just text") == "just text"


def test_tags_to_string_and_tags_from_string_roundtrip():
    assert frontmatter.tags_to_string(["a", " b ", "", "c"]) == "a,b,c"
    assert frontmatter.tags_from_string("a, b ,,c") == ["a", "b", "c"]
    assert frontmatter.tags_from_string("") == []
