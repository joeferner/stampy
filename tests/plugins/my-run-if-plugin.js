"use strict";

class MyRunIfPlugin {
    shouldExecute(ctx, script, args) {
        ctx.log(script, 'STDOUT', `my-run-if ${args.join(' ')}`);
        return Promise.resolve(true);
    }
}

module.exports = MyRunIfPlugin;
