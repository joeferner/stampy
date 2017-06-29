import * as path from "path";
import {exec} from "child_process";
import {ExecutionContext, Script} from "../../types";

export function relative(from: string, to: string): string {
    let result = path.relative(from, to);
    if (!result.startsWith('.') && !result.startsWith('/')) {
        result = './' + result;
    }
    return result;
}

function parseMd5sumOutput(data: any): string {
    const line = (data + '').trim();
    return line.split(' ')[0].trim();
}

export function md5LocalFile(fileName: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const md5sumProcess = exec(`md5sum "${fileName}"`);
        md5sumProcess.stdout.on('data', data => {
            return resolve(parseMd5sumOutput(data));
        });
        md5sumProcess.stderr.on('data', data => {
            reject(new Error(`Could not get md5 of local file "${fileName}": ${data}`));
        });
        md5sumProcess.on('close', code => {
            if (code !== 0) {
                reject(new Error(`Could not get md5 of local file "${fileName}" (code: ${code})`));
            }
        });
    });
}

export function md5RemoteFile(ctx: ExecutionContext, script: Script, fileName: string): Promise<string> {
    return new Promise((resolve, reject) => {
        ctx.client.exec(`if [ -e "${fileName}" ]; then md5sum "${fileName}"; else echo "na"; fi`, (err, process) => {
            if (err) {
                return reject(err);
            }
            process.on('data', data => {
                return resolve(parseMd5sumOutput(data));
            });
            process.stderr.on('data', data => {
                reject(new Error(`Could not get md5 of remote file "${fileName}": ${data}`));
            });
            process.on('close', code => {
                if (code !== 0) {
                    reject(new Error(`Could not get md5 of remote file "${fileName}" (code: ${code}}`));
                }
            });
        });
    });
}
