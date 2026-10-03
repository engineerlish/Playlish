# Spotify Web API fixtures

Responses in the shapes the Web API uses as of October 2026, used by the integration tests with the fake Spotify
server (`tests/helpers/fake-spotify.ts`). All names and ids are made up; no real account data.

Shapes follow developer.spotify.com, including:
- February 2026 changelog: no `email`, `country`, `product` or `followers` on the user; no `popularity`,
  `available_markets`, `external_ids` or `linked_from` on tracks; playlist sizes in `items.total` (the deprecated
  `tracks` field is still sent); playlist entries hold the track or episode under `item`; search returns at most 10
  per type; library calls are `/me/library` with up to 40 URIs.
- July 2026 changelog: quota errors are `429` with `{"status": 429, "message": "Too many requests", "reason": "QUOTA_EXCEEDED"}`.
- Queue and playback state can contain podcast episodes; playlist search results can contain `null` entries.

When Spotify announces API changes, update these files and `src/main/spotify/types.ts` together, and note the
changelog entry here.
