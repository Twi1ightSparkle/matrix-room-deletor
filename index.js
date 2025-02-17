const fs = require('fs');
const axios = require('axios');
const humanizeDuration = require('humanize-duration');

const {
    adminToken,
    doNotDeleteRoom,
    mmrQuarantineRoomMedia,
    mmrSharedSecret,
    saveRoomMembers,
    saveRoomState,
    serverUrl,
    sleepSecondsAfterEachRoom,
} = JSON.parse(fs.readFileSync(`${__dirname}/config.json`));

const serverName = serverUrl.replace(/https?:\/\//, '');

// Command line options
const live = process.argv[2] === '--live';

// Read rooms
const file = fs.readFileSync(`${__dirname}/rooms.txt`, 'utf-8');
const rooms = file.split('\n');
if (rooms[rooms.length - 1] === '') {
    rooms.pop();
}

// Log file
const now = new Date();
const logFile = `${__dirname}/rooms-log-${serverName}-${now.toISOString()}.json`;
const deletedRooms = {};

// Axois setup
const synapseAdmin = axios.create({ baseURL: serverUrl });

/**
 * Sleep for n seconds. This blocks execution of all JavaScript by halting
 * Node.js' event loop
 * @param {Number} seconds Number of seconds to sleep
 */
const sleep = (seconds) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
};

/**
 * Capitalize the first letter in the provided string
 * @param {String} string   The string to work with
 * @returns {String}        The string with the first letter capitalized
 */
const capitalizeFirstLetter = (string) => {
    return string.charAt(0).toUpperCase() + string.slice(1);
};

/**
 * Make a call to the Synapse (media repo) admin API
 * @param {Array}  verb         The verb for action taken [past, present] For example: ['got', 'getting']
 * @param {String} task         The task being done. For example: 'room summary'
 * @param {String} method       The HTTP method to use
 * @param {String} endpoint     The endpoint to call
 * @param {Object} payload      Optional payload. Defaults to empty
 * @returns {Object}            Result including timestamp, status, message, and data containing either the result data
 *                              or error information
 */
const adminApi = async (verb, task, method, endpoint, payload = {}) => {
    let result, data;
    const dataDefault = {
        time: new Date(),
        endpoint: `${method.toUpperCase()} ${endpoint} ${JSON.stringify(payload)}`,
    };

    const firstWord = capitalizeFirstLetter(verb[1]);
    console.log(`${firstWord} ${task}. ${dataDefault.endpoint}`);

    try {
        // matrix-media-repo
        if (endpoint.startsWith('/_matrix/media/')) {
            result = await synapseAdmin(endpoint, {
                data: payload,
                headers: { Authorization: `Bearer ${adminToken}` },
                method,
                params: { access_token: mmrSharedSecret },
            });
        }

        // Synapse Admin API
        else {
            result = await synapseAdmin(endpoint, {
                data: payload,
                headers: { Authorization: `Bearer ${adminToken}` },
                method,
            });
        }

        data = {
            ...dataDefault,
            success: true,
            message: `Successfully ${verb[0]} ${task}`,
            data: result?.data || null,
        };
    } catch (err) {
        data = {
            ...dataDefault,
            success: false,
            message: `Error ${verb[1]} ${task}`,
            data: err,
        };
        console.log(`Error ${verb[1]} ${task} - ${err}. See the log for more details.`);
    }

    return data;
};

/**
 * Write the log file. Overwrites any previous contents.
 * @param {Object} content Full contents of the log file
 */
const writeLog = (content) => {
    fs.writeFileSync(logFile, JSON.stringify(content), 'utf-8');
};

/**
 * Create a string for how long is remaining
 * @param {Number} total    Total rooms
 * @param {Number} counter  Progress
 * @returns
 */
const timeRemaining = (total, counter) => {
    const roomsRemaining = total - counter;
    const secondsRemaining = (5 + sleepSecondsAfterEachRoom) * roomsRemaining;
    return `Time remaining: At least ${humanizeDuration(secondsRemaining * 1000)}`;
};

/**
 * Process all rooms
 * @param {Array} rooms Array of rooms to process
 */
