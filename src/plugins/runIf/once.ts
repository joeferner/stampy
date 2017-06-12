import {ExecutionContext, Script} from "../../../types";
import {ExprRunIfPlugin} from "./expr";
import * as path from "path";

export class OnceRunIfPlugin extends ExprRunIfPlugin {
    async shouldExecute(ctx: ExecutionContext, script: Script, args: string[]): Promise<boolean> {
        const remoteTestFile = this.getRemoteTestFile(script);
        return super.shouldExecute(ctx, script, [`! -f "${remoteTestFile}"`]);
    }

    async scriptComplete?(ctx: ExecutionContext, script: Script, code: number): Promise<void> {
        const remoteTestFile = this.getRemoteTestFile(script);
        return new Promise((resolve, reject) => {
            ctx.exec(script, `touch "${remoteTestFile}"`)
                .on('close', code => {
                    if (code === 0) {
                        resolve(true);
                    }
                    reject(new Error(`Could not touch "${remoteTestFile}"`));
                })
                .on('error', err => {
                    reject(err);
                });
        });
    }

    private getRemoteTestFile(script: Script): string {
        return path.basename(script.remoteFile) + '.once';
    }
}