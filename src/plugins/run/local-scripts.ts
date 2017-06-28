import {ExecutionContext, FileRef, RunPlugin, RunResults, Script} from "../../../types";
import * as child_process from "child_process";
import {log} from "../../log";
import * as path from "path";
import {globFiles} from "../../utils/glob";

const exec = child_process.exec;

export class LocalScriptsRunPlugin implements RunPlugin {
    async run?(ctx: ExecutionContext, script: Script, args: string[]): Promise<RunResults> {
        const files = await globFiles(ctx, args);
        for (let file of files) {
            await this.runLocalScript(ctx, file);
        }
        return {};
    }

    runLocalScript(ctx: ExecutionContext, file: FileRef): Promise<void> {
        ctx.pluginData['local-scripts'] = ctx.pluginData['local-scripts'] || {};
        if (ctx.pluginData['local-scripts'][file.packagePath]) {
            return;
        }

        log(ctx, file.packagePath, 'RUN');
        return new Promise((resolve, reject) => {
            const options = {
                cwd: path.dirname(file.fullPath)
            };
            const cp = exec(file.fullPath, options);
            cp.stdout.on('data', data => {
                log(ctx, file.packagePath, 'STDOUT', data);
            });
            cp.stderr.on('data', data => {
                log(ctx, file.packagePath, 'STDERR', data);
            });
            cp.on('close', (code) => {
                if (code === 0) {
                    ctx.pluginData['local-scripts'][file.packagePath] = true;
                    return resolve();
                }
                return reject(new Error(`Received bad return code from "${file} (code: ${code})"`));
            });
        });
    }
}
