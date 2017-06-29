import {BaseContext, ExecutionContext, FileRef, RunPlugin, Script} from "../types";
import * as _ from "lodash";
import * as child_process from "child_process";
import * as ssh2 from "ssh2";
import {ConnectConfig} from "ssh2";
import * as scp2 from "scp2";
import * as path from "path";
import {calculateExecutionOrder} from "./execution-order";
import * as EventEmitter from "events";
import * as rjson from "relaxed-json";
import * as chalk from "chalk";
import {log} from "./log";
import * as os from "os";
import * as fs from "fs-extra";
import * as NestedError from "nested-error-stacks";
import {md5LocalFile, md5RemoteFile} from "./utils/file";
import {isUndefined} from "util";

const ScpClient = scp2.Client;
const exec = child_process.exec;

export async function execute(ctx: BaseContext): Promise<void> {
    const executionContexts = await getExecutionContexts(ctx);
    const colorFnQueue: any = [
        chalk.green,
        chalk.cyan,
        chalk.yellow.bold,
        chalk.magenta,
        chalk.red,
        chalk.blue.bold
    ];
    for (let ctx of executionContexts) {
        ctx.logColorHostFn = colorFnQueue.shift();
        try {
            if (!ctx.local) {
                ctx.client = await getSshClient(ctx);
                ctx.scpClient = new ScpClient(getSshOptions(ctx));
                ctx.scpClient.on('error', err => {
                    throw new NestedError('scp error', err);
                });
            }
            await syncFiles(ctx);
            await executeScripts(ctx);
            if (ctx.client) {
                ctx.client.end();
                ctx.scpClient.close();
            }
        } finally {
            colorFnQueue.push(ctx.logColorHostFn);
        }
    }
    log(ctx, null, 'DONE');
}

async function getExecutionContexts(ctx: BaseContext): Promise<ExecutionContext[]> {
    const results: { [host: string]: ExecutionContext } = {};
    for (let roleName in ctx.config.roles) {
        if (!shouldRoleRun(ctx, roleName)) {
            continue;
        }
        const roleInfo = ctx.config.roles[roleName];
        for (let host of roleInfo.hosts) {
            if (results[host]) {
                results[host].roles.push(roleName);
            } else {
                results[host] = {
                    ...ctx,
                    local: false,
                    sshOptions: {
                        ...ctx.config.defaults.ssh,
                        host
                    },
                    options: {
                        ...ctx.config.defaults
                    },
                    roles: [roleName],
                    exec: null,
                    copyFile: null,
                    log: null,
                    logColorHostFn: null
                };
            }
        }
    }
    let executionContexts = _.values(results);
    for (let ctx of executionContexts) {
        ctx.local = isLocal(ctx);
        ctx.scripts = await calculateExecutionOrder(ctx, ctx.scripts);
        ctx.exec = executeCommand.bind(null, ctx);
        ctx.log = log.bind(null, ctx);
        ctx.copyFile = copyFile.bind(null, ctx);
    }
    return executionContexts;
}

function syncFiles(ctx: ExecutionContext): Promise<void> {
    if (ctx.local) {
        return syncFilesLocal(ctx);
    } else {
        return syncFilesRemote(ctx);
    }
}

async function syncFilesLocal(ctx: ExecutionContext): Promise<void> {
    for (let script of ctx.scripts) {
        await syncScript(ctx, script);
    }
    for (let include of ctx.includes) {
        await copyFile(
            ctx,
            null,
            {
                fullPath: path.join(ctx.baseDir, include),
                packagePath: include
            }
        );
    }

    async function syncScript(ctx: ExecutionContext, script: Script): Promise<void> {
        await copyFile(ctx, script, script.path);
        for (let file of script.files) {
            await copyFile(ctx, script, file);
        }
    }
}

function syncFilesRemote(ctx: ExecutionContext): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        syncFilesToClient(ctx, ctx.scripts)
            .then(() => {
                resolve();
            })
            .catch((err) => {
                reject(err);
            });

        async function syncFilesToClient(ctx: ExecutionContext, scripts: Script[]): Promise<void> {
            for (let script of scripts) {
                await syncScript(ctx, script);
            }
            for (let include of ctx.includes) {
                await copyFile(
                    ctx,
                    null,
                    {
                        fullPath: path.join(ctx.baseDir, include),
                        packagePath: include
                    }
                );
            }
        }

        async function syncScript(ctx: ExecutionContext, script: Script): Promise<void> {
            await copyFile(ctx, script, script.path);
            for (let file of script.files) {
                await copyFile(ctx, script, file);
            }
        }
    });
}

