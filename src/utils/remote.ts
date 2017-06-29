import {ExecutionContext, FileRef, Script} from "../../types";
import {exec} from "child_process";
import * as path from "path";
import {log} from "../log";
import {md5LocalFile, md5RemoteFile} from "./file";
import * as fs from "fs-extra";
import * as os from "os";
import * as ssh2 from "ssh2";
import {ConnectConfig} from "ssh2";
import * as scp2 from "scp2";
import {EventEmitter} from "events";

export async function copyFile(ctx: ExecutionContext, script: Script, file: FileRef): Promise<void> {
    const destFile = path.join(ctx.options.workingPath, file.packagePath);
    if (!destFile.startsWith(ctx.options.workingPath)) {
        throw new Error(`package path outside of working directory "${file.packagePath}"`);
    }
    const srcFileMd5 = ctx.options.compareMd5sOnCopy ? await md5LocalFile(file.fullPath) : null;
    if (ctx.local) {
        const destFileMd5 = ctx.options.compareMd5sOnCopy ? await md5LocalFile(destFile) : null;
        if (ctx.options.compareMd5sOnCopy && srcFileMd5 === destFileMd5) {
            log(ctx, script, 'SKIP', `MD5s match: ${file.fullPath} -> ${destFile}`);
            return;
        }
        log(ctx, script, 'COPY', `${file.fullPath} -> ${destFile}`);
        return fs.copy(file.fullPath, destFile);
    } else {
        const destFileMd5 = ctx.options.compareMd5sOnCopy ? await md5RemoteFile(ctx, script, destFile) : null;
        if (ctx.options.compareMd5sOnCopy && srcFileMd5 === destFileMd5) {
            log(ctx, script, 'SKIP', `MD5s match: ${file.fullPath} -> ${ctx.sshOptions.host}:${destFile}`);
            return;
        }
        log(ctx, script, 'COPY', `${file.fullPath} -> ${ctx.sshOptions.host}:${destFile}`);
        return new Promise<void>((resolve, reject) => {
            return ctx.scpClient.upload(file.fullPath, destFile, err => {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        });
    }
}

export function executeCommand(ctx: ExecutionContext, script: Script, command: string): EventEmitter {
    if (ctx.local) {
        return executeCommandLocal(ctx, script, command);
    } else {
        return executeCommandRemote(ctx, script, command);
    }
}

function executeCommandLocal(ctx: ExecutionContext, script: Script, command: string): EventEmitter {
    const options = {};
    const result = new EventEmitter();
    const cp = exec(getFullCommand(ctx, script, command), options);
    cp.stdout.on('data', data => {
        result.emit('stdout', data);
    });
    cp.stderr.on('data', data => {
        result.emit('stderr', data);
    });
    cp.on('close', (code) => {
        result.emit('close', code);
    });
    return result;
}

function executeCommandRemote(ctx: ExecutionContext, script: Script, command: string): EventEmitter {
    const result = new EventEmitter();
    ctx.client.exec(getFullCommand(ctx, script, command), (err, stream) => {
        if (err) {
            return result.emit('error', err);
        }
        stream.on('close', (code, signal) => {
            result.emit('close', code, signal);
        });
        stream.on('data', data => {
            result.emit('stdout', data);
        });
        stream.stderr.on('data', data => {
            data = (data + '').replace('stdin: is not a tty\n', '');
            if (data.length === 0) {
                return;
            }
            result.emit('stderr', data);
        });
    });
    return result;
}

function getFullCommand(ctx: ExecutionContext, script: Script, command: string) {
    const scriptPath = path.dirname(path.join(ctx.options.workingPath, script.path.packagePath));
    let result = 'bash -l << STAMPY_BASH_EOF\n';
    result += 'set -eu\n';
    result += `cd "${scriptPath}"\n`;
    for (let include of ctx.includes) {
        result += `source ${include}\n`;
    }
    result += `export STAMPY_GROUPS="${ctx.groups.join(' ')}"\n`;
    result += `export STAMPY_ROLES="${ctx.roles.join(' ')}"\n`;
    result += `function stampy_skip { echo 'STAMPY: {"action": "SKIP"}'; }\n`;
    result += `export -f stampy_skip\n`;
    result += `function stampy_reboot { echo 'STAMPY: {"action": "REBOOT", "timeout": '\\\${1:-60}'}'; }\n`;
    result += `export -f stampy_reboot\n`;
    result += `${command}\n`;
    result += 'STAMPY_BASH_EOF';
    if (ctx.options.sudo) {
        result = `sudo -s -- << STAMPY_SUDO_EOF\n${result}\nSTAMPY_SUDO_EOF`;
    }
    return result;
}

function getSshOptions(ctx: ExecutionContext): ConnectConfig {
    const options = {
        ...ctx.sshOptions
    };
    if (options.privateKey) {
        let privateKeyFileName = <string>options.privateKey;
        privateKeyFileName = privateKeyFileName.replace('~', os.homedir());
        options.privateKey = fs.readFileSync(privateKeyFileName);
    }
    return options;
}

export function getScpClient(ctx: ExecutionContext): Promise<scp2.Client> {
    return Promise.resolve(new scp2.Client(getSshOptions(ctx)));
}

export function getSshClient(ctx: ExecutionContext): Promise<ssh2.Client> {
    return new Promise<ssh2.Client>((resolve, reject) => {
        const client = new ssh2.Client();
        client.on('ready', () => {
            resolve(client);
        });
        client.on('error', err => {
            reject(err);
        });
        log(ctx, null, 'CONNECT', `username: ${ctx.sshOptions.username || '<no username specified>'}`);
        client.connect(getSshOptions(ctx));
    });
}
