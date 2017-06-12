"use strict";

class MyRequirePlugin {
    expandRequires(ctx, args) {
        ctx.log('STDOUT', `my-require ${args.join(' ')}`);
        return Promise.resolve([]);
    }
}

module.exports = MyRequirePlugin;
