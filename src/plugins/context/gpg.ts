import {BaseContext, Command, CommandPlugin, ContextPlugin, ExecutionContext} from "../../../types";
import * as openpgp from "openpgp";
import * as fs from "fs-extra";
import * as NestedError from "nested-error-stacks";
import * as passwordPrompt from "password-prompt";
import * as path from "path";
import * as commandLineCommands from "command-line-commands";
import * as commandLineArgs from "command-line-args";

const DEFAULT_FILE_NAME = 'stampy.gpg';

interface GpgOptions {
    fileName?: string;
    password?: string;
}

class GpgCommandPlugin implements CommandPlugin {
    run(ctx: BaseContext, args: string[]): Promise<void> {
        const {command, argv} = GpgCommandPlugin.getCommand(args);
        switch (command) {
            case 'add':
                return this.add(ctx, argv);
            case 'keys':
                return this.keys(ctx, argv);
            case 'remove':
                return this.remove(ctx, argv);
            default:
                GpgCommandPlugin.printUsage();
                process.exit(-1);
                break;
        }
        return Promise.resolve();
    }

    private async add(ctx: BaseContext, args: string[]): Promise<void> {
        const options = commandLineArgs([
            {name: 'key', alias: 'k', type: String},
            {name: 'value', alias: 'v'}
        ], {argv: args});
        if (!options.key) {
            console.error('key is required');
            process.exit(-1);
            return;
        }
        if (!options.value) {
            console.error('value is required');
            process.exit(-1);
            return;
        }

        const obj = await getDecryptedObject(ctx);
        obj[options.key] = options.value;
        await writeEncryptedObject(ctx, obj);
        console.log('key/value added');
    }

    private async remove(ctx: BaseContext, args: string[]): Promise<void> {
        const options = commandLineArgs([
            {name: 'key', alias: 'k', type: String}
        ], {argv: args});
        if (!options.key) {
            console.error('key is required');
            process.exit(-1);
            return;
        }

        const obj = await getDecryptedObject(ctx);
        delete obj[options.key];
        await writeEncryptedObject(ctx, obj);
        console.log('key removed');
    }

    private async keys(ctx: BaseContext, args: string[]): Promise<void> {
        const options = commandLineArgs([], {argv: args});

        const obj = await getDecryptedObject(ctx);
        for (let key of Object.keys(obj)) {
            console.log(key);
        }
    }

    private static getCommand(args: string[]) {
        try {
            const {command, argv} = commandLineCommands(['add', 'remove', 'keys'], args);
            return {command, argv};
        } catch (err) {
            return {command: null, argv: null};
        }
    }

    private static printUsage() {
        console.log('usage');
    }
}

export class GpgContextPlugin implements ContextPlugin {
    applyToBaseContext?(ctx: BaseContext): Promise<void> {
        const cmd: Command = {
            description: 'GPG utilities',
            scripts: [],
            commandPlugin: new GpgCommandPlugin()
        };
        ctx.config.commands.gpg = cmd;
        return Promise.resolve();
    }

    applyToExecutionContext(ctx: ExecutionContext): Promise<void> {
        (<any>ctx).gpg = getValue.bind(this, ctx);
        return Promise.resolve();
    }
}

async function getValue(ctx: ExecutionContext, key: string): Promise<string> {
    const obj = await getDecryptedObject(ctx);
    return obj[key];
}

async function getDecryptedObject(ctx: BaseContext): Promise<any> {
    const encryptedData = await readEncryptedData(ctx);
    const password = await getPassword(ctx);
    let message;
    try {
        message = openpgp.message.readArmored(encryptedData);
    } catch (err) {
        throw new NestedError(`Could not decrypt file "${getFileName(ctx)}"`, err);
    }
    const options = {
        message: message,
        password: password,
        format: 'utf8'
    };
    return openpgp.decrypt(options)
        .then(function (plaintext) {
            return JSON.parse(new Buffer(plaintext.data).toString('utf8'));
        })
        .catch(err => {
            throw new NestedError(`Could not decrypt file "${getFileName(ctx)}"`, err);
        });
}

async function writeEncryptedObject(ctx: BaseContext, obj: any): Promise<void> {
    const password = await getPassword(ctx);
    const options = {
        data: JSON.stringify(obj),
        passwords: [password]
    };
    return openpgp.encrypt(options)
        .then(function (results) {
            return writeFile(ctx, results.data);
        });
}

function getPassword(ctx: BaseContext): Promise<string> {
    const gpgOptions = getGpgOptions(ctx);
    if ('password' in gpgOptions) {
        return Promise.resolve(gpgOptions.password);
    }
    return passwordPrompt("GPG password: ", {method: 'hide'});
}

function getFileName(ctx: BaseContext) {
    const gpgOptions = getGpgOptions(ctx);
    return path.resolve(ctx.baseDir, gpgOptions.fileName || DEFAULT_FILE_NAME);
}

function readEncryptedData(ctx: BaseContext): Promise<string> {
    const fileName = getFileName(ctx);
    return fs.readFile(fileName, 'utf8')
        .catch(err => {
            throw new NestedError(`Could not read GPG file "${fileName}"`, err);
        });
}

function writeFile(ctx: BaseContext, str: string): Promise<void> {
    const fileName = getFileName(ctx);
    return fs.writeFile(fileName, str)
        .catch(err => {
            throw new NestedError(`Could not write GPG file "${fileName}"`, err);
        });
}

function getGpgOptions(ctx: BaseContext): GpgOptions {
    if ((<ExecutionContext>ctx).options && (<any>(<ExecutionContext>ctx).options).gpg) {
        return (<any>(<ExecutionContext>ctx).options).gpg;
    }

    return (<any>ctx.config.defaults).gpg || {};
}