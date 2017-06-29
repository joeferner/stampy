import {ExecutionContext, RunIfPlugin, Script} from "../../../types";

export class HasRolesRunIfPlugin implements RunIfPlugin {
    async shouldExecute(ctx: ExecutionContext, script: Script, args: string[]): Promise<boolean> {
        for (let role of args) {
            if (ctx.roles.indexOf(role) < 0) {
                return false;
            }
        }
        return true;
    }
}