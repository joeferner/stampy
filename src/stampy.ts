import {run} from "./stampy-run";

run(process.argv)
    .then(() => {
        process.exit(0);
    })
    .catch(err => {
        console.error('failed', err);
        process.exit(1);
    });