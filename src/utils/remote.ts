import {ExecutionContext, ExecutionContextState, FileRef, Script, SshClient, SshConfig} from "../../types";
import {ChildProcess, exec} from "child_process";
import * as path from "path";
import {log} from "../log";
import {md5LocalFile, md5RemoteFile} from "./file";
import * as NestedError from "nested-error-stacks";
import * as fs from "fs-extra";
import {EventEmitter} from "events";
import * as os from "os";
import * as async from "async";

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
            log(ctx, script, 'SKIP', `MD5s match: ${file.fullPath} -> ${ctx.host}:${destFile}`);
            return;
        }
        log(ctx, script, 'COPY', `${file.fullPath} -> ${ctx.host}:${destFile}`);
        return uploadFile(ctx, script, file.fullPath, destFile);
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
    ctx.sshClient.exec(getFullCommand(ctx, script, command))
        .then(stream => {
            stream.on('close', code => {
                result.emit('close', code);
            });
            stream.on('stdout', data => {
                result.emit('stdout', data);
            });
            stream.on('stderr', data => {
                result.emit('stderr', data);
            });
            stream.on('error', err => {
                result.emit('error', err);
            });
        })
        .catch(err => {
            return result.emit('error', err);
        });
    return result;
}

function getFullCommand(ctx: ExecutionContext, script: Script, command: string) {
    let result = 'bash -l << STAMPY_BASH_EOF\n';
    result += 'set -eu\n';
    if (script) {
        const scriptPath = path.dirname(path.join(ctx.options.workingPath, script.path.packagePath));
        result += `cd "${scriptPath}"\n`;
    }
    if (filesSynced(ctx)) {
        for (let include of ctx.includes) {
            result += `source ${path.join(ctx.options.workingPath, include)}\n`;
        }
    }
    for (let name in ctx.options.env) {
        const value = ctx.options.env[name];
        result += `export ${name}=${value}\n`;
    }
    result += `export STAMPY_GROUPS="${ctx.groups.join(' ')}"\n`;
    result += `export STAMPY_ROLES="${ctx.roles.join(' ')}"\n`;
    result += `function stampy_skip { echo 'STAMPY: {"action": "SKIP"}'; }\n`;
    result += `export -f stampy_skip\n`;
    result += `function stampy_reboot { echo 'STAMPY: {"action": "REBOOT", "timeout": '\\\${1:-60}'}'; }\n`;
    result += `export -f stampy_reboot\n`;
    result += 'function is_in_role { local role=\\$1; for v in \\${STAMPY_ROLES}; do if [[ "\\${v}" == "\\${role}" ]]; then return 0; fi; done; return 1; }\n';
    result += `export -f is_in_role\n`;
    result += `${command}\n`;
    result += 'STAMPY_BASH_EOF';
    if (ctx.options.sudo) {
        result = `sudo -s -- << STAMPY_SUDO_EOF\n${result}\nSTAMPY_SUDO_EOF`;
    }
    return result;
}

function filesSynced(ctx: ExecutionContext): boolean {
    switch (ctx.state) {
        case ExecutionContextState.INITIALIZING:
        case ExecutionContextState.CONNECTED:
        case ExecutionContextState.DISCONNECTED:
            return false;
        case ExecutionContextState.FILES_SYNCED:
            return true;
        default:
            throw new Error(`unhandled context state: ${ctx.state}`);
    }
}

function uploadFile(ctx: ExecutionContext, script: Script, localFile: string, remoteFile: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const destDir = path.dirname(remoteFile);
        let scpCommand = getScpCommand(ctx.host, ctx.sshOptions, localFile, remoteFile);

        // -m and -p don't work well together so we have to start from root and work our way up
        let cmd = '';
        for (let d of getDirectoryLineage(destDir)) {
            cmd += `${ctx.options.sudo ? 'sudo ' : ''}mkdir -p -m 777 "${d}"\n`;
        }

        ctx.sshClient.run(script, cmd)
            .then(code => {
                if (code !== 0) {
                    return reject(new Error(`Could not create directories on remote machine: ${destDir} (code: ${code})`));
                }

                const process = exec(scpCommand);
                process.stdout.on('data', data => {
                    ctx.logWithScript(script, 'STDOUT', data);
                });
                process.stderr.on('data', data => {
                    ctx.logWithScript(script, 'STDERR', data);
                });
                process.on('close', code => {
                    if (code === 0) {
                        return resolve();
                    }
                    return reject(new Error(`Could not scp file using "${scpCommand}" (code: ${code})`));
                })
            })
            .catch(err => {
                return reject(new NestedError(`Could not scp file using "${scpCommand}"`, err));
            });
    });
}

function getDirectoryLineage(dir: string): string[] {
    const parentDir = path.dirname(dir);
    if (parentDir === '/') {
        return [];
    }
    return [...getDirectoryLineage(parentDir), dir];
}

function getScpCommand(host: string, sshConfig: SshConfig, localFile: string, remoteFile: string): string {
    if (!host) {
        throw new Error('host not set');
    }
    if (sshConfig.scpCommand) {
        return sshConfig.scpCommand.replace(/\$\{(.*?)\}/g, (substr, variable) => {
            switch (variable) {
                case 'SRC':
                    return localFile;
                case 'DEST':
                    return remoteFile;
                default:
                    return substr;
            }
        });
    } else {
        let dest = '';
        if (sshConfig.username) {
            dest += `${sshConfig.username}@`;
        }
        dest += `${host}:${remoteFile}`;
        const privateKeyOpt = sshConfig.privateKey
            ? `-i "${sshConfig.privateKey.replace(/~/g, os.homedir())}" `
            : '';
        const sshpass = 'password' in sshConfig
            ? `sshpass -p "${sshConfig.password}" `
            : '';
        return `${sshpass}scp ${privateKeyOpt}-q "${localFile}" "${dest}"`;
    }
}

