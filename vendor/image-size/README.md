# BuildTrack image-size security patch

This is a minimal, API-compatible fork of `image-size@1.2.1`, which Metro
requires through `^1.0.2`. It keeps the upstream MIT license and compiled
runtime files only.

The fork rejects invalid zero-length or truncated ICNS/container boxes so a
malformed local asset cannot trap the Node.js event loop. It addresses
GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq while no patched upstream npm
release is available. Remove this fork once Metro depends on an upstream
`image-size` release containing equivalent guards.
