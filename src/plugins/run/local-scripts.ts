import {ExecutionContext, FileRef, RunPlugin, RunResults, Script} from "../../../types";
import * as child_process from "child_process";
import {log} from "../../log";
import * as path from "path";
import * as rjson from "relaxed-json";
import {relative} from "../../utils/file";
import * as NestedError from "nested-error-stacks";

const exec = child_process.exec;

export class LocalScriptsRunPlugin implements RunPlugin {
    async run(ctx: ExecutionContext, script: Script, args: string[]): Promise<RunResults> {
        const fullPath = path.join(path.dirname(script.path.fullPath), args[0]);
        const fileRef = {
            fullPath,
            packagePath: relative(ctx.baseDir, fullPath)
        };
        await this.runLocalScript(ctx, script, fileRef, args.slice(1));
        return {};
    }

    runLocalScript(ctx: ExecutionContext, script: Script, file: FileRef, args: string[]): Promise<void> {
        ctx.pluginData['local-scripts'] = ctx.pluginData['local-scripts'] || {};
        if (ctx.pluginData['local-scripts'][file.packagePath]) {
            return;
        }

        log(ctx, file.packagePath, 'RUN');
        return new Promise((resolve, reject) => {
            const options = {
                cwd: path.dirname(file.fullPath)
            };
            let cmd = 'bash -l << STAMPY_BASH_EOF\n';
            cmd += `function stampy_cp { echo 'STAMPY: {"action": "CP", "src": "'\\$1'", "dest": "'\\$2'"}'; }\n`;
            cmd += `export -f stampy_cp\n`;
            cmd += `export STAMPY_BASE_DIR=${ctx.baseDir}\n`;
            for (let name in ctx.options.env) {
                const value = ctx.options.env[name];
                cmd += `export ${name}=${value}\n`;
            }
            cmd += `${file.fullPath} ${args.join(' ')}\n`;
            cmd += `STAMPY_BASH_EOF`;
            const pendingPromises = [];
            const cp = exec(cmd, options);
            cp.stdout.on('data', data => {
                const lines = (data + '').split('\n');
                for (let line of lines) {
                    let m;
                    if (m = line.match(/^STAMPY:(.*)/)) {
                        const exprStr = m[1].trim();
                        const expr = JSON.parse(rjson.transform(exprStr));
                        switch (expr.action) {
                            case 'CP':
                                const fileToCopyFullPath = path.resolve(path.dirname(script.path.fullPath), expr.src);
                                const fileToCopy = {
                                    fullPath: fileToCopyFullPath,
                                    packagePath: expr.dest && expr.dest.length > 0 ? expr.dest : relative(ctx.baseDir, fileToCopyFullPath)
                                };
                                pendingPromises.push(ctx.copyFile(script, fileToCopy));
                                continue;
                            default:
                                return reject(new Error(`Invalid action received from script`));
                        }
                    }
                    log(ctx, file.packagePath, 'STDOUT', line);
                }
            });
            cp.stderr.on('data', data => {
                log(ctx, file.packagePath, 'STDERR', data);
            });
            cp.on('close', (code) => {
                Promise.all(pendingPromises)
                    .then(() => {
                        if (code === 0) {
                            ctx.pluginData['local-scripts'][file.packagePath] = true;
                            return resolve();
                        }
                        return reject(new Error(`Received bad return code from "${file.packagePath}" (code: ${code})`));
                    })
                    .catch(err => {
                        return reject(new NestedError(`Pending promise failed`, err));
                    });
            });
        });
    }
}
