import {ExecutionContext, RunPlugin, RunResults, Script} from "../../../types";
import {commandLineParse} from "../../utils/command-line";
import * as commandLineCommands from "command-line-commands";

export class YumRunPlugin implements RunPlugin {
    run(ctx: ExecutionContext, script: Script, args: string[]): Promise<RunResults> {
        const {command, argv} = YumRunPlugin.getCommand(args);
        switch (command) {
            case 'update':
                return this.update(ctx, script, argv);
            case 'ensure':
                return this.ensure(ctx, script, argv);
            default:
                const message = `Invalid yum command "${args[0] || ''}"`;
                console.error(message);
                process.exit(-1);
                return Promise.reject(new Error(message));
        }
    }

    private async update(ctx: ExecutionContext, script: Script, argv: any): Promise<RunResults> {
        const options = commandLineParse([], {argv});
        const code = await ctx.run(script, 'yum update -y');
        if (code !== 0) {
            throw new Error(`yum update failed with code ${code}`);
        }
        return {};
    }

    private async ensure(ctx: ExecutionContext, script: Script, argv: any) {
        const options = commandLineParse([
            {name: 'packages', defaultOption: true, multiple: true, defaultValue: []}
        ], {argv});

        for (let p of options.packages) {
            const code = await ctx.run(script, `yum -q -C list installed ${p} > /dev/null`);
            if (code !== 0) {
                await ctx.run(script, `yum install -y ${p}`);
            }
        }

        return {};
    }

    private static getCommand(args: string[]) {
        try {
            return commandLineCommands(['update', 'ensure'], args);
        } catch (err) {
            return {command: null, argv: null};
        }
    }
}
