
class MyContextPlugin {
    applyToBaseContext(ctx) {
        ctx.myContextPluginFn = function(i) {
            return i + 20;
        };
        return Promise.resolve();
    }
}

module.exports = MyContextPlugin;
