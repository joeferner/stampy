import {ExpandRequiresResults, RequirePluginContext} from "../../../types";
import {FileGlobRequirePlugin} from "./file-glob";
import * as child_process from "child_process";
import {log} from "../../log";
import * as path from "path";

const exec = child_process.exec;

export class LocalScriptsRequirePlugin extends FileGlobRequirePlugin {
    async expandRequires(ctx: RequirePluginContext, args: string[]): Promise<ExpandRequiresResults> {
        const files = await super.globFiles(ctx, args);
        for (let file of files) {
            await this.runLocalScript(ctx, file);
        }
        return {};
    }

    runLocalScript(ctx: RequirePluginContext, file: string): Promise<void> {
        ctx.pluginData['local-scripts'] = ctx.pluginData['local-scripts'] || {};
        if (ctx.pluginData['local-scripts'][file]) {
            return;
        }

        const script = path.relative(ctx.baseDir, file);
        log(ctx, script, 'RUN');
        return new Promise((resolve, reject) => {
            const options = {
                cwd: path.dirname(file)
            };
            const cp = exec(file, options);
            cp.stdout.on('data', data => {
                log(ctx, script, 'STDOUT', data);
            });
            cp.stderr.on('data', data => {
                log(ctx, script, 'STDERR', data);
            });
            cp.on('close', (code) => {
                if (code === 0) {
                    ctx.pluginData['local-scripts'][file] = true;
                    return resolve();
                }
                return reject(new Error(`Received bad return code from "${file} (code: ${code})"`));
            });
        });
    }
}
