import {ExecutionContext, RunIfPlugin, Script} from "../../../types";

export class CmdRunIfPlugin implements RunIfPlugin {
    shouldExecute(ctx: ExecutionContext, script: Script, args: string[]): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            let command = args.join(' ');
            ctx.exec(script, command)
                .on('stdout', data => {
                    ctx.logWithScript(script, 'STDOUT', data);
                })
                .on('stderr', data => {
                    ctx.logWithScript(script, 'STDERR', data);
                    reject(new Error('received message from stderr'));
                })
                .on('close', code => {
                    resolve(code === 0);
                })
                .on('error', err => {
                    reject(err);
                });
        });
    }
}