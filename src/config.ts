import * as yaml from "js-yaml";
import * as fs from "fs-extra";
import {Config, Host} from "../types";
import * as path from "path";
import * as _ from "lodash";

const DEFAULT_CONFIG = './stampy.yaml';

export async function getConfig(config: string): Promise<string> {
    if (config) {
        return config;
    } else if (!config) {
        return DEFAULT_CONFIG;
    }
}

export async function load(file: string, groups: string[]): Promise<Config> {
    const exists = await fs.pathExists(file);
    if (!exists) {
        throw new Error(`Could not find config "${path.resolve(file)}"`);
    }

    const stats = await fs.stat(file);
    if (!stats.isFile()) {
        throw new Error(`Config "${file}" must be a file`);
    }

    const fileContents = await fs.readFile(file, 'utf8');
    const config: Config = yaml.safeLoad(fileContents);
    if (config.hosts) {
        config.roles = transformHostsToRoles(config.hosts);
    }
    config.data = config.data || {};
    config.defaults = <any>config.defaults || {};
    config.defaults.ssh = config.defaults.ssh || {};
    for (let groupName of groups) {
        if (!config.groups[groupName]) {
            throw new Error(`Could not find group with name "${groupName}"`);
        }
        _.merge(config, config.groups[groupName])
    }
    return config;
}

function transformHostsToRoles(hosts): { [role: string]: Host } {
    const results = {};
    for (let host of hosts) {
        for (let role of host.roles) {
            results[role] = results[role] || {hosts: []};
            results[role].hosts.push(host.host);
        }
    }
    return results;
}
