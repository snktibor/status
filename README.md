# status

Pings my projects every five minutes for [snktibor.hu/status](https://snktibor.hu/status).

The addresses come from [snktibor.hu/api/status/targets](https://snktibor.hu/api/status/targets), the results go to
`status.json` on the [`data`](https://github.com/snktibor/status/tree/data) branch.

```sh
node check.mjs status.json
node --test
```
