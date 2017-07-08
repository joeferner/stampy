import {BaseContext, CommandPlugin} from "../../../types";
import {commandLineParse} from "../../utils/command-line";
import * as commandLineUsage from "command-line-usage";
import * as commandLineCommands from "command-line-commands";
import * as fs from "fs-extra";
import * as gpg from "../../utils/gpg";

export class GpgCommandPlugin implements CommandPlugin {
    public readonly description = "Utilities for working with the project's GPG protected file";

    run(ctx: BaseContext, args: string[]): Promise<void> {
        console.log(args);
        const {command, argv} = GpgCommandPlugin.getCommand(args);
        switch (command) {
            case 'create':
                return this.create(ctx, argv);
            case 'set':
                return this.set(ctx, argv);
            case 'keys':
                return this.keys(ctx, argv);
            case 'remove':
                return this.remove(ctx, argv);
            default:
                if (args[0] === '--help' || args[0] === '-h') {
                    GpgCommandPlugin.printUsage();
                    process.exit(-1);
                    return Promise.resolve();
                } else {
                    const message = `Invalid gpg command "${args[0] || ''}"`;
                    console.error(message);
                    process.exit(-1);
                    return Promise.reject(new Error(message));
                }
        }
    }

    private async create(ctx: BaseContext, argv: string[]): Promise<void> {
        const help = [
            {header: 'Summary', content: 'Create a new GPG protected file'},
            {options: true}
        ];
        const options = commandLineParse([], {argv, help});
        const exists = await fs.pathExists(gpg.getFileName(ctx));
        if (exists) {
            console.error(`${gpg.getFileName(ctx)} already exists`);
            process.exit(-1);
            return;
        }
        await gpg.writeEncryptedObject(ctx, {});
        console.log(`${gpg.getFileName(ctx)} created`);
    }

    private async set(ctx: BaseContext, argv: string[]): Promise<void> {
        const options = commandLineParse([
            {name: 'value', alias: 'v', type: String, multiple: true}
        ], {argv});
        if (!options.value || options.value.length === 0) {
            console.error('one or more values are required');
            process.exit(-1);
            return;
        }

        const obj = await gpg.getDecryptedObject(ctx);
        for (const value of options.value) {
            const m = value.match(/(.*?)=(.*)/);
            if (!m) {
                console.error('value must be in the format <key>=<value>');
                process.exit(-1);
                return;
            }
            obj[m[1]] = m[2];
        }
        await gpg.writeEncryptedObject(ctx, obj);
        console.log('key/values added');
    }

    private async remove(ctx: BaseContext, args: string[]): Promise<void> {
        const options = commandLineParse([
            {name: 'key', alias: 'k', type: String}
        ], {argv: args});
        if (!options.key) {
            console.error('key is required');
            process.exit(-1);
            return;
        }

        const obj = await gpg.getDecryptedObject(ctx);
        if (!(options.key in obj)) {
            console.error(`key "${options.key}" not found`);
            process.exit(-1);
            return;
        }
        delete obj[options.key];
        await gpg.writeEncryptedObject(ctx, obj);
        console.log('key removed');
    }

    private async keys(ctx: BaseContext, args: string[]): Promise<void> {
        const options = commandLineParse([], {argv: args});

        const obj = await gpg.getDecryptedObject(ctx);
        for (let key of Object.keys(obj)) {
            console.log(key);
        }
    }

    private static getCommand(args: string[]) {
        try {
            const {command, argv} = commandLineCommands(['create', 'set', 'remove', 'keys'], args);
            return {command, argv};
        } catch (err) {
            return {command: null, argv: null};
        }
    }

    private static printUsage() {
        const usage = commandLineUsage([
            {
                header: 'Options',
                optionList: [
                    {name: 'help', alias: 'h', type: Boolean, description: 'Help'}
                ]
            },
            {
                header: 'Commands',
                content: [
                    {
                        name: 'create',
                        summary: 'create a new GPG file'
                    },
                    {
                        name: 'set',
                        summary: 'set key/value pairs'
                    },
                    {
                        name: 'remove',
                        summary: 'remove a key/value pair'
                    },
                    {
                        name: 'keys',
                        summary: 'list the keys'
                    }
                ]
            }
        ]);
        console.error(usage);
    }
}