interface SshTask {
    processEventEmitter: EventEmitter;
    controlFlowEventEmitter: EventEmitter;
    cmd: string;
    code?: number;
}

class RemoteSshClient implements SshClient {
    private ctx: ExecutionContext;
    private sshProcess: ChildProcess;
    private q: AsyncQueue<SshTask>;
    private currentTask: SshTask;

    constructor(ctx: ExecutionContext, sshProcess: ChildProcess) {
        this.ctx = ctx;
        this.sshProcess = sshProcess;

        this.sshProcess.stdout.on('data', data => {
            if (this.currentTask) {
                const dataStr = '' + data;
                const newDataStr = dataStr.replace(/STAMPY_SSH_TASK_COMPLETE: ([0-9]+)\n/, (substr, codeStr) => {
                    this.currentTask.code = parseInt(codeStr);
                    return '';
                });

                if (dataStr != newDataStr) {
                    this.currentTask.processEventEmitter.emit('stdout', newDataStr);
                    this.currentTask.controlFlowEventEmitter.emit('close');
                } else {
                    this.currentTask.processEventEmitter.emit('stdout', data);
                }
            } else {
                ctx.logWithScript(null, 'STDOUT', data);
            }
        });

        this.sshProcess.stderr.on('data', data => {
            if (this.currentTask) {
                data = (data + '').replace(/Connection to (.*?) closed by remote host.\r?\n?/, '');
                data = (data + '').replace(/stdin: is not a tty\r?\n?/g, '');
                if (data.length === 0) {
                    return;
                }
                this.currentTask.processEventEmitter.emit('stderr', data);
            }
        });

        this.sshProcess.on('close', code => {
            if (this.currentTask) {
                this.currentTask.code = code;
            }
            ctx.logWithScript(null, 'CLOSE', `ssh connection closed (code: ${code})`);
            if (this.currentTask) {
                this.currentTask.controlFlowEventEmitter.emit('close');
            }
        });

        this.q = async.queue((task: SshTask, callback) => {
            this.currentTask = task;
            const chunk = `${task.cmd}\necho "STAMPY_SSH_TASK_COMPLETE: $?"\n`;
            try {
                sshProcess.stdin.write(chunk);
            } catch (err) {
                if (callback) {
                    callback(new NestedError('could not write task', err));
                }
                callback = null;
            }
            task.controlFlowEventEmitter.on('close', () => {
                if (callback) {
                    callback();
                }
                callback = null;
            });
        });
    }

    end(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.sshProcess.stdin.write('exit\n');
            this.sshProcess.kill();
            setTimeout(() => {
                resolve();
            }, 100);
        });
    }

    exec(cmd: string): Promise<NodeJS.EventEmitter> {
        const processEventEmitter = new EventEmitter();
        const task: SshTask = {
            processEventEmitter,
            cmd,
            controlFlowEventEmitter: new EventEmitter()
        };
        this.q.push(task, err => {
            if (err) {
                processEventEmitter.emit('error', err);
            }
            processEventEmitter.emit('close', task.code);
        });
        return Promise.resolve(processEventEmitter);
    }

    run(script: Script, cmd: string): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            this.exec(cmd)
                .then(ee => {
                    ee.on('stdout', data => {
                        this.ctx.logWithScript(script, 'STDOUT', data);
                    });
                    ee.on('stderr', data => {
                        this.ctx.logWithScript(script, 'STDERR', data);
                    });
                    ee.on('error', err => {
                        return reject(err);
                    });
                    ee.on('close', code => {
                        return resolve(code);
                    });
                })
                .catch(err => {
                    return reject(err);
                });
        });
    }
}

export function getSshClient(ctx: ExecutionContext): Promise<SshClient> {
    return new Promise<SshClient>((resolve, reject) => {
        const sshCommand = getSshCommand(ctx.host, ctx.sshOptions);
        log(ctx, null, 'CONNECT', sshCommand);
        const sshProcess = exec(sshCommand);
        resolve(new RemoteSshClient(ctx, sshProcess));
    });
}

function getSshCommand(host: string, sshConfig: SshConfig): string {
    if (!host) {
        throw new Error('host not set');
    }
    if (sshConfig.sshCommand) {
        return sshConfig.sshCommand;
    } else {
        let connection = '';
        if (sshConfig.username) {
            connection += `${sshConfig.username}@`;
        }
        connection += `${host}`;
        const timeoutOpt = 'readyTimeout' in sshConfig
            ? `-o ConnectTimeout=${sshConfig.readyTimeout / 1000} `
            : '';
        const privateKeyOpt = sshConfig.privateKey
            ? `-i "${sshConfig.privateKey.replace(/~/g, os.homedir())}" `
            : '';
        const sshpass = 'password' in sshConfig
            ? `sshpass -p "${sshConfig.password}" `
            : '';
        return `${sshpass}ssh ${timeoutOpt}${privateKeyOpt}-q ${connection}`;
    }
}
