# Changelog

## [1.3.0](https://github.com/thesammykins/onlydrives_alert_bot/compare/onlydrives-alert-bot-v1.2.0...onlydrives-alert-bot-v1.3.0) (2026-03-22)


### Features

* add persistent product cache to database ([7929c2b](https://github.com/thesammykins/onlydrives_alert_bot/commit/7929c2b824d35b5e830041d2ee34186984aa9ec0))
* add sku utils and bulk alert subscriptions ([152f80c](https://github.com/thesammykins/onlydrives_alert_bot/commit/152f80cb60827118ccc48bab52a458aa16b68149))
* wire product cache into monitor and commands ([0ff8ba5](https://github.com/thesammykins/onlydrives_alert_bot/commit/0ff8ba520cdcfcf7e0b5f591783bef2975fc3348))


### Bug Fixes

* correct bot.ts handler indentation ([f24fcf1](https://github.com/thesammykins/onlydrives_alert_bot/commit/f24fcf1b17a6df96f32678047febb1bb84500286))
* move required delivery option before optional thresholds in alert add ([ccfa64c](https://github.com/thesammykins/onlydrives_alert_bot/commit/ccfa64c58d583be760280ce15e940689b88c47b1))

## [1.2.0](https://github.com/thesammykins/onlydrives_alert_bot/compare/onlydrives-alert-bot-v1.1.0...onlydrives-alert-bot-v1.2.0) (2026-01-19)


### Features

* add autocomplete to /history command with best value SKUs ([188df2d](https://github.com/thesammykins/onlydrives_alert_bot/commit/188df2d07a0165f8a6eb136a31807ea9632a327d))
* add fuzzy SKU matching to /history autocomplete ([322e4b6](https://github.com/thesammykins/onlydrives_alert_bot/commit/322e4b600799cd984dac871f88c7a84d71e67960))
* add personal SKU price alert subscriptions ([1675c8a](https://github.com/thesammykins/onlydrives_alert_bot/commit/1675c8a707f31364798d52a5c09859a44a200b3e))
* add runtime configuration via /config command ([9855f3f](https://github.com/thesammykins/onlydrives_alert_bot/commit/9855f3fda0ae5fbc858dc286b126304a46dc48e2))


### Bug Fixes

* preserve price baseline until alert fires to prevent incremental creep ([fb4de78](https://github.com/thesammykins/onlydrives_alert_bot/commit/fb4de7810bb18674ae88ce6994f9a0014b093c2a))
* remove Source field from alert embeds ([2c6a7ef](https://github.com/thesammykins/onlydrives_alert_bot/commit/2c6a7ef6d0bbb90c7716a1e8c944d12b5d2681f1))
* replace deprecated ephemeral option with MessageFlags.Ephemeral ([c93e1d9](https://github.com/thesammykins/onlydrives_alert_bot/commit/c93e1d942a34b358fcbe2af42c628cee307ce0c6))
