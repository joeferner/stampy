import * as fs from "fs";
import * as chalk from "chalk";
import {BaseContext, ExecutionContext, LogAction, Script} from "../types";

export function log(ctx: BaseContext, script: Script | string, action: LogAction, data?) {
    data = data ? data.toString().replace(/\n$/, '') : null;
    if (data) {
        const lines = data.replace(/\r/g, '').split('\n');
        if (lines.length > 1) {
            for (let line of lines) {
                log(ctx, script, action, line);
            }
            return;
        }
    }

    const host = (<ExecutionContext>ctx).sshOptions ? (<ExecutionContext>ctx).sshOptions.host : 'local';
    const scriptString = typeof script === 'string'
        ? script
        : script
            ? script.path.packagePath
            : '';

    if (ctx.outputFormat === 'json') {
        writeOutput(ctx, JSON.stringify({
            host: host,
            action: action,
            script: scriptString,
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
        case 'DONE':
            actionString = chalk.bold.white('DONE');
            break;
        default:
            actionString = chalk.red('UNKN');
            break;
    }
    const hostString = (<ExecutionContext>ctx).logColorHostFn ? (<ExecutionContext>ctx).logColorHostFn(host) : host;
    let message = `${hostString}: [${actionString}] ${scriptString}`;
    if (data) {
        message += scriptString ? ': ' : '';
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

function writeOutput(ctx: BaseContext, message: string) {
    if (ctx.outputFileFD) {
        fs.writeSync(ctx.outputFileFD, message + "\n");
    } else {
        console.log(message);
    }
}