async function copyFile(ctx: ExecutionContext, script: Script, file: FileRef): Promise<void> {
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

async function executeScripts(ctx: ExecutionContext): Promise<void> {
    for (let script of ctx.scripts) {
        if (await shouldExecuteScript(ctx, script)) {
            await executeScript(ctx, script);
            await executeScriptCompleteFunctions(ctx, script);
        } else {
            log(ctx, script, 'SKIP');
        }
    }
}

async function shouldExecuteScript(ctx: ExecutionContext, script: Script): Promise<boolean> {
    for (let line of script.stampyLines) {
        if (line.type === 'run-if' || line.type === 'skip-if') {
            const runIfPluginName = line.args[0];
            const runIfPlugin = ctx.plugins['run-if'][runIfPluginName];
            if (!runIfPlugin) {
                throw new Error(`Could not find 'run-if' plugin '${runIfPluginName}'`);
            }
            if (runIfPlugin.shouldExecute) {
                let result = await runIfPlugin.shouldExecute(ctx, script, line.args.slice(1));
                if (line.type === 'skip-if') {
                    result = !result;
                }
                if (!result) {
                    return false;
                }
            }
        }
    }
    return true;
}

async function executeScriptCompleteFunctions(ctx: ExecutionContext, script: Script): Promise<void> {
    if (ctx.dryRun) {
        return;
    }
    for (let line of script.stampyLines) {
        const pluginName = line.args[0];
        let type = line.type;
        if (type === 'skip-if') {
            type = 'run-if';
        }
        const plugin = ctx.plugins[type][pluginName];
        if (!plugin) {
            throw new Error(`Could not find '${line.type}' plugin '${pluginName}'`);
        }
        if (plugin.scriptComplete) {
            await plugin.scriptComplete(ctx, script, line.args.slice(1), 0);
        }
    }
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

function getSshClient(ctx: ExecutionContext): Promise<ssh2.Client> {
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

function executeCommand(ctx: ExecutionContext, script: Script, command: string): EventEmitter {
    if (ctx.local) {
        return executeCommandLocal(ctx, script, command);
    } else {
        return executeCommandRemote(ctx, script, command);
    }
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

function reboot(ctx: ExecutionContext, script: Script, expr: any): Promise<void> {
    log(ctx, script, 'STDOUT', `Rebooting and waiting for ${expr.timeout} seconds`);
    return new Promise((resolve, reject) => {
        const rebootProcess = executeCommand(ctx, script, ctx.options.rebootCommand);
        rebootProcess.on('stdout', data => {
            log(ctx, script, 'STDOUT', data);
        });
        rebootProcess.on('stderr', data => {
            log(ctx, script, 'STDERR', data);
            reject(new Error(`could not execute reboot command "${ctx.options.rebootCommand}"`));
        });
        rebootProcess.on('close', code => {
            if (code === 0 || isUndefined(code)) {
                setTimeout(async () => {
                    ctx.client = await getSshClient(ctx);
                    ctx.scpClient = new ScpClient(getSshOptions(ctx));
                    return resolve();
                }, expr.timeout * 1000);
            } else {
                reject(new Error(`could not execute reboot command "${ctx.options.rebootCommand}" (code: ${code})`));
            }
        });
    });
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

function executeScript(ctx: ExecutionContext, script: Script): Promise<void> {
    log(ctx, script, 'RUN');
    if (ctx.dryRun) {
        return Promise.resolve();
    }

    return executeRunLines(ctx, script)
        .then(async (additionalFiles: FileRef[]) => {
            for (let f of additionalFiles) {
                await copyFile(ctx, script, f);
            }
        })
        .then(() => {
            let rebooting = false;
            return new Promise<void>((resolve, reject) => {
                const ee = executeCommand(ctx, script, `./${path.basename(script.path.packagePath)}`);
                ee.on('stdout', data => {
                    const lines = (data + '')
                        .replace(/\r/g, '')
                        .replace(/\n$/, '')
                        .split('\n');
                    for (let line of lines) {
                        let m;
                        if (m = line.match(/^STAMPY:(.*)/)) {
                            const exprStr = m[1].trim();
                            const expr = JSON.parse(rjson.transform(exprStr));
                            switch (expr.action) {
                                case 'SKIP':
                                    log(ctx, script, 'SKIP');
                                    return resolve();
                                case 'REBOOT':
                                    rebooting = true;
                                    reboot(ctx, script, expr)
                                        .then(() => {
                                            resolve();
                                        })
                                        .catch((err) => {
                                            reject(err);
                                        });
                                    return;
                                default:
                                    return reject(new Error(`Invalid action received from script "${expr.action}"`));
                            }
                        }
                        log(ctx, script, 'STDOUT', line);
                    }
                });
                ee.on('stderr', data => {
                    log(ctx, script, 'STDERR', data);
                });
                ee.on('close', (code) => {
                    if (rebooting) {
                        return;
                    }
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`process "${script.path.packagePath}" exited with code ${code}`));
                    }
                });
            });
        });
}

async function executeRunLines(ctx: ExecutionContext, script: Script): Promise<FileRef[]> {
    let results = [];
    for (let line of script.stampyLines) {
        if (line.type === 'run') {
            const runPluginName = line.args[0];
            const runPlugin: RunPlugin = ctx.plugins['run'][runPluginName];
            if (!runPlugin) {
                throw new Error(`Could not find 'run' plugin '${runPluginName}'`);
            }
            const runResults = await runPlugin.run(ctx, script, line.args.slice(1));
            results = results.concat(runResults.files || []);
        }
    }
    return results;
}

function isLocal(ctx: ExecutionContext) {
    return ctx.sshOptions.host === 'localhost' || ctx.sshOptions.host === '127.0.0.1';
}

function shouldRoleRun(ctx: BaseContext, roleName: string) {
    return !ctx.rolesToRun || ctx.rolesToRun.indexOf(roleName) >= 0;
}
