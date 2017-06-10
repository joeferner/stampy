import * as commander from "commander";

const args = commander
    .version('0.1.0')
    .parse(process.argv);

console.log('args', args);