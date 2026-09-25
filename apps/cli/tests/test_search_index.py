from composition.search import SearchIndex


class _FakeMeiliIndex:
    def __init__(self, hits):
        self._hits = hits

    def search(self, text, opts):
        return {"hits": self._hits}


class _FakeMeiliClient:
    def __init__(self, hits):
        self._index = _FakeMeiliIndex(hits)

    def index(self, uid):
        return self._index


def test_search_deduplicates_repeated_hit_ids(monkeypatch):
    hits = [{"id": 1}, {"id": 2}, {"id": 1}]  # id 1 repeated, as from a misbehaving backend
    monkeypatch.setattr(
        "composition.search.meilisearch.Client",
        lambda url, api_key: _FakeMeiliClient(hits),
    )

    index = SearchIndex(url="http://example", api_key="key")
    result_ids = index.search("anything")

    assert result_ids == [1, 2]
