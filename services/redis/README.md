User-visible departures from real Redis

- Tons of missing features, obviously; even implemented commands may have missing flags
- The server API is not text-based, it's more similar to the API of the Redis JS client
- `XADD` doesn't have special handling for `1526919030474-*`, only for `*`
- `XSTREAM` doesn't support `(1526919030474-*` (i.e. open / exclusive `end` values)
