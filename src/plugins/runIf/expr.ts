import {ExecutionContext, RunIfPlugin, Script} from "../../../types";

export class ExprRunIfPlugin implements RunIfPlugin {
    shouldExecute(ctx: ExecutionContext, script: Script, args: string[]): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            const arg = args.join(' ');
            const command = `test ${arg}`;
            ctx.exec(script, command)
                .on('close', code => {
                    if (code === 0) {
                        resolve(true);
                    }
                    if (code === 1) {
                        resolve(false);
                    }
                    reject(new Error(`Could not execute expression "${arg}"`));
                })
                .on('error', err => {
                    reject(err);
                });
            return true;
        });
    }
}