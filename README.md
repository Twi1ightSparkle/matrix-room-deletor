# matrix-room-deletor

Delete multiple Matrix rooms using the [Synapse Admin API](https://matrix-org.github.io/synapse/latest/admin_api/rooms.html#version-2-new-version)

`adminToken` is only used for `index.js`, `userToken` is only used for `createRooms.js`

By default, the script runs in test mode and calls the [Room Details API](https://matrix-org.github.io/synapse/latest/admin_api/rooms.html#room-details-api)
instead of the Delete API. Useful to verify your room list. Call `index.js` with option `--live` to make changes.
