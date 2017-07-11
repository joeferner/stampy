import {ExprRunIfPlugin} from "./ExprRunIfPlugin";
import {ExecutionContext, Script} from "../../../types";

export class ExistsRunIfPlugin extends ExprRunIfPlugin {
    shouldExecute(ctx: ExecutionContext, script: Script, args: string[]): Promise<boolean> {
        if (args.length !== 1) {
            return Promise.reject(new Error(`"exists" takes 1 argument, found ${args.length}`));
        }
        return super.shouldExecute(ctx, script, [`-e "${args[0]}"`]);
    }
}