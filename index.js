const fs = require('fs');
const axios = require('axios');
const { sleep } = require('sleep');

const { adminToken, serverUrl } = JSON.parse(fs.readFileSync(`${__dirname}/config.json`));

const live = process.argv[2] === '--live' ? true : false;

const file = fs.readFileSync(`${__dirname}/rooms.txt`, 'utf-8');
const rooms = file.split('\n');

const now = new Date();
const logFile = `${__dirname}/rooms-log-${now.toISOString()}.json`;

const headers = { Authorization: `Bearer ${adminToken}` };
const matrixAdmin = axios.create({
    baseURL: `https://${serverUrl}/_synapse/admin`,
    headers,
});

const deletedRooms = {};

rooms.forEach(async (room) => {
    if (room.length === 0) {
        return;
    }

    deletedRooms[room] = [];

    let result, data;
    try {
        if (live) {
            result = await matrixAdmin({
                method: 'delete',
                url: `/v2/rooms/${room}`,
                data: {
                    block: true,
                    purge: true,
                },
            });
        } else {
            result = await matrixAdmin.get(`/v1/rooms/${room}`);
        }
    } catch (err) {
        console.log(`Error deleting room ${room} - ${err}`);
        deletedRooms[room].push({
            time: new Date(),
            success: false,
            message: 'Error deleting room',
            error: err,
        });
        fs.writeFileSync(logFile, JSON.stringify(deletedRooms));
    }

    data = result?.data ? result.data : null;
    const delete_id = data ? data.delete_id : null;

    if (delete_id && live) {
        do {
            console.log(`Waiting for ${room} to complete purge`);
            sleep(5);
            try {
                result = await matrixAdmin.get(`/v2/rooms/delete_status/${delete_id}`);
            } catch (err) {
                console.log(`Error getting delete status for room ${room} - ${err}`);
                deletedRooms[room].push({
                    time: new Date(),
                    success: false,
                    message: 'Error getting delete status',
                    error: err,
                });
                fs.writeFileSync(logFile, JSON.stringify(deletedRooms));
            }

            data = result?.data;
        } while (data?.status !== 'complete');
    }

    deletedRooms[room].push({
        time: new Date(),
        success: true,
        message: 'Successfully deleted room',
        result: data,
    });
    fs.writeFileSync(logFile, JSON.stringify(deletedRooms));
});
