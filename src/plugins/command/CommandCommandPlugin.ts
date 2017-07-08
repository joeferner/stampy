import {BaseContext, CommandPlugin, ExecutionContext} from "../../../types";
import * as executor from "../../executor";

export class CommandCommandPlugin implements CommandPlugin {
    run(ctx: BaseContext, args: string[]): Promise<void> {
        return executor.execute(ctx);
    }

    async execute(ctx: ExecutionContext, args: string[]): Promise<void> {
        const code = await ctx.run(null, args.join(' '));
        ctx.logWithScript(null, 'STDOUT', `command exited with code: ${code}`);
        return Promise.resolve();
    }
}
