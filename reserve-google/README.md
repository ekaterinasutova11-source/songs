# Private Google reserve

This is an immutable emergency snapshot, not a synchronized second writable
disk. It uses the already uploaded ZIP_STORED archive and a private byte-offset
catalogue. Neither the archive nor the catalogue may be shared publicly.

`Code.gs` runs in the owner's Google Apps Script account with explicit
`drive.readonly` and `script.external_request` scopes. The default Google Cloud
project enables Drive v3 through the advanced-service manifest declaration;
no billing account or standalone Cloud registration is part of this setup.

The public web-app endpoint uses POST-body access keys and preserves the
original pupil IDs. Only the teacher sees pupil keys. Pupils see only their own
library. OAuth tokens, ZIP offsets, raw access settings, and other pupils' files
are never returned to pupils. Reads are confined to the configured private
reserve folder and the named ZIP. The ZIP size and MD5 must match the index
before any access; each reconstructed file must also match its original SHA-256.

Missing texts are omitted from the snapshot's song files. Missing pupil
metadata is explicitly marked unavailable and is never written as an empty
replacement onto Yandex. All mutation actions fail on this service.

## Activation gate

1. Upload the private index next to the existing ZIP.
2. Save the script and manifest. Owner authorizes read-only Google access.
3. Run `checkReserve`; it must report `archiveVerified: true`.
4. Deploy an owner-executed web app, accessible to callers without Google login.
   Access to the music is still controlled by existing site keys.
5. Check real cross-origin POST requests, a real text, and real audio chunks in
   the browser, including a simulated primary outage and pupil isolation.
6. Only then set `GOOGLE_RESERVE_URL` in the public site configuration.

The frontend may retry safe reads on Google after transient primary failures.
It must not bypass primary 401/403 responses, nor retry mutations on Google.
Reserve mode shows its snapshot date and blocks changes until a fresh primary
library successfully loads. Audio is checked in full before producing a blob
URL; large recordings can therefore take longer to start from the reserve.

## Remaining reliability work

This does not promise uninterrupted service when both providers, the user's
network, or Google's quotas fail. The reserve must be refreshed after library
edits, new pupils, link resets, and deletion. Automatic snapshot refresh,
immediate revocation propagation, writable conflict handling, and incremental
Drive file mirroring are separate work; they are not enabled by this snapshot.
Old authorized pupil links can still work against an old snapshot during a
primary outage. Do not describe this deployment as automatic synchronization.

Private index generation lives in the local `work/build-reserve-index.py`
utility, outside the public repository. Never commit its generated JSON.
