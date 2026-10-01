# Feature matrix

Where the three products (see [product-builds.md](product-builds.md)) behave differently.
Only differences and known gaps are listed; anything not here works the same everywhere.

| Feature | CLI | Web | Desktop |
|---|---|---|---|
| Paste an image into a note | No | Yes | Yes |
| Image size limit | n/a | **10 MB** | **None** |

## Notes

- **Image size limit.** The web app refuses pasted images over 10 MB, because they travel
  to the server as request bodies. The desktop app has no limit: the image is written to the
  user's own disk and never leaves the machine. Details in
  [architecture/images.md](architecture/images.md).
