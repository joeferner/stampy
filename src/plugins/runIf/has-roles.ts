import {ExecutionContext, RunIfPlugin, Script} from "../../../types";

export class HasRolesRunIfPlugin implements RunIfPlugin {
    async shouldExecute(ctx: ExecutionContext, script: Script, args: string[]): Promise<boolean> {
        const expressions = args.join(' ').split('||');
        return expressions.some(expr => HasRolesRunIfPlugin.evalAndExpression(ctx, expr));
    }

    private static evalAndExpression(ctx: ExecutionContext, expr: string): boolean {
        const roles = expr.trim().replace(/\s+/g, ' ').split(' ');
        for (let role of roles) {
            if (ctx.roles.indexOf(role) < 0) {
                return false;
            }
        }
        return true;
    }
}