const processRooms = async (rooms) => {
    const roomCount = rooms.length;
    let counter = 0;

    console.log(`${roomCount} rooms loaded. ${timeRemaining(roomCount, 0)}\n\n`);

    for (const roomId of rooms) {
        counter += 1;
        const progressMessage = `Working with room ${roomId}. Room ${counter} of ${roomCount}`;
        console.log(progressMessage);

        if (roomId === '') {
            return;
        }

        deletedRooms[roomId] = {};

        // Get room summary
        const roomSummary = await adminApi(
            ['got', 'getting'],
            'room summary',
            'get',
            `/_synapse/admin/v1/rooms/${roomId}`,
        );

        deletedRooms[roomId].roomSummary = roomSummary;
        writeLog(deletedRooms);

        // Save room members
        if (saveRoomMembers) {
            const members = await adminApi(
                ['fetched', 'fetching'],
                'room members',
                'get',
                `/_synapse/admin/v1/rooms/${roomId}/members`,
            );

            deletedRooms[roomId].roomMembers = members;
            writeLog(deletedRooms);
        }

        // Save room state
        if (saveRoomState) {
            const state = await adminApi(
                ['fetched', 'fetching'],
                'room state',
                'get',
                `/_synapse/admin/v1/rooms/${roomId}/state`,
            );

            deletedRooms[roomId].roomState = state;
            writeLog(deletedRooms);
        }

        // Quarantine room media
        if (live && mmrQuarantineRoomMedia) {
            const roomDeleteResult = await adminApi(
                ['quarantined', 'quarantining'],
                'room media',
                'post',
                `/_matrix/media/unstable/admin/quarantine/room/${roomId}`,
            );

            deletedRooms[roomId].mediaQuarantineResult = roomDeleteResult;
            writeLog(deletedRooms);
        }

        // Delete the room
        let deleteId;
        if (live && !doNotDeleteRoom) {
            const roomDeleteResult = await adminApi(
                ['deleted', 'deleting'],
                'the room',
                'delete',
                `/_synapse/admin/v2/rooms/${roomId}`,
                { block: true, purge: true },
            );
            deleteId = roomDeleteResult?.data?.delete_id || null;

            deletedRooms[roomId].roomDeleteResult = roomDeleteResult;
            writeLog(deletedRooms);
        }

        // If we're live and got a delete ID,
        // then wait for the room to finish deleting
        if (deleteId && live) {
            let deletionStatus = { data: { status: 'not started' } };
            let delaySeconds = 0;
            let deleteWaitTime = 0;
            do {
                // Gradually wait longer and longer in between checking the
                // delete status. If it's not done relatively quick, it
                // might take a long time. No point in checking every 5 seconds
                // for 15 minutes
                delaySeconds += 5;
                deleteWaitTime += delaySeconds;
                console.log(
                    `Waiting ${humanizeDuration(delaySeconds * 1000)} for ${roomId} to complete purge. ` +
                        `Total wait time: ${humanizeDuration(deleteWaitTime * 1000)}`,
                );
                sleep(delaySeconds);

                deletionStatus = await adminApi(
                    ['got', 'getting'],
                    'delete status for room',
                    `get`,
                    `/_synapse/admin/v2/rooms/delete_status/${deleteId}`,
                );

                if (!deletionStatus.success) {
                    console.log(
                        `Error getting delete status for room ${roomId}. ` +
                            `Script is not waiting for this to finish. ${deletionStatus.data}`,
                    );
                    break;
                }
            } while (deletionStatus.data?.status !== 'complete');

            deletedRooms[roomId].roomDeleteStatus = deletionStatus;
            writeLog(deletedRooms);
        }

        // Print a status update and wait for Synapse to catch up...
        const percent = ((counter / roomCount) * 100).toFixed();

        let delay = true;
        const durationString = humanizeDuration(sleepSecondsAfterEachRoom * 1000);
        let sleepMsg = `Sleeping ${durationString} to allow Synapse to catch up and not die. `;
        if (counter === roomCount) {
            sleepMsg = '';
            delay = false;
        }

        console.log(
            `Finished with room ${roomId}. ${sleepMsg}${percent}% done.\n${timeRemaining(roomCount, counter)}. ` +
                `This does not account for time spent waiting for rooms to complete shutdown\n\n`,
        );

        if (delay) {
            sleep(sleepSecondsAfterEachRoom);
        }
    }
};

processRooms(rooms);
