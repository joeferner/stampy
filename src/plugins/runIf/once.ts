import {ExecutionContext, Script} from "../../../types";
import {ExprRunIfPlugin} from "./expr";
import * as path from "path";

export class OnceRunIfPlugin extends ExprRunIfPlugin {
    async shouldExecute(ctx: ExecutionContext, script: Script, args: string[]): Promise<boolean> {
        const remoteTestFile = OnceRunIfPlugin.getRemoteTestFile(ctx, script);
        return super.shouldExecute(ctx, script, [`! -f "${remoteTestFile}"`]);
    }

    async scriptComplete?(ctx: ExecutionContext, script: Script, args: string[], code: number): Promise<void> {
        if (code !== 0) {
            return Promise.resolve();
        }
        const remoteTestFile = OnceRunIfPlugin.getRemoteTestFile(ctx, script);
        return new Promise<void>((resolve, reject) => {
            ctx.exec(script, `touch "${remoteTestFile}"`)
                .on('stdout', data => {
                    ctx.logWithScript(script, 'STDOUT', data);
                })
                .on('stderr', data => {
                    ctx.logWithScript(script, 'STDERR', data);
                    reject(new Error('received message from stderr'));
                })
                .on('close', code => {
                    if (code === 0) {
                        return resolve();
                    }
                    return reject(new Error(`Could not touch "${remoteTestFile}"`));
                })
                .on('error', err => {
                    return reject(err);
                });
        });
    }

    private static getRemoteTestFile(ctx: ExecutionContext, script: Script): string {
        const remoteFile = path.join(ctx.options.workingPath, script.path.packagePath);
        return path.basename(remoteFile) + '.once';
    }
}