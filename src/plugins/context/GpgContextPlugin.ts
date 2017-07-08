import {ContextPlugin, ExecutionContext} from "../../../types";
import * as gpg from "../../utils/gpg";

export class GpgContextPlugin implements ContextPlugin {
    async applyToExecutionContext(ctx: ExecutionContext): Promise<void> {
        if (!(<any>ctx.options).gpg) {
            return;
        }
        const obj = await gpg.getDecryptedObject(ctx);
        (<any>ctx).gpg = (key: string) => {
            return obj[key];
        };
        return;
    }
}
