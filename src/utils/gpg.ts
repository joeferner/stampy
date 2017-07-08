import * as openpgp from "openpgp";
import * as fs from "fs-extra";
import * as NestedError from "nested-error-stacks";
import * as passwordPrompt from "password-prompt";
import * as path from "path";
import {BaseContext, ExecutionContext} from "../../types";

const DEFAULT_FILE_NAME = 'stampy.gpg';

interface GpgOptions {
    fileName?: string;
    password?: string;
}

export async function getDecryptedObject(ctx: BaseContext): Promise<any> {
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

export async function writeEncryptedObject(ctx: BaseContext, obj: any): Promise<void> {
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

let lastPassword = null;
function getPassword(ctx: BaseContext): Promise<string> {
    const gpgOptions = getGpgOptions(ctx);
    if ('password' in gpgOptions) {
        return Promise.resolve(gpgOptions.password);
    }
    if (lastPassword) {
        return lastPassword;
    }
    lastPassword = passwordPrompt("GPG password: ", {method: 'hide'});
    return lastPassword;
}

export function getFileName(ctx: BaseContext) {
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
