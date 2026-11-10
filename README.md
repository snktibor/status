# status

A Cloudflare Worker that pings my projects every five minutes for [snktibor.hu/status](https://snktibor.hu/status).

It takes the addresses from [snktibor.hu/api/status/targets](https://snktibor.hu/api/status/targets), keeps 90 days
of results in KV and serves them at `/status.json`.

```sh
node --test
npx wrangler deploy
```
