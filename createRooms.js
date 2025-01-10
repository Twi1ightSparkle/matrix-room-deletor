/*
    Create a few rooms for testing and development purposes
*/
const fs = require('fs');
const axios = require('axios');

const roomCount = 5;

/**
 * Sleep for n seconds. This blocks execution of all JavaScript by halting
 * Node.js' event loop
 * @param {Number} seconds Number of seconds to sleep
 */
const sleep = (seconds) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
};

const main = async () => {
    const { serverUrl, userToken } = JSON.parse(fs.readFileSync(`${__dirname}/config.json`));

    let now = new Date();
    now = now.toISOString();

    const headers = { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' };
    const dataTemplate = (n) => {
        return {
            name: `${now}-${String(n)}`,
            visibility: 'private',
        };
    };

    const matrix = axios.create({ baseURL: `${serverUrl}/_matrix/client`, headers });

    for (let n = 1; n <= roomCount; n++) {
        if (n > 1) {
            sleep(5);
        }
        const data = dataTemplate(n);
        let result;
        try {
            result = await matrix.post('/r0/createRoom', data);
        } catch (err) {
            console.debug(err);
            process.exit(1);
        }
        fs.appendFileSync(`${__dirname}/rooms.txt`, `${result.data.room_id}\n`);
        console.log(`Created room ${n} out of ${roomCount}. Name: ${data.name}. ID: ${result.data.room_id}`);
    }
};

main().catch((err) => console.log(err));
