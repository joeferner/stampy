import * as fs from "fs";
import * as chalk from "chalk";
import {ExecutionContext, LogAction, Script} from "../types";

export function log(ctx: ExecutionContext, script: Script, action: LogAction, data?) {
    data = data ? data.toString().replace(/\n$/, '') : null;
    if (data) {
        const lines = data.split('\n');
        if (lines.length > 1) {
            for (let line of lines) {
                log(ctx, script, action, line);
            }
            return;
        }
    }

    const host = (ctx.sshOptions ? ctx.sshOptions.host : 'local');

    if (ctx.outputFormat === 'json') {
        writeOutput(ctx, JSON.stringify({
            host: host,
            action: action,
            script: script ? script.path : null,
            data: data
        }));
        return;
    }

    let actionString = '';
    switch (action) {
        case 'CONNECT':
            actionString = chalk.yellow('CONN');
            break;
        case 'RUN':
            actionString = chalk.green('RUN ');
            break;
        case 'SKIP':
            actionString = chalk.yellow('SKIP');
            break;
        case 'COPY':
            actionString = chalk.gray('COPY');
            break;
        case 'STDOUT':
            actionString = chalk.gray('OUT ');
            break;
        case 'STDERR':
            actionString = chalk.bold.red('ERR ');
            break;
        default:
            actionString = chalk.red('UNKN');
            break;
    }
    let message = `${ctx.logColorHostFn ? ctx.logColorHostFn(host) : host}: [${actionString}] ${script ? script.path : ''}`;
    if (data) {
        message += ': ';
        message += action === 'STDERR' ? chalk.bold.red(data) : data;
    }
    switch (action) {
        case 'STDERR':
            writeOutput(ctx, message);
            break;
        default:
            writeOutput(ctx, message);
            break;
    }
}

function writeOutput(ctx: ExecutionContext, message: string) {
    if (ctx.outputFileFD) {
        fs.writeSync(ctx.outputFileFD, message + "\n");
    } else {
        console.log(message);
    }
}
